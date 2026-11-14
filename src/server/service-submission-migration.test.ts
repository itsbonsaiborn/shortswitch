// @vitest-environment node

import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { runMigrations } from './migrations.js';

const migrationNames = [
  'activities_domain_foundation', 'activity_slide_descriptions', 'activity_attempt_submission_reason',
  'activity_managed_media', 'activity_authoritative_deadlines', 'activity_unified_grading',
  'activity_results_indexes', 'activity_publishing_access', 'legacy_live_migration_audit',
  'activity_optional_grading_settings', 'activity_visual_design', 'activity_patterns_and_navigation',
  'activity_attempt_question_points', 'boards_foundation', 'boards_management', 'board_card_ownership',
  'board_grid_reactions', 'board_theme_design', 'board_realtime_moderation', 'board_recovery_security',
  'board_submission_expiration', 'service_sections', 'service_contacts_visual_config', 'service_submissions'
] as const;

describe('Service submission Inbox migration', () => {
  it('preserves Stage 5 records and maps legacy processing statuses', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE service_submissions (
        id TEXT PRIMARY KEY,
        submission_type TEXT NOT NULL CHECK (submission_type IN ('contact', 'report_abuse')),
        status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_review', 'resolved', 'dismissed')),
        email TEXT, subject TEXT, message TEXT, link_identifier TEXT,
        reason TEXT, description TEXT, reporter_email TEXT,
        duplicate_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO service_submissions VALUES
        ('contact-1', 'contact', 'in_review', 'sender@example.test', 'Subject', 'Message', NULL, NULL, NULL, NULL, 'duplicate-1', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
        ('abuse-1', 'report_abuse', 'dismissed', NULL, NULL, NULL, 'short-id', 'spam', 'Description', 'reporter@example.test', 'duplicate-2', '2026-01-03T00:00:00.000Z', '2026-01-04T00:00:00.000Z');
    `);
    const insertMigration = database.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');
    migrationNames.forEach((name, index) => insertMigration.run(index + 1, name, '2026-01-01T00:00:00.000Z'));

    runMigrations(database);

    expect(database.prepare('SELECT id, status, duplicate_key FROM service_submissions ORDER BY id').all()).toEqual([
      { id: 'abuse-1', status: 'rejected', duplicate_key: 'duplicate-2' },
      { id: 'contact-1', status: 'in_progress', duplicate_key: 'duplicate-1' }
    ]);
    expect(database.prepare('SELECT allowed_email_domains_json, public_contact_email, retention_days FROM service_submission_settings').get())
      .toEqual({ allowed_email_domains_json: '[]', public_contact_email: null, retention_days: 365 });
    expect(database.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
    database.close();
  });
});
