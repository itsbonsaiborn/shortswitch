// @vitest-environment node

import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { runMigrations } from './migrations.js';

const priorMigrationNames = [
  'activities_domain_foundation', 'activity_slide_descriptions', 'activity_attempt_submission_reason',
  'activity_managed_media', 'activity_authoritative_deadlines', 'activity_unified_grading',
  'activity_results_indexes', 'activity_publishing_access', 'legacy_live_migration_audit',
  'activity_optional_grading_settings', 'activity_visual_design', 'activity_patterns_and_navigation',
  'activity_attempt_question_points', 'boards_foundation', 'boards_management', 'board_card_ownership',
  'board_grid_reactions', 'board_theme_design', 'board_realtime_moderation', 'board_recovery_security',
  'board_submission_expiration', 'service_sections', 'service_contacts_visual_config', 'service_submissions',
  'service_submission_inbox_settings', 'service_submission_availability'
] as const;

describe('administrator TOTP migration', () => {
  it('adds isolated 2FA storage without changing existing users and cascades private records', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO users VALUES (
        'existing-admin', 'admin@example.test', 'Admin', 'existing-password-hash',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
    `);
    const insertMigration = database.prepare(
      'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    );
    priorMigrationNames.forEach((name, index) => insertMigration.run(index + 1, name, '2026-01-01T00:00:00.000Z'));

    runMigrations(database);

    expect(database.prepare('SELECT email, password_hash AS passwordHash FROM users').get()).toEqual({
      email: 'admin@example.test', passwordHash: 'existing-password-hash'
    });
    expect(database.prepare('SELECT name FROM schema_migrations WHERE version = 27').get())
      .toEqual({ name: 'administrator_totp_two_factor' });
    database.prepare(`
      INSERT INTO user_totp_settings (user_id, secret_encrypted, last_used_counter, enabled_at, updated_at)
      VALUES ('existing-admin', 'v1.test', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    `).run();
    database.prepare(`
      INSERT INTO pending_auth_challenges (id, user_id, created_at, expires_at, failed_attempts)
      VALUES ('pending', 'existing-admin', '2026-01-01T00:00:00.000Z', '2026-01-01T00:05:00.000Z', 0)
    `).run();
    database.prepare("DELETE FROM users WHERE id = 'existing-admin'").run();
    expect(database.prepare('SELECT COUNT(*) AS count FROM user_totp_settings').get()).toEqual({ count: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM pending_auth_challenges').get()).toEqual({ count: 0 });
    expect(database.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
    database.close();
  });
});
