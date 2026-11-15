import { getDb } from '../db.js';
import { createId, nowIso } from '../utils.js';

export interface TotpSettingsRow {
  userId: string;
  secretEncrypted: string;
  lastUsedCounter: number | null;
  enabledAt: string;
  updatedAt: string;
}

export interface PendingAuthChallengeRow {
  id: string;
  userId: string;
  expiresAt: string;
  failedAttempts: number;
}

export class TwoFactorRepository {
  private db = getDb();

  getSettings(userId: string) {
    return this.db.prepare(`
      SELECT user_id AS userId, secret_encrypted AS secretEncrypted,
        last_used_counter AS lastUsedCounter, enabled_at AS enabledAt, updated_at AS updatedAt
      FROM user_totp_settings WHERE user_id = ?
    `).get(userId) as TotpSettingsRow | undefined;
  }

  getAnySettings() {
    return this.db.prepare(`
      SELECT user_id AS userId, secret_encrypted AS secretEncrypted,
        last_used_counter AS lastUsedCounter, enabled_at AS enabledAt, updated_at AS updatedAt
      FROM user_totp_settings LIMIT 1
    `).get() as TotpSettingsRow | undefined;
  }

  saveEnrollment(userId: string, secretEncrypted: string, expiresAt: string) {
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO user_totp_enrollments (user_id, secret_encrypted, created_at, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        secret_encrypted = excluded.secret_encrypted,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at
    `).run(userId, secretEncrypted, timestamp, expiresAt);
  }

  getEnrollment(userId: string) {
    return this.db.prepare(`
      SELECT secret_encrypted AS secretEncrypted, expires_at AS expiresAt
      FROM user_totp_enrollments WHERE user_id = ?
    `).get(userId) as { secretEncrypted: string; expiresAt: string } | undefined;
  }

  activate(userId: string, secretEncrypted: string, counter: number, recoveryCodeHashes: string[]) {
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        INSERT INTO user_totp_settings (
          user_id, secret_encrypted, last_used_counter, enabled_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          secret_encrypted = excluded.secret_encrypted,
          last_used_counter = excluded.last_used_counter,
          enabled_at = excluded.enabled_at,
          updated_at = excluded.updated_at
      `).run(userId, secretEncrypted, counter, timestamp, timestamp);
      this.db.prepare('DELETE FROM user_totp_recovery_codes WHERE user_id = ?').run(userId);
      const insertCode = this.db.prepare(`
        INSERT INTO user_totp_recovery_codes (id, user_id, code_hash, created_at, used_at)
        VALUES (?, ?, ?, ?, NULL)
      `);
      for (const codeHash of recoveryCodeHashes) {
        insertCode.run(createId(), userId, codeHash, timestamp);
      }
      this.db.prepare('DELETE FROM user_totp_enrollments WHERE user_id = ?').run(userId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  acceptCounter(userId: string, counter: number) {
    const result = this.db.prepare(`
      UPDATE user_totp_settings
      SET last_used_counter = ?, updated_at = ?
      WHERE user_id = ? AND (last_used_counter IS NULL OR last_used_counter < ?)
    `).run(counter, nowIso(), userId, counter);
    return Number(result.changes) === 1;
  }

  listUnusedRecoveryCodes(userId: string) {
    return this.db.prepare(`
      SELECT id, code_hash AS codeHash
      FROM user_totp_recovery_codes
      WHERE user_id = ? AND used_at IS NULL
      ORDER BY created_at ASC, id ASC
    `).all(userId) as Array<{ id: string; codeHash: string }>;
  }

  useRecoveryCode(userId: string, id: string) {
    const result = this.db.prepare(`
      UPDATE user_totp_recovery_codes SET used_at = ?
      WHERE id = ? AND user_id = ? AND used_at IS NULL
    `).run(nowIso(), id, userId);
    return Number(result.changes) === 1;
  }

  countUnusedRecoveryCodes(userId: string) {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM user_totp_recovery_codes
      WHERE user_id = ? AND used_at IS NULL
    `).get(userId) as { count: number };
    return Number(row.count);
  }

  disable(userId: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM user_totp_recovery_codes WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM user_totp_enrollments WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM pending_auth_challenges WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM user_totp_settings WHERE user_id = ?').run(userId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  createChallenge(userId: string, expiresAt: string) {
    const id = createId();
    this.db.prepare('DELETE FROM pending_auth_challenges WHERE user_id = ?').run(userId);
    this.db.prepare(`
      INSERT INTO pending_auth_challenges (
        id, user_id, created_at, expires_at, failed_attempts
      ) VALUES (?, ?, ?, ?, 0)
    `).run(id, userId, nowIso(), expiresAt);
    return id;
  }

  getChallenge(id: string) {
    return this.db.prepare(`
      SELECT id, user_id AS userId, expires_at AS expiresAt, failed_attempts AS failedAttempts
      FROM pending_auth_challenges WHERE id = ?
    `).get(id) as PendingAuthChallengeRow | undefined;
  }

  recordChallengeFailure(id: string, maximumAttempts: number) {
    this.db.prepare(`
      UPDATE pending_auth_challenges SET failed_attempts = failed_attempts + 1
      WHERE id = ? AND failed_attempts < ?
    `).run(id, maximumAttempts);
    const challenge = this.getChallenge(id);
    if (challenge && challenge.failedAttempts >= maximumAttempts) this.deleteChallenge(id);
  }

  deleteChallenge(id: string) {
    this.db.prepare('DELETE FROM pending_auth_challenges WHERE id = ?').run(id);
  }

  deleteExpiredChallenges() {
    this.db.prepare('DELETE FROM pending_auth_challenges WHERE expires_at < ?').run(nowIso());
    this.db.prepare('DELETE FROM user_totp_enrollments WHERE expires_at < ?').run(nowIso());
  }
}
