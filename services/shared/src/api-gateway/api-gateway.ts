/**
 * API Gateway (HLD): route table -> service, JWT authentication (optionally admin-only), per-client
 * token-bucket rate limiting per route, service discovery with round-robin, a circuit breaker per
 * downstream service and streaming reverse proxying (http-proxy-middleware).
 */
import type { ClientRequest, IncomingMessage, ServerResponse } from 'node:http';
import type { Express, NextFunction, Request, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { CircuitBreaker } from '../circuit-breaker/circuit-breaker';
import { ServiceDiscovery } from '../service-discovery/service-discovery';
import { IDENTITY_HEADERS, verifyToken, type AuthUser } from '../auth';
import { breakerState } from '../metrics';
import { b3Headers, currentTrace } from '../tracing/zipkin';
import type { Logger } from '../logger';

export interface RouteConfig {
  path: string;
  methods: string[];
  targetService: string;
  requiresAuth: boolean;
  adminOnly: boolean;
  /** Requests per minute per client for this route. */
  rateLimit: number;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

type GatewayRequest = Request & { gatewayRoute?: RouteConfig; gatewayUser?: AuthUser; gatewayTarget?: string };

export class APIGateway {
  private routes: RouteConfig[] = [];
  private buckets = new Map<string, Bucket>();
  private breakers = new Map<string, CircuitBreaker>();
  private proxy: (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => Promise<void>;

  constructor(private readonly discovery: ServiceDiscovery, private readonly logger: Logger) {
    this.proxy = createProxyMiddleware<IncomingMessage, ServerResponse>({
      changeOrigin: true,
      xfwd: true,
      proxyTimeout: Number(process.env.PROXY_TIMEOUT_MS ?? 15_000),
      router: (req) => (req as unknown as GatewayRequest).gatewayTarget!,
      // Express strips nothing here because the proxy is mounted at '/', so the path is forwarded unchanged.
      on: {
        proxyReq: (proxyReq: ClientRequest, req: IncomingMessage) => this.decorate(proxyReq, req as unknown as GatewayRequest),
        proxyRes: (proxyRes: IncomingMessage, req: IncomingMessage) => {
          const r = req as unknown as GatewayRequest;
          const breaker = this.breaker(r.gatewayRoute!.targetService);
          if ((proxyRes.statusCode ?? 500) >= 500) breaker.recordFailure();
          else breaker.recordSuccess();
        },
        error: (err: Error, req: IncomingMessage, res: ServerResponse | import('node:net').Socket) => {
          const r = req as unknown as GatewayRequest;
          const service = r.gatewayRoute?.targetService ?? 'unknown';
          this.breaker(service).recordFailure();
          this.logger.error('proxy error', { service, err: err.message });
          if ('writeHead' in res && !res.headersSent) {
            res.writeHead(503, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: `${service} unavailable` }));
          }
        },
      },
    });
  }

  addRoute(path: string, methods: string[], targetService: string, requiresAuth = true, rateLimit = 100, adminOnly = false): void {
    this.routes.push({ path, methods: methods.map((m) => m.toUpperCase()), targetService, requiresAuth, adminOnly, rateLimit });
    // Most specific first: more segments, then fewer :params. So /api/users/login beats /api/users.
    const score = (r: RouteConfig) => {
      const segs = r.path.split('/').filter(Boolean);
      return segs.length * 10 - segs.filter((x) => x.startsWith(':')).length;
    };
    this.routes.sort((a, b) => score(b) - score(a));
  }

  getRoutes(): RouteConfig[] {
    return [...this.routes];
  }

  /** Segment-prefix match: every route segment must equal (or, for `:param`, fill) the request segment. */
  findRoute(path: string, method: string): RouteConfig | null {
    const req = path.split('?')[0].split('/').filter(Boolean);
    return (
      this.routes.find((r) => {
        if (!r.methods.includes(method)) return false;
        const segs = r.path.split('/').filter(Boolean);
        return segs.length <= req.length && segs.every((seg, i) => seg.startsWith(':') || seg === req[i]);
      }) ?? null
    );
  }

  breaker(service: string): CircuitBreaker {
    let b = this.breakers.get(service);
    if (!b) {
      b = new CircuitBreaker({
        name: service,
        onStateChange: (name, state) => {
          breakerState.set({ target: name }, state === 'closed' ? 0 : state === 'half-open' ? 1 : 2);
          this.logger.warn('gateway circuit breaker', { service: name, state });
        },
      });
      this.breakers.set(service, b);
    }
    return b;
  }

  breakerSnapshot() {
    return [...this.breakers.values()].map((b) => b.snapshot());
  }

  /** Token bucket: capacity = rateLimit, refilled continuously at rateLimit per minute. */
  checkRateLimit(clientId: string, route: RouteConfig): { allowed: boolean; remaining: number; retryAfter: number } {
    const key = `${route.path}:${clientId}`;
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? { tokens: route.rateLimit, lastRefill: now };
    const refill = ((now - bucket.lastRefill) / 60_000) * route.rateLimit;
    bucket.tokens = Math.min(route.rateLimit, bucket.tokens + refill);
    bucket.lastRefill = now;
    this.buckets.set(key, bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfter: 0 };
    }
    return { allowed: false, remaining: 0, retryAfter: Math.ceil(((1 - bucket.tokens) / route.rateLimit) * 60) };
  }

  private authenticate(req: Request): AuthUser | null {
    const header = req.header('authorization') ?? '';
    if (!header.startsWith('Bearer ')) return null;
    try {
      return verifyToken(header.slice(7));
    } catch {
      return null;
    }
  }

  /** Strips client-supplied identity headers and adds verified identity + trace headers. */
  private decorate(proxyReq: ClientRequest, req: GatewayRequest): void {
    for (const h of Object.values(IDENTITY_HEADERS)) proxyReq.removeHeader(h);
    proxyReq.removeHeader('x-internal-token');
    const user = req.gatewayUser;
    if (user) {
      proxyReq.setHeader(IDENTITY_HEADERS.id, user.id);
      proxyReq.setHeader(IDENTITY_HEADERS.email, user.email);
      proxyReq.setHeader(IDENTITY_HEADERS.role, user.role);
      proxyReq.setHeader(IDENTITY_HEADERS.gatewayToken, process.env.GATEWAY_SHARED_SECRET ?? '');
    }
    const trace = currentTrace();
    if (trace) for (const [k, v] of Object.entries(b3Headers(trace))) proxyReq.setHeader(k, v);
    // express.json() may have consumed the body; re-send it.
    const body = (req as Request).body;
    if (body && typeof body === 'object' && Object.keys(body).length > 0 && (req.headers['content-type'] ?? '').includes('application/json')) {
      const data = JSON.stringify(body);
      proxyReq.setHeader('content-length', Buffer.byteLength(data));
      proxyReq.write(data);
    }
  }

  handleRequest = (req: Request, res: Response, next: NextFunction): void => {
    const r = req as GatewayRequest;
    const route = this.findRoute(req.path, req.method);
    if (!route) return next();

    const user = this.authenticate(req);
    if (route.requiresAuth && !user) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    if (route.adminOnly && user?.role !== 'admin') {
      res.status(403).json({ success: false, error: 'Admin role required' });
      return;
    }

    const limit = this.checkRateLimit(user?.id ?? req.ip ?? 'unknown', route);
    res.setHeader('x-ratelimit-limit', route.rateLimit);
    res.setHeader('x-ratelimit-remaining', limit.remaining);
    if (!limit.allowed) {
      res.setHeader('retry-after', limit.retryAfter);
      res.status(429).json({ success: false, error: 'Rate limit exceeded', retryAfterSeconds: limit.retryAfter });
      return;
    }

    if (!this.breaker(route.targetService).allowRequest()) {
      res.status(503).json({ success: false, error: `${route.targetService} unavailable (circuit open)` });
      return;
    }

    const instance = this.discovery.discoverService(route.targetService);
    if (!instance) {
      res.status(503).json({ success: false, error: `${route.targetService} has no healthy instances` });
      return;
    }
    r.gatewayRoute = route;
    r.gatewayUser = user ?? undefined;
    r.gatewayTarget = this.discovery.baseUrl(instance);
    res.setHeader('x-upstream-instance', instance.instanceId);
    void this.proxy(req, res, next);
  };

  mount(app: Express): void {
    app.use(this.handleRequest);
  }
}
