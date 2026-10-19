/**
 * Cache-aside helper over Redis. Every operation degrades to a miss when Redis is down or not
 * configured, so the cache can never take a service offline.
 */
import { createClient, type RedisClientType } from 'redis';
import type { Logger } from './logger';
import { cacheCounter } from './metrics';

export class Cache {
  private client: RedisClientType | null = null;

  constructor(private readonly service: string, private readonly logger: Logger, url = process.env.REDIS_URL) {
    if (!url) return;
    this.client = createClient({
      url,
      socket: { reconnectStrategy: (retries) => Math.min(retries * 200, 5000) },
    });
    this.client.on('error', (err) => this.logger.warn('Redis error', { err: err.message }));
  }

  async connect(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.connect();
      this.logger.info('Redis connected');
    } catch (err) {
      this.logger.warn('Redis connect failed; caching disabled until it reconnects', { err: (err as Error).message });
    }
  }

  isReady(): boolean {
    return this.client?.isReady ?? false;
  }

  status(): 'connected' | 'disconnected' | 'disabled' {
    if (!this.client) return 'disabled';
    return this.client.isReady ? 'connected' : 'disconnected';
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.isReady()) return null;
    try {
      const raw = await this.client!.get(key);
      cacheCounter.inc({ service: this.service, result: raw ? 'hit' : 'miss' });
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.isReady()) return;
    try {
      await this.client!.set(key, JSON.stringify(value), { EX: ttlSeconds });
    } catch {
      // ignore
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (!this.isReady() || keys.length === 0) return;
    try {
      await this.client!.del(keys);
    } catch {
      // ignore
    }
  }

  /** Deletes every key with the given prefix (used to invalidate cached list pages). */
  async delPrefix(prefix: string): Promise<void> {
    if (!this.isReady()) return;
    try {
      const keys: string[] = [];
      for await (const key of this.client!.scanIterator({ MATCH: `${prefix}*`, COUNT: 200 })) keys.push(key);
      if (keys.length) await this.client!.del(keys);
    } catch {
      // ignore
    }
  }

  /** Cache-aside: return the cached value or load, store and return it. */
  async wrap<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<{ value: T; cached: boolean }> {
    const hit = await this.get<T>(key);
    if (hit !== null) return { value: hit, cached: true };
    const value = await load();
    if (value !== null && value !== undefined) await this.set(key, value, ttlSeconds);
    return { value, cached: false };
  }

  async close(): Promise<void> {
    if (this.client?.isOpen) await this.client.quit().catch(() => undefined);
  }
}
