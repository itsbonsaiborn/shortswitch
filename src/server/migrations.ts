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
  },
  {
    version: 14,
    name: 'boards_foundation',
    up(db) {
      const publicSlugTable = db.prepare(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'public_slugs'`
      ).get() as { sql: string } | undefined;
      if (publicSlugTable && !publicSlugTable.sql.includes("'board'")) {
        db.exec(`
          ALTER TABLE public_slugs RENAME TO public_slugs_pre_boards;
          CREATE TABLE public_slugs (
            slug TEXT PRIMARY KEY,
            resource_type TEXT NOT NULL CHECK (resource_type IN ('link', 'live_activity', 'page', 'board')),
            resource_id TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL
          );
          INSERT INTO public_slugs (slug, resource_type, resource_id, created_at)
          SELECT slug, resource_type, resource_id, created_at FROM public_slugs_pre_boards;
          DROP TABLE public_slugs_pre_boards;
        `);
      }

      db.exec(`
        CREATE TABLE board_themes (
          id TEXT PRIMARY KEY,
          owner_user_id TEXT,
          name TEXT NOT NULL,
          config_json TEXT NOT NULL,
          is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE boards (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'disabled')),
          public_revision INTEGER NOT NULL DEFAULT 0 CHECK (public_revision >= 0),
          published_at TEXT,
          archived_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (user_id, id),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE board_settings (
          board_id TEXT PRIMARY KEY,
          theme_id TEXT NOT NULL,
          layout TEXT NOT NULL DEFAULT 'freeform' CHECK (layout IN ('freeform')),
          is_read_only INTEGER NOT NULL DEFAULT 0 CHECK (is_read_only IN (0, 1)),
          is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
          require_participant_name INTEGER NOT NULL DEFAULT 0 CHECK (require_participant_name IN (0, 1)),
          moderation_mode TEXT NOT NULL DEFAULT 'review_all' CHECK (moderation_mode IN ('auto_approve', 'review_all')),
          max_cards_total INTEGER NOT NULL DEFAULT 500 CHECK (max_cards_total BETWEEN 1 AND 5000),
          max_cards_per_participant INTEGER NOT NULL DEFAULT 10 CHECK (max_cards_per_participant BETWEEN 1 AND 100),
          max_title_length INTEGER NOT NULL DEFAULT 160 CHECK (max_title_length BETWEEN 1 AND 300),
          max_body_length INTEGER NOT NULL DEFAULT 5000 CHECK (max_body_length BETWEEN 1 AND 20000),
          allow_image_urls INTEGER NOT NULL DEFAULT 1 CHECK (allow_image_urls IN (0, 1)),
          participant_can_edit INTEGER NOT NULL DEFAULT 1 CHECK (participant_can_edit IN (0, 1)),
          participant_can_delete INTEGER NOT NULL DEFAULT 1 CHECK (participant_can_delete IN (0, 1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
          FOREIGN KEY (theme_id) REFERENCES board_themes(id) ON DELETE RESTRICT
        );

        CREATE TABLE board_participants (
          id TEXT PRIMARY KEY,
          board_id TEXT NOT NULL,
          participant_key_hash TEXT NOT NULL,
          display_name TEXT,
          card_count INTEGER NOT NULL DEFAULT 0 CHECK (card_count >= 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          UNIQUE (board_id, participant_key_hash),
          UNIQUE (board_id, id),
          FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
        );

        CREATE TABLE board_cards (
          id TEXT PRIMARY KEY,
          board_id TEXT NOT NULL,
          participant_id TEXT,
          author_display_name TEXT,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          image_url TEXT,
          moderation_status TEXT NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending', 'approved', 'rejected')),
          moderation_reason TEXT,
          published_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (board_id, id),
          FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
          FOREIGN KEY (participant_id) REFERENCES board_participants(id) ON DELETE SET NULL
        );

        CREATE TABLE board_card_positions (
          card_id TEXT PRIMARY KEY,
          board_id TEXT NOT NULL,
          x REAL NOT NULL DEFAULT 0,
          y REAL NOT NULL DEFAULT 0,
          width REAL NOT NULL DEFAULT 280 CHECK (width BETWEEN 160 AND 1200),
          height REAL NOT NULL DEFAULT 180 CHECK (height BETWEEN 100 AND 1600),
          z_index INTEGER NOT NULL DEFAULT 0 CHECK (z_index >= 0),
          revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
          updated_at TEXT NOT NULL,
          FOREIGN KEY (board_id, card_id) REFERENCES board_cards(board_id, id) ON DELETE CASCADE
        );

        CREATE TABLE board_card_credentials (
          card_id TEXT PRIMARY KEY,
          board_id TEXT NOT NULL,
          owner_token_hash TEXT NOT NULL UNIQUE,
          recovery_pin_hash TEXT,
          credential_version INTEGER NOT NULL DEFAULT 1 CHECK (credential_version >= 1),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_used_at TEXT,
          FOREIGN KEY (board_id, card_id) REFERENCES board_cards(board_id, id) ON DELETE CASCADE
        );

        CREATE TABLE board_card_moderation_events (
          id TEXT PRIMARY KEY,
          board_id TEXT NOT NULL,
          card_id TEXT NOT NULL,
          previous_status TEXT CHECK (previous_status IN ('pending', 'approved', 'rejected')),
          next_status TEXT NOT NULL CHECK (next_status IN ('pending', 'approved', 'rejected')),
          reason TEXT,
          moderator_user_id TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (board_id, card_id) REFERENCES board_cards(board_id, id) ON DELETE CASCADE,
          FOREIGN KEY (moderator_user_id) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE TABLE board_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          board_id TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision > 0),
          event_type TEXT NOT NULL CHECK (event_type IN ('board_updated', 'card_created', 'card_updated', 'card_moved', 'card_moderated', 'card_deleted')),
          entity_id TEXT,
          payload_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          UNIQUE (board_id, revision),
          FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
        );

        CREATE INDEX idx_boards_user_updated ON boards(user_id, updated_at DESC);
        CREATE INDEX idx_boards_status_updated ON boards(status, updated_at DESC);
        CREATE INDEX idx_board_themes_owner_updated ON board_themes(owner_user_id, updated_at DESC);
        CREATE INDEX idx_board_participants_board_seen ON board_participants(board_id, last_seen_at DESC);
        CREATE INDEX idx_board_cards_board_status_created ON board_cards(board_id, moderation_status, created_at DESC);
        CREATE INDEX idx_board_cards_participant_created ON board_cards(board_id, participant_id, created_at DESC);
        CREATE INDEX idx_board_positions_board_z ON board_card_positions(board_id, z_index, card_id);
        CREATE INDEX idx_board_moderation_board_created ON board_card_moderation_events(board_id, created_at DESC);
        CREATE INDEX idx_board_events_board_revision ON board_events(board_id, revision);
      `);

      const timestamp = nowIso();
      const insertTheme = db.prepare(`
        INSERT OR IGNORE INTO board_themes (id, owner_user_id, name, config_json, is_system, created_at, updated_at)
        VALUES (?, NULL, ?, ?, 1, ?, ?)
      `);
      for (const theme of [
        ['board_theme_classic_cream', 'Classic Cream', '{"surface":"classic_cream"}'],
        ['board_theme_forest_dark', 'Forest Dark', '{"surface":"forest_dark"}'],
        ['board_theme_soft_lavender', 'Soft Lavender', '{"surface":"soft_lavender"}'],
        ['board_theme_ocean_blue', 'Ocean Blue', '{"surface":"ocean_blue"}'],
        ['board_theme_minimal_light', 'Minimal Light', '{"surface":"minimal_light"}']
      ] as const) {
        insertTheme.run(theme[0], theme[1], theme[2], timestamp, timestamp);
      }
    }
  },
  {
    version: 15,
    name: 'boards_management',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(boards)').all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === 'expires_at')) {
        db.exec('ALTER TABLE boards ADD COLUMN expires_at TEXT;');
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_boards_expiration ON boards(expires_at);');
    }
  },
  {
    version: 16,
    name: 'board_card_ownership',
    up(db) {
      const settingsColumns = db.prepare('PRAGMA table_info(board_settings)').all() as Array<{ name: string }>;
      if (!settingsColumns.some((column) => column.name === 'require_card_title')) {
        db.exec(`ALTER TABLE board_settings ADD COLUMN require_card_title INTEGER NOT NULL DEFAULT 1 CHECK (require_card_title IN (0, 1));`);
      }
      const cardColumns = db.prepare('PRAGMA table_info(board_cards)').all() as Array<{ name: string }>;
      if (!cardColumns.some((column) => column.name === 'card_layout')) {
        db.exec(`ALTER TABLE board_cards ADD COLUMN card_layout TEXT NOT NULL DEFAULT 'text' CHECK (card_layout IN ('text', 'image_text', 'compact'));`);
      }
      db.exec(`
        CREATE TABLE board_ownership_sessions (
          id TEXT PRIMARY KEY,
          board_id TEXT NOT NULL,
          session_token_hash TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          last_used_at TEXT,
          FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
        );
        CREATE TABLE board_ownership_session_cards (
          session_id TEXT NOT NULL,
          card_id TEXT NOT NULL,
          granted_at TEXT NOT NULL,
          PRIMARY KEY (session_id, card_id),
          FOREIGN KEY (session_id) REFERENCES board_ownership_sessions(id) ON DELETE CASCADE,
          FOREIGN KEY (card_id) REFERENCES board_cards(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_board_ownership_sessions_board_expiry ON board_ownership_sessions(board_id, expires_at);
        CREATE INDEX idx_board_ownership_session_cards_card ON board_ownership_session_cards(card_id, session_id);
      `);
    }
  },
  {
    version: 17,
    name: 'board_grid_reactions',
    up(db) {
      db.exec(`
        ALTER TABLE board_settings RENAME TO board_settings_pre_grid;
        CREATE TABLE board_settings (
          board_id TEXT PRIMARY KEY,
          theme_id TEXT NOT NULL,
          layout TEXT NOT NULL DEFAULT 'grid' CHECK (layout IN ('grid')),
          is_read_only INTEGER NOT NULL DEFAULT 0 CHECK (is_read_only IN (0, 1)),
          is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
          require_participant_name INTEGER NOT NULL DEFAULT 0 CHECK (require_participant_name IN (0, 1)),
          moderation_mode TEXT NOT NULL DEFAULT 'review_all' CHECK (moderation_mode IN ('auto_approve', 'review_all')),
          max_cards_total INTEGER NOT NULL DEFAULT 500 CHECK (max_cards_total BETWEEN 1 AND 5000),
          max_cards_per_participant INTEGER NOT NULL DEFAULT 10 CHECK (max_cards_per_participant BETWEEN 1 AND 100),
          max_title_length INTEGER NOT NULL DEFAULT 160 CHECK (max_title_length BETWEEN 1 AND 300),
          max_body_length INTEGER NOT NULL DEFAULT 5000 CHECK (max_body_length BETWEEN 1 AND 20000),
          allow_image_urls INTEGER NOT NULL DEFAULT 1 CHECK (allow_image_urls IN (0, 1)),
          participant_can_edit INTEGER NOT NULL DEFAULT 1 CHECK (participant_can_edit IN (0, 1)),
          participant_can_delete INTEGER NOT NULL DEFAULT 1 CHECK (participant_can_delete IN (0, 1)),
          require_card_title INTEGER NOT NULL DEFAULT 1 CHECK (require_card_title IN (0, 1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
          FOREIGN KEY (theme_id) REFERENCES board_themes(id) ON DELETE RESTRICT
        );
        INSERT INTO board_settings (
          board_id, theme_id, layout, is_read_only, is_locked, require_participant_name,
          moderation_mode, max_cards_total, max_cards_per_participant, max_title_length,
          max_body_length, allow_image_urls, participant_can_edit, participant_can_delete,
          require_card_title, created_at, updated_at
        )
        SELECT board_id, theme_id, 'grid', is_read_only, is_locked, require_participant_name,
          moderation_mode, max_cards_total, max_cards_per_participant, max_title_length,
          max_body_length, allow_image_urls, participant_can_edit, participant_can_delete,
          require_card_title, created_at, updated_at
        FROM board_settings_pre_grid;
        DROP TABLE board_settings_pre_grid;

        CREATE TABLE board_reaction_sessions (
          id TEXT PRIMARY KEY,
          board_id TEXT NOT NULL,
          session_token_hash TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          last_used_at TEXT,
          FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
        );
        CREATE TABLE board_card_reactions (
          board_id TEXT NOT NULL,
          card_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          reaction_type TEXT NOT NULL CHECK (reaction_type IN ('like', 'dislike')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (card_id, session_id),
          FOREIGN KEY (board_id, card_id) REFERENCES board_cards(board_id, id) ON DELETE CASCADE,
          FOREIGN KEY (session_id) REFERENCES board_reaction_sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_board_reaction_sessions_board_expiry
          ON board_reaction_sessions(board_id, expires_at);
        CREATE INDEX idx_board_card_reactions_card_type
          ON board_card_reactions(board_id, card_id, reaction_type);
      `);
    }
  },
  {
    version: 18,
    name: 'board_theme_design',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(board_settings)').all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === 'visual_style')) {
        db.exec(`ALTER TABLE board_settings ADD COLUMN visual_style TEXT NOT NULL DEFAULT 'classic' CHECK (visual_style IN ('classic', 'minimal', 'soft', 'bold'));`);
      }
      if (!columns.some((column) => column.name === 'background_pattern')) {
        db.exec(`ALTER TABLE board_settings ADD COLUMN background_pattern TEXT NOT NULL DEFAULT 'none' CHECK (background_pattern IN ('none', 'dots', 'grid', 'soft_glow', 'crosses'));`);
      }
      if (!columns.some((column) => column.name === 'pattern_intensity')) {
        db.exec(`ALTER TABLE board_settings ADD COLUMN pattern_intensity INTEGER NOT NULL DEFAULT 35 CHECK (pattern_intensity BETWEEN 0 AND 100);`);
      }
    }
  },
  {
    version: 19,
    name: 'board_realtime_moderation',
    up(db) {
      const cardColumns = db.prepare('PRAGMA table_info(board_cards)').all() as Array<{ name: string }>;
      if (!cardColumns.some((column) => column.name === 'is_hidden')) {
        db.exec(`ALTER TABLE board_cards ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1));`);
      }

      const eventTable = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'board_events'")
        .get() as { sql: string } | undefined;
      if (eventTable && !eventTable.sql.includes("'reaction_updated'")) {
        db.exec(`
          ALTER TABLE board_events RENAME TO board_events_pre_realtime;
          CREATE TABLE board_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            board_id TEXT NOT NULL,
            revision INTEGER NOT NULL CHECK (revision > 0),
            event_type TEXT NOT NULL CHECK (event_type IN (
              'board_updated', 'card_created', 'card_updated', 'card_moved',
              'card_moderated', 'card_deleted', 'reaction_updated'
            )),
            entity_id TEXT,
            payload_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            UNIQUE (board_id, revision),
            FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
          );
          INSERT INTO board_events (id, board_id, revision, event_type, entity_id, payload_json, created_at)
          SELECT id, board_id, revision, event_type, entity_id, payload_json, created_at
          FROM board_events_pre_realtime;
          DROP TABLE board_events_pre_realtime;
          CREATE INDEX idx_board_events_board_revision ON board_events(board_id, revision);
        `);
      }
    }
  },
  {
    version: 20,
    name: 'board_recovery_security',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(board_card_credentials)').all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === 'recovery_failed_attempts')) {
        db.exec(`ALTER TABLE board_card_credentials ADD COLUMN recovery_failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (recovery_failed_attempts >= 0);`);
      }
      if (!columns.some((column) => column.name === 'recovery_window_started_at')) {
        db.exec(`ALTER TABLE board_card_credentials ADD COLUMN recovery_window_started_at TEXT;`);
      }
      if (!columns.some((column) => column.name === 'recovery_locked_until')) {
        db.exec(`ALTER TABLE board_card_credentials ADD COLUMN recovery_locked_until TEXT;`);
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_board_credentials_recovery_lock ON board_card_credentials(board_id, recovery_locked_until);`);
    }
  },
  {
    version: 21,
    name: 'board_submission_expiration',
    up(db) {
      const settingsTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'board_settings'").get();
      if (!settingsTable) return;
      const columns = db.prepare('PRAGMA table_info(board_settings)').all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === 'submissions_expires_at')) {
        db.exec('ALTER TABLE board_settings ADD COLUMN submissions_expires_at TEXT;');
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_board_settings_submission_expiration ON board_settings(submissions_expires_at);');
    }
  },
  {
    version: 22,
    name: 'service_sections',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS service_sections (
          section_type TEXT PRIMARY KEY CHECK (section_type IN ('about', 'security', 'privacy', 'contacts')),
          is_required INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0, 1)),
          is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
          show_in_footer INTEGER NOT NULL DEFAULT 1 CHECK (show_in_footer IN (0, 1)),
          needs_review INTEGER NOT NULL DEFAULT 1 CHECK (needs_review IN (0, 1)),
          draft_title_en TEXT NOT NULL,
          draft_body_en TEXT NOT NULL,
          draft_title_lv TEXT NOT NULL,
          draft_body_lv TEXT NOT NULL,
          published_title_en TEXT NOT NULL,
          published_body_en TEXT NOT NULL,
          published_title_lv TEXT NOT NULL,
          published_body_lv TEXT NOT NULL,
          is_published INTEGER NOT NULL DEFAULT 1 CHECK (is_published IN (0, 1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          published_at TEXT
        );
      `);

      const insert = db.prepare(`
        INSERT OR IGNORE INTO service_sections (
          section_type, is_required, is_enabled, show_in_footer, needs_review,
          draft_title_en, draft_body_en, draft_title_lv, draft_body_lv,
          published_title_en, published_body_en, published_title_lv, published_body_lv,
          is_published, created_at, updated_at, published_at
        ) VALUES (?, ?, 1, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      `);
      const timestamp = nowIso();
      const defaults = [
        ['about', 0, 'About ShortSwitch', 'ShortSwitch is a self-hosted educational platform for short links, public pages, activities, and collaborative boards.\n\nAdministrator review required: adapt this description to your deployment before publication.', 'Par ShortSwitch', 'ShortSwitch ir pašmitināta izglītības platforma īsajām saitēm, publiskajām lapām, aktivitātēm un sadarbības tāfelēm.\n\nNepieciešama administratora pārbaude: pirms publicēšanas pielāgojiet šo aprakstu savai videi.'],
        ['security', 1, 'Security Policy', 'This page is reserved for security information and responsible vulnerability reporting instructions.\n\nAdministrator review required: add a monitored reporting channel and deployment-specific guidance. No security contact is configured by default.', 'Drošības politika', 'Šī lapa ir paredzēta drošības informācijai un norādījumiem par atbildīgu ievainojamību ziņošanu.\n\nNepieciešama administratora pārbaude: pievienojiet uzraudzītu ziņošanas kanālu un videi atbilstošus norādījumus. Drošības kontaktinformācija pēc noklusējuma nav norādīta.'],
        ['privacy', 1, 'Privacy Policy', 'This page must be reviewed and updated by the operator to describe how this ShortSwitch deployment handles personal data, analytics, retention, and participant content.\n\nNo deployment-specific legal or privacy statement is configured by default.', 'Privātuma politika', 'Operatoram šī lapa ir jāpārskata un jāatjaunina, aprakstot, kā konkrētā ShortSwitch vide apstrādā personas datus, analītiku, glabāšanas termiņus un dalībnieku saturu.\n\nVidei specifisks juridisks vai privātuma paziņojums pēc noklusējuma nav konfigurēts.'],
        ['contacts', 1, 'Contacts', 'Operator contact details have not been configured.\n\nAdministrator review required: add a monitored contact method before relying on this page for support or safety reports.', 'Kontakti', 'Operatora kontaktinformācija nav konfigurēta.\n\nNepieciešama administratora pārbaude: pirms izmantot šo lapu atbalsta vai drošības ziņojumiem, pievienojiet uzraudzītu saziņas veidu.']
      ] as const;
      for (const [type, required, titleEn, bodyEn, titleLv, bodyLv] of defaults) {
        insert.run(type, required, titleEn, bodyEn, titleLv, bodyLv, titleEn, bodyEn, titleLv, bodyLv, timestamp, timestamp, timestamp);
      }
    }
  },
  {
    version: 23,
    name: 'service_contacts_visual_config',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(service_sections)').all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === 'draft_config_json')) {
        db.exec(`ALTER TABLE service_sections ADD COLUMN draft_config_json TEXT NOT NULL DEFAULT '{}';`);
      }
      if (!columns.some((column) => column.name === 'published_config_json')) {
        db.exec(`ALTER TABLE service_sections ADD COLUMN published_config_json TEXT NOT NULL DEFAULT '{}';`);
      }
    }
  },
  {
    version: 24,
    name: 'service_submissions',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS service_submissions (
          id TEXT PRIMARY KEY,
          submission_type TEXT NOT NULL CHECK (submission_type IN ('contact', 'report_abuse')),
          status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_review', 'resolved', 'dismissed')),
          email TEXT,
          subject TEXT,
          message TEXT,
          link_identifier TEXT,
          reason TEXT CHECK (reason IS NULL OR reason IN ('phishing', 'malware', 'spam', 'harassment', 'copyright', 'privacy', 'other')),
          description TEXT,
          reporter_email TEXT,
          duplicate_key TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (
            (submission_type = 'contact' AND email IS NOT NULL AND subject IS NOT NULL AND message IS NOT NULL AND link_identifier IS NULL AND reason IS NULL AND description IS NULL AND reporter_email IS NULL)
            OR
            (submission_type = 'report_abuse' AND email IS NULL AND subject IS NULL AND message IS NULL AND link_identifier IS NOT NULL AND reason IS NOT NULL AND description IS NOT NULL)
          )
        );
        CREATE INDEX IF NOT EXISTS idx_service_submissions_status_created
          ON service_submissions(status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_service_submissions_type_created
          ON service_submissions(submission_type, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_service_submissions_link
          ON service_submissions(link_identifier, created_at DESC);
      `);
    }
  },
  {
    version: 25,
    name: 'service_submission_inbox_settings',
    up(db) {
      db.exec(`
        ALTER TABLE service_submissions RENAME TO service_submissions_stage5;
        CREATE TABLE service_submissions (
          id TEXT PRIMARY KEY,
          submission_type TEXT NOT NULL CHECK (submission_type IN ('contact', 'report_abuse')),
          status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved', 'rejected')),
          email TEXT,
          subject TEXT,
          message TEXT,
          link_identifier TEXT,
          reason TEXT CHECK (reason IS NULL OR reason IN ('phishing', 'malware', 'spam', 'harassment', 'copyright', 'privacy', 'other')),
          description TEXT,
          reporter_email TEXT,
          duplicate_key TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (
            (submission_type = 'contact' AND email IS NOT NULL AND subject IS NOT NULL AND message IS NOT NULL AND link_identifier IS NULL AND reason IS NULL AND description IS NULL AND reporter_email IS NULL)
            OR
            (submission_type = 'report_abuse' AND email IS NULL AND subject IS NULL AND message IS NULL AND link_identifier IS NOT NULL AND reason IS NOT NULL AND description IS NOT NULL)
          )
        );
        INSERT INTO service_submissions (
          id, submission_type, status, email, subject, message, link_identifier, reason,
          description, reporter_email, duplicate_key, created_at, updated_at
        )
        SELECT id, submission_type,
          CASE status WHEN 'in_review' THEN 'in_progress' WHEN 'dismissed' THEN 'rejected' ELSE status END,
          email, subject, message, link_identifier, reason, description, reporter_email,
          duplicate_key, created_at, updated_at
        FROM service_submissions_stage5;
        DROP TABLE service_submissions_stage5;
        CREATE INDEX idx_service_submissions_status_created ON service_submissions(status, created_at DESC);
        CREATE INDEX idx_service_submissions_type_created ON service_submissions(submission_type, created_at DESC);
        CREATE INDEX idx_service_submissions_link ON service_submissions(link_identifier, created_at DESC);

        CREATE TABLE service_submission_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          allowed_email_domains_json TEXT NOT NULL DEFAULT '[]',
          public_contact_email TEXT,
          retention_days INTEGER NOT NULL DEFAULT 365 CHECK (retention_days BETWEEN 1 AND 3650),
          updated_at TEXT NOT NULL
        );
      `);
      db.prepare(`
        INSERT INTO service_submission_settings (
          id, allowed_email_domains_json, public_contact_email, retention_days, updated_at
        ) VALUES (1, '[]', NULL, 365, ?)
      `).run(nowIso());
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
