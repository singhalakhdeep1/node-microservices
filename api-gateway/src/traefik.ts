// Traefik integration: read-only client for the Traefik API (edge routers, services, middlewares, entrypoints).
// Traefik sits in front of the gateway in docker-compose/k8s; the gateway exposes this view at /api/gateway/edge.

export class TraefikService {
  constructor(private readonly apiUrl = 'http://localhost:8080') {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.apiUrl.replace(/\/$/, '')}${path}`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`Traefik ${path} -> ${res.status}`);
    return (await res.json()) as T;
  }

  getOverview() {
    return this.get<Record<string, unknown>>('/api/overview');
  }

  getEntryPoints() {
    return this.get<unknown[]>('/api/entrypoints');
  }

  getHTTPRouters() {
    return this.get<{ name: string; rule: string; service: string; status: string; entryPoints: string[] }[]>('/api/http/routers');
  }

  getHTTPRouter(name: string) {
    return this.get<Record<string, unknown>>(`/api/http/routers/${encodeURIComponent(name)}`);
  }

  getHTTPServices() {
    return this.get<{ name: string; status: string; serverStatus?: Record<string, string> }[]>('/api/http/services');
  }

  getHTTPMiddlewares() {
    return this.get<{ name: string; type: string; status: string }[]>('/api/http/middlewares');
  }

  getTCPRouters() {
    return this.get<unknown[]>('/api/tcp/routers');
  }

  getTCPServices() {
    return this.get<unknown[]>('/api/tcp/services');
  }

  getVersion() {
    return this.get<{ Version: string }>('/api/version');
  }

  /** One call summarising the edge for the admin dashboard. */
  async snapshot() {
    const [version, routers, services, middlewares] = await Promise.all([
      this.getVersion(),
      this.getHTTPRouters(),
      this.getHTTPServices(),
      this.getHTTPMiddlewares(),
    ]);
    return {
      version: version.Version,
      routers: routers.map((r) => ({ name: r.name, rule: r.rule, service: r.service, status: r.status, entryPoints: r.entryPoints })),
      services: services.map((s) => ({ name: s.name, status: s.status, servers: s.serverStatus ?? {} })),
      middlewares: middlewares.map((m) => ({ name: m.name, type: m.type, status: m.status })),
    };
  }
}
