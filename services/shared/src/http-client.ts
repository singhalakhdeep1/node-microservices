/**
 * Service-to-service HTTP client: per-target circuit breaker, timeout, retry with exponential
 * backoff for idempotent calls, Zipkin B3 propagation and the internal API token.
 */
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker/circuit-breaker';
import { INTERNAL_TOKEN_HEADER } from './auth';
import { getTracer } from './tracing/zipkin';
import { HttpError } from './errors';
import type { Logger } from './logger';
import { breakerState } from './metrics';

export interface ServiceResponse<T> {
  status: number;
  body: T;
}

export interface CallOptions {
  method?: string;
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
}

/** Thrown when the downstream service could not be reached (timeout, refused, breaker open, 5xx). */
export class ServiceUnavailableError extends HttpError {
  constructor(service: string, reason: string) {
    super(503, `${service} unavailable: ${reason}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ServiceClient {
  readonly breaker: CircuitBreaker;

  constructor(
    readonly serviceName: string,
    private readonly resolveBaseUrl: () => string | Promise<string>,
    private readonly caller: string,
    private readonly logger?: Logger,
  ) {
    this.breaker = new CircuitBreaker({
      name: serviceName,
      onStateChange: (name, state) => {
        breakerState.set({ target: name }, state === 'closed' ? 0 : state === 'half-open' ? 1 : 2);
        this.logger?.warn('circuit breaker state change', { target: name, state });
      },
    });
  }

  async request<T>(path: string, opts: CallOptions = {}): Promise<ServiceResponse<T>> {
    const method = opts.method ?? 'GET';
    const retries = opts.retries ?? (method === 'GET' ? 2 : 0);
    let attempt = 0;
    for (;;) {
      try {
        return await this.breaker.execute(() => this.once<T>(method, path, opts));
      } catch (err) {
        if (err instanceof CircuitOpenError) throw new ServiceUnavailableError(this.serviceName, 'circuit open');
        if (!(err instanceof ServiceUnavailableError) || attempt >= retries) throw err;
        attempt++;
        await sleep(100 * 2 ** attempt);
      }
    }
  }

  private async once<T>(method: string, path: string, opts: CallOptions): Promise<ServiceResponse<T>> {
    const base = await this.resolveBaseUrl();
    const tracer = getTracer(this.caller);
    const exec = async (traceHeaders: Record<string, string>) => {
      let res: Response;
      try {
        res = await fetch(`${base}${path}`, {
          method,
          headers: {
            'content-type': 'application/json',
            [INTERNAL_TOKEN_HEADER]: process.env.INTERNAL_API_TOKEN ?? '',
            'x-caller-service': this.caller,
            ...traceHeaders,
            ...opts.headers,
          },
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
        });
      } catch (err) {
        throw new ServiceUnavailableError(this.serviceName, (err as Error).name === 'TimeoutError' ? 'timeout' : (err as Error).message);
      }
      // 5xx counts against the breaker; 4xx is a valid answer and is returned to the caller.
      if (res.status >= 500) throw new ServiceUnavailableError(this.serviceName, `HTTP ${res.status}`);
      const text = await res.text();
      return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
    };
    return tracer ? tracer.traceClient(`${method} ${path.split('?')[0]}`, this.serviceName, exec) : exec({});
  }
}
