import client from 'prom-client';
import type { NextFunction, Request, Response } from 'express';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const httpRequests = new client.Counter({
  name: 'http_requests_total',
  help: 'HTTP requests handled',
  labelNames: ['service', 'method', 'route', 'status'] as const,
  registers: [registry],
});

export const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency',
  labelNames: ['service', 'method', 'route'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const breakerState = new client.Gauge({
  name: 'circuit_breaker_state',
  help: 'Circuit breaker state per downstream target (0 closed, 1 half-open, 2 open)',
  labelNames: ['target'] as const,
  registers: [registry],
});

export const eventsCounter = new client.Counter({
  name: 'domain_events_total',
  help: 'Domain events published or consumed',
  labelNames: ['service', 'direction', 'type'] as const,
  registers: [registry],
});

export const cacheCounter = new client.Counter({
  name: 'cache_requests_total',
  help: 'Cache lookups by result',
  labelNames: ['service', 'result'] as const,
  registers: [registry],
});

export function metricsMiddleware(service: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const end = httpDuration.startTimer();
    res.on('finish', () => {
      const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.baseUrl || 'unmatched';
      end({ service, method: req.method, route });
      httpRequests.inc({ service, method: req.method, route, status: String(res.statusCode) });
    });
    next();
  };
}

export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  res.setHeader('content-type', registry.contentType);
  res.send(await registry.metrics());
}
