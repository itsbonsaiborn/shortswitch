import { afterEach, describe, expect, test, vi } from 'vitest';
import { RateLimiterService } from './rate-limiter-service.js';

describe('RateLimiterService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('resets attempts after the configured window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-23T10:00:00.000Z'));

    const limiter = new RateLimiterService();

    expect(
      limiter.consume('auth', '127.0.0.1:admin@example.com', {
        maxAttempts: 1,
        windowMinutes: 1,
        blockMinutes: 1
      })
    ).toBe(true);

    expect(
      limiter.consume('auth', '127.0.0.1:admin@example.com', {
        maxAttempts: 1,
        windowMinutes: 1,
        blockMinutes: 1
      })
    ).toBe(false);

    vi.advanceTimersByTime(61_000);

    expect(
      limiter.consume('auth', '127.0.0.1:admin@example.com', {
        maxAttempts: 1,
        windowMinutes: 1,
        blockMinutes: 1
      })
    ).toBe(true);
  });
});
