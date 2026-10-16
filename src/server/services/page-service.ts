import type { PageBlockConfig, PageBlockType, PageInput, PageLayout, PageNestedBlockType, PageStatus, PageTheme, PublicPage } from '@/shared/types.js';
import { UAParser } from 'ua-parser-js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { LinkRepository } from '../repositories/link-repository.js';
import { LiveRepository } from '../repositories/live-repository.js';
import { PageRepository } from '../repositories/page-repository.js';
import { SettingsRepository } from '../repositories/settings-repository.js';
import { createId, createSlugGenerator, hmacSha256, humanReferrer, validateCustomSlug, validateGeneratedSlug, validateTargetUrl } from '../utils.js';

const THEMES = new Set<PageTheme>(['classic_cream', 'forest_dark', 'soft_lavender', 'ocean_blue', 'minimal_light']);
const LAYOUTS = new Set<PageLayout>(['classic', 'minimal', 'soft', 'bold']);
const STATUSES = new Set<PageStatus>(['draft', 'published', 'disabled']);
const BLOCK_TYPES = new Set<PageBlockType>(['heading', 'text', 'link', 'existing_link', 'live_activity', 'email', 'divider', 'spacer', 'image', 'double']);
const NESTED_BLOCK_TYPES = new Set<PageNestedBlockType>(['heading', 'text', 'link', 'existing_link', 'live_activity', 'email', 'divider', 'spacer', 'image']);
const ALIGNMENTS = new Set<NonNullable<PageBlockConfig['alignment']>>(['left', 'center', 'right']);
const SIZES = new Set<NonNullable<PageBlockConfig['size']>>(['small', 'medium', 'large']);
const DIVIDER_STYLES = new Set<NonNullable<PageBlockConfig['style']>>(['solid', 'dashed', 'dotted']);
const EMAIL_STYLES = new Set<NonNullable<PageBlockConfig['style']>>(['text', 'button']);
const MAX_BLOCKS = 100;

const normalizeOsLabel = (name?: string, version?: string) => {
  if (!name) return 'Unknown';
  if (/windows/i.test(name)) return 'Windows';
  if (/mac/i.test(name)) return 'macOS';
  if (/ios/i.test(name)) return 'iOS';
  if (/android/i.test(name)) return 'Android';
  if (/linux|ubuntu|debian|fedora|arch/i.test(name)) return 'Linux';
  return [name, version].filter(Boolean).join(' ');
};

const text = (value: unknown, field: string, maximum: number, required = false) => {
  if (typeof value !== 'string') {
    if (required) throw new Error(`${field} is required.`);
    return '';
  }
  const normalized = value.trim();
  if (required && !normalized) throw new Error(`${field} is required.`);
  if (normalized.length > maximum) throw new Error(`${field} is too long.`);
  return normalized;
};

const choice = <T extends string>(value: unknown, allowed: Set<T>, fallback: T, field: string) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string' && allowed.has(value as T)) return value as T;
  throw new Error(`${field} is invalid.`);
};

const httpsUrl = (value: unknown, field: string) => {
  const normalized = text(value, field, 2048);
  if (!normalized) return '';
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`${field} is invalid.`);
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname) throw new Error(`${field} must use HTTPS.`);
  return parsed.toString();
};

export class PageService {
  private pages = new PageRepository();
  private links = new LinkRepository();
  private live = new LiveRepository();
  private settings = new SettingsRepository();

  private ensureOwner(userId: string, pageId: string) {
    const page = this.pages.findById(pageId);
    if (!page || (this.pages.getStatusBySlug(page.slug)?.userId !== userId)) throw new Error('Page not found.');
    return page;
  }

  private validateBlock(userId: string, type: PageBlockType, raw: PageBlockConfig, blockIds = new Set<string>()): PageBlockConfig {
    if (!BLOCK_TYPES.has(type)) throw new Error('Unsupported block type.');
    const configValue = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    if (type === 'heading') {
      return {
        text: text(configValue.text, 'Heading text', 160, true),
        alignment: choice(configValue.alignment, ALIGNMENTS, 'left', 'Heading alignment'),
        size: choice(configValue.size, SIZES, 'medium', 'Heading size')
      };
    }
    if (type === 'text') {
      return {
        text: text(configValue.text, 'Text', 4000, true),
        alignment: choice(configValue.alignment, ALIGNMENTS, 'left', 'Text alignment')
      };
    }
    if (type === 'link') {
      return {
        title: text(configValue.title, 'Link title', 120, true),
        subtitle: text(configValue.subtitle, 'Link subtitle', 240),
        emoji: text(configValue.emoji, 'Link emoji', 16),
        url: validateTargetUrl(text(configValue.url, 'Link URL', 2048, true)),
        openInNewTab: Boolean(configValue.openInNewTab)
      };
    }
    if (type === 'existing_link') {
      const resourceId = text(configValue.resourceId, 'Link', 128, true);
      const link = this.links.findById(resourceId);
      if (!link || link.userId !== userId) throw new Error('Selected ShortSwitch Link was not found.');
      return {
        resourceId,
        title: text(configValue.title, 'Link title', 120) || link.slug,
        subtitle: text(configValue.subtitle, 'Link subtitle', 240),
        emoji: text(configValue.emoji, 'Link emoji', 16),
        openInNewTab: Boolean(configValue.openInNewTab)
      };
    }
    if (type === 'live_activity') {
      const resourceId = text(configValue.resourceId, 'Live Activity', 128, true);
      if (this.live.getOwnerId(resourceId) !== userId) throw new Error('Selected Live Activity was not found.');
      const activity = this.live.findById(resourceId)!;
      return {
        resourceId,
        title: text(configValue.title, 'Live title', 120) || activity.title,
        subtitle: text(configValue.subtitle, 'Live subtitle', 240),
        emoji: text(configValue.emoji, 'Live emoji', 16),
        openInNewTab: Boolean(configValue.openInNewTab)
      };
    }
    if (type === 'email') {
      const email = text(configValue.email, 'Email address', 254, true).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email address is invalid.');
      return {
        label: text(configValue.label, 'Email label', 120) || email,
        email,
        style: choice(configValue.style, EMAIL_STYLES, 'button', 'Email style')
      };
    }
    if (type === 'divider') {
      return {
        style: choice(configValue.style, DIVIDER_STYLES, 'solid', 'Divider style'),
        spacing: choice(configValue.spacing, SIZES, 'medium', 'Divider spacing')
      };
    }
    if (type === 'spacer') {
      return { spacing: choice(configValue.spacing, SIZES, 'medium', 'Spacer spacing') };
    }
    if (type === 'double') {
      const children = (configValue as { children?: unknown }).children;
      if (!Array.isArray(children) || children.length !== 2) throw new Error('Double block must contain exactly two blocks.');
      return {
        children: children.map((rawChild) => {
          if (!rawChild || typeof rawChild !== 'object' || Array.isArray(rawChild)) throw new Error('Double block child is invalid.');
          const child = rawChild as { id?: unknown; type?: unknown; config?: unknown; visible?: unknown };
          const childType = child.type as PageNestedBlockType;
          if (!NESTED_BLOCK_TYPES.has(childType)) throw new Error('Double blocks cannot contain another Double block.');
          const id = typeof child.id === 'string' && child.id.length <= 128 ? child.id : createId();
          if (blockIds.has(id)) throw new Error('Block IDs must be unique.');
          blockIds.add(id);
          return {
            id,
            type: childType,
            config: this.validateBlock(userId, childType, child.config as PageBlockConfig, blockIds),
            visible: child.visible !== false
          };
        })
      };
    }
    return {
      url: httpsUrl(configValue.url, 'Image URL'),
      alt: text(configValue.alt, 'Image alt text', 300, true),
      caption: text(configValue.caption, 'Image caption', 500),
      alignment: choice(configValue.alignment, ALIGNMENTS, 'center', 'Image alignment')
    };
  }

  private validateInput(userId: string, raw: PageInput): PageInput {
    if (!raw || typeof raw !== 'object') throw new Error('Page data is required.');
    if (!Array.isArray(raw.blocks)) throw new Error('Blocks must be an array.');
    if (raw.blocks.length > MAX_BLOCKS) throw new Error(`A Page can contain at most ${MAX_BLOCKS} blocks.`);
    const theme = choice(raw.theme, THEMES, 'classic_cream', 'Theme');
    const layout = choice(raw.layout, LAYOUTS, 'classic', 'Layout');
    const status = choice(raw.status, STATUSES, 'draft', 'Status');
    const blockIds = new Set<string>();
    return {
      title: text(raw.title, 'Title', 120, true),
      slug: typeof raw.slug === 'string' ? raw.slug.trim() : undefined,
      description: text(raw.description, 'Description', 1000),
      emoji: text(raw.emoji, 'Emoji', 16),
      avatarUrl: httpsUrl(raw.avatarUrl, 'Avatar URL'),
      theme,
      layout,
      status,
      seoTitle: text(raw.seoTitle, 'SEO title', 120),
      seoDescription: text(raw.seoDescription, 'SEO description', 300),
      blocks: raw.blocks.map((block) => {
        if (!block || typeof block !== 'object') throw new Error('Block data is invalid.');
        const type = block.type as PageBlockType;
        const id = typeof block.id === 'string' && block.id.length <= 128 ? block.id : undefined;
        if (id && blockIds.has(id)) throw new Error('Block IDs must be unique.');
        if (id) blockIds.add(id);
        return {
          id,
          type,
          config: this.validateBlock(userId, type, block.config, blockIds),
          visible: block.visible !== false
        };
      })
    };
  }

  private resolveSlug(requested?: string) {
    const security = this.settings.getSecuritySettings();
    const manual = requested?.trim();
    const slug = manual || createSlugGenerator(security.slugAllowedChars, security.minSlugLength)();
    const result = manual
      ? validateCustomSlug(slug, { minLength: security.minSlugLength, maxLength: security.maxSlugLength })
      : validateGeneratedSlug(slug, {
          allowedChars: security.slugAllowedChars,
          minLength: security.minSlugLength,
          maxLength: security.maxSlugLength
        });
    if (!result.ok) throw new Error(result.reason);
    return slug;
  }

  list(userId: string, query: { search?: string; sort?: string; page?: string | number; pageSize?: string | number }) {
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const pageSize = Math.min(50, Math.max(1, Math.floor(Number(query.pageSize) || 12)));
    const sort = ['newest', 'oldest', 'title', 'views'].includes(String(query.sort))
      ? (query.sort as 'newest' | 'oldest' | 'title' | 'views')
      : 'newest';
    return this.pages.list(userId, { search: String(query.search ?? '').trim().slice(0, 120), sort, page, pageSize });
  }

  get(userId: string, pageId: string) {
    return this.ensureOwner(userId, pageId);
  }

  create(userId: string, raw: PageInput) {
    const input = this.validateInput(userId, raw);
    const slug = this.resolveSlug(input.slug);
    try {
      return this.pages.create(userId, slug, input);
    } catch (error) {
      if (String((error as Error).message).includes('UNIQUE constraint failed')) throw new Error('This slug is already in use.');
      throw error;
    }
  }

  update(userId: string, pageId: string, raw: PageInput) {
    const current = this.ensureOwner(userId, pageId);
    const input = this.validateInput(userId, raw);
    const slug = input.slug ? this.resolveSlug(input.slug) : current.slug;
    try {
      return this.pages.update(pageId, slug, input)!;
    } catch (error) {
      if (String((error as Error).message).includes('UNIQUE constraint failed')) throw new Error('This slug is already in use.');
      throw error;
    }
  }

  setStatus(userId: string, pageId: string, status: PageStatus) {
    this.ensureOwner(userId, pageId);
    if (!STATUSES.has(status)) throw new Error('Invalid Page status.');
    return this.pages.setStatus(pageId, status)!;
  }

  duplicate(userId: string, pageId: string) {
    const source = this.ensureOwner(userId, pageId);
    const security = this.settings.getSecuritySettings();
    const duplicateTitle = `${source.title.slice(0, 115).trimEnd()} copy`;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const slug = createSlugGenerator(security.slugAllowedChars, security.minSlugLength)();
      try {
        return this.pages.duplicateForUser(userId, pageId, slug, duplicateTitle)!;
      } catch (error) {
        if (!String((error as Error).message).includes('UNIQUE constraint failed')) throw error;
      }
    }
    throw new Error('Could not allocate a unique slug.');
  }

  delete(userId: string, pageId: string) {
    this.ensureOwner(userId, pageId);
    this.pages.delete(pageId);
  }

  getPublic(
    slug: string,
    requestMeta?: { ip?: string; userAgent?: string; referrer?: string; language?: string }
  ): PublicPage {
    const page = this.pages.findBySlug(slug, true);
    if (!page) throw new Error('Page not found.');
    if (requestMeta?.ip) {
      const ip = requestMeta.ip;
      const parser = new UAParser(requestMeta.userAgent);
      const deviceType = parser.getDevice().type ?? 'desktop';
      const browser = parser.getBrowser();
      const os = parser.getOS();
      setImmediate(() => {
        try {
          this.pages.recordView({
            pageId: page.id,
            visitorHash: hmacSha256(config.ipHashSecret, ip),
            deviceType,
            browser: browser.name || 'Unknown',
            os: normalizeOsLabel(os.name, os.version),
            referrer: humanReferrer(requestMeta.referrer),
            language: requestMeta.language?.split(',')[0]?.trim() || null,
            rawIp: config.storeRawIp ? ip : null
          });
        } catch (error) {
          logger.error({ err: error, pageId: page.id }, 'page view analytics write failed');
        }
      });
    }
    return {
      id: page.id,
      slug: page.slug,
      publicUrl: page.publicUrl,
      title: page.title,
      description: page.description,
      emoji: page.emoji,
      avatarUrl: page.avatarUrl,
      theme: page.theme,
      layout: page.layout,
      blocks: page.blocks
    };
  }

  findPublicRoute(slug: string) {
    return this.pages.findRouteBySlug(slug);
  }

  trackClick(
    slug: string,
    input: { blockId?: string; eventId?: string },
    requestMeta: { ip: string; userAgent?: string; referrer?: string; language?: string }
  ) {
    const page = this.pages.findBySlug(slug, true);
    if (!page) throw new Error('Page not found.');
    const blockId = text(input.blockId, 'Block', 128, true);
    const eventId = text(input.eventId, 'Event', 128, true);
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(eventId)) throw new Error('Event is invalid.');
    const publicBlocks: Array<{ id: string; type: PageBlockType; config: PageBlockConfig }> = [];
    for (const candidate of page.blocks) {
      if (candidate.type === 'double') {
        publicBlocks.push(...(candidate.config.children ?? []).filter((child) => child.visible));
      } else {
        publicBlocks.push(candidate);
      }
    }
    const block = publicBlocks.find((candidate) => candidate.id === blockId);
    if (!block || !['link', 'existing_link', 'live_activity', 'email'].includes(block.type)) throw new Error('Block not found.');
    const blockConfig = block.config;
    const label = String(blockConfig.title || blockConfig.label || blockConfig.email || 'Link').slice(0, 120);
    const parser = new UAParser(requestMeta.userAgent);
    const browser = parser.getBrowser();
    const os = parser.getOS();
    setImmediate(() => {
      try {
        this.pages.recordClick({
          pageId: page.id,
          blockId,
          label,
          eventId,
          visitorHash: hmacSha256(config.ipHashSecret, requestMeta.ip),
          deviceType: parser.getDevice().type ?? 'desktop',
          browser: browser.name || 'Unknown',
          os: normalizeOsLabel(os.name, os.version),
          referrer: humanReferrer(requestMeta.referrer),
          language: requestMeta.language?.split(',')[0]?.trim() || null,
          rawIp: config.storeRawIp ? requestMeta.ip : null
        });
      } catch (error) {
        logger.error({ err: error, pageId: page.id, blockId }, 'page click analytics write failed');
      }
    });
  }

  analytics(userId: string, pageId: string, range: 'day' | 'week' | 'month', timezoneOffsetMinutes = 0, limit = 10) {
    this.ensureOwner(userId, pageId);
    const safeLimit = [10, 20, 50].includes(limit) ? limit : 10;
    return this.pages.analytics(pageId, range, timezoneOffsetMinutes, safeLimit);
  }

  clearAnalytics(userId: string, pageId: string) {
    this.ensureOwner(userId, pageId);
    const deletedRows = this.pages.clearAnalytics(pageId);
    return { page: this.pages.findById(pageId)!, deletedRows };
  }

  clearAllAnalytics(userId: string) {
    return this.pages.clearAllAnalytics(userId);
  }

  cleanupAnalytics() {
    const cutoff = new Date(Date.now() - config.analyticsRetentionDays * 24 * 60 * 60 * 1000).toISOString();
    return this.pages.deleteAnalyticsOlderThan(cutoff);
  }
}
