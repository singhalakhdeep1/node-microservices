/**
 * API Gateway: single entry point for the frontend. JWT auth, per-route token-bucket rate limits,
 * global IP rate limit, service discovery (Consul or static), circuit breakers, proxying,
 * aggregated health, admin status views (routes, breakers, registry, Traefik edge).
 */
import 'dotenv/config';
import rateLimit from 'express-rate-limit';
import { APIGateway, asyncHandler, consulFromEnv, createService, HttpError, requireAdmin, ServiceDiscovery } from '@nms/shared';
import { TraefikService } from './traefik';

const NAME = 'api-gateway';
const SERVICES = {
  'user-service': process.env.USER_SERVICE_URL ?? 'http://localhost:3001',
  'product-service': process.env.PRODUCT_SERVICE_URL ?? 'http://localhost:3002',
  'order-service': process.env.ORDER_SERVICE_URL ?? 'http://localhost:3003',
  'notification-service': process.env.NOTIFICATION_SERVICE_URL ?? 'http://localhost:3004',
};

const discovery = new ServiceDiscovery(consulFromEnv());
for (const [name, url] of Object.entries(SERVICES)) discovery.registerUrl(name, url);

const probe = (name: string) => async () => {
  const inst = discovery.discoverService(name) ?? discovery.getAllServices()[name]?.[0];
  if (!inst) return 'unavailable';
  try {
    const res = await fetch(`${discovery.baseUrl(inst)}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok ? 'healthy' : 'unhealthy';
  } catch {
    return 'unavailable';
  }
};

const service = createService({
  name: NAME,
  port: Number(process.env.PORT ?? 3000),
  health: Object.fromEntries(Object.keys(SERVICES).map((n) => [n, probe(n)])),
});
const { app, logger } = service;
const gateway = new APIGateway(discovery, logger);
const traefik = process.env.TRAEFIK_API_URL ? new TraefikService(process.env.TRAEFIK_API_URL) : null;

// path, methods, service, requiresAuth, requests/min, adminOnly
gateway.addRoute('/api/users/register', ['POST'], 'user-service', false, 10);
gateway.addRoute('/api/users/login', ['POST'], 'user-service', false, 20);
gateway.addRoute('/api/users/:id/avatar', ['GET'], 'user-service', false, 300);
gateway.addRoute('/api/users', ['GET', 'POST', 'PATCH'], 'user-service', true, 120);
gateway.addRoute('/api/products', ['GET'], 'product-service', false, 300);
gateway.addRoute('/api/products', ['POST', 'PUT', 'DELETE'], 'product-service', true, 60, true);
gateway.addRoute('/api/orders', ['GET', 'POST', 'PUT'], 'order-service', true, 120);
gateway.addRoute('/api/notifications', ['GET', 'PATCH', 'POST'], 'notification-service', true, 120);

async function main() {
  discovery.start(Object.keys(SERVICES), Number(process.env.DISCOVERY_INTERVAL_MS ?? 10_000));

  await service.start((app) => {
    // Coarse per-IP flood protection in front of the per-route buckets.
    app.use(rateLimit({ windowMs: 60_000, limit: Number(process.env.GLOBAL_RATE_LIMIT ?? 600), standardHeaders: 'draft-7', legacyHeaders: false }));

    app.get('/api', (_req, res) => {
      res.json({
        success: true,
        message: 'Node Microservices API Gateway',
        version: '2.0.0',
        routes: gateway.getRoutes().map((r) => ({ path: r.path, methods: r.methods, service: r.targetService, auth: r.requiresAuth, admin: r.adminOnly, ratePerMinute: r.rateLimit })),
      });
    });

    app.get('/api/gateway/status', requireAdmin, (_req, res) => {
      res.json({
        success: true,
        data: {
          breakers: gateway.breakerSnapshot(),
          registry: Object.fromEntries(
            Object.entries(discovery.getAllServices()).map(([name, list]) => [
              name,
              list.map((i) => ({ id: i.instanceId, url: discovery.baseUrl(i), healthy: i.isHealthy, lastHeartbeat: new Date(i.lastHeartbeat).toISOString(), source: i.metadata.source ?? 'static' })),
            ]),
          ),
          consul: Boolean(process.env.CONSUL_HOST),
          tracing: Boolean(process.env.ZIPKIN_URL),
          logging: process.env.FLUENTD_HOST ? 'fluentd' : 'console',
        },
      });
    });

    app.get('/api/gateway/edge', requireAdmin, asyncHandler(async (_req, res) => {
      if (!traefik) throw new HttpError(503, 'TRAEFIK_API_URL is not configured');
      res.json({ success: true, data: await traefik.snapshot() });
    }));

    gateway.mount(app);
  }, { onStop: async () => discovery.stop() });

  logger.info('routing table', { routes: gateway.getRoutes().length, services: SERVICES });
}

main().catch((err) => {
  logger.error('startup failed', { err: (err as Error).message });
  process.exit(1);
});
