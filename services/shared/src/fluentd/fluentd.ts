// Fluentd integration: forwards structured log events to a Fluentd agent over the forward protocol.
import fluentLogger from 'fluent-logger';

export interface FluentdOptions {
  host?: string;
  port?: number;
  timeout?: number;
  reconnectInterval?: number;
}

type Sender = ReturnType<typeof fluentLogger.createFluentSender>;

export class FluentdService {
  private sender: Sender;

  constructor(private readonly tag: string, options: FluentdOptions = {}) {
    this.sender = fluentLogger.createFluentSender(tag, {
      host: options.host ?? 'localhost',
      port: options.port ?? 24224,
      timeout: options.timeout ?? 3.0,
      reconnectInterval: options.reconnectInterval ?? 60_000,
    });
    // A missing agent must never crash the service; events are dropped until it reconnects.
    (this.sender as unknown as NodeJS.EventEmitter).on('error', () => undefined);
  }

  emit(label: string, data: Record<string, unknown>): void {
    this.sender.emit(label, data);
  }

  emitError(error: Error, context: Record<string, unknown> = {}): void {
    this.emit('error', { message: error.message, stack: error.stack, name: error.name, ...context });
  }

  emitHttpRequest(method: string, path: string, status: number, durationMs: number, extra: Record<string, unknown> = {}): void {
    this.emit('http', { method, path, status, durationMs, ...extra });
  }

  emitDbQuery(collection: string, operation: string, durationMs: number): void {
    this.emit('db', { collection, operation, durationMs });
  }

  close(): void {
    // end() with no record just closes the socket (the bundled typings only declare the 3-arg form).
    (this.sender as unknown as { end: () => void }).end();
  }
}

let shared: FluentdService | null | undefined;

/** Returns the process-wide Fluentd sender, or null when FLUENTD_HOST is not configured. */
export function getFluentd(tag: string): FluentdService | null {
  if (shared !== undefined) return shared;
  shared = process.env.FLUENTD_HOST
    ? new FluentdService(process.env.FLUENTD_TAG ? `${process.env.FLUENTD_TAG}.${tag}` : tag, {
        host: process.env.FLUENTD_HOST,
        port: Number(process.env.FLUENTD_PORT ?? 24224),
      })
    : null;
  return shared;
}
