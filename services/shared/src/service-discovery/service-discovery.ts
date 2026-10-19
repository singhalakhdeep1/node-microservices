/**
 * Service Discovery (HLD): registry of service instances with heartbeats, real HTTP health checks,
 * round-robin selection and cleanup of dead instances. When Consul is configured the registry is
 * refreshed from Consul's passing health checks; otherwise it is seeded from static URLs (env).
 */
import { ConsulService } from '../consul/consul';

export interface ServiceInstance {
  serviceName: string;
  instanceId: string;
  host: string;
  port: number;
  protocol: 'http' | 'https';
  healthCheckPath: string;
  metadata: Record<string, string>;
  lastHeartbeat: number;
  isHealthy: boolean;
}

export class ServiceDiscovery {
  private services = new Map<string, ServiceInstance[]>();
  private cursors = new Map<string, number>();
  /** Statically configured instances (env URLs), kept as the last-resort fallback. */
  private seeds = new Map<string, ServiceInstance[]>();
  private timers: NodeJS.Timeout[] = [];
  readonly heartbeatInterval = Number(process.env.HEARTBEAT_INTERVAL ?? 30_000);
  readonly heartbeatTimeout = Number(process.env.HEARTBEAT_TIMEOUT ?? 60_000);

  constructor(private readonly consul: ConsulService | null = null) {}

  registerService(serviceName: string, instanceId: string, host: string, port: number, healthCheckPath = '/health', metadata: Record<string, string> = {}, protocol: 'http' | 'https' = 'http'): void {
    const list = (this.services.get(serviceName) ?? []).filter((s) => s.instanceId !== instanceId);
    list.push({ serviceName, instanceId, host, port, protocol, healthCheckPath, metadata, lastHeartbeat: Date.now(), isHealthy: true });
    this.services.set(serviceName, list);
  }

  /** Registers a statically configured instance from a base URL such as http://user-service:3001. */
  registerUrl(serviceName: string, baseUrl: string): void {
    const url = new URL(baseUrl);
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    this.registerService(serviceName, `${serviceName}@${url.host}`, url.hostname, port, '/health', { static: 'true' }, url.protocol === 'https:' ? 'https' : 'http');
    this.seeds.set(serviceName, (this.services.get(serviceName) ?? []).filter((s) => s.metadata.static === 'true'));
  }

  deregisterService(serviceName: string, instanceId: string): void {
    const list = this.services.get(serviceName);
    if (list) this.services.set(serviceName, list.filter((s) => s.instanceId !== instanceId));
  }

  private alive(s: ServiceInstance): boolean {
    return s.isHealthy && Date.now() - s.lastHeartbeat < this.heartbeatTimeout;
  }

  /**
   * Round-robin over healthy instances. When every instance is marked unhealthy it falls back to
   * all registered instances ("panic routing"), so a restarted service is reachable before the next
   * health probe; the caller's circuit breaker limits the cost of trying a dead one.
   */
  discoverService(serviceName: string): ServiceInstance | null {
    const healthy = this.discoverAllInstances(serviceName);
    const registered = this.services.get(serviceName) ?? [];
    const pool = healthy.length ? healthy : registered.length ? registered : this.seeds.get(serviceName) ?? [];
    if (pool.length === 0) return null;
    const cursor = (this.cursors.get(serviceName) ?? 0) % pool.length;
    this.cursors.set(serviceName, cursor + 1);
    return pool[cursor];
  }

  discoverAllInstances(serviceName: string): ServiceInstance[] {
    return (this.services.get(serviceName) ?? []).filter((s) => this.alive(s));
  }

  baseUrl(instance: ServiceInstance): string {
    return `${instance.protocol}://${instance.host}:${instance.port}`;
  }

  sendHeartbeat(serviceName: string, instanceId: string): void {
    const inst = this.services.get(serviceName)?.find((s) => s.instanceId === instanceId);
    if (inst) {
      inst.lastHeartbeat = Date.now();
      inst.isHealthy = true;
    }
  }

  /** Probes every instance's health endpoint; a successful probe counts as a heartbeat. */
  async healthCheck(): Promise<void> {
    const checks: Promise<void>[] = [];
    for (const instances of this.services.values()) {
      for (const inst of instances) {
        checks.push(
          fetch(`${this.baseUrl(inst)}${inst.healthCheckPath}`, { signal: AbortSignal.timeout(3000) })
            .then((res) => {
              inst.isHealthy = res.ok;
              if (res.ok) inst.lastHeartbeat = Date.now();
            })
            .catch(() => {
              inst.isHealthy = false;
            }),
        );
      }
    }
    await Promise.all(checks);
  }

  /** Replaces the instance list of each service with Consul's passing instances. */
  async syncFromConsul(serviceNames: string[]): Promise<void> {
    if (!this.consul) return;
    await Promise.all(
      serviceNames.map(async (name) => {
        try {
          const instances = await this.consul!.healthyInstances(name);
          if (instances.length === 0) return; // keep static fallbacks if Consul has none yet
          this.services.set(
            name,
            instances.map((i) => ({
              serviceName: name,
              instanceId: i.id,
              host: i.address,
              port: i.port,
              protocol: 'http' as const,
              healthCheckPath: '/health',
              metadata: { source: 'consul' },
              lastHeartbeat: Date.now(),
              isHealthy: true,
            })),
          );
        } catch {
          // Consul unreachable: keep the last known registry.
        }
      }),
    );
  }

  cleanupUnhealthyInstances(): void {
    const now = Date.now();
    for (const [name, list] of this.services) {
      // Static instances are kept (they are re-probed); dynamic ones expire after the heartbeat timeout.
      const kept = list.filter((s) => s.metadata.static === 'true' || now - s.lastHeartbeat < this.heartbeatTimeout);
      if (kept.length === 0) this.services.delete(name);
      else this.services.set(name, kept);
    }
  }

  /** Starts periodic health checks (and Consul sync when configured). */
  start(serviceNames: string[], intervalMs = 10_000): void {
    const tick = async () => {
      await this.syncFromConsul(serviceNames);
      await this.healthCheck();
      this.cleanupUnhealthyInstances();
    };
    void tick();
    const t = setInterval(() => void tick(), intervalMs);
    t.unref();
    this.timers.push(t);
  }

  stop(): void {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  getAllServices(): Record<string, ServiceInstance[]> {
    return Object.fromEntries(this.services);
  }
}
