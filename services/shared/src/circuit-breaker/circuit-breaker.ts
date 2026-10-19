/**
 * Circuit Breaker (LLD): closed -> open after N consecutive failures, open -> half-open after
 * resetTimeout, half-open -> closed after `halfOpenSuccesses` successes (any failure re-opens).
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  name?: string;
  failureThreshold?: number;
  resetTimeout?: number;
  halfOpenSuccesses?: number;
  onStateChange?: (name: string, state: CircuitState) => void;
}

export class CircuitOpenError extends Error {
  constructor(readonly breaker: string) {
    super(`Circuit breaker is open for ${breaker}`);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  readonly name: string;
  private readonly failureThreshold: number;
  private readonly resetTimeout: number;
  private readonly halfOpenSuccesses: number;
  private readonly onStateChange?: (name: string, state: CircuitState) => void;
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;

  constructor(options: CircuitBreakerOptions = {}) {
    this.name = options.name ?? 'default';
    this.failureThreshold = options.failureThreshold ?? Number(process.env.FAILURE_THRESHOLD ?? 5);
    this.resetTimeout = options.resetTimeout ?? Number(process.env.RESET_TIMEOUT ?? 60_000);
    this.halfOpenSuccesses = options.halfOpenSuccesses ?? 2;
    this.onStateChange = options.onStateChange;
  }

  /** True when a call may proceed; moves open -> half-open once the reset timeout has elapsed. */
  allowRequest(): boolean {
    if (this.state !== 'open') return true;
    if (!this.shouldAttemptReset()) return false;
    this.transition('half-open');
    return true;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.allowRequest()) throw new CircuitOpenError(this.name);
    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.halfOpenSuccesses) this.reset();
    } else {
      this.failureCount = 0;
    }
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.state === 'half-open' || this.failureCount >= this.failureThreshold) this.trip();
  }

  private transition(state: CircuitState): void {
    if (this.state === state) return;
    this.state = state;
    this.onStateChange?.(this.name, state);
  }

  private shouldAttemptReset(): boolean {
    return this.lastFailureTime !== null && Date.now() - this.lastFailureTime > this.resetTimeout;
  }

  trip(): void {
    this.successCount = 0;
    this.transition('open');
  }

  reset(): void {
    this.failureCount = 0;
    this.successCount = 0;
    this.transition('closed');
  }

  getState(): CircuitState {
    return this.state;
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  snapshot() {
    return { name: this.name, state: this.state, failures: this.failureCount, lastFailureAt: this.lastFailureTime };
  }
}
