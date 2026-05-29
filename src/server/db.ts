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

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_links_user_id ON links(user_id);
      CREATE INDEX IF NOT EXISTS idx_analytics_link_id_timestamp ON analytics_events(link_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_analytics_slug_timestamp ON analytics_events(slug, timestamp);
    `);

    const linkColumns = dbInstance
      .prepare(`PRAGMA table_info(links)`)
      .all() as Array<{ name: string }>;

    const userColumns = dbInstance
      .prepare(`PRAGMA table_info(users)`)
      .all() as Array<{ name: string }>;

    const analyticsColumns = dbInstance
      .prepare(`PRAGMA table_info(analytics_events)`)
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

    if (!analyticsColumns.some((column) => column.name === 'auth_outcome')) {
      dbInstance.exec(`ALTER TABLE analytics_events ADD COLUMN auth_outcome TEXT NOT NULL DEFAULT 'success';`);
    }

    if (!analyticsColumns.some((column) => column.name === 'raw_ip')) {
      dbInstance.exec(`ALTER TABLE analytics_events ADD COLUMN raw_ip TEXT;`);
    }
  }

  return dbInstance;
};

export const resetDb = () => {
  dbInstance?.close();
  dbInstance = null;
};
