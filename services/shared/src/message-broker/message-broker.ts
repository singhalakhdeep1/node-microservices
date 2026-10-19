/**
 * Message Broker / Event Bus (HLD). Domain events go to one durable RabbitMQ *topic* exchange
 * (`EVENTS_EXCHANGE`, routing key = event type, e.g. `order.created`). Each consumer gets its own
 * durable queue bound by pattern; failed messages are dead-lettered to `<exchange>.dlx`.
 * Without RABBITMQ_URL an in-process EventEmitter bus is used (single-process dev only).
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import amqp from 'amqplib';
import type { Logger } from '../logger';
import { eventsCounter } from '../metrics';
import { childContext, currentTrace, getTracer, runWithTrace, type TraceContext } from '../tracing/zipkin';

export interface EventEnvelope<T = unknown> {
  id: string;
  type: string;
  source: string;
  data: T;
  timestamp: string;
  correlationId?: string;
  trace?: TraceContext;
}

export type EventHandler<T = unknown> = (event: EventEnvelope<T>) => Promise<void> | void;

export interface Broker {
  readonly kind: 'rabbitmq' | 'memory';
  connect(): Promise<void>;
  publish<T>(type: string, data: T, correlationId?: string): Promise<boolean>;
  subscribe<T>(queue: string, patterns: string[], handler: EventHandler<T>): Promise<void>;
  isConnected(): boolean;
  close(): Promise<void>;
}

function envelope<T>(source: string, type: string, data: T, correlationId?: string): EventEnvelope<T> {
  return {
    id: randomUUID(),
    type,
    source,
    data,
    timestamp: new Date().toISOString(),
    correlationId,
    trace: childContext(currentTrace()),
  };
}

/** Topic-style pattern match (`*` = one word, `#` = zero or more words). */
export function topicMatches(pattern: string, key: string): boolean {
  const p = pattern.split('.');
  const k = key.split('.');
  const walk = (i: number, j: number): boolean => {
    if (i === p.length) return j === k.length;
    if (p[i] === '#') return walk(i + 1, j) || (j < k.length && walk(i, j + 1));
    if (j === k.length) return false;
    return (p[i] === '*' || p[i] === k[j]) && walk(i + 1, j + 1);
  };
  return walk(0, 0);
}

/** In-process publish/subscribe bus with correlation ids. */
export class MessageBroker extends EventEmitter implements Broker {
  readonly kind = 'memory' as const;
  private subscribers = new Map<string, { patterns: string[]; handler: EventHandler<any> }>();

  constructor(private readonly source = 'local', private readonly logger?: Logger) {
    super();
  }

  async connect(): Promise<void> {}

  async publish<T>(type: string, data: T, correlationId?: string): Promise<boolean> {
    const evt = envelope(this.source, type, data, correlationId);
    for (const { patterns, handler } of this.subscribers.values()) {
      if (patterns.some((p) => topicMatches(p, type))) {
        Promise.resolve()
          .then(() => handler(evt))
          .catch((err) => this.logger?.error('in-memory handler failed', { type, err: (err as Error).message }));
      }
    }
    this.emit(type, evt);
    return true;
  }

  async subscribe<T>(queue: string, patterns: string[], handler: EventHandler<T>): Promise<void> {
    this.subscribers.set(queue, { patterns, handler });
  }

  unsubscribe(queue: string): void {
    this.subscribers.delete(queue);
  }

  isConnected(): boolean {
    return true;
  }

  async close(): Promise<void> {
    this.subscribers.clear();
  }
}

type Subscription = { queue: string; patterns: string[]; handler: EventHandler<any> };

/** RabbitMQ (AMQP 0-9-1) broker with reconnect, publisher confirms, manual acks and a dead-letter exchange. */
export class RabbitMQBroker implements Broker {
  readonly kind = 'rabbitmq' as const;
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.ConfirmChannel | null = null;
  private subscriptions: Subscription[] = [];
  private closing = false;
  private readonly exchange: string;
  private readonly dlx: string;

  constructor(private readonly url: string, private readonly source: string, private readonly logger: Logger, exchange = process.env.EVENTS_EXCHANGE ?? 'microservices.events') {
    this.exchange = exchange;
    this.dlx = `${exchange}.dlx`;
  }

  async connect(): Promise<void> {
    try {
      const conn = await amqp.connect(this.url);
      const ch = await conn.createConfirmChannel();
      await ch.assertExchange(this.exchange, 'topic', { durable: true });
      await ch.assertExchange(this.dlx, 'fanout', { durable: true });
      await ch.assertQueue(`${this.exchange}.dead-letter`, { durable: true });
      await ch.bindQueue(`${this.exchange}.dead-letter`, this.dlx, '');
      await ch.prefetch(Number(process.env.RABBITMQ_PREFETCH ?? 20));
      this.connection = conn;
      this.channel = ch;
      conn.on('error', (err) => this.logger.error('RabbitMQ connection error', { err: err.message }));
      conn.on('close', () => {
        this.channel = null;
        this.connection = null;
        if (!this.closing) {
          this.logger.warn('RabbitMQ connection closed, reconnecting in 5s');
          setTimeout(() => void this.connect(), 5000);
        }
      });
      for (const sub of this.subscriptions) await this.bind(sub);
      this.logger.info('RabbitMQ connected', { exchange: this.exchange });
    } catch (err) {
      this.logger.error('RabbitMQ connect failed, retrying in 5s', { err: (err as Error).message });
      if (!this.closing) setTimeout(() => void this.connect(), 5000);
    }
  }

  isConnected(): boolean {
    return this.channel !== null;
  }

  async publish<T>(type: string, data: T, correlationId?: string): Promise<boolean> {
    if (!this.channel) {
      this.logger.error('RabbitMQ not connected; event dropped', { type });
      return false;
    }
    const evt = envelope(this.source, type, data, correlationId);
    const ch = this.channel;
    try {
      await new Promise<void>((resolve, reject) => {
        ch.publish(this.exchange, type, Buffer.from(JSON.stringify(evt)), {
          persistent: true,
          contentType: 'application/json',
          messageId: evt.id,
          correlationId,
          type,
          appId: this.source,
          timestamp: Math.floor(Date.now() / 1000),
        }, (err) => (err ? reject(err) : resolve()));
      });
      if (evt.trace) getTracer(this.source)?.recordMessage('PRODUCER', `publish ${type}`, evt.trace, { 'messaging.routing_key': type });
      eventsCounter.inc({ service: this.source, direction: 'published', type });
      this.logger.info('event published', { type, id: evt.id });
      return true;
    } catch (err) {
      this.logger.error('event publish failed', { type, err: (err as Error).message });
      return false;
    }
  }

  async subscribe<T>(queue: string, patterns: string[], handler: EventHandler<T>): Promise<void> {
    const sub: Subscription = { queue, patterns, handler };
    this.subscriptions.push(sub);
    if (this.channel) await this.bind(sub);
  }

  private async bind(sub: Subscription): Promise<void> {
    const ch = this.channel!;
    await ch.assertQueue(sub.queue, { durable: true, deadLetterExchange: this.dlx });
    for (const p of sub.patterns) await ch.bindQueue(sub.queue, this.exchange, p);
    await ch.consume(sub.queue, async (msg) => {
      if (!msg) return;
      let evt: EventEnvelope;
      try {
        evt = JSON.parse(msg.content.toString());
      } catch {
        ch.nack(msg, false, false);
        return;
      }
      const ctx = evt.trace ? childContext(evt.trace) : childContext();
      try {
        await runWithTrace(ctx, () => sub.handler(evt));
        getTracer(this.source)?.recordMessage('CONSUMER', `consume ${evt.type}`, ctx, { 'messaging.queue': sub.queue });
        ch.ack(msg);
      } catch (err) {
        // Retry once by requeueing; a redelivered message that fails again goes to the DLX.
        this.logger.error('event handler failed', { type: evt.type, queue: sub.queue, redelivered: msg.fields.redelivered, err: (err as Error).message });
        ch.nack(msg, false, !msg.fields.redelivered);
      }
    });
    this.logger.info('subscribed', { queue: sub.queue, patterns: sub.patterns });
  }

  async close(): Promise<void> {
    this.closing = true;
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }
}

export function createBroker(source: string, logger: Logger): Broker {
  return process.env.RABBITMQ_URL ? new RabbitMQBroker(process.env.RABBITMQ_URL, source, logger) : new MessageBroker(source, logger);
}

export const Events = {
  USER_REGISTERED: 'user.registered',
  USER_UPDATED: 'user.updated',
  PRODUCT_CREATED: 'product.created',
  PRODUCT_UPDATED: 'product.updated',
  PRODUCT_DELETED: 'product.deleted',
  STOCK_LOW: 'product.stock_low',
  ORDER_CREATED: 'order.created',
  ORDER_STATUS_CHANGED: 'order.status_changed',
  ORDER_CANCELLED: 'order.cancelled',
} as const;
