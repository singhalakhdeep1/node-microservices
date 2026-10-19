/**
 * Common service bootstrap: security middleware, identity, Zipkin tracing, Prometheus metrics,
 * request logging (to Fluentd when configured), health and metrics endpoints, uniform errors,
 * Consul registration and graceful shutdown.
 */
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import os from 'node:os';
import type { Server } from 'node:http';
import { createLogger, type Logger } from './logger';
import { identify } from './auth';
import { HttpError } from './errors';
import { metricsHandler, metricsMiddleware } from './metrics';
import { getTracer } from './tracing/zipkin';
import { getFluentd } from './fluentd/fluentd';
import { consulFromEnv } from './consul/consul';

export type HealthCheck = () => Promise<string> | string;

export interface ServiceOptions {
  name: string;
  port: number;
  /** Named dependency checks; a value other than 'connected'/'ok'/'disabled' marks the service degraded. */
  health?: Record<string, HealthCheck>;
  /** Required dependencies: if one is not healthy the health endpoint returns 503. */
  critical?: string[];
  jsonLimit?: string;
}

export interface Service {
  app: Express;
  logger: Logger;
  /** Mounts the routes and the 404/error handlers, starts listening, registers with Consul. */
  start(mount: (app: Express) => void, hooks?: { onStop?: () => Promise<void> }): Promise<Server>;
}

const OK = new Set(['connected', 'ok', 'disabled', 'healthy']);

export function createService(opts: ServiceOptions): Service {
  const logger = createLogger(opts.name);
  const app = express();
  const tracer = getTracer(opts.name);
  const fluent = getFluentd(opts.name);

  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(helmet());
  app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true, credentials: true }));
  app.use(express.json({ limit: opts.jsonLimit ?? '1mb' }));
  if (tracer) app.use(tracer.middleware());
  app.use(metricsMiddleware(opts.name));
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      if (req.path === '/health' || req.path === '/metrics') return;
      const ms = Date.now() - started;
      logger.info('request', { method: req.method, path: req.originalUrl, status: res.statusCode, ms });
      fluent?.emitHttpRequest(req.method, req.originalUrl, res.statusCode, ms, { service: opts.name });
    });
    next();
  });
  app.use(identify);

  app.get('/health', async (_req, res) => {
    const deps: Record<string, string> = {};
    for (const [name, check] of Object.entries(opts.health ?? {})) {
      try {
        deps[name] = await check();
      } catch (err) {
        deps[name] = `error: ${(err as Error).message}`;
      }
    }
    const criticalDown = (opts.critical ?? []).some((d) => !OK.has(deps[d]));
    const degraded = Object.values(deps).some((v) => !OK.has(v));
    res.status(criticalDown ? 503 : 200).json({
      service: opts.name,
      status: criticalDown ? 'unhealthy' : degraded ? 'degraded' : 'healthy',
      dependencies: deps,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });
  app.get('/metrics', metricsHandler);

  return {
    app,
    logger,
    async start(mount, hooks) {
      mount(app);
      app.use((req, _res, next) => next(new HttpError(404, `Route not found: ${req.method} ${req.path}`)));
      app.use((err: Error & { status?: number; code?: number; errors?: Record<string, { message: string }>; type?: string }, req: Request, res: Response, _next: NextFunction) => {
        let status = err instanceof HttpError ? err.status : err.status ?? 500;
        let message = err.message;
        let details: unknown = err instanceof HttpError ? err.details : undefined;
        if (err.name === 'ValidationError' && err.errors) {
          status = 400;
          details = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message]));
          message = 'Validation failed';
        } else if (err.name === 'CastError') {
          status = 400;
          message = 'Invalid id';
        } else if (err.code === 11000) {
          status = 409;
          message = 'Duplicate key';
        } else if (err.type === 'entity.parse.failed') {
          status = 400;
          message = 'Malformed JSON body';
        }
        if (status >= 500) {
          logger.error('unhandled error', { path: req.originalUrl, err: err.message, stack: err.stack });
          fluent?.emitError(err, { path: req.originalUrl, service: opts.name });
        }
        res.status(status).json({ success: false, error: status >= 500 && process.env.NODE_ENV === 'production' ? 'Internal server error' : message, details });
      });

      const server = await new Promise<Server>((resolve, reject) => {
        const s = app.listen(opts.port, () => resolve(s));
        s.once('error', reject); // e.g. EADDRINUSE: fail startup instead of hanging
      });
      logger.info(`${opts.name} listening`, { port: opts.port });

      const consul = consulFromEnv();
      const serviceId = `${opts.name}-${os.hostname()}-${opts.port}`;
      if (consul) {
        const address = process.env.SERVICE_ADDRESS ?? os.hostname();
        consul
          .registerService({
            id: serviceId,
            name: opts.name,
            address,
            port: opts.port,
            healthCheckUrl: `http://${address}:${opts.port}/health`,
            tags: ['node-microservices', 'v2'],
          })
          .then(() => logger.info('registered with Consul', { serviceId }))
          .catch((err) => logger.warn('Consul registration failed', { err: (err as Error).message }));
      }

      let stopping = false;
      const shutdown = async (signal: string) => {
        if (stopping) return;
        stopping = true;
        logger.info('shutting down', { signal });
        await consul?.deregisterService(serviceId).catch(() => undefined);
        server.close();
        await hooks?.onStop?.().catch(() => undefined);
        await tracer?.close();
        fluent?.close();
        process.exit(0);
      };
      process.on('SIGTERM', () => void shutdown('SIGTERM'));
      process.on('SIGINT', () => void shutdown('SIGINT'));
      return server;
    },
  };
}
