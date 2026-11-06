import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

function rateLimited(): HttpException {
  return new HttpException({ code: 'LOGIN_RATE_LIMITED' }, HttpStatus.TOO_MANY_REQUESTS);
}

const windowMs = 15 * 60 * 1000;
const failureLimit = 30;
const maximumTrackedAddresses = 50_000;

@Injectable()
export class LoginRateLimitService {
  private readonly failures = new Map<string, { count: number; windowStartedAt: number }>();

  assertAllowed(ipAddress: string): void {
    const now = Date.now();
    this.removeExpired(now);
    const entry = this.failures.get(ipAddress);
    if (!entry && this.failures.size >= maximumTrackedAddresses) {
      throw rateLimited();
    }
    if (entry && entry.count >= failureLimit && now - entry.windowStartedAt < windowMs) {
      throw rateLimited();
    }
  }

  recordFailure(ipAddress: string): void {
    const now = Date.now();
    const existing = this.failures.get(ipAddress);
    if (existing && now - existing.windowStartedAt < windowMs) {
      existing.count += 1;
      return;
    }
    if (this.failures.size >= maximumTrackedAddresses && !existing) return;
    this.failures.set(ipAddress, { count: 1, windowStartedAt: now });
  }

  clear(ipAddress: string): void {
    this.failures.delete(ipAddress);
  }

  private removeExpired(now: number): void {
    for (const [ipAddress, entry] of this.failures) {
      if (now - entry.windowStartedAt >= windowMs) this.failures.delete(ipAddress);
    }
  }
}
