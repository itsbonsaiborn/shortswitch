import { logger } from '../logger.js';

interface RateLimitBucket {
  count: number;
  resetAt: number;
  blockedUntil: number;
}

interface RateLimitOptions {
  maxAttempts: number;
  windowMinutes: number;
  blockMinutes?: number;
}

interface RateLimitMetadata {
  userId?: string;
  slug?: string;
  origin?: string;
}

export class RateLimiterService {
  private buckets = new Map<string, RateLimitBucket>();

  private getBucket(scope: string, key: string, windowMinutes: number) {
    const now = Date.now();
    const bucketKey = `${scope}:${key}`;
    const current = this.buckets.get(bucketKey);

    if (current && current.blockedUntil > now) {
      return current;
    }

    if (!current || current.resetAt <= now) {
      const next: RateLimitBucket = {
        count: 0,
        resetAt: now + windowMinutes * 60_000,
        blockedUntil: 0
      };
      this.buckets.set(bucketKey, next);
      return next;
    }

    return current;
  }

  consume(scope: string, key: string, options: RateLimitOptions, metadata?: RateLimitMetadata) {
    const now = Date.now();
    const bucket = this.getBucket(scope, key, options.windowMinutes);

    if (bucket.blockedUntil > now) {
      logger.warn({ scope, ...metadata }, 'rate limit triggered');
      return false;
    }

    bucket.count += 1;
    if (bucket.count > options.maxAttempts) {
      bucket.blockedUntil = now + (options.blockMinutes ?? options.windowMinutes) * 60_000;
      logger.warn({ scope, ...metadata }, 'rate limit triggered');
      return false;
    }

    return true;
  }

  reset(scope: string, key: string) {
    this.buckets.delete(`${scope}:${key}`);
  }
}
