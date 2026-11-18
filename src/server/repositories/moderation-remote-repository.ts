import type {
  ModerationRule,
  RemoteModerationParsingMode,
  RemoteModerationRulePreview,
  RemoteModerationSource,
  RemoteModerationSyncStatus
} from '../../shared/types.js';
import { getDb } from '../db.js';
import { createId, nowIso } from '../utils.js';

export interface RemoteModerationSourceRecord extends Omit<RemoteModerationSource, 'syncing'> {
  userId: string;
  contentHash: string | null;
}

interface SourceRow {
  id: string;
  userId: string;
  url: string;
  parsingMode: RemoteModerationParsingMode;
  updateIntervalMinutes: number | null;
  enabled: number;
  createdAt: string;
  updatedAt: string;
  lastSuccessfulUpdateAt: string | null;
  lastCheckedAt: string | null;
  ruleCount: number;
  syncStatus: RemoteModerationSyncStatus;
  lastError: string | null;
  contentHash: string | null;
}

const sourceSelect = `
  SELECT id, user_id AS userId, url, parsing_mode AS parsingMode,
         update_interval_minutes AS updateIntervalMinutes, enabled,
         created_at AS createdAt, updated_at AS updatedAt,
         last_successful_update_at AS lastSuccessfulUpdateAt,
         last_checked_at AS lastCheckedAt, rule_count AS ruleCount,
         sync_status AS syncStatus, last_error AS lastError, content_hash AS contentHash
  FROM moderation_remote_sources
`;

const mapSource = (row: SourceRow): RemoteModerationSourceRecord => ({
  ...row,
  enabled: Boolean(row.enabled),
  updateIntervalMinutes: row.updateIntervalMinutes === null ? null : Number(row.updateIntervalMinutes),
  ruleCount: Number(row.ruleCount)
});

export class ModerationRemoteRepository {
  private readonly db = getDb();

  listSources(userId: string) {
    return (this.db.prepare(`${sourceSelect} WHERE user_id = ? ORDER BY created_at DESC, id DESC`).all(userId) as unknown as SourceRow[])
      .map(mapSource);
  }

  listAutomatedSources() {
    return (this.db.prepare(`${sourceSelect} WHERE enabled = 1 AND update_interval_minutes IS NOT NULL`).all() as unknown as SourceRow[])
      .map(mapSource);
  }

  getSource(userId: string, id: string) {
    const row = this.db.prepare(`${sourceSelect} WHERE user_id = ? AND id = ?`).get(userId, id) as unknown as SourceRow | undefined;
    return row ? mapSource(row) : undefined;
  }

  createSource(input: {
    userId: string;
    url: string;
    parsingMode: RemoteModerationParsingMode;
    updateIntervalMinutes: number | null;
    enabled: boolean;
  }) {
    const id = createId();
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO moderation_remote_sources (
        id, user_id, url, parsing_mode, update_interval_minutes, enabled,
        created_at, updated_at, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      id,
      input.userId,
      input.url,
      input.parsingMode,
      input.updateIntervalMinutes,
      input.enabled ? 1 : 0,
      timestamp,
      timestamp
    );
    return this.getSource(input.userId, id)!;
  }

  updateSource(id: string, userId: string, input: {
    url: string;
    parsingMode: RemoteModerationParsingMode;
    updateIntervalMinutes: number | null;
    enabled: boolean;
    sourceChanged: boolean;
  }) {
    const timestamp = nowIso();
    const result = this.db.prepare(`
      UPDATE moderation_remote_sources
      SET url = ?, parsing_mode = ?, update_interval_minutes = ?, enabled = ?,
          updated_at = ?, sync_status = CASE WHEN ? = 1 THEN 'pending' ELSE sync_status END,
          last_error = CASE WHEN ? = 1 THEN NULL ELSE last_error END,
          content_hash = CASE WHEN ? = 1 THEN NULL ELSE content_hash END
      WHERE id = ? AND user_id = ?
    `).run(
      input.url,
      input.parsingMode,
      input.updateIntervalMinutes,
      input.enabled ? 1 : 0,
      timestamp,
      input.sourceChanged ? 1 : 0,
      input.sourceChanged ? 1 : 0,
      input.sourceChanged ? 1 : 0,
      id,
      userId
    );
    return result.changes > 0 ? this.getSource(userId, id) : undefined;
  }

  setEnabled(id: string, userId: string, enabled: boolean) {
    const result = this.db.prepare(`
      UPDATE moderation_remote_sources SET enabled = ?, updated_at = ? WHERE id = ? AND user_id = ?
    `).run(enabled ? 1 : 0, nowIso(), id, userId);
    return result.changes > 0 ? this.getSource(userId, id) : undefined;
  }

  deleteSource(id: string, userId: string) {
    return this.db.prepare('DELETE FROM moderation_remote_sources WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
  }

  listRulePreviews(sourceId: string, limit = 100): RemoteModerationRulePreview[] {
    return this.db.prepare(`
      SELECT id, pattern, match_mode AS matchMode, position
      FROM moderation_remote_rules
      WHERE source_id = ?
      ORDER BY position ASC
      LIMIT ?
    `).all(sourceId, limit) as unknown as RemoteModerationRulePreview[];
  }

  listAllRules(sourceId: string): RemoteModerationRulePreview[] {
    return this.db.prepare(`
      SELECT id, pattern, match_mode AS matchMode, position
      FROM moderation_remote_rules
      WHERE source_id = ?
      ORDER BY position ASC
    `).all(sourceId) as unknown as RemoteModerationRulePreview[];
  }

  listActiveRules(userId: string): ModerationRule[] {
    return this.db.prepare(`
      SELECT 'remote:' || rules.id AS id, rules.pattern, rules.match_mode AS matchMode,
             rules.created_at AS createdAt, sources.updated_at AS updatedAt
      FROM moderation_remote_rules rules
      INNER JOIN moderation_remote_sources sources ON sources.id = rules.source_id
      WHERE sources.user_id = ? AND sources.enabled = 1
      ORDER BY sources.created_at DESC, rules.position ASC
    `).all(userId) as unknown as ModerationRule[];
  }

  recordFailure(id: string, checkedAt: string, message: string) {
    this.db.prepare(`
      UPDATE moderation_remote_sources
      SET last_checked_at = ?, sync_status = 'error', last_error = ?, updated_at = ?
      WHERE id = ?
    `).run(checkedAt, message.slice(0, 500), checkedAt, id);
  }

  recordUnchanged(id: string, checkedAt: string, ruleCount: number, contentHash: string) {
    this.db.prepare(`
      UPDATE moderation_remote_sources
      SET last_checked_at = ?, rule_count = ?, content_hash = ?,
          sync_status = 'unchanged', last_error = NULL, updated_at = ?
      WHERE id = ?
    `).run(checkedAt, ruleCount, contentHash, checkedAt, id);
  }

  replaceRules(id: string, checkedAt: string, contentHash: string, rules: Array<{
    pattern: string;
    matchMode: ModerationRule['matchMode'];
  }>) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM moderation_remote_rules WHERE source_id = ?').run(id);
      const insert = this.db.prepare(`
        INSERT INTO moderation_remote_rules (id, source_id, pattern, match_mode, position, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      rules.forEach((rule, position) => {
        insert.run(createId(), id, rule.pattern, rule.matchMode, position, checkedAt);
      });
      this.db.prepare(`
        UPDATE moderation_remote_sources
        SET last_checked_at = ?, last_successful_update_at = ?, rule_count = ?,
            sync_status = 'success', last_error = NULL, content_hash = ?, updated_at = ?
        WHERE id = ?
      `).run(checkedAt, checkedAt, rules.length, contentHash, checkedAt, id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
