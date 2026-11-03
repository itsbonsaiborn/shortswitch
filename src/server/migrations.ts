import type { DatabaseSync } from 'node:sqlite';
import { nowIso } from './utils.js';

interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseSync) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'activities_domain_foundation',
    up(db) {
      db.exec(`
        CREATE TABLE activity_versions (
          id TEXT PRIMARY KEY,
          activity_id TEXT NOT NULL,
          version_number INTEGER NOT NULL,
          settings_json TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          published_by TEXT,
          published_at TEXT NOT NULL,
          UNIQUE (activity_id, version_number),
          UNIQUE (activity_id, id),
          FOREIGN KEY (activity_id) REFERENCES live_activities(id) ON DELETE CASCADE,
          FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE TABLE activity_models (
          activity_id TEXT PRIMARY KEY,
          model TEXT NOT NULL DEFAULT 'slides_v1' CHECK (model IN ('legacy_v1', 'slides_v1')),
          description TEXT NOT NULL DEFAULT '',
          required_answer_behavior TEXT NOT NULL CHECK (required_answer_behavior IN ('require_all', 'allow_incomplete')),
          navigation_policy TEXT NOT NULL CHECK (navigation_policy IN ('linear', 'free')),
          result_visibility TEXT NOT NULL CHECK (result_visibility IN ('never', 'after_submission', 'after_close')),
          maximum_attempts INTEGER NOT NULL CHECK (maximum_attempts BETWEEN 1 AND 100),
          attempt_time_limit_seconds INTEGER,
          submission_deadline_at TEXT,
          shuffle_question_options INTEGER NOT NULL DEFAULT 0 CHECK (shuffle_question_options IN (0, 1)),
          published_version_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (activity_id) REFERENCES live_activities(id) ON DELETE CASCADE,
          FOREIGN KEY (activity_id, published_version_id) REFERENCES activity_versions(activity_id, id)
            ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
        );

        CREATE TABLE activity_drafts (
          activity_id TEXT PRIMARY KEY,
          revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (activity_id) REFERENCES activity_models(activity_id) ON DELETE CASCADE
        );

        CREATE TABLE activity_draft_slides (
          id TEXT PRIMARY KEY,
          activity_id TEXT NOT NULL,
          position INTEGER NOT NULL CHECK (position >= 0),
          title TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (activity_id, position),
          UNIQUE (activity_id, id),
          FOREIGN KEY (activity_id) REFERENCES activity_drafts(activity_id) ON DELETE CASCADE
        );

        CREATE TABLE activity_draft_blocks (
          id TEXT PRIMARY KEY,
          slide_id TEXT NOT NULL,
          position INTEGER NOT NULL CHECK (position >= 0),
          block_type TEXT NOT NULL CHECK (block_type IN ('heading', 'text', 'image', 'divider', 'question')),
          question_type TEXT CHECK (question_type IN ('single_choice', 'multiple_choice', 'open_answer', 'word_cloud', 'ordering', 'matching', 'image_labeling')),
          is_graded INTEGER NOT NULL DEFAULT 0 CHECK (is_graded IN (0, 1)),
          points INTEGER NOT NULL DEFAULT 0 CHECK (points BETWEEN 0 AND 1000),
          required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
          public_config_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (slide_id, position),
          CHECK ((block_type = 'question' AND question_type IS NOT NULL) OR (block_type != 'question' AND question_type IS NULL)),
          FOREIGN KEY (slide_id) REFERENCES activity_draft_slides(id) ON DELETE CASCADE
        );

        CREATE UNIQUE INDEX idx_activity_draft_one_graded_question
          ON activity_draft_blocks(slide_id)
          WHERE block_type = 'question' AND is_graded = 1;

        CREATE TABLE activity_draft_question_keys (
          block_id TEXT PRIMARY KEY,
          question_type TEXT NOT NULL CHECK (question_type IN ('single_choice', 'multiple_choice', 'open_answer', 'word_cloud', 'ordering', 'matching', 'image_labeling')),
          key_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (block_id) REFERENCES activity_draft_blocks(id) ON DELETE CASCADE
        );

        CREATE TABLE activity_version_slides (
          id TEXT PRIMARY KEY,
          version_id TEXT NOT NULL,
          stable_id TEXT NOT NULL,
          position INTEGER NOT NULL CHECK (position >= 0),
          title TEXT NOT NULL DEFAULT '',
          UNIQUE (version_id, position),
          UNIQUE (version_id, stable_id),
          FOREIGN KEY (version_id) REFERENCES activity_versions(id) ON DELETE CASCADE
        );

        CREATE TABLE activity_version_blocks (
          id TEXT PRIMARY KEY,
          slide_id TEXT NOT NULL,
          stable_id TEXT NOT NULL,
          position INTEGER NOT NULL CHECK (position >= 0),
          block_type TEXT NOT NULL CHECK (block_type IN ('heading', 'text', 'image', 'divider', 'question')),
          question_type TEXT CHECK (question_type IN ('single_choice', 'multiple_choice', 'open_answer', 'word_cloud', 'ordering', 'matching', 'image_labeling')),
          is_graded INTEGER NOT NULL DEFAULT 0 CHECK (is_graded IN (0, 1)),
          points INTEGER NOT NULL DEFAULT 0 CHECK (points BETWEEN 0 AND 1000),
          required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
          public_config_json TEXT NOT NULL,
          UNIQUE (slide_id, position),
          UNIQUE (slide_id, stable_id),
          CHECK ((block_type = 'question' AND question_type IS NOT NULL) OR (block_type != 'question' AND question_type IS NULL)),
          FOREIGN KEY (slide_id) REFERENCES activity_version_slides(id) ON DELETE CASCADE
        );

        CREATE UNIQUE INDEX idx_activity_version_one_graded_question
          ON activity_version_blocks(slide_id)
          WHERE block_type = 'question' AND is_graded = 1;

        CREATE TABLE activity_version_question_keys (
          block_id TEXT PRIMARY KEY,
          question_type TEXT NOT NULL CHECK (question_type IN ('single_choice', 'multiple_choice', 'open_answer', 'word_cloud', 'ordering', 'matching', 'image_labeling')),
          key_json TEXT NOT NULL,
          FOREIGN KEY (block_id) REFERENCES activity_version_blocks(id) ON DELETE CASCADE
        );

        CREATE TABLE activity_attempts (
          id TEXT PRIMARY KEY,
          activity_id TEXT NOT NULL,
          published_version_id TEXT NOT NULL,
          participant_id TEXT,
          participant_name TEXT,
          attempt_number INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
          access_token_hash TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'auto_submitted', 'expired')),
          started_at TEXT NOT NULL,
          deadline_at TEXT,
          submitted_at TEXT,
          last_saved_at TEXT,
          current_slide_id TEXT,
          revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
          score REAL,
          maximum_score REAL NOT NULL DEFAULT 0,
          grading_revision INTEGER NOT NULL DEFAULT 0 CHECK (grading_revision >= 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (activity_id, published_version_id) REFERENCES activity_versions(activity_id, id) ON DELETE RESTRICT,
          FOREIGN KEY (participant_id) REFERENCES live_participants(id) ON DELETE SET NULL,
          FOREIGN KEY (current_slide_id) REFERENCES activity_version_slides(id) ON DELETE SET NULL
        );

        CREATE TABLE activity_attempt_responses (
          attempt_id TEXT NOT NULL,
          question_block_id TEXT NOT NULL,
          answer_json TEXT NOT NULL,
          published_answer_json TEXT,
          moderation_status TEXT NOT NULL DEFAULT 'approved' CHECK (moderation_status IN ('approved', 'pending', 'rejected')),
          moderation_reason TEXT,
          client_revision INTEGER NOT NULL DEFAULT 0 CHECK (client_revision >= 0),
          server_revision INTEGER NOT NULL DEFAULT 0 CHECK (server_revision >= 0),
          saved_at TEXT NOT NULL,
          finalized_at TEXT,
          grading_status TEXT NOT NULL DEFAULT 'pending' CHECK (grading_status IN ('pending', 'graded', 'manual_review')),
          awarded_points REAL,
          grading_details_json TEXT,
          PRIMARY KEY (attempt_id, question_block_id),
          FOREIGN KEY (attempt_id) REFERENCES activity_attempts(id) ON DELETE CASCADE,
          FOREIGN KEY (question_block_id) REFERENCES activity_version_blocks(id) ON DELETE RESTRICT
        );

        CREATE TABLE activity_attempt_slide_progress (
          attempt_id TEXT NOT NULL,
          slide_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'unseen' CHECK (status IN ('unseen', 'viewed', 'completed')),
          first_viewed_at TEXT,
          completed_at TEXT,
          PRIMARY KEY (attempt_id, slide_id),
          FOREIGN KEY (attempt_id) REFERENCES activity_attempts(id) ON DELETE CASCADE,
          FOREIGN KEY (slide_id) REFERENCES activity_version_slides(id) ON DELETE RESTRICT
        );

        CREATE INDEX idx_activity_models_updated ON activity_models(updated_at DESC);
        CREATE INDEX idx_activity_versions_activity_number ON activity_versions(activity_id, version_number DESC);
        CREATE INDEX idx_activity_draft_slides_order ON activity_draft_slides(activity_id, position);
        CREATE INDEX idx_activity_draft_blocks_order ON activity_draft_blocks(slide_id, position);
        CREATE INDEX idx_activity_version_slides_order ON activity_version_slides(version_id, position);
        CREATE INDEX idx_activity_version_blocks_order ON activity_version_blocks(slide_id, position);
        CREATE INDEX idx_activity_attempts_activity_status ON activity_attempts(activity_id, status, started_at DESC);
        CREATE INDEX idx_activity_attempts_participant ON activity_attempts(activity_id, participant_id, attempt_number);
        CREATE INDEX idx_activity_attempts_deadline ON activity_attempts(status, deadline_at);
        CREATE INDEX idx_activity_attempt_responses_status ON activity_attempt_responses(grading_status, moderation_status);
      `);
    }
  },
  {
    version: 2,
    name: 'activity_slide_descriptions',
    up(db) {
      db.exec(`
        ALTER TABLE activity_draft_slides ADD COLUMN description TEXT NOT NULL DEFAULT '';
        ALTER TABLE activity_version_slides ADD COLUMN description TEXT NOT NULL DEFAULT '';
      `);
    }
  },
  {
    version: 3,
    name: 'activity_attempt_submission_reason',
    up(db) {
      db.exec(`
        ALTER TABLE activity_attempts ADD COLUMN submission_reason TEXT;
        CREATE INDEX idx_activity_attempts_access_token ON activity_attempts(access_token_hash);
      `);
    }
  },
  {
    version: 4,
    name: 'activity_managed_media',
    up(db) {
      db.exec(`
        CREATE TABLE activity_media (
          id TEXT PRIMARY KEY,
          owner_user_id TEXT NOT NULL,
          storage_name TEXT NOT NULL UNIQUE,
          original_filename TEXT NOT NULL,
          mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg')),
          byte_size INTEGER NOT NULL CHECK (byte_size > 0),
          width INTEGER NOT NULL CHECK (width > 0),
          height INTEGER NOT NULL CHECK (height > 0),
          sha256 TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_activity_media_owner_created ON activity_media(owner_user_id, created_at DESC);
        CREATE INDEX idx_activity_media_sha256 ON activity_media(owner_user_id, sha256);
      `);
    }
  },
  {
    version: 5,
    name: 'activity_authoritative_deadlines',
    up(db) {
      db.exec(`
        ALTER TABLE activity_models ADD COLUMN submission_deadline_timezone TEXT NOT NULL DEFAULT 'UTC';
        ALTER TABLE activity_models ADD COLUMN low_time_warning_seconds INTEGER DEFAULT 300;
        ALTER TABLE activity_attempts ADD COLUMN individual_deadline_at TEXT;
        ALTER TABLE activity_attempts ADD COLUMN global_deadline_at TEXT;
        ALTER TABLE activity_attempts ADD COLUMN deadline_extended_at TEXT;
        ALTER TABLE activity_attempts ADD COLUMN deadline_extended_seconds INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE activity_attempts ADD COLUMN deadline_extended_by TEXT REFERENCES users(id) ON DELETE SET NULL;
      `);
      const attempts = db.prepare(
        `SELECT a.id, a.started_at as startedAt, a.deadline_at as deadlineAt, v.settings_json as settingsJson
         FROM activity_attempts a INNER JOIN activity_versions v ON v.id = a.published_version_id`
      ).all() as unknown as Array<{ id: string; startedAt: string; deadlineAt: string | null; settingsJson: string }>;
      const update = db.prepare(
        `UPDATE activity_attempts SET individual_deadline_at = ?, global_deadline_at = ?, deadline_at = ? WHERE id = ?`
      );
      for (const attempt of attempts) {
        const settings = JSON.parse(attempt.settingsJson) as { attemptTimeLimitSeconds?: number | null; submissionDeadlineAt?: string | null };
        const individual = settings.attemptTimeLimitSeconds
          ? new Date(Date.parse(attempt.startedAt) + settings.attemptTimeLimitSeconds * 1000).toISOString()
          : null;
        const global = settings.submissionDeadlineAt && Number.isFinite(Date.parse(settings.submissionDeadlineAt))
          ? new Date(settings.submissionDeadlineAt).toISOString()
          : null;
        const effective = [individual, global, attempt.deadlineAt]
          .filter((value): value is string => Boolean(value))
          .sort()[0] ?? null;
        update.run(individual, global, effective, attempt.id);
      }
    }
  },
  {
    version: 6,
    name: 'activity_unified_grading',
    up(db) {
      db.exec(`
        ALTER TABLE activity_models ADD COLUMN feedback_policy TEXT NOT NULL DEFAULT 'points_per_question'
          CHECK (feedback_policy IN ('none', 'total_points', 'points_per_question', 'correct_answers', 'manual_release'));
        ALTER TABLE activity_attempts ADD COLUMN score_units INTEGER;
        ALTER TABLE activity_attempts ADD COLUMN maximum_score_units INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE activity_attempts ADD COLUMN grading_state TEXT NOT NULL DEFAULT 'in_progress'
          CHECK (grading_state IN ('in_progress', 'submitted', 'expired', 'awaiting_manual_grading', 'fully_graded'));
        ALTER TABLE activity_attempts ADD COLUMN results_released_at TEXT;
        ALTER TABLE activity_attempts ADD COLUMN results_released_by TEXT REFERENCES users(id) ON DELETE SET NULL;
        ALTER TABLE activity_attempt_responses ADD COLUMN awarded_points_units INTEGER;
        ALTER TABLE activity_attempt_responses ADD COLUMN teacher_feedback TEXT NOT NULL DEFAULT '';

        CREATE TABLE activity_grading_audit (
          id TEXT PRIMARY KEY,
          attempt_id TEXT NOT NULL,
          question_block_id TEXT,
          action TEXT NOT NULL CHECK (action IN ('automatic', 'manual', 'moderation', 'release')),
          previous_awarded_units INTEGER,
          awarded_units INTEGER,
          teacher_feedback TEXT NOT NULL DEFAULT '',
          actor_user_id TEXT,
          details_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          FOREIGN KEY (attempt_id) REFERENCES activity_attempts(id) ON DELETE CASCADE,
          FOREIGN KEY (question_block_id) REFERENCES activity_version_blocks(id) ON DELETE RESTRICT,
          FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX idx_activity_grading_audit_attempt ON activity_grading_audit(attempt_id, created_at);
      `);
      db.exec(`
        UPDATE activity_attempts
        SET score_units = CASE WHEN score IS NULL THEN NULL ELSE CAST(ROUND(score * 1000) AS INTEGER) END,
            maximum_score_units = CAST(ROUND(maximum_score * 1000) AS INTEGER),
            grading_state = CASE
              WHEN status = 'in_progress' THEN 'in_progress'
              WHEN status = 'auto_submitted' OR status = 'expired' THEN 'expired'
              WHEN EXISTS (
                SELECT 1 FROM activity_attempt_responses r
                WHERE r.attempt_id = activity_attempts.id AND r.grading_status = 'manual_review'
              ) THEN 'awaiting_manual_grading'
              WHEN score IS NULL THEN 'submitted'
              ELSE 'fully_graded'
            END;
        UPDATE activity_attempt_responses
        SET awarded_points_units = CASE
          WHEN awarded_points IS NULL THEN NULL ELSE CAST(ROUND(awarded_points * 1000) AS INTEGER)
        END;
      `);
    }
  },
  {
    version: 7,
    name: 'activity_results_indexes',
    up(db) {
      db.exec(`
        CREATE INDEX idx_activity_attempts_results
          ON activity_attempts(activity_id, grading_state, started_at DESC, id);
        CREATE INDEX idx_activity_responses_question_attempt
          ON activity_attempt_responses(question_block_id, attempt_id, moderation_status, grading_status);
      `);
    }
  },
  {
    version: 8,
    name: 'activity_publishing_access',
    up(db) {
      db.exec(`
        ALTER TABLE activity_models ADD COLUMN availability_start_at TEXT;
        ALTER TABLE activity_models ADD COLUMN archived_at TEXT;
        CREATE INDEX idx_activity_models_archived_updated
          ON activity_models(archived_at, updated_at DESC);
      `);
    }
  },
  {
    version: 9,
    name: 'legacy_live_migration_audit',
    up(db) {
      db.exec(`
        CREATE TABLE legacy_activity_migrations (
          activity_id TEXT PRIMARY KEY,
          source_question_type TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('migrated', 'unsupported', 'error')),
          message TEXT NOT NULL,
          legacy_response_count INTEGER NOT NULL DEFAULT 0,
          legacy_view_count INTEGER NOT NULL DEFAULT 0,
          migrated_version_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (activity_id) REFERENCES live_activities(id) ON DELETE CASCADE,
          FOREIGN KEY (migrated_version_id) REFERENCES activity_versions(id) ON DELETE SET NULL
        );
        CREATE INDEX idx_legacy_activity_migrations_status
          ON legacy_activity_migrations(status, updated_at DESC);
      `);
    }
  },
  {
    version: 10,
    name: 'activity_optional_grading_settings',
    up(db) {
      db.exec(`
        ALTER TABLE activity_models ADD COLUMN grading_enabled INTEGER NOT NULL DEFAULT 1
          CHECK (grading_enabled IN (0, 1));
        ALTER TABLE activity_models ADD COLUMN default_question_points INTEGER NOT NULL DEFAULT 1
          CHECK (default_question_points BETWEEN 1 AND 1000);
      `);
    }
  },
  {
    version: 11,
    name: 'activity_visual_design',
    up(db) {
      db.exec(`
        ALTER TABLE activity_models ADD COLUMN theme TEXT NOT NULL DEFAULT 'minimal_light'
          CHECK (theme IN ('classic_cream', 'forest_dark', 'soft_lavender', 'ocean_blue', 'minimal_light'));
        ALTER TABLE activity_models ADD COLUMN layout TEXT NOT NULL DEFAULT 'classic'
          CHECK (layout IN ('classic', 'minimal', 'soft', 'bold'));
      `);
    }
  },
  {
    version: 12,
    name: 'activity_patterns_and_navigation',
    up(db) {
      db.exec(`
        ALTER TABLE activity_models ADD COLUMN background_pattern TEXT NOT NULL DEFAULT 'none'
          CHECK (background_pattern IN ('none', 'dots', 'grid', 'soft_glow', 'crosses'));
        ALTER TABLE activity_models ADD COLUMN pattern_intensity INTEGER NOT NULL DEFAULT 35
          CHECK (pattern_intensity BETWEEN 0 AND 100);
        ALTER TABLE activity_models ADD COLUMN shuffle_slides INTEGER NOT NULL DEFAULT 0
          CHECK (shuffle_slides IN (0, 1));
        ALTER TABLE activity_models ADD COLUMN allow_back_navigation INTEGER NOT NULL DEFAULT 1
          CHECK (allow_back_navigation IN (0, 1));
      `);
    }
  },
  {
    version: 13,
    name: 'activity_attempt_question_points',
    up(db) {
      db.exec(`
        CREATE TABLE activity_attempt_question_points (
          attempt_id TEXT NOT NULL,
          question_block_id TEXT NOT NULL,
          question_stable_id TEXT NOT NULL,
          maximum_points_units INTEGER NOT NULL CHECK (maximum_points_units >= 0),
          updated_at TEXT NOT NULL,
          PRIMARY KEY (attempt_id, question_block_id),
          UNIQUE (attempt_id, question_stable_id),
          FOREIGN KEY (attempt_id) REFERENCES activity_attempts(id) ON DELETE CASCADE,
          FOREIGN KEY (question_block_id) REFERENCES activity_version_blocks(id) ON DELETE RESTRICT
        );
        CREATE INDEX idx_activity_attempt_question_points_stable
          ON activity_attempt_question_points(question_stable_id, attempt_id);

        INSERT INTO activity_attempt_question_points (
          attempt_id, question_block_id, question_stable_id, maximum_points_units, updated_at
        )
        SELECT a.id, b.id, b.stable_id, CAST(ROUND(b.points * 1000) AS INTEGER), a.updated_at
        FROM activity_attempts a
        INNER JOIN activity_version_slides s ON s.version_id = a.published_version_id
        INNER JOIN activity_version_blocks b ON b.slide_id = s.id AND b.block_type = 'question';
      `);
    }
  }
];

export const runMigrations = (db: DatabaseSync) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Map(
    (db.prepare('SELECT version, name FROM schema_migrations').all() as Array<{ version: number; name: string }>)
      .map((row) => [Number(row.version), row.name])
  );

  for (const migration of migrations) {
    const appliedName = applied.get(migration.version);
    if (appliedName !== undefined) {
      if (appliedName !== migration.name) throw new Error(`Migration ${migration.version} was applied as ${appliedName}, expected ${migration.name}.`);
      continue;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, nowIso());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
};
