// Zipkin distributed tracing: B3 header propagation, server/client spans, batched HTTP reporting (Zipkin v2 JSON).
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentId?: string;
  sampled: boolean;
}

interface ZipkinSpan {
  traceId: string;
  id: string;
  parentId?: string;
  name: string;
  kind: 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER';
  timestamp: number;
  duration: number;
  localEndpoint: { serviceName: string };
  remoteEndpoint?: { serviceName: string };
  tags: Record<string, string>;
  annotations?: { timestamp: number; value: string }[];
}

const storage = new AsyncLocalStorage<TraceContext>();
const newId = (): string => randomBytes(8).toString('hex');
const nowMicros = (): number => Math.round(performance.timeOrigin * 1000 + performance.now() * 1000);

export function currentTrace(): TraceContext | undefined {
  return storage.getStore();
}

export class ZipkinService {
  private queue: ZipkinSpan[] = [];
  private timer: NodeJS.Timeout;

  constructor(
    readonly serviceName: string,
    private readonly zipkinUrl: string,
    private readonly sampleRate = 1,
  ) {
    this.timer = setInterval(() => void this.flush(), 2000);
    this.timer.unref();
  }

  /** Express middleware: continues an incoming B3 trace (or starts one) and records a SERVER span. */
  middleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      const incomingTrace = req.header('x-b3-traceid');
      const ctx: TraceContext = {
        traceId: incomingTrace ?? randomBytes(16).toString('hex'),
        spanId: newId(),
        parentId: incomingTrace ? req.header('x-b3-spanid') : undefined,
        sampled: req.header('x-b3-sampled') ? req.header('x-b3-sampled') === '1' : Math.random() < this.sampleRate,
      };
      const start = nowMicros();
      res.setHeader('x-trace-id', ctx.traceId);
      res.on('finish', () => {
        this.record({
          traceId: ctx.traceId,
          id: ctx.spanId,
          parentId: ctx.parentId,
          name: `${req.method.toLowerCase()} ${req.route?.path ? req.baseUrl + req.route.path : req.path}`,
          kind: 'SERVER',
          timestamp: start,
          duration: Math.max(1, nowMicros() - start),
          localEndpoint: { serviceName: this.serviceName },
          tags: { 'http.method': req.method, 'http.path': req.originalUrl, 'http.status_code': String(res.statusCode) },
        }, ctx.sampled);
      });
      storage.run(ctx, next);
    };
  }

  /** Wraps an outgoing call in a CLIENT span; returns the B3 headers to send downstream. */
  async traceClient<T>(name: string, remoteService: string, fn: (headers: Record<string, string>) => Promise<T>): Promise<T> {
    const parent = currentTrace();
    const ctx: TraceContext = {
      traceId: parent?.traceId ?? randomBytes(16).toString('hex'),
      spanId: newId(),
      parentId: parent?.spanId,
      sampled: parent?.sampled ?? Math.random() < this.sampleRate,
    };
    const headers = b3Headers(ctx);
    const start = nowMicros();
    const tags: Record<string, string> = {};
    try {
      return await fn(headers);
    } catch (err) {
      tags.error = (err as Error).message;
      throw err;
    } finally {
      this.record({
        traceId: ctx.traceId,
        id: ctx.spanId,
        parentId: ctx.parentId,
        name,
        kind: 'CLIENT',
        timestamp: start,
        duration: Math.max(1, nowMicros() - start),
        localEndpoint: { serviceName: this.serviceName },
        remoteEndpoint: { serviceName: remoteService },
        tags,
      }, ctx.sampled);
    }
  }

  /** Records a PRODUCER/CONSUMER span for a message-queue hop. */
  recordMessage(kind: 'PRODUCER' | 'CONSUMER', name: string, ctx: TraceContext, tags: Record<string, string> = {}): void {
    const ts = nowMicros();
    this.record({
      traceId: ctx.traceId,
      id: ctx.spanId,
      parentId: ctx.parentId,
      name,
      kind,
      timestamp: ts,
      duration: 1,
      localEndpoint: { serviceName: this.serviceName },
      remoteEndpoint: { serviceName: 'rabbitmq' },
      tags,
    }, ctx.sampled);
  }

  private record(span: ZipkinSpan, sampled: boolean): void {
    if (!sampled) return;
    this.queue.push(span);
    if (this.queue.length >= 100) void this.flush();
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    try {
      await fetch(`${this.zipkinUrl.replace(/\/$/, '')}/api/v2/spans`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // Tracing is best-effort: losing spans must not affect requests.
    }
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }
}

export function b3Headers(ctx: TraceContext): Record<string, string> {
  const headers: Record<string, string> = {
    'x-b3-traceid': ctx.traceId,
    'x-b3-spanid': ctx.spanId,
    'x-b3-sampled': ctx.sampled ? '1' : '0',
  };
  if (ctx.parentId) headers['x-b3-parentspanid'] = ctx.parentId;
  return headers;
}

/** Runs fn inside a trace context (used by message consumers to continue a trace). */
export function runWithTrace<T>(ctx: TraceContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function childContext(parent?: TraceContext): TraceContext {
  return {
    traceId: parent?.traceId ?? randomBytes(16).toString('hex'),
    spanId: newId(),
    parentId: parent?.spanId,
    sampled: parent?.sampled ?? true,
  };
}

let tracer: ZipkinService | null | undefined;

/** Process-wide tracer, or null when ZIPKIN_URL is not configured. */
export function getTracer(serviceName: string): ZipkinService | null {
  if (tracer !== undefined) return tracer;
  tracer = process.env.ZIPKIN_URL
    ? new ZipkinService(process.env.ZIPKIN_SERVICE_NAME ?? serviceName, process.env.ZIPKIN_URL, Number(process.env.ZIPKIN_SAMPLE_RATE ?? 1))
    : null;
  return tracer;
}
