import winston from 'winston';
import Transport from 'winston-transport';
import { getFluentd } from './fluentd/fluentd';
import { currentTrace } from './tracing/zipkin';

/** Winston transport that ships every log line to Fluentd (when FLUENTD_HOST is set). */
class FluentdTransport extends Transport {
  constructor(private readonly service: string) {
    super();
  }

  log(info: Record<string, unknown>, next: () => void): void {
    const fluent = getFluentd(this.service);
    if (fluent) {
      const { level, message, ...rest } = info;
      fluent.emit('log', { level, message, service: this.service, ...rest });
    }
    next();
  }
}

/** Adds the active Zipkin trace id to each line so logs and traces can be joined. */
const traceFormat = winston.format((info) => {
  const trace = currentTrace();
  if (trace) info.traceId = trace.traceId;
  return info;
});

export function createLogger(service: string): winston.Logger {
  const transports: winston.transport[] = [
    new winston.transports.Console({
      format:
        process.env.LOG_FORMAT === 'pretty'
          ? winston.format.combine(winston.format.colorize(), winston.format.simple())
          : winston.format.json(),
    }),
  ];
  if (process.env.FLUENTD_HOST) transports.push(new FluentdTransport(service));

  return winston.createLogger({
    level: process.env.LOG_LEVEL ?? 'info',
    defaultMeta: { service },
    format: winston.format.combine(winston.format.timestamp(), traceFormat(), winston.format.errors({ stack: true })),
    transports,
  });
}

export type Logger = winston.Logger;
