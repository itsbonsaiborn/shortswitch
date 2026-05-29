import type { LinkRecord } from '@/shared/types.js';
import { getDb } from '../db.js';
import { buildShortUrl, createId, nowIso } from '../utils.js';

export interface LinkRow {
  id: string;
  userId: string;
  slug: string;
  targetUrl: string;
  comment: string | null;
  passwordHash: string | null;
  enabled: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  clickCount: number;
  uniqueClickCount: number;
}

export class LinkRepository {
  private db = getDb();

  list(userId: string): LinkRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
          id,
          slug,
          target_url as targetUrl,
          comment,
          password_hash as passwordHash,
          enabled,
          created_at as createdAt,
          expires_at as expiresAt,
          click_count as clickCount,
          (
            SELECT COUNT(DISTINCT visitor_hash)
            FROM analytics_events
            WHERE analytics_events.link_id = links.id
          ) as uniqueClickCount
         FROM links
         WHERE user_id = ?
         ORDER BY created_at DESC`
      )
      .all(userId) as Array<Omit<LinkRow, 'userId' | 'updatedAt'>>;

    return rows.map((row) => ({
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
      uniqueClickCount: row.uniqueClickCount ?? 0
    }));
  }

  create(input: {
    userId: string;
    slug: string;
    targetUrl: string;
    comment: string | null;
    passwordHash: string | null;
    expiresAt: string | null;
  }) {
    const id = createId();
    const timestamp = nowIso();
    this.db
      .prepare(
        `INSERT INTO links (
          id, user_id, slug, target_url, comment, password_hash, enabled, created_at, updated_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.userId,
        input.slug,
        input.targetUrl,
        input.comment,
        input.passwordHash,
        1,
        timestamp,
        timestamp,
        input.expiresAt
      );
    return this.findById(id)!;
  }

  findById(id: string) {
    return this.db
      .prepare(
        `SELECT
          id,
          user_id as userId,
          slug,
          target_url as targetUrl,
          comment,
          password_hash as passwordHash,
          enabled,
          created_at as createdAt,
          updated_at as updatedAt,
          expires_at as expiresAt,
          click_count as clickCount,
          (
            SELECT COUNT(DISTINCT visitor_hash)
            FROM analytics_events
            WHERE analytics_events.link_id = links.id
          ) as uniqueClickCount
         FROM links
         WHERE id = ?`
      )
      .get(id) as LinkRow | undefined;
  }

  findBySlug(slug: string) {
    return this.db
      .prepare(
        `SELECT
          id,
          user_id as userId,
          slug,
          target_url as targetUrl,
          comment,
          password_hash as passwordHash,
          enabled,
          created_at as createdAt,
          updated_at as updatedAt,
          expires_at as expiresAt,
          click_count as clickCount,
          (
            SELECT COUNT(DISTINCT visitor_hash)
            FROM analytics_events
            WHERE analytics_events.link_id = links.id
          ) as uniqueClickCount
         FROM links
         WHERE slug = ?`
      )
      .get(slug) as LinkRow | undefined;
  }

  update(
    id: string,
    input: {
      targetUrl: string;
      slug: string;
      comment: string | null;
      passwordHash: string | null;
      expiresAt: string | null;
    }
  ) {
    this.db
      .prepare(
        `UPDATE links
         SET target_url = ?, slug = ?, comment = ?, password_hash = ?, expires_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(input.targetUrl, input.slug, input.comment, input.passwordHash, input.expiresAt, nowIso(), id);
    return this.findById(id)!;
  }

  setEnabled(id: string, enabled: boolean, expiresAt?: string | null) {
    this.db
      .prepare(
        `UPDATE links
         SET enabled = ?, expires_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(enabled ? 1 : 0, expiresAt ?? null, nowIso(), id);
    return this.findById(id)!;
  }

  delete(id: string) {
    this.db.prepare('DELETE FROM links WHERE id = ?').run(id);
  }

  incrementClicks(id: string) {
    this.db.prepare('UPDATE links SET click_count = click_count + 1 WHERE id = ?').run(id);
  }

  resetAllClickCounts() {
    this.db.prepare('UPDATE links SET click_count = 0').run();
  }

  resetClickCount(id: string) {
    this.db.prepare('UPDATE links SET click_count = 0 WHERE id = ?').run(id);
  }
}
