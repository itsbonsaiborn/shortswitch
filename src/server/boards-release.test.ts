// @vitest-environment node

import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from './migrations.js';

const migrationNames = [
  'activities_domain_foundation',
  'activity_slide_descriptions',
  'activity_attempt_submission_reason',
  'activity_managed_media',
  'activity_authoritative_deadlines',
  'activity_unified_grading',
  'activity_results_indexes',
  'activity_publishing_access',
  'legacy_live_migration_audit',
  'activity_optional_grading_settings',
  'activity_visual_design',
  'activity_patterns_and_navigation',
  'activity_attempt_question_points',
  'boards_foundation',
  'boards_management',
  'board_card_ownership',
  'board_grid_reactions',
  'board_theme_design',
  'board_realtime_moderation'
] as const;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Boards release migrations', () => {
  it('upgrades pre-security card credentials without changing ownership hashes and restores from a file backup', () => {
    const directory = mkdtempSync(join(tmpdir(), 'shortswitch-boards-release-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'upgrade.sqlite');
    const backupPath = join(directory, 'upgrade.backup.sqlite');
    const database = new DatabaseSync(databasePath);

    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE board_card_credentials (
        card_id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        owner_token_hash TEXT NOT NULL UNIQUE,
        recovery_pin_hash TEXT,
        credential_version INTEGER NOT NULL DEFAULT 1 CHECK (credential_version >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_used_at TEXT
      );
    `);
    const insertMigration = database.prepare(
      'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    );
    migrationNames.forEach((name, index) => insertMigration.run(index + 1, name, '2026-01-01T00:00:00.000Z'));
    database.prepare(`
      INSERT INTO board_card_credentials (
        card_id, board_id, owner_token_hash, recovery_pin_hash,
        credential_version, created_at, updated_at, last_used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'card-existing',
      'board-existing',
      'owner-hash-must-survive',
      'pin-hash-must-survive',
      3,
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
      '2026-01-03T00:00:00.000Z'
    );

    runMigrations(database);

    const upgraded = database.prepare('SELECT * FROM board_card_credentials WHERE card_id = ?')
      .get('card-existing') as Record<string, unknown>;
    expect(upgraded).toMatchObject({
      board_id: 'board-existing',
      owner_token_hash: 'owner-hash-must-survive',
      recovery_pin_hash: 'pin-hash-must-survive',
      credential_version: 3,
      recovery_failed_attempts: 0,
      recovery_window_started_at: null,
      recovery_locked_until: null
    });
    expect(database.prepare('SELECT name FROM schema_migrations WHERE version = 20').get()).toEqual({
      name: 'board_recovery_security'
    });
    expect(database.prepare('SELECT name FROM schema_migrations WHERE version = 21').get()).toEqual({
      name: 'board_submission_expiration'
    });
    expect(database.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    database.close();
    copyFileSync(databasePath, backupPath);
    expect(readFileSync(backupPath).byteLength).toBeGreaterThan(0);

    const restored = new DatabaseSync(backupPath, { readOnly: true });
    expect(restored.prepare('SELECT owner_token_hash, recovery_pin_hash FROM board_card_credentials').get())
      .toEqual({
        owner_token_hash: 'owner-hash-must-survive',
        recovery_pin_hash: 'pin-hash-must-survive'
      });
    expect(restored.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
    restored.close();
  });
});
