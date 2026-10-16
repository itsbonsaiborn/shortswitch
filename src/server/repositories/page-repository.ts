import type {
  PageAnalytics,
  PageBlock,
  PageBlockConfig,
  PageBlockType,
  PageDetail,
  PageInput,
  PageLayout,
  PageListResponse,
  PageNestedBlock,
  PageStatus,
  PageSummary,
  PageTheme
} from '@/shared/types.js';
import { getDb } from '../db.js';
import { buildShortUrl, createId, nowIso } from '../utils.js';
import { buildAnalyticsBreakdowns, type AnalyticsBreakdownRow } from './analytics-breakdowns.js';

interface PageRow {
  id: string;
  userId: string;
  slug: string;
  title: string;
  description: string | null;
  emoji: string | null;
  avatarUrl: string | null;
  theme: PageTheme;
  layout: PageLayout;
  status: PageStatus;
  seoTitle: string | null;
  seoDescription: string | null;
  blockCount: number;
  totalViews: number;
  uniqueVisitors: number;
  totalLinkClicks: number;
  createdAt: string;
  updatedAt: string;
}

interface BlockRow {
  id: string;
  type: PageBlockType;
  configJson: string;
  position: number;
  visible: number;
  createdAt: string;
  updatedAt: string;
}

const pageSelect = `
  SELECT
    p.id, p.user_id as userId, p.slug, p.title, p.description, p.emoji,
    p.avatar_url as avatarUrl, p.theme, p.layout, p.status,
    p.seo_title as seoTitle, p.seo_description as seoDescription,
    p.created_at as createdAt, p.updated_at as updatedAt,
    (SELECT COUNT(*) FROM page_blocks b WHERE b.page_id = p.id) as blockCount,
    (SELECT COUNT(*) FROM page_views v WHERE v.page_id = p.id) as totalViews,
    (SELECT COUNT(DISTINCT visitor_hash) FROM page_views v WHERE v.page_id = p.id) as uniqueVisitors,
    (SELECT COUNT(*) FROM page_block_clicks c WHERE c.page_id = p.id) as totalLinkClicks
  FROM pages p
`;
const publicPageSelect = `
  SELECT
    p.id, p.user_id as userId, p.slug, p.title, p.description, p.emoji,
    p.avatar_url as avatarUrl, p.theme, p.layout, p.status,
    p.seo_title as seoTitle, p.seo_description as seoDescription,
    p.created_at as createdAt, p.updated_at as updatedAt,
    0 as blockCount, 0 as totalViews, 0 as uniqueVisitors, 0 as totalLinkClicks
  FROM pages p
`;

export class PageRepository {
  private db = getDb();

  private analyticsFrame(range: 'day' | 'week' | 'month', timezoneOffsetMinutes: number) {
    const offset = Number.isFinite(timezoneOffsetMinutes)
      ? Math.max(-840, Math.min(840, Math.trunc(timezoneOffsetMinutes)))
      : 0;
    const toLocalWall = (date: Date) => new Date(date.getTime() + offset * 60_000);
    const toUtcInstant = (date: Date) => new Date(date.getTime() - offset * 60_000);
    const key = (date: Date, includeHour = false) => {
      const dateKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
      return includeHour ? `${dateKey} ${String(date.getUTCHours()).padStart(2, '0')}:00` : dateKey;
    };
    const monthLabel = (date: Date) => `${date.getUTCDate()} ${date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })}`;
    const sqliteOffset = `${offset >= 0 ? '+' : ''}${offset} minutes`;
    const localNow = toLocalWall(new Date());

    if (range === 'day') {
      const localEnd = new Date(localNow);
      localEnd.setUTCMinutes(0, 0, 0);
      localEnd.setUTCHours(localEnd.getUTCHours() + 1);
      const localStart = new Date(localEnd);
      localStart.setUTCHours(localStart.getUTCHours() - 24);
      const buckets = Array.from({ length: 24 }, (_, index) => {
        const date = new Date(localStart);
        date.setUTCHours(date.getUTCHours() + index);
        return { key: key(date, true), label: `${String(date.getUTCHours()).padStart(2, '0')}:00` };
      });
      return {
        start: toUtcInstant(localStart),
        end: toUtcInstant(localEnd),
        bucketSql: `strftime('%Y-%m-%d %H:00', timestamp, '${sqliteOffset}')`,
        buckets
      };
    }

    if (range === 'week') {
      const localStart = new Date(localNow);
      const day = localStart.getUTCDay();
      localStart.setUTCDate(localStart.getUTCDate() + (day === 0 ? -6 : 1 - day));
      localStart.setUTCHours(0, 0, 0, 0);
      const localEnd = new Date(localStart);
      localEnd.setUTCDate(localEnd.getUTCDate() + 7);
      const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const buckets = labels.map((label, index) => {
        const date = new Date(localStart);
        date.setUTCDate(date.getUTCDate() + index);
        return { key: key(date), label };
      });
      return {
        start: toUtcInstant(localStart),
        end: toUtcInstant(localEnd),
        bucketSql: `strftime('%Y-%m-%d', timestamp, '${sqliteOffset}')`,
        buckets
      };
    }

    const localEnd = new Date(localNow);
    localEnd.setUTCHours(0, 0, 0, 0);
    localEnd.setUTCDate(localEnd.getUTCDate() + 1);
    const localStart = new Date(localEnd);
    localStart.setUTCDate(localStart.getUTCDate() - 30);
    const buckets = Array.from({ length: 30 }, (_, index) => {
      const date = new Date(localStart);
      date.setUTCDate(date.getUTCDate() + index);
      return { key: key(date), label: monthLabel(date) };
    });
    return {
      start: toUtcInstant(localStart),
      end: toUtcInstant(localEnd),
      bucketSql: `strftime('%Y-%m-%d', timestamp, '${sqliteOffset}')`,
      buckets
    };
  }

  private toSummary(row: PageRow): PageSummary {
    return {
      id: row.id,
      slug: row.slug,
      publicUrl: buildShortUrl(row.slug),
      title: row.title,
      description: row.description,
      emoji: row.emoji,
      avatarUrl: row.avatarUrl,
      theme: row.theme,
      layout: row.layout,
      status: row.status,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      blockCount: Number(row.blockCount),
      totalViews: Number(row.totalViews),
      uniqueVisitors: Number(row.uniqueVisitors),
      totalLinkClicks: Number(row.totalLinkClicks),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  private hydrateBlock(type: PageBlockType, config: PageBlockConfig, ownerId?: string) {
    let href: string | null | undefined;
    let available: boolean | undefined;
    if (type === 'existing_link') {
      const linked = this.db
        .prepare('SELECT slug FROM links WHERE id = ? AND user_id = ?')
        .get(config.resourceId ?? '', ownerId ?? '') as { slug: string } | undefined;
      href = linked ? buildShortUrl(linked.slug) : null;
      available = Boolean(linked);
    } else if (type === 'live_activity') {
      const linked = this.db
        .prepare('SELECT slug FROM live_activities WHERE id = ? AND user_id = ?')
        .get(config.resourceId ?? '', ownerId ?? '') as { slug: string } | undefined;
      href = linked ? buildShortUrl(linked.slug) : null;
      available = Boolean(linked);
    }
    if (type === 'double') {
      const children = (config.children ?? []).map((child): PageNestedBlock => {
        const hydrated = this.hydrateBlock(child.type, child.config, ownerId);
        return { ...child, config: hydrated.config, ...(hydrated.href !== undefined ? { href: hydrated.href, available: hydrated.available } : {}) };
      });
      return { config: { ...config, children }, href, available };
    }
    return { config, href, available };
  }

  private getBlocks(pageId: string, visibleOnly = false, ownerId?: string): PageBlock[] {
    const rows = this.db
      .prepare(
        `SELECT id, block_type as type, config_json as configJson, position, visible,
                created_at as createdAt, updated_at as updatedAt
         FROM page_blocks
         WHERE page_id = ? ${visibleOnly ? 'AND visible = 1' : ''}
         ORDER BY position ASC`
      )
      .all(pageId) as unknown as BlockRow[];

    return rows.map((row) => {
      const hydrated = this.hydrateBlock(row.type, JSON.parse(row.configJson) as PageBlockConfig, ownerId);
      return {
        id: row.id,
        type: row.type,
        config: hydrated.config,
        position: Number(row.position),
        visible: Boolean(row.visible),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        ...(hydrated.href !== undefined ? { href: hydrated.href, available: hydrated.available } : {})
      };
    });
  }

  list(
    userId: string,
    options: { search: string; sort: 'newest' | 'oldest' | 'title' | 'views'; page: number; pageSize: number }
  ): PageListResponse {
    const where = options.search ? `AND (LOWER(title) LIKE ? OR LOWER(slug) LIKE ?)` : '';
    const search = `%${options.search.toLowerCase()}%`;
    const parameters = options.search ? [userId, search, search] : [userId];
    const orderBy = {
      newest: 'p.created_at DESC',
      oldest: 'p.created_at ASC',
      title: 'LOWER(p.title) ASC',
      views: 'totalViews DESC, p.created_at DESC'
    }[options.sort];
    const rows = this.db
      .prepare(`${pageSelect} WHERE p.user_id = ? ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(...parameters, options.pageSize, (options.page - 1) * options.pageSize) as unknown as PageRow[];
    const total = Number(
      (this.db
        .prepare(`SELECT COUNT(*) as count FROM pages WHERE user_id = ? ${where.replaceAll('p.', '')}`)
        .get(...parameters) as { count: number }).count
    );
    const stats = this.db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM pages WHERE user_id = ?) as totalPages,
          (SELECT COUNT(*) FROM page_views v INNER JOIN pages p ON p.id = v.page_id WHERE p.user_id = ?) as totalViews,
          (SELECT COUNT(DISTINCT visitor_hash) FROM page_views v INNER JOIN pages p ON p.id = v.page_id WHERE p.user_id = ?) as uniqueVisitors`
      )
      .get(userId, userId, userId) as PageListResponse['stats'];
    return {
      items: rows.map((row) => this.toSummary(row)),
      total,
      page: options.page,
      pageSize: options.pageSize,
      stats: {
        totalPages: Number(stats.totalPages),
        totalViews: Number(stats.totalViews),
        uniqueVisitors: Number(stats.uniqueVisitors)
      }
    };
  }

  findById(id: string): PageDetail | undefined {
    const row = this.db.prepare(`${pageSelect} WHERE p.id = ?`).get(id) as unknown as PageRow | undefined;
    return row ? { ...this.toSummary(row), blocks: this.getBlocks(row.id, false, row.userId) } : undefined;
  }

  findBySlug(slug: string, publishedOnly = false): PageDetail | undefined {
    const row = this.db
      .prepare(`${publishedOnly ? publicPageSelect : pageSelect} WHERE p.slug = ? ${publishedOnly ? "AND p.status = 'published'" : ''}`)
      .get(slug) as unknown as PageRow | undefined;
    return row ? { ...this.toSummary(row), blocks: this.getBlocks(row.id, publishedOnly, row.userId) } : undefined;
  }

  getStatusBySlug(slug: string) {
    return this.db
      .prepare('SELECT id, user_id as userId, status FROM pages WHERE slug = ?')
      .get(slug) as { id: string; userId: string; status: PageStatus } | undefined;
  }

  findRouteBySlug(slug: string) {
    const row = this.db
      .prepare(
        `SELECT id, status, title, description, seo_title as seoTitle, seo_description as seoDescription,
                updated_at as updatedAt
         FROM pages WHERE slug = ?`
      )
      .get(slug) as {
        id: string;
        status: PageStatus;
        title: string;
        description: string | null;
        seoTitle: string | null;
        seoDescription: string | null;
        updatedAt: string;
      } | undefined;
    return row ? { ...row, publicUrl: buildShortUrl(slug) } : undefined;
  }

  private insertBlocks(pageId: string, blocks: PageInput['blocks'], timestamp: string, existingCreated = new Map<string, string>()) {
    const statement = this.db.prepare(
      `INSERT INTO page_blocks (id, page_id, block_type, config_json, position, visible, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    blocks.forEach((block, position) => {
      const id = block.id && existingCreated.has(block.id) ? block.id : createId();
      statement.run(
        id,
        pageId,
        block.type,
        JSON.stringify(block.config),
        position,
        block.visible ? 1 : 0,
        existingCreated.get(id) ?? timestamp,
        timestamp
      );
    });
  }

  create(userId: string, slug: string, input: PageInput) {
    const id = createId();
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`INSERT INTO public_slugs (slug, resource_type, resource_id, created_at) VALUES (?, 'page', ?, ?)`).run(slug, id, timestamp);
      this.db
        .prepare(
          `INSERT INTO pages (id, user_id, slug, title, description, emoji, avatar_url, theme, layout, status, seo_title, seo_description, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, userId, slug, input.title, input.description || null, input.emoji || null, input.avatarUrl || null, input.theme, input.layout, input.status, input.seoTitle || null, input.seoDescription || null, timestamp, timestamp);
      this.insertBlocks(id, input.blocks, timestamp);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.findById(id)!;
  }

  update(id: string, slug: string, input: PageInput) {
    const current = this.findById(id);
    if (!current) return undefined;
    const timestamp = nowIso();
    const existingCreated = new Map(current.blocks.map((block) => [block.id, block.createdAt]));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (current.slug !== slug) {
        this.db.prepare(`DELETE FROM public_slugs WHERE resource_type = 'page' AND resource_id = ?`).run(id);
        this.db.prepare(`INSERT INTO public_slugs (slug, resource_type, resource_id, created_at) VALUES (?, 'page', ?, ?)`).run(slug, id, timestamp);
      }
      this.db
        .prepare(
          `UPDATE pages SET slug = ?, title = ?, description = ?, emoji = ?, avatar_url = ?, theme = ?, layout = ?, status = ?, seo_title = ?, seo_description = ?, updated_at = ? WHERE id = ?`
        )
        .run(slug, input.title, input.description || null, input.emoji || null, input.avatarUrl || null, input.theme, input.layout, input.status, input.seoTitle || null, input.seoDescription || null, timestamp, id);
      this.db.prepare('DELETE FROM page_blocks WHERE page_id = ?').run(id);
      this.insertBlocks(id, input.blocks, timestamp, existingCreated);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.findById(id)!;
  }

  setStatus(id: string, status: PageStatus) {
    this.db.prepare('UPDATE pages SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), id);
    return this.findById(id);
  }

  duplicateForUser(userId: string, sourceId: string, slug: string, title: string) {
    const source = this.findById(sourceId);
    if (!source) return undefined;
    return this.create(userId, slug, {
      title,
      description: source.description ?? '',
      emoji: source.emoji ?? '',
      avatarUrl: source.avatarUrl ?? '',
      theme: source.theme,
      layout: source.layout,
      status: 'draft',
      seoTitle: source.seoTitle ?? '',
      seoDescription: source.seoDescription ?? '',
      blocks: source.blocks.map((block) => ({ type: block.type, config: block.config, visible: block.visible }))
    });
  }

  delete(id: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM pages WHERE id = ?').run(id);
      this.db.prepare(`DELETE FROM public_slugs WHERE resource_type = 'page' AND resource_id = ?`).run(id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  recordView(input: {
    pageId: string;
    visitorHash: string;
    deviceType: string;
    browser: string;
    os: string;
    referrer: string;
    language: string | null;
    rawIp: string | null;
  }) {
    this.db
      .prepare(`INSERT INTO page_views (
        id, page_id, timestamp, visitor_hash, device_type, browser, os, referrer, language, raw_ip
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(createId(), input.pageId, nowIso(), input.visitorHash, input.deviceType, input.browser, input.os, input.referrer, input.language, input.rawIp);
  }

  recordClick(input: {
    pageId: string;
    blockId: string;
    label: string;
    eventId: string;
    visitorHash: string;
    deviceType: string;
    browser: string;
    os: string;
    referrer: string;
    language: string | null;
    rawIp: string | null;
  }) {
    this.db
      .prepare(`INSERT OR IGNORE INTO page_block_clicks (
        id, page_id, block_id, block_label, event_id, timestamp, visitor_hash,
        device_type, browser, os, referrer, language, raw_ip
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        createId(), input.pageId, input.blockId, input.label, input.eventId, nowIso(), input.visitorHash,
        input.deviceType, input.browser, input.os, input.referrer, input.language, input.rawIp
      );
  }

  findClickableBlock(pageId: string, blockId: string) {
    return this.db
      .prepare(
        `SELECT b.block_type as type, b.config_json as configJson
         FROM page_blocks b INNER JOIN pages p ON p.id = b.page_id
         WHERE b.page_id = ? AND b.id = ? AND b.visible = 1 AND p.status = 'published'`
      )
      .get(pageId, blockId) as { type: PageBlockType; configJson: string } | undefined;
  }

  analytics(pageId: string, range: 'day' | 'week' | 'month', timezoneOffsetMinutes = 0, limit = 10): PageAnalytics {
    const totals = this.db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM page_views WHERE page_id = ?) as totalViews,
          (SELECT COUNT(DISTINCT visitor_hash) FROM page_views WHERE page_id = ?) as uniqueVisitors,
          (SELECT COUNT(*) FROM page_block_clicks WHERE page_id = ?) as totalLinkClicks`
      )
      .get(pageId, pageId, pageId) as { totalViews: number; uniqueVisitors: number; totalLinkClicks: number };
    const frame = this.analyticsFrame(range, timezoneOffsetMinutes);
    const rows = this.db
      .prepare(
        `SELECT ${frame.bucketSql} as bucket, COUNT(*) as views, COUNT(DISTINCT visitor_hash) as uniqueVisitors
         FROM page_views WHERE page_id = ? AND timestamp >= ? AND timestamp < ? GROUP BY bucket ORDER BY bucket ASC`
      )
      .all(pageId, frame.start.toISOString(), frame.end.toISOString()) as Array<{ bucket: string; views: number; uniqueVisitors: number }>;
    const rowMap = new Map(rows.map((row) => [row.bucket, row]));
    const viewsOverTime = frame.buckets.map((bucket) => ({
      date: bucket.key,
      label: bucket.label,
      views: Number(rowMap.get(bucket.key)?.views ?? 0),
      uniqueVisitors: Number(rowMap.get(bucket.key)?.uniqueVisitors ?? 0)
    }));
    const clickRows = this.db
      .prepare(
        `SELECT block_id as blockId, MAX(block_label) as label, COUNT(*) as clicks
         FROM page_block_clicks WHERE page_id = ? GROUP BY block_id ORDER BY clicks DESC`
      )
      .all(pageId) as unknown as Array<{ blockId: string; label: string; clicks: number }>;
    const clickMap = new Map(clickRows.map((row) => [row.blockId, Number(row.clicks)]));
    const owner = this.db.prepare('SELECT user_id as userId FROM pages WHERE id = ?').get(pageId) as { userId: string } | undefined;
    const clickableBlocks = owner
      ? this.getBlocks(pageId, false, owner.userId).flatMap((block) => {
          if (block.type !== 'double') return [block];
          return (block.config.children ?? []).map((child, childIndex) => ({
            id: child.id,
            type: child.type,
            config: child.config,
            position: block.position + childIndex / 10,
            visible: child.visible,
            createdAt: block.createdAt,
            updatedAt: block.updatedAt,
            href: child.href,
            available: child.available
          } as PageBlock));
        }).filter((block) => ['link', 'existing_link', 'live_activity', 'email'].includes(block.type))
      : [];
    const blockClicks = clickableBlocks
      .map((block) => ({
        blockId: block.id,
        label: block.config.title || block.config.label || block.config.email || 'Untitled link',
        clicks: clickMap.get(block.id) ?? 0,
        url: block.type === 'link'
          ? block.config.url ?? null
          : block.type === 'email'
            ? block.config.email ? `mailto:${block.config.email}` : null
            : block.href ?? null,
        type: block.type as PageAnalytics['blockClicks'][number]['type'],
        position: block.position
      }))
      .sort((left, right) => right.clicks - left.clicks || left.position - right.position)
      .map(({ position: _position, ...block }) => block);
    const breakdownRows = this.db
      .prepare(
        `SELECT 'devices' as category, COALESCE(NULLIF(TRIM(device_type), ''), 'Unknown') as label, COUNT(*) as value
         FROM page_views WHERE page_id = ? GROUP BY label
         UNION ALL
         SELECT 'browsers', COALESCE(NULLIF(TRIM(browser), ''), 'Unknown'), COUNT(*)
         FROM page_views WHERE page_id = ? GROUP BY COALESCE(NULLIF(TRIM(browser), ''), 'Unknown')
         UNION ALL
         SELECT 'operatingSystems', COALESCE(NULLIF(TRIM(os), ''), 'Unknown'), COUNT(*)
         FROM page_views WHERE page_id = ? GROUP BY COALESCE(NULLIF(TRIM(os), ''), 'Unknown')
         UNION ALL
         SELECT 'languages', COALESCE(NULLIF(TRIM(language), ''), 'Unknown'), COUNT(*)
         FROM page_views WHERE page_id = ? GROUP BY COALESCE(NULLIF(TRIM(language), ''), 'Unknown')
         ORDER BY category, value DESC, label ASC`
      )
      .all(pageId, pageId, pageId, pageId) as unknown as AnalyticsBreakdownRow[];
    const recentClicks = this.db
      .prepare(
        `SELECT c.id, c.timestamp, c.block_label as context,
                c.raw_ip as ipAddress,
                c.browser,
                c.os,
                c.device_type as device,
                c.referrer,
                c.language
         FROM page_block_clicks c
         WHERE c.page_id = ? ORDER BY c.timestamp DESC LIMIT ?`
      )
      .all(pageId, limit) as unknown as PageAnalytics['recentClicks'];
    return {
      totalViews: Number(totals.totalViews),
      uniqueVisitors: Number(totals.uniqueVisitors),
      totalLinkClicks: Number(totals.totalLinkClicks),
      viewsOverTime,
      blockClicks,
      breakdowns: buildAnalyticsBreakdowns(breakdownRows),
      recentClicks
    };
  }

  deleteAnalyticsOlderThan(cutoffIso: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const views = this.db.prepare('DELETE FROM page_views WHERE timestamp < ?').run(cutoffIso).changes;
      const clicks = this.db.prepare('DELETE FROM page_block_clicks WHERE timestamp < ?').run(cutoffIso).changes;
      this.db.exec('COMMIT');
      return Number(views) + Number(clicks);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  clearAnalytics(pageId: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const views = this.db.prepare('DELETE FROM page_views WHERE page_id = ?').run(pageId).changes;
      const clicks = this.db.prepare('DELETE FROM page_block_clicks WHERE page_id = ?').run(pageId).changes;
      this.db.exec('COMMIT');
      return Number(views) + Number(clicks);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  clearAllAnalytics(userId: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const views = this.db
        .prepare('DELETE FROM page_views WHERE page_id IN (SELECT id FROM pages WHERE user_id = ?)')
        .run(userId).changes;
      const clicks = this.db
        .prepare('DELETE FROM page_block_clicks WHERE page_id IN (SELECT id FROM pages WHERE user_id = ?)')
        .run(userId).changes;
      this.db.exec('COMMIT');
      return Number(views) + Number(clicks);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
