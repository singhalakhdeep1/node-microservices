// Consul integration over the agent HTTP API: registration with HTTP health checks, healthy-instance
// lookup, key/value store, sessions and distributed locks.

export interface ConsulRegistration {
  id: string;
  name: string;
  address: string;
  port: number;
  healthCheckUrl: string;
  tags?: string[];
  meta?: Record<string, string>;
}

export interface ConsulInstance {
  id: string;
  name: string;
  address: string;
  port: number;
  tags: string[];
}

interface HealthEntry {
  Service: { ID: string; Service: string; Address: string; Port: number; Tags: string[] | null };
  Node: { Address: string };
}

export class ConsulService {
  private readonly base: string;

  constructor(host = 'localhost', port = 8500, private readonly token?: string) {
    this.base = `http://${host}:${port}/v1`;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(this.token ? { 'x-consul-token': this.token } : {}),
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok && res.status !== 404) throw new Error(`Consul ${method} ${path} -> ${res.status} ${await res.text()}`);
    if (res.status === 404) return null as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  registerService(reg: ConsulRegistration): Promise<void> {
    return this.call('PUT', '/agent/service/register', {
      ID: reg.id,
      Name: reg.name,
      Address: reg.address,
      Port: reg.port,
      Tags: reg.tags ?? [],
      Meta: reg.meta ?? {},
      Check: { HTTP: reg.healthCheckUrl, Interval: '10s', Timeout: '5s', DeregisterCriticalServiceAfter: '1m' },
    });
  }

  deregisterService(serviceId: string): Promise<void> {
    return this.call('PUT', `/agent/service/deregister/${encodeURIComponent(serviceId)}`);
  }

  /** Instances whose health checks are passing. */
  async healthyInstances(serviceName: string): Promise<ConsulInstance[]> {
    const entries = (await this.call<HealthEntry[] | null>('GET', `/health/service/${encodeURIComponent(serviceName)}?passing=true`)) ?? [];
    return entries.map((e) => ({
      id: e.Service.ID,
      name: e.Service.Service,
      address: e.Service.Address || e.Node.Address,
      port: e.Service.Port,
      tags: e.Service.Tags ?? [],
    }));
  }

  async getAllServices(): Promise<Record<string, unknown>> {
    return (await this.call<Record<string, unknown>>('GET', '/agent/services')) ?? {};
  }

  async putKeyValue(key: string, value: string): Promise<boolean> {
    return this.call<boolean>('PUT', `/kv/${key}`, value);
  }

  async getKeyValue(key: string): Promise<string | null> {
    const rows = await this.call<{ Value: string | null }[] | null>('GET', `/kv/${key}`);
    const raw = rows?.[0]?.Value;
    return raw ? Buffer.from(raw, 'base64').toString('utf8') : null;
  }

  async deleteKeyValue(key: string): Promise<boolean> {
    return this.call<boolean>('DELETE', `/kv/${key}`);
  }

  async createSession(name: string, ttl = '30s'): Promise<string> {
    const res = await this.call<{ ID: string }>('PUT', '/session/create', { Name: name, TTL: ttl, Behavior: 'release' });
    return res.ID;
  }

  renewSession(sessionId: string): Promise<unknown> {
    return this.call('PUT', `/session/renew/${sessionId}`);
  }

  destroySession(sessionId: string): Promise<boolean> {
    return this.call<boolean>('PUT', `/session/destroy/${sessionId}`);
  }

  acquireLock(key: string, sessionId: string, value = ''): Promise<boolean> {
    return this.call<boolean>('PUT', `/kv/${key}?acquire=${sessionId}`, value);
  }

  releaseLock(key: string, sessionId: string): Promise<boolean> {
    return this.call<boolean>('PUT', `/kv/${key}?release=${sessionId}`, '');
  }
}

export function consulFromEnv(): ConsulService | null {
  if (!process.env.CONSUL_HOST) return null;
  return new ConsulService(process.env.CONSUL_HOST, Number(process.env.CONSUL_PORT ?? 8500), process.env.CONSUL_TOKEN);
}
