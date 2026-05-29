import type { CurrentUser } from '@/shared/types.js';
import { getDb } from '../db.js';
import { createId, nowIso } from '../utils.js';

export interface UserRow extends CurrentUser {
  passwordHash: string;
  sessionVersion: number;
  isBootstrapAdmin: number;
}

export class UserRepository {
  private db = getDb();

  findBootstrapAdmin() {
    return this.db
      .prepare('SELECT id FROM users WHERE is_bootstrap_admin = 1 LIMIT 1')
      .get() as { id: string } | undefined;
  }

  findFirstUser() {
    return this.db
      .prepare('SELECT id FROM users ORDER BY created_at ASC, rowid ASC LIMIT 1')
      .get() as { id: string } | undefined;
  }

  createOrPromoteBootstrapAdmin(email: string, name: string, passwordHash: string) {
    const existingBootstrapAdmin = this.findBootstrapAdmin();

    const timestamp = nowIso();

    if (existingBootstrapAdmin) {
      return existingBootstrapAdmin.id;
    }

    const existingByEmail = this.db
      .prepare('SELECT id FROM users WHERE email = ?')
      .get(email) as { id: string } | undefined;

    if (existingByEmail) {
      this.db
        .prepare(
          `UPDATE users
           SET name = ?, password_hash = ?, is_bootstrap_admin = 1, session_version = session_version + 1, updated_at = ?
           WHERE id = ?`
        )
        .run(name, passwordHash, timestamp, existingByEmail.id);
      return existingByEmail.id;
    }

    const firstUser = this.findFirstUser();

    if (firstUser) {
      this.db
        .prepare(
          `UPDATE users
           SET email = ?, name = ?, password_hash = ?, is_bootstrap_admin = 1, session_version = session_version + 1, updated_at = ?
           WHERE id = ?`
        )
        .run(email, name, passwordHash, timestamp, firstUser.id);
      return firstUser.id;
    }

    const id = createId();
    this.db
      .prepare(
        `INSERT INTO users (id, email, name, password_hash, is_bootstrap_admin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, email, name, passwordHash, 1, timestamp, timestamp);

    return id;
  }

  resetBootstrapAdmin(email: string, name: string, passwordHash: string) {
    const timestamp = nowIso();
    const canonicalUser =
      this.findBootstrapAdmin() ??
      this.findFirstUser();

    if (canonicalUser) {
      this.db.exec('BEGIN');
      try {
        this.db.prepare('DELETE FROM sessions').run();
        this.db.prepare('UPDATE links SET user_id = ? WHERE user_id != ?').run(canonicalUser.id, canonicalUser.id);
        this.db.prepare('DELETE FROM users WHERE id != ?').run(canonicalUser.id);
        this.db
          .prepare(
            `UPDATE users
             SET email = ?, name = ?, password_hash = ?, is_bootstrap_admin = 1, session_version = session_version + 1, updated_at = ?
             WHERE id = ?`
          )
          .run(email, name, passwordHash, timestamp, canonicalUser.id);
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
      return canonicalUser.id;
    }

    return this.createOrPromoteBootstrapAdmin(email, name, passwordHash);
  }

  findByEmail(email: string) {
    const row = this.db
      .prepare(
        `SELECT id, email, name, theme, password_hash as passwordHash, session_version as sessionVersion, is_bootstrap_admin as isBootstrapAdmin
         FROM users WHERE email = ?`
      )
      .get(email) as UserRow | undefined;
    return row;
  }

  findById(id: string) {
    return this.db
      .prepare(
        `SELECT id, email, name, theme, password_hash as passwordHash, session_version as sessionVersion, is_bootstrap_admin as isBootstrapAdmin
         FROM users WHERE id = ?`
      )
      .get(id) as UserRow | undefined;
  }

  updateTheme(id: string, theme: CurrentUser['theme']) {
    this.db.prepare('UPDATE users SET theme = ?, updated_at = ? WHERE id = ?').run(theme, nowIso(), id);
  }

  updatePassword(id: string, passwordHash: string) {
    this.db
      .prepare(
        'UPDATE users SET password_hash = ?, session_version = session_version + 1, updated_at = ? WHERE id = ?'
      )
      .run(passwordHash, nowIso(), id);
  }
}
