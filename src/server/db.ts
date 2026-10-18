import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

let dbInstance: DatabaseSync | null = null;

export const getDb = () => {
  if (!dbInstance) {
    fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
    dbInstance = new DatabaseSync(config.databasePath);
    dbInstance.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_bootstrap_admin INTEGER NOT NULL DEFAULT 0,
        theme TEXT NOT NULL DEFAULT 'system',
        sidebar_collapsed INTEGER NOT NULL DEFAULT 0,
        locale TEXT NOT NULL DEFAULT 'en',
        preferences_initialized INTEGER NOT NULL DEFAULT 0,
        session_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_version INTEGER NOT NULL,
        csrf_secret TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS links (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        target_url TEXT NOT NULL,
        comment TEXT,
        password_hash TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT,
        click_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS analytics_events (
        id TEXT PRIMARY KEY,
        link_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        browser TEXT NOT NULL,
        os TEXT NOT NULL,
        device_type TEXT NOT NULL,
        referrer TEXT NOT NULL,
        country TEXT NOT NULL,
        region TEXT NOT NULL,
        city TEXT,
        language TEXT,
        traffic_type TEXT NOT NULL,
        auth_outcome TEXT NOT NULL DEFAULT 'success',
        visitor_hash TEXT NOT NULL,
        raw_ip TEXT,
        FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS public_slugs (
        slug TEXT PRIMARY KEY,
        resource_type TEXT NOT NULL CHECK (resource_type IN ('link', 'live_activity', 'page')),
        resource_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS live_activities (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
        identity_mode TEXT NOT NULL DEFAULT 'anonymous' CHECK (identity_mode IN ('anonymous', 'named')),
        allow_multiple_responses INTEGER NOT NULL DEFAULT 0,
        max_responses_per_participant INTEGER NOT NULL DEFAULT 1,
        moderation_mode TEXT NOT NULL DEFAULT 'off' CHECK (moderation_mode IN ('off', 'filter_only', 'review_all')),
        public_results INTEGER NOT NULL DEFAULT 1,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_response_at TEXT,
        public_revision INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS live_questions (
        id TEXT PRIMARY KEY,
        activity_id TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        question_type TEXT NOT NULL CHECK (question_type IN ('open_answer', 'word_cloud', 'multiple_choice', 'scale')),
        prompt TEXT NOT NULL,
        allow_multiple_choices INTEGER NOT NULL DEFAULT 0,
        max_answer_length INTEGER NOT NULL DEFAULT 280,
        scale_min INTEGER,
        scale_max INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (activity_id, position),
        FOREIGN KEY (activity_id) REFERENCES live_activities(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS live_question_options (
        id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        label TEXT NOT NULL,
        UNIQUE (question_id, position),
        FOREIGN KEY (question_id) REFERENCES live_questions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS live_participants (
        id TEXT PRIMARY KEY,
        activity_id TEXT NOT NULL,
        participant_token TEXT NOT NULL,
        display_name TEXT,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        UNIQUE (activity_id, participant_token),
        FOREIGN KEY (activity_id) REFERENCES live_activities(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS live_responses (
        id TEXT PRIMARY KEY,
        activity_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        participant_name TEXT,
        published_participant_name TEXT,
        original_text TEXT,
        published_text TEXT,
        selected_options_json TEXT,
        scale_value INTEGER,
        moderation_status TEXT NOT NULL CHECK (moderation_status IN ('approved', 'pending', 'rejected')),
        moderation_reason TEXT,
        edited_by_moderator INTEGER NOT NULL DEFAULT 0,
        name_edited_by_moderator INTEGER NOT NULL DEFAULT 0,
        moderated_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (activity_id) REFERENCES live_activities(id) ON DELETE CASCADE,
        FOREIGN KEY (question_id) REFERENCES live_questions(id) ON DELETE CASCADE,
        FOREIGN KEY (participant_id) REFERENCES live_participants(id) ON DELETE CASCADE,
        FOREIGN KEY (moderated_by) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS live_views (
        id TEXT PRIMARY KEY,
        activity_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        visitor_hash TEXT NOT NULL,
        device_type TEXT NOT NULL DEFAULT 'unknown',
        browser TEXT NOT NULL DEFAULT 'Unknown',
        os TEXT NOT NULL DEFAULT 'Unknown',
        referrer TEXT NOT NULL DEFAULT 'Direct',
        language TEXT,
        raw_ip TEXT,
        FOREIGN KEY (activity_id) REFERENCES live_activities(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS moderation_rules (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        pattern TEXT NOT NULL,
        match_mode TEXT NOT NULL CHECK (match_mode IN ('whole_word', 'contains')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS pages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT,
        emoji TEXT,
        avatar_url TEXT,
        theme TEXT NOT NULL DEFAULT 'classic_cream' CHECK (theme IN ('classic_cream', 'forest_dark', 'soft_lavender', 'ocean_blue', 'minimal_light')),
        layout TEXT NOT NULL DEFAULT 'classic' CHECK (layout IN ('classic', 'minimal', 'soft', 'bold')),
        background_pattern TEXT NOT NULL DEFAULT 'none',
        pattern_intensity INTEGER NOT NULL DEFAULT 35,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'disabled')),
        seo_title TEXT,
        seo_description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS page_blocks (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL,
        block_type TEXT NOT NULL CHECK (block_type IN ('heading', 'text', 'link', 'existing_link', 'live_activity', 'email', 'divider', 'spacer', 'image', 'double')),
        config_json TEXT NOT NULL,
        position INTEGER NOT NULL,
        visible INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (page_id, position),
        FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS page_views (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        visitor_hash TEXT NOT NULL,
        device_type TEXT NOT NULL DEFAULT 'unknown',
        browser TEXT NOT NULL DEFAULT 'Unknown',
        os TEXT NOT NULL DEFAULT 'Unknown',
        referrer TEXT NOT NULL DEFAULT 'Direct',
        language TEXT,
        raw_ip TEXT,
        FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS page_block_clicks (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL,
        block_id TEXT NOT NULL,
        block_label TEXT NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        timestamp TEXT NOT NULL,
        visitor_hash TEXT NOT NULL,
        device_type TEXT NOT NULL DEFAULT 'unknown',
        browser TEXT NOT NULL DEFAULT 'Unknown',
        os TEXT NOT NULL DEFAULT 'Unknown',
        referrer TEXT NOT NULL DEFAULT 'Direct',
        language TEXT,
        raw_ip TEXT,
        FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_links_user_id ON links(user_id);
      CREATE INDEX IF NOT EXISTS idx_analytics_link_id_timestamp ON analytics_events(link_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_analytics_slug_timestamp ON analytics_events(slug, timestamp);
      CREATE INDEX IF NOT EXISTS idx_live_activities_user_created ON live_activities(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_live_questions_activity ON live_questions(activity_id, position);
      CREATE INDEX IF NOT EXISTS idx_live_participants_activity ON live_participants(activity_id);
      CREATE INDEX IF NOT EXISTS idx_live_responses_activity_created ON live_responses(activity_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_live_responses_activity_status ON live_responses(activity_id, moderation_status);
      CREATE INDEX IF NOT EXISTS idx_live_responses_public_page ON live_responses(activity_id, moderation_status, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_live_responses_participant_count ON live_responses(activity_id, participant_id);
      CREATE INDEX IF NOT EXISTS idx_live_views_activity_timestamp ON live_views(activity_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_live_views_activity_visitor ON live_views(activity_id, visitor_hash);
      CREATE INDEX IF NOT EXISTS idx_moderation_rules_user ON moderation_rules(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_pages_user_created ON pages(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_page_blocks_page_position ON page_blocks(page_id, position);
      CREATE INDEX IF NOT EXISTS idx_page_views_page_timestamp ON page_views(page_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_page_views_page_visitor ON page_views(page_id, visitor_hash);
      CREATE INDEX IF NOT EXISTS idx_page_clicks_page_timestamp ON page_block_clicks(page_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_page_clicks_page_block ON page_block_clicks(page_id, block_id);

      INSERT OR IGNORE INTO public_slugs (slug, resource_type, resource_id, created_at)
      SELECT slug, 'link', id, created_at FROM links;
    `);

    const publicSlugTable = dbInstance
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'public_slugs'`)
      .get() as { sql: string } | undefined;
    if (publicSlugTable && !publicSlugTable.sql.includes("'page'")) {
      dbInstance.exec('BEGIN IMMEDIATE');
      try {
        dbInstance.exec(`
          ALTER TABLE public_slugs RENAME TO public_slugs_legacy;
          CREATE TABLE public_slugs (
            slug TEXT PRIMARY KEY,
            resource_type TEXT NOT NULL CHECK (resource_type IN ('link', 'live_activity', 'page')),
            resource_id TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL
          );
          INSERT INTO public_slugs (slug, resource_type, resource_id, created_at)
          SELECT slug, resource_type, resource_id, created_at FROM public_slugs_legacy;
          DROP TABLE public_slugs_legacy;
        `);
        dbInstance.exec('COMMIT');
      } catch (error) {
        dbInstance.exec('ROLLBACK');
        throw error;
      }
    }

    const pageBlocksTable = dbInstance
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'page_blocks'`)
      .get() as { sql: string } | undefined;
    if (pageBlocksTable && !pageBlocksTable.sql.includes("'double'")) {
      dbInstance.exec('BEGIN IMMEDIATE');
      try {
        dbInstance.exec(`
          ALTER TABLE page_blocks RENAME TO page_blocks_legacy;
          CREATE TABLE page_blocks (
            id TEXT PRIMARY KEY,
            page_id TEXT NOT NULL,
            block_type TEXT NOT NULL CHECK (block_type IN ('heading', 'text', 'link', 'existing_link', 'live_activity', 'email', 'divider', 'spacer', 'image', 'double')),
            config_json TEXT NOT NULL,
            position INTEGER NOT NULL,
            visible INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (page_id, position),
            FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
          );
          INSERT INTO page_blocks (id, page_id, block_type, config_json, position, visible, created_at, updated_at)
          SELECT id, page_id, block_type, config_json, position, visible, created_at, updated_at FROM page_blocks_legacy;
          DROP TABLE page_blocks_legacy;
          CREATE INDEX IF NOT EXISTS idx_page_blocks_page_position ON page_blocks(page_id, position);
        `);
        dbInstance.exec('COMMIT');
      } catch (error) {
        dbInstance.exec('ROLLBACK');
        throw error;
      }
    }

    const linkColumns = dbInstance
      .prepare(`PRAGMA table_info(links)`)
      .all() as Array<{ name: string }>;

    const userColumns = dbInstance
      .prepare(`PRAGMA table_info(users)`)
      .all() as Array<{ name: string }>;

    const analyticsColumns = dbInstance
      .prepare(`PRAGMA table_info(analytics_events)`)
      .all() as Array<{ name: string }>;

    const liveResponseColumns = dbInstance
      .prepare(`PRAGMA table_info(live_responses)`)
      .all() as Array<{ name: string }>;

    const liveActivityColumns = dbInstance
      .prepare(`PRAGMA table_info(live_activities)`)
      .all() as Array<{ name: string }>;

    const pageViewColumns = dbInstance
      .prepare(`PRAGMA table_info(page_views)`)
      .all() as Array<{ name: string }>;

    const pageClickColumns = dbInstance
      .prepare(`PRAGMA table_info(page_block_clicks)`)
      .all() as Array<{ name: string }>;

    const pageColumns = dbInstance
      .prepare(`PRAGMA table_info(pages)`)
      .all() as Array<{ name: string }>;

    const liveViewColumns = dbInstance
      .prepare(`PRAGMA table_info(live_views)`)
      .all() as Array<{ name: string }>;

    if (!linkColumns.some((column) => column.name === 'enabled')) {
      dbInstance.exec(`ALTER TABLE links ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;`);
    }

    if (!linkColumns.some((column) => column.name === 'comment')) {
      dbInstance.exec(`ALTER TABLE links ADD COLUMN comment TEXT;`);
    }

    if (!userColumns.some((column) => column.name === 'is_bootstrap_admin')) {
      dbInstance.exec(`ALTER TABLE users ADD COLUMN is_bootstrap_admin INTEGER NOT NULL DEFAULT 0;`);
    }
    if (!userColumns.some((column) => column.name === 'sidebar_collapsed')) {
      dbInstance.exec(`ALTER TABLE users ADD COLUMN sidebar_collapsed INTEGER NOT NULL DEFAULT 0;`);
    }
    if (!userColumns.some((column) => column.name === 'locale')) {
      dbInstance.exec(`ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';`);
    }
    if (!userColumns.some((column) => column.name === 'preferences_initialized')) {
      dbInstance.exec(`ALTER TABLE users ADD COLUMN preferences_initialized INTEGER NOT NULL DEFAULT 0;`);
    }
    if (!pageColumns.some((column) => column.name === 'background_pattern')) {
      dbInstance.exec(`ALTER TABLE pages ADD COLUMN background_pattern TEXT NOT NULL DEFAULT 'none';`);
    }
    if (!pageColumns.some((column) => column.name === 'pattern_intensity')) {
      dbInstance.exec(`ALTER TABLE pages ADD COLUMN pattern_intensity INTEGER NOT NULL DEFAULT 35;`);
    }

    if (!analyticsColumns.some((column) => column.name === 'auth_outcome')) {
      dbInstance.exec(`ALTER TABLE analytics_events ADD COLUMN auth_outcome TEXT NOT NULL DEFAULT 'success';`);
    }

    if (!analyticsColumns.some((column) => column.name === 'raw_ip')) {
      dbInstance.exec(`ALTER TABLE analytics_events ADD COLUMN raw_ip TEXT;`);
    }

    if (!liveResponseColumns.some((column) => column.name === 'participant_name')) {
      dbInstance.exec(`ALTER TABLE live_responses ADD COLUMN participant_name TEXT;`);
    }

    if (!liveResponseColumns.some((column) => column.name === 'published_participant_name')) {
      dbInstance.exec(`ALTER TABLE live_responses ADD COLUMN published_participant_name TEXT;`);
    }

    if (!liveResponseColumns.some((column) => column.name === 'name_edited_by_moderator')) {
      dbInstance.exec(`ALTER TABLE live_responses ADD COLUMN name_edited_by_moderator INTEGER NOT NULL DEFAULT 0;`);
    }

    if (!liveActivityColumns.some((column) => column.name === 'expires_at')) {
      dbInstance.exec(`ALTER TABLE live_activities ADD COLUMN expires_at TEXT;`);
    }

    if (!liveActivityColumns.some((column) => column.name === 'public_revision')) {
      dbInstance.exec(`ALTER TABLE live_activities ADD COLUMN public_revision INTEGER NOT NULL DEFAULT 0;`);
    }

    if (!pageViewColumns.some((column) => column.name === 'device_type')) {
      dbInstance.exec(`ALTER TABLE page_views ADD COLUMN device_type TEXT NOT NULL DEFAULT 'unknown';`);
    }
    if (!pageViewColumns.some((column) => column.name === 'browser')) {
      dbInstance.exec(`ALTER TABLE page_views ADD COLUMN browser TEXT NOT NULL DEFAULT 'Unknown';`);
    }
    if (!pageViewColumns.some((column) => column.name === 'os')) {
      dbInstance.exec(`ALTER TABLE page_views ADD COLUMN os TEXT NOT NULL DEFAULT 'Unknown';`);
    }
    if (!pageViewColumns.some((column) => column.name === 'referrer')) {
      dbInstance.exec(`ALTER TABLE page_views ADD COLUMN referrer TEXT NOT NULL DEFAULT 'Direct';`);
    }
    if (!pageViewColumns.some((column) => column.name === 'language')) {
      dbInstance.exec(`ALTER TABLE page_views ADD COLUMN language TEXT;`);
    }
    if (!pageClickColumns.some((column) => column.name === 'device_type')) {
      dbInstance.exec(`ALTER TABLE page_block_clicks ADD COLUMN device_type TEXT NOT NULL DEFAULT 'unknown';`);
    }
    if (!pageClickColumns.some((column) => column.name === 'browser')) {
      dbInstance.exec(`ALTER TABLE page_block_clicks ADD COLUMN browser TEXT NOT NULL DEFAULT 'Unknown';`);
    }
    if (!pageClickColumns.some((column) => column.name === 'os')) {
      dbInstance.exec(`ALTER TABLE page_block_clicks ADD COLUMN os TEXT NOT NULL DEFAULT 'Unknown';`);
    }
    if (!pageClickColumns.some((column) => column.name === 'referrer')) {
      dbInstance.exec(`ALTER TABLE page_block_clicks ADD COLUMN referrer TEXT NOT NULL DEFAULT 'Direct';`);
    }
    if (!pageClickColumns.some((column) => column.name === 'language')) {
      dbInstance.exec(`ALTER TABLE page_block_clicks ADD COLUMN language TEXT;`);
    }
    if (!pageClickColumns.some((column) => column.name === 'raw_ip')) {
      dbInstance.exec(`ALTER TABLE page_block_clicks ADD COLUMN raw_ip TEXT;`);
    }
    if (!liveViewColumns.some((column) => column.name === 'browser')) {
      dbInstance.exec(`ALTER TABLE live_views ADD COLUMN browser TEXT NOT NULL DEFAULT 'Unknown';`);
    }
    if (!liveViewColumns.some((column) => column.name === 'os')) {
      dbInstance.exec(`ALTER TABLE live_views ADD COLUMN os TEXT NOT NULL DEFAULT 'Unknown';`);
    }
    if (!liveViewColumns.some((column) => column.name === 'referrer')) {
      dbInstance.exec(`ALTER TABLE live_views ADD COLUMN referrer TEXT NOT NULL DEFAULT 'Direct';`);
    }
    if (!liveViewColumns.some((column) => column.name === 'language')) {
      dbInstance.exec(`ALTER TABLE live_views ADD COLUMN language TEXT;`);
    }
  }

  return dbInstance;
};

export const resetDb = () => {
  dbInstance?.close();
  dbInstance = null;
};
