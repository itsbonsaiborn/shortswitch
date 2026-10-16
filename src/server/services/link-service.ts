import argon2 from 'argon2';
import { UAParser } from 'ua-parser-js';
import type { LinkDetailsResponse, LinkFormInput, LinkRecord } from '@/shared/types.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { AnalyticsRepository } from '../repositories/analytics-repository.js';
import { LinkRepository, type LinkRow } from '../repositories/link-repository.js';
import { SettingsRepository } from '../repositories/settings-repository.js';
import {
  buildShortUrl,
  clamp,
  createSlugGenerator,
  expirationFromInput,
  hmacSha256,
  humanReferrer,
  nowIso,
  validateCustomSlug,
  validateGeneratedSlug,
  validateTargetUrl
} from '../utils.js';

export class LinkService {
  private links = new LinkRepository();
  private analytics = new AnalyticsRepository();
  private settings = new SettingsRepository();
  private pendingAnalyticsWrites = new Set<Promise<void>>();

  private scheduleAnalyticsWrite(linkId: string, slug: string, write: () => void) {
    const task = new Promise<void>((resolve) => {
      setImmediate(() => {
        try {
          write();
        } catch (error) {
          logger.error({ linkId, slug, err: error }, 'analytics write failed');
        } finally {
          resolve();
        }
      });
    });
    this.pendingAnalyticsWrites.add(task);
    void task.finally(() => this.pendingAnalyticsWrites.delete(task));
  }

  async flushAnalytics() {
    while (this.pendingAnalyticsWrites.size > 0) {
      await Promise.allSettled([...this.pendingAnalyticsWrites]);
    }
  }

  list(userId: string) {
    return this.links.list(userId);
  }

  private toLinkRecord(row: LinkRow): LinkRecord {
    return {
      id: row.id,
      slug: row.slug,
      shortUrl: buildShortUrl(row.slug),
      targetUrl: row.targetUrl,
      comment: row.comment,
      passwordProtected: Boolean(row.passwordHash),
      enabled: Boolean(row.enabled),
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      clickCount: row.clickCount,
      uniqueClickCount: row.uniqueClickCount
    };
  }

  private normalizeOsLabel(name?: string, version?: string) {
    if (!name) return 'Unknown';
    if (/windows/i.test(name)) return 'Windows';
    if (/mac/i.test(name)) return 'macOS';
    if (/ios/i.test(name)) return 'iOS';
    if (/android/i.test(name)) return 'Android';
    if (/linux|ubuntu|debian|fedora|arch/i.test(name)) return 'Linux';
    return [name, version].filter(Boolean).join(' ');
  }

  async create(userId: string, input: LinkFormInput): Promise<LinkRecord> {
    const settings = this.settings.getSecuritySettings();
    const manualSlug = input.slug?.trim();
    const slug = manualSlug
      ? manualSlug
      : createSlugGenerator(settings.slugAllowedChars, settings.minSlugLength)();

    const slugValidation = manualSlug
      ? validateCustomSlug(slug, {
          minLength: settings.minSlugLength,
          maxLength: settings.maxSlugLength
        })
      : validateGeneratedSlug(slug, {
          allowedChars: settings.slugAllowedChars,
          minLength: settings.minSlugLength,
          maxLength: settings.maxSlugLength
        });

    if (!slugValidation.ok) {
      throw new Error(slugValidation.reason);
    }

    const passwordHash = input.password?.trim() ? await argon2.hash(input.password) : null;
    const comment = input.comment?.trim() ? input.comment.trim() : null;
    let row: LinkRow;
    try {
      row = this.links.create({
        userId,
        slug,
        targetUrl: validateTargetUrl(input.targetUrl),
        comment,
        passwordHash,
        expiresAt: expirationFromInput(input.expirationValue, input.expirationUnit)
      });
    } catch (error) {
      if (String((error as Error).message).includes('UNIQUE constraint failed')) {
        throw new Error('This slug is already in use.');
      }
      throw error;
    }

    logger.info({ userId, slug }, 'link created');

    return this.toLinkRecord(row);
  }

  async update(userId: string, linkId: string, input: LinkFormInput) {
    const existing = this.links.findById(linkId);
    if (!existing || existing.userId !== userId) throw new Error('Link not found.');
    const settings = this.settings.getSecuritySettings();
    const manualSlug = input.slug?.trim();
    const slug = manualSlug || existing.slug;

    const slugValidation = manualSlug
      ? validateCustomSlug(slug, {
          minLength: settings.minSlugLength,
          maxLength: settings.maxSlugLength
        })
      : validateGeneratedSlug(slug, {
          allowedChars: settings.slugAllowedChars,
          minLength: settings.minSlugLength,
          maxLength: settings.maxSlugLength
        });

    if (!slugValidation.ok) {
      throw new Error(slugValidation.reason);
    }

    const passwordHash =
      input.password === undefined
        ? existing.passwordHash
        : input.password.trim()
          ? await argon2.hash(input.password)
          : null;
    const comment =
      input.comment === undefined ? existing.comment : input.comment.trim() ? input.comment.trim() : null;

    let row: LinkRow;
    try {
      row = this.links.update(linkId, {
        targetUrl: input.targetUrl ? validateTargetUrl(input.targetUrl) : existing.targetUrl,
        slug,
        comment,
        passwordHash,
        expiresAt:
          input.expirationValue === undefined && input.expirationUnit === undefined
            ? existing.expiresAt
            : expirationFromInput(input.expirationValue, input.expirationUnit)
      });
    } catch (error) {
      if (String((error as Error).message).includes('UNIQUE constraint failed')) {
        throw new Error('This slug is already in use.');
      }
      throw error;
    }

    logger.info({ userId, slug: row.slug }, 'link updated');

    return this.toLinkRecord(row);
  }

  delete(userId: string, linkId: string) {
    const existing = this.links.findById(linkId);
    if (!existing || existing.userId !== userId) throw new Error('Link not found.');
    this.links.delete(linkId);
    logger.info({ userId, slug: existing.slug }, 'link deleted');
  }

  setEnabled(userId: string, linkId: string, enabled: boolean, clearExpirationOnEnable = false) {
    const existing = this.links.findById(linkId);
    if (!existing || existing.userId !== userId) throw new Error('Link not found.');
    const nextExpiresAt =
      enabled && (clearExpirationOnEnable || this.isExpired(existing.expiresAt))
        ? null
        : existing.expiresAt;
    const row = this.links.setEnabled(linkId, enabled, nextExpiresAt);
    logger.info({ userId, slug: row.slug, enabled }, enabled ? 'link enabled' : 'link disabled');
    return this.toLinkRecord(row);
  }

  async verifyPassword(slug: string, password: string) {
    const link = this.links.findBySlug(slug);
    if (!link || !link.passwordHash) return false;
    return argon2.verify(link.passwordHash, password);
  }

  getLinkDetails(
    userId: string,
    linkId: string,
    range: 'day' | 'week' | 'month',
    limit: number,
    timezoneOffsetMinutes = 0
  ): LinkDetailsResponse {
    const link = this.links.findById(linkId);
    if (!link || link.userId !== userId) throw new Error('Link not found.');
    return {
      link: this.toLinkRecord(link),
      overview: this.analytics.getOverview(link.id, range, timezoneOffsetMinutes),
      recentClicks: this.analytics.getRecentClicks(link.id, clamp(limit, 10, 50)),
      breakdowns: this.analytics.getBreakdowns(link.id)
    };
  }

  getGlobalAnalytics(userId: string, range: 'day' | 'week' | 'month', timezoneOffsetMinutes = 0) {
    return this.analytics.getGlobalAnalytics(userId, range, timezoneOffsetMinutes);
  }

  getGlobalActivityOverTime(userId: string, range: 'day' | 'week' | 'month', timezoneOffsetMinutes = 0) {
    return this.analytics.getGlobalActivityOverTime(userId, range, timezoneOffsetMinutes);
  }

  getLinkBySlug(slug: string) {
    return this.links.findBySlug(slug);
  }

  isExpired(expiresAt: string | null) {
    return Boolean(expiresAt && expiresAt < nowIso());
  }

  isDisabled(link: Pick<LinkRow, 'enabled' | 'expiresAt'>) {
    return !Boolean(link.enabled) || this.isExpired(link.expiresAt);
  }

  queueAnalytics(linkId: string, slug: string, request: {
    userAgent: string | undefined;
    referrer: string | undefined;
    language: string | undefined;
    ip: string | undefined;
    country: string | undefined;
    region: string | undefined;
    city: string | undefined;
  }) {
    this.scheduleAnalyticsWrite(linkId, slug, () => {
        const parser = new UAParser(request.userAgent);
        const device = parser.getDevice();
        const browser = parser.getBrowser();
        const os = parser.getOS();
        const browserLabel = [browser.name, browser.version].filter(Boolean).join(' ') || 'Unknown';
        const osLabel = this.normalizeOsLabel(os.name, os.version);
        const deviceType = device.type ?? 'desktop';
        const hasUserAgent = Boolean(request.userAgent?.trim());
        const trafficType = !hasUserAgent
          ? 'unknown'
          : /bot|spider|crawl/i.test(request.userAgent ?? '')
            ? 'bot'
            : 'human';
        const visitorHash = hmacSha256(config.ipHashSecret, request.ip ?? 'unknown');

        this.analytics.record({
          linkId,
          slug,
          timestamp: nowIso(),
          browser: browserLabel,
          os: osLabel,
          deviceType,
          referrer: humanReferrer(request.referrer),
          country: request.country ?? 'Unknown',
          region: request.region ?? 'Unknown',
          city: request.city ?? null,
          language: request.language?.split(',')[0] ?? null,
          trafficType,
          authOutcome: 'success',
          visitorHash,
          rawIp: config.storeRawIp ? (request.ip ?? null) : null
        });
        this.links.incrementClicks(linkId);
    });
  }

  queueFailedPasswordAttempt(linkId: string, slug: string, request: {
    userAgent: string | undefined;
    referrer: string | undefined;
    language: string | undefined;
    ip: string | undefined;
    country: string | undefined;
    region: string | undefined;
    city: string | undefined;
  }) {
    this.scheduleAnalyticsWrite(linkId, slug, () => {
        const parser = new UAParser(request.userAgent);
        const device = parser.getDevice();
        const browser = parser.getBrowser();
        const os = parser.getOS();
        const browserLabel = browser.name || 'Unknown';
        const osLabel = this.normalizeOsLabel(os.name, os.version);
        const deviceType = device.type ?? 'desktop';
        const hasUserAgent = Boolean(request.userAgent?.trim());
        const trafficType = !hasUserAgent
          ? 'unknown'
          : /bot|spider|crawl/i.test(request.userAgent ?? '')
            ? 'bot'
            : 'human';
        const visitorHash = hmacSha256(config.ipHashSecret, request.ip ?? 'unknown');

        this.analytics.record({
          linkId,
          slug,
          timestamp: nowIso(),
          browser: browserLabel,
          os: osLabel,
          deviceType,
          referrer: humanReferrer(request.referrer),
          country: request.country ?? 'Unknown',
          region: request.region ?? 'Unknown',
          city: request.city ?? null,
          language: request.language?.split(',')[0] ?? null,
          trafficType,
          authOutcome: 'failed_password',
          visitorHash,
          rawIp: config.storeRawIp ? (request.ip ?? null) : null
        });
    });
  }

  cleanupAnalytics() {
    const cutoff = new Date(Date.now() - config.analyticsRetentionDays * 24 * 3_600_000).toISOString();
    return this.analytics.deleteOlderThan(cutoff);
  }

  clearAnalytics() {
    const deletedRows = this.analytics.clearAll();
    this.links.resetAllClickCounts();
    return deletedRows;
  }

  clearLinkAnalytics(userId: string, linkId: string) {
    const existing = this.links.findById(linkId);
    if (!existing || existing.userId !== userId) throw new Error('Link not found.');
    const deletedRows = this.analytics.clearForLink(linkId);
    this.links.resetClickCount(linkId);
    logger.warn({ userId, slug: existing.slug, deletedRows }, 'link analytics cleared');
    return this.toLinkRecord(this.links.findById(linkId)!);
  }
}
