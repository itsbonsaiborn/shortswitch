import { getDb } from '../db.js';
import { createId, nowIso } from '../utils.js';

export interface SessionRow {
  id: string;
  userId: string;
  sessionVersion: number;
  csrfSecret: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export class SessionRepository {
  private db = getDb();

  create(input: Omit<SessionRow, 'id' | 'createdAt' | 'lastSeenAt'>) {
    const id = createId();
    const timestamp = nowIso();
    this.db
      .prepare(
        `INSERT INTO sessions (
          id, user_id, session_version, csrf_secret, created_at, last_seen_at, expires_at, ip_address, user_agent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.userId,
        input.sessionVersion,
        input.csrfSecret,
        timestamp,
        timestamp,
        input.expiresAt,
        input.ipAddress,
        input.userAgent
      );
    return id;
  }

  findById(id: string) {
    return this.db
      .prepare(
        `SELECT
          id,
          user_id as userId,
          session_version as sessionVersion,
          csrf_secret as csrfSecret,
          created_at as createdAt,
          last_seen_at as lastSeenAt,
          expires_at as expiresAt,
          ip_address as ipAddress,
          user_agent as userAgent
         FROM sessions
         WHERE id = ?`
      )
      .get(id) as SessionRow | undefined;
  }

  touch(id: string) {
    this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(nowIso(), id);
  }

  listForUser(userId: string) {
    return this.db
      .prepare(
        `SELECT
          id,
          created_at as createdAt,
          last_seen_at as lastSeenAt,
          ip_address as ipAddress,
          user_agent as userAgent
         FROM sessions
         WHERE user_id = ?
         ORDER BY last_seen_at DESC`
      )
      .all(userId) as Array<{
        id: string;
        createdAt: string;
        lastSeenAt: string;
        ipAddress: string | null;
        userAgent: string | null;
      }>;
  }

  delete(id: string) {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  deleteOthers(userId: string, sessionId: string) {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, sessionId);
  }

  deleteForUser(userId: string) {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  deleteExpired() {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso());
  }

  deleteOutdatedVersions(userId: string, sessionVersion: number, keepSessionId?: string) {
    if (keepSessionId) {
      this.db
        .prepare(
          'DELETE FROM sessions WHERE user_id = ? AND (session_version != ? OR id != ?)'
        )
        .run(userId, sessionVersion, keepSessionId);
      return;
    }
    this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND session_version != ?').run(userId, sessionVersion);
  }

  updateSessionVersion(sessionId: string, sessionVersion: number) {
    this.db
      .prepare('UPDATE sessions SET session_version = ?, last_seen_at = ? WHERE id = ?')
      .run(sessionVersion, nowIso(), sessionId);
  }
}
