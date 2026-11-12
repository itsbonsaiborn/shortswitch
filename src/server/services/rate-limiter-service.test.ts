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

  test('opportunistically removes expired buckets so anonymous identities cannot grow memory forever', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-23T10:00:00.000Z'));
    const limiter = new RateLimiterService();

    for (let index = 0; index < 50; index += 1) {
      limiter.consume('board-reaction-session', `session-${index}`, {
        maxAttempts: 10,
        windowMinutes: 1
      });
    }
    expect((limiter as unknown as { buckets: Map<string, unknown> }).buckets.size).toBe(50);

    vi.advanceTimersByTime(61_000);
    limiter.consume('board-reaction-session', 'current-session', {
      maxAttempts: 10,
      windowMinutes: 1
    });
    expect((limiter as unknown as { buckets: Map<string, unknown> }).buckets.size).toBe(1);
  });
});
