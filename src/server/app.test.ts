// @vitest-environment node
import argon2 from 'argon2';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const envKeys = [
  'NODE_ENV',
  'DATABASE_PATH',
  'APP_DATA_DIR',
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD',
  'ADMIN_NAME',
  'COOKIE_SECURE',
  'COOKIE_SAME_SITE',
  'PUBLIC_URL',
  'APP_BASE_URL',
  'APP_NAME',
  'APP_DESCRIPTION',
  'CORS_ORIGIN',
  'ENABLE_CSP',
  'STORE_RAW_IP',
  'IP_HASH_SECRET',
  'ANALYTICS_RETENTION_DAYS',
  'RESET_ADMIN',
  'RESET_ADMIN_ON_START',
  'MIN_SLUG_LENGTH',
  'MAX_SLUG_LENGTH',
  'SLUG_ALLOWED_CHARS',
  'LOGIN_MAX_FAILED_ATTEMPTS',
  'LOGIN_ATTEMPT_WINDOW_MINUTES',
  'LOGIN_BLOCK_MINUTES',
  'PROTECTED_LINK_MAX_FAILED_ATTEMPTS',
  'PROTECTED_LINK_ATTEMPT_WINDOW_MINUTES',
  'PROTECTED_LINK_BLOCK_MINUTES',
  'API_RATE_LIMIT_ENABLED',
  'API_RATE_LIMIT_MAX_REQUESTS',
  'API_RATE_LIMIT_WINDOW_MINUTES',
  'LINK_CREATE_RATE_LIMIT_ENABLED',
  'LINK_CREATE_MAX_REQUESTS',
  'LINK_CREATE_WINDOW_MINUTES',
  'REDIRECT_RATE_LIMIT_ENABLED',
  'REDIRECT_RATE_LIMIT_MAX_REQUESTS',
  'REDIRECT_RATE_LIMIT_WINDOW_MINUTES',
  'REDIRECT_RATE_LIMIT_BLOCK_MINUTES',
  'LIVE_SUBMIT_MAX_REQUESTS',
  'LIVE_SUBMIT_WINDOW_MINUTES',
  'BLOCK_LOCAL_URLS',
  'BLOCK_PRIVATE_IPS',
  'SESSION_TTL_HOURS',
  'SESSION_COOKIE_NAME'
];

const extractCookies = (setCookie: string[] | string | undefined) => {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return list.map((entry) => entry.split(';')[0]).join('; ');
};

const getSetCookieEntries = (setCookie: string[] | string | undefined) =>
  Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];

const getCookieValue = (cookieHeader: string, name: string) =>
  cookieHeader
    .split('; ')
    .find((entry) => entry.startsWith(`${name}=`))
    ?.slice(name.length + 1) ?? null;

const createTestDbPath = () =>
  path.join(process.cwd(), '.data', `test-shortswitch-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);

const setBaseEnv = (dbPath: string, overrides: Record<string, string | undefined> = {}) => {
  for (const key of envKeys) {
    delete process.env[key];
  }

  const nextEnv: Record<string, string> = {
    NODE_ENV: 'development',
    DATABASE_PATH: dbPath,
    APP_DATA_DIR: `${dbPath}.data`,
    ADMIN_EMAIL: 'admin@example.com',
    ADMIN_PASSWORD: 'test-admin-password-42',
    ADMIN_NAME: 'Admin',
    COOKIE_SECURE: 'false',
    COOKIE_SAME_SITE: 'lax',
    PUBLIC_URL: 'http://localhost:3000',
    APP_NAME: 'ShortSwitch',
    APP_DESCRIPTION: 'Test instance',
    CORS_ORIGIN: 'http://localhost:5173',
    ENABLE_CSP: 'false',
    STORE_RAW_IP: 'false',
    IP_HASH_SECRET: 'test-ip-hash-secret',
    ANALYTICS_RETENTION_DAYS: '90',
    RESET_ADMIN_ON_START: 'false',
    MIN_SLUG_LENGTH: '6',
    MAX_SLUG_LENGTH: '64',
    SLUG_ALLOWED_CHARS: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    LOGIN_MAX_FAILED_ATTEMPTS: '5',
    LOGIN_ATTEMPT_WINDOW_MINUTES: '10',
    LOGIN_BLOCK_MINUTES: '15',
    PROTECTED_LINK_MAX_FAILED_ATTEMPTS: '5',
    PROTECTED_LINK_ATTEMPT_WINDOW_MINUTES: '10',
    PROTECTED_LINK_BLOCK_MINUTES: '15',
    API_RATE_LIMIT_ENABLED: 'false',
    API_RATE_LIMIT_MAX_REQUESTS: '300',
    API_RATE_LIMIT_WINDOW_MINUTES: '1',
    LINK_CREATE_RATE_LIMIT_ENABLED: 'false',
    LINK_CREATE_MAX_REQUESTS: '30',
    LINK_CREATE_WINDOW_MINUTES: '60',
    REDIRECT_RATE_LIMIT_ENABLED: 'false',
    REDIRECT_RATE_LIMIT_MAX_REQUESTS: '600',
    REDIRECT_RATE_LIMIT_WINDOW_MINUTES: '1',
    REDIRECT_RATE_LIMIT_BLOCK_MINUTES: '10',
    LIVE_SUBMIT_MAX_REQUESTS: '60',
    LIVE_SUBMIT_WINDOW_MINUTES: '1',
    BLOCK_LOCAL_URLS: 'true',
    BLOCK_PRIVATE_IPS: 'false',
    SESSION_TTL_HOURS: '720',
    SESSION_COOKIE_NAME: 'shortswitch_session'
  };

  Object.assign(process.env, nextEnv);

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

const getCsrfBundle = async (app: any) => {
  const response = await app.inject({ method: 'GET', url: '/api/auth/csrf-token' });
  return {
    csrfToken: response.json().csrfToken as string,
    csrfCookies: extractCookies(response.headers['set-cookie'] as string[] | string | undefined)
  };
};

const login = async (
  app: any,
  email: string,
  password: string,
  csrf: Awaited<ReturnType<typeof getCsrfBundle>>
) => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
    headers: {
      cookie: csrf.csrfCookies,
      'x-csrf-token': csrf.csrfToken
    }
  });

  return {
    response,
    cookies: `${csrf.csrfCookies}; ${extractCookies(response.headers['set-cookie'] as string[] | string | undefined)}`
  };
};

const seedUser = async (email: string, password: string, name = 'User B') => {
  const { getDb } = await import('./db.js');
  const { createId, nowIso } = await import('./utils.js');
  const db = getDb();
  const id = createId();
  const timestamp = nowIso();
  const hash = await argon2.hash(password);
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, is_bootstrap_admin, theme, session_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 'system', 1, ?, ?)`
  ).run(id, email, name, hash, timestamp, timestamp);
  return id;
};

describe.sequential('server security hardening', () => {
  let testDbPath = '';

  beforeEach(() => {
    testDbPath = createTestDbPath();
    fs.mkdirSync(path.dirname(testDbPath), { recursive: true });
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    setBaseEnv(testDbPath);
    vi.resetModules();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  afterEach(async () => {
    try {
      const dbModule = await import('./db.js');
      dbModule.resetDb();
    } catch {
      // ignore module load failures in config validation tests
    }
    try {
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    } catch {
      // keep per-test db if SQLite still holds a transient file handle
    }
    fs.rmSync(`${testDbPath}.data`, { recursive: true, force: true });
    vi.useRealTimers();
  });

  test('fails startup in production without CORS_ORIGIN', async () => {
    setBaseEnv(testDbPath, {
      NODE_ENV: 'production',
      STORE_RAW_IP: 'true',
      CORS_ORIGIN: undefined
    });
    vi.resetModules();

    await expect(import('./app.js')).rejects.toThrow('CORS_ORIGIN must be set in production');
  });

  test('fails startup in production without a non-default admin password', async () => {
    setBaseEnv(testDbPath, {
      NODE_ENV: 'production',
      STORE_RAW_IP: 'true',
      ADMIN_PASSWORD: 'change-me-now'
    });
    vi.resetModules();

    await expect(import('./config.js')).rejects.toThrow('ADMIN_PASSWORD must be explicitly set');
  });

  test('fails startup with an insecure cookie on an HTTPS production URL', async () => {
    setBaseEnv(testDbPath, {
      NODE_ENV: 'production',
      PUBLIC_URL: 'https://links.example.com',
      COOKIE_SECURE: 'false',
      STORE_RAW_IP: 'true'
    });
    vi.resetModules();

    await expect(import('./config.js')).rejects.toThrow('COOKIE_SECURE must be enabled');
  });

  test('localizes public HTML from only the primary Accept-Language value', async () => {
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const cases = [
      { language: 'lv-LV', locale: 'lv', heading: 'Adrese nav atrasta' },
      { language: 'en-US', locale: 'en', heading: 'Address not found' },
      { language: 'ru-RU,lv-LV;q=0.9', locale: 'en', heading: 'Address not found' },
      { language: 'zz-ZZ', locale: 'en', heading: 'Address not found' }
    ];

    for (const item of cases) {
      const response = await app.inject({
        method: 'GET',
        url: '/missing-public-resource',
        headers: { 'accept-language': item.language }
      });
      expect(response.statusCode).toBe(404);
      expect(response.body).toContain(`<html lang="${item.locale}">`);
      expect(response.body).toContain(item.heading);
    }

    await app.close();
  });

  test('renders localized protected, expired and disabled public states', async () => {
    const {
      renderLinkDisabledPage,
      renderLinkExpiredPage,
      renderProtectedLinkPage,
      renderPublicServiceUnavailablePage
    } = await import('./views/error-pages.js');

    expect(renderProtectedLinkPage({ locale: 'lv', error: 'Nepareiza parole.' }))
      .toContain('Ievadi paroli');
    expect(renderProtectedLinkPage({ locale: 'lv', error: 'Nepareiza parole.' }))
      .toContain('Nepareiza parole.');
    expect(renderLinkExpiredPage('lv', 'live')).toContain('Aktivitātes termiņš ir beidzies');
    expect(renderLinkDisabledPage('lv', 'page')).toContain('Lapa ir atspējota');
    expect(renderPublicServiceUnavailablePage('lv')).toContain('Pakalpojums nav pieejams');
  });

  test('upgrades the shared slug registry for Pages without losing legacy rows', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const legacy = new DatabaseSync(testDbPath);
    legacy.exec(`
      CREATE TABLE public_slugs (
        slug TEXT PRIMARY KEY,
        resource_type TEXT NOT NULL CHECK (resource_type IN ('link', 'live_activity')),
        resource_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      INSERT INTO public_slugs VALUES ('legacy-slug', 'link', 'legacy-resource', '2026-01-01T00:00:00.000Z');
    `);
    legacy.close();
    const { getDb } = await import('./db.js');
    const db = getDb();
    const table = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'public_slugs'`).get() as { sql: string };
    expect(table.sql).toContain("'page'");
    expect(db.prepare('SELECT * FROM public_slugs WHERE slug = ?').get('legacy-slug')).toMatchObject({
      resource_type: 'link', resource_id: 'legacy-resource'
    });
    expect(() => db.prepare('INSERT INTO public_slugs VALUES (?, ?, ?, ?)').run('page-slug', 'page', 'page-resource', '2026-01-01T00:00:00.000Z')).not.toThrow();
  });

  test('upgrades Page block constraints for Double without losing existing blocks', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const legacy = new DatabaseSync(testDbPath);
    legacy.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
        is_bootstrap_admin INTEGER NOT NULL DEFAULT 0, theme TEXT NOT NULL DEFAULT 'system', session_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE pages (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT, emoji TEXT,
        avatar_url TEXT, theme TEXT NOT NULL DEFAULT 'classic_cream', layout TEXT NOT NULL DEFAULT 'classic', status TEXT NOT NULL DEFAULT 'draft',
        seo_title TEXT, seo_description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE page_blocks (
        id TEXT PRIMARY KEY, page_id TEXT NOT NULL,
        block_type TEXT NOT NULL CHECK (block_type IN ('heading', 'text', 'link', 'existing_link', 'live_activity', 'email', 'divider', 'spacer', 'image')),
        config_json TEXT NOT NULL, position INTEGER NOT NULL, visible INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE (page_id, position), FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
      );
      CREATE TABLE page_views (
        id TEXT PRIMARY KEY, page_id TEXT NOT NULL, timestamp TEXT NOT NULL, visitor_hash TEXT NOT NULL, raw_ip TEXT,
        FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
      );
      CREATE TABLE page_block_clicks (
        id TEXT PRIMARY KEY, page_id TEXT NOT NULL, block_id TEXT NOT NULL, block_label TEXT NOT NULL,
        event_id TEXT NOT NULL UNIQUE, timestamp TEXT NOT NULL, visitor_hash TEXT NOT NULL,
        FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
      );
      INSERT INTO users VALUES ('owner', 'owner@example.com', 'Owner', 'hash', 0, 'system', 1, '2026-01-01', '2026-01-01');
      INSERT INTO pages (id, user_id, slug, title, description, emoji, avatar_url, theme, layout, status, seo_title, seo_description, created_at, updated_at)
      VALUES ('page', 'owner', 'legacy-page', 'Legacy', NULL, NULL, NULL, 'classic_cream', 'classic', 'draft', NULL, NULL, '2026-01-01', '2026-01-01');
      INSERT INTO page_blocks VALUES ('legacy-heading', 'page', 'heading', '{"text":"Preserved"}', 0, 1, '2026-01-01', '2026-01-01');
      INSERT INTO page_views VALUES ('legacy-view', 'page', '2026-01-01', 'visitor', NULL);
      INSERT INTO page_block_clicks VALUES ('legacy-click', 'page', 'legacy-heading', 'Preserved', 'legacy-event', '2026-01-01', 'visitor');
    `);
    legacy.close();

    const { getDb } = await import('./db.js');
    const db = getDb();
    const table = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'page_blocks'`).get() as { sql: string };
    expect(table.sql).toContain("'double'");
    expect(db.prepare('SELECT block_type, config_json FROM page_blocks WHERE id = ?').get('legacy-heading')).toMatchObject({
      block_type: 'heading', config_json: '{"text":"Preserved"}'
    });
    expect(db.prepare('SELECT visitor_hash, device_type, browser, os, referrer, language FROM page_views WHERE id = ?').get('legacy-view')).toMatchObject({
      visitor_hash: 'visitor', device_type: 'unknown', browser: 'Unknown', os: 'Unknown', referrer: 'Direct', language: null
    });
    expect(db.prepare('SELECT visitor_hash, device_type, browser, os, referrer, language FROM page_block_clicks WHERE id = ?').get('legacy-click')).toMatchObject({
      visitor_hash: 'visitor', device_type: 'unknown', browser: 'Unknown', os: 'Unknown', referrer: 'Direct', language: null
    });
    expect(db.prepare('SELECT sidebar_collapsed, locale, preferences_initialized FROM users WHERE id = ?').get('owner')).toMatchObject({
      sidebar_collapsed: 0, locale: 'en', preferences_initialized: 0
    });
    expect(db.prepare('SELECT background_pattern, pattern_intensity FROM pages WHERE id = ?').get('page')).toMatchObject({
      background_pattern: 'none', pattern_intensity: 35
    });
    expect(() => db.prepare('INSERT INTO page_blocks VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      'double-block', 'page', 'double', '{"children":[]}', 1, 1, '2026-01-01', '2026-01-01'
    )).not.toThrow();
  });

  test('user preferences are validated, persisted and scoped to the authenticated user', async () => {
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const otherUserId = await seedUser('other@example.com', 'other-password-42');
    const csrf = await getCsrfBundle(app);
    const admin = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);
    const headers = { cookie: admin.cookies, 'x-csrf-token': csrf.csrfToken };

    const updated = await app.inject({
      method: 'PATCH', url: '/api/settings/preferences', headers,
      payload: { theme: 'dark', sidebarCollapsed: true, locale: 'lv', userId: otherUserId }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({ theme: 'dark', sidebarCollapsed: true, locale: 'lv', initialized: true });

    const preferences = await app.inject({ method: 'GET', url: '/api/settings/preferences', headers: { cookie: admin.cookies } });
    expect(preferences.statusCode).toBe(200);
    expect(preferences.headers['cache-control']).toBe('private, no-store');
    expect(preferences.json()).toEqual({ theme: 'dark', sidebarCollapsed: true, locale: 'lv', initialized: true });

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: admin.cookies } });
    expect(me.json()).toMatchObject({ theme: 'dark', sidebarCollapsed: true, locale: 'lv', preferencesInitialized: true });
    const { getDb } = await import('./db.js');
    expect(getDb().prepare('SELECT theme, sidebar_collapsed, locale FROM users WHERE id = ?').get(otherUserId)).toMatchObject({
      theme: 'system', sidebar_collapsed: 0, locale: 'en'
    });

    expect((await app.inject({ method: 'PATCH', url: '/api/settings/preferences', headers, payload: { locale: 'de' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/api/settings/preferences', payload: { locale: 'lv' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/settings/preferences' })).statusCode).toBe(401);
    await app.close();
  });

  test('allowed CORS origin works and unknown origin is not trusted', async () => {
    setBaseEnv(testDbPath, {
      NODE_ENV: 'production',
      PUBLIC_URL: 'https://links.example.com',
      COOKIE_SECURE: 'true',
      CORS_ORIGIN: 'https://links.example.com',
      ENABLE_CSP: 'true'
    });
    vi.resetModules();

    const { buildApp } = await import('./app.js');
    const app = await buildApp();

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'https://links.example.com' }
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('https://links.example.com');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const denied = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'https://evil.example.com' }
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    expect(denied.headers['access-control-allow-credentials']).toBeUndefined();

    await app.close();
  });

  test('helmet CSP headers are enabled in production with strict directives', async () => {
    setBaseEnv(testDbPath, {
      NODE_ENV: 'production',
      PUBLIC_URL: 'https://links.example.com',
      COOKIE_SECURE: 'true',
      CORS_ORIGIN: 'https://links.example.com',
      ENABLE_CSP: 'true'
    });
    vi.resetModules();

    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    const csp = String(response.headers['content-security-policy'] ?? '');

    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'unsafe-inline'");

    await app.close();
  });

  test('session cookie uses HttpOnly, SameSite, Secure in production and API body has no session token', async () => {
    setBaseEnv(testDbPath, {
      NODE_ENV: 'production',
      PUBLIC_URL: 'https://links.example.com',
      COOKIE_SECURE: 'true',
      CORS_ORIGIN: 'https://links.example.com'
    });
    vi.resetModules();

    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const { response } = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);
    const setCookie = getSetCookieEntries(response.headers['set-cookie'] as string[] | string | undefined).join('\n');

    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Secure');
    expect(response.json()).not.toHaveProperty('sessionId');
    expect(response.json()).not.toHaveProperty('token');

    await app.close();
  });

  test('POST, PATCH and DELETE APIs reject missing CSRF but allow valid CSRF, while redirects work without CSRF', async () => {
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const { cookies } = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);

    const createWithoutCsrf = await app.inject({
      method: 'POST',
      url: '/api/links',
      payload: { targetUrl: 'https://example.com', slug: 'secure01' },
      headers: { cookie: cookies }
    });
    expect(createWithoutCsrf.statusCode).toBe(403);

    const created = await app.inject({
      method: 'POST',
      url: '/api/links',
      payload: { targetUrl: 'https://example.com', slug: 'secure01' },
      headers: {
        cookie: cookies,
        'x-csrf-token': csrf.csrfToken
      }
    });
    expect(created.statusCode).toBe(200);
    const link = created.json();

    const patchWithoutCsrf = await app.inject({
      method: 'PATCH',
      url: `/api/links/${link.id}`,
      payload: { targetUrl: 'https://example.org' },
      headers: { cookie: cookies }
    });
    expect(patchWithoutCsrf.statusCode).toBe(403);

    const patchWithCsrf = await app.inject({
      method: 'PATCH',
      url: `/api/links/${link.id}`,
      payload: { targetUrl: 'https://example.org' },
      headers: {
        cookie: cookies,
        'x-csrf-token': csrf.csrfToken
      }
    });
    expect(patchWithCsrf.statusCode).toBe(200);

    const deleteWithoutCsrf = await app.inject({
      method: 'DELETE',
      url: `/api/links/${link.id}`,
      headers: { cookie: cookies }
    });
    expect(deleteWithoutCsrf.statusCode).toBe(403);

    const redirect = await app.inject({ method: 'GET', url: '/secure01' });
    expect(redirect.statusCode).toBe(302);

    await app.close();
  });

  test('unauthenticated users cannot access protected APIs', async () => {
    const { buildApp } = await import('./app.js');
    const app = await buildApp();

    expect((await app.inject({ method: 'GET', url: '/api/links' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/analytics/global' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/sessions' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/settings/password', payload: { password: 'x' } })).statusCode).toBe(403);

    await app.close();
  });

  test('IDOR is blocked for links and analytics', async () => {
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    await seedUser('userb@example.com', 'another-password');

    const adminCsrf = await getCsrfBundle(app);
    const adminLogin = await login(app, 'admin@example.com', 'test-admin-password-42', adminCsrf);
    const userBCsrf = await getCsrfBundle(app);
    const userBLogin = await login(app, 'userb@example.com', 'another-password', userBCsrf);

    const created = await app.inject({
      method: 'POST',
      url: '/api/links',
      payload: { targetUrl: 'https://example.com', slug: 'owner01' },
      headers: {
        cookie: adminLogin.cookies,
        'x-csrf-token': adminCsrf.csrfToken
      }
    });
    const link = created.json();

    const listForUserB = await app.inject({
      method: 'GET',
      url: '/api/links',
      headers: { cookie: userBLogin.cookies }
    });
    expect(listForUserB.json().some((entry: any) => entry.id === link.id)).toBe(false);

    const updateAsUserB = await app.inject({
      method: 'PATCH',
      url: `/api/links/${link.id}`,
      payload: { targetUrl: 'https://evil.example.com' },
      headers: {
        cookie: userBLogin.cookies,
        'x-csrf-token': userBCsrf.csrfToken
      }
    });
    expect(updateAsUserB.statusCode).toBe(404);

    const deleteAsUserB = await app.inject({
      method: 'DELETE',
      url: `/api/links/${link.id}`,
      headers: {
        cookie: userBLogin.cookies,
        'x-csrf-token': userBCsrf.csrfToken
      }
    });
    expect(deleteAsUserB.statusCode).toBe(404);

    const analyticsAsUserB = await app.inject({
      method: 'GET',
      url: `/api/links/${link.id}/analytics?range=day&limit=10`,
      headers: { cookie: userBLogin.cookies }
    });
    expect(analyticsAsUserB.statusCode).toBe(404);

    const pagePayload = {
      title: 'Admin Page', slug: 'admin-page', theme: 'minimal_light', layout: 'classic', status: 'draft',
      blocks: [{ type: 'existing_link', visible: true, config: { title: 'Admin Link', resourceId: link.id } }]
    };
    const createdPage = await app.inject({
      method: 'POST', url: '/api/pages', payload: pagePayload,
      headers: { cookie: adminLogin.cookies, 'x-csrf-token': adminCsrf.csrfToken }
    });
    expect(createdPage.statusCode).toBe(200);
    const page = createdPage.json();
    expect((await app.inject({ method: 'GET', url: `/api/pages/${page.id}`, headers: { cookie: userBLogin.cookies } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/pages/${page.id}/analytics`, headers: { cookie: userBLogin.cookies } })).statusCode).toBe(404);
    expect((await app.inject({
      method: 'PATCH', url: `/api/pages/${page.id}`, payload: pagePayload,
      headers: { cookie: userBLogin.cookies, 'x-csrf-token': userBCsrf.csrfToken }
    })).statusCode).toBe(404);
    expect((await app.inject({
      method: 'DELETE', url: `/api/pages/${page.id}`,
      headers: { cookie: userBLogin.cookies, 'x-csrf-token': userBCsrf.csrfToken }
    })).statusCode).toBe(404);
    expect((await app.inject({
      method: 'POST', url: '/api/pages', payload: { ...pagePayload, slug: 'foreign-resource' },
      headers: { cookie: userBLogin.cookies, 'x-csrf-token': userBCsrf.csrfToken }
    })).statusCode).toBe(404);

    await app.close();
  });

  test('login rate limit triggers and successful login clears prior failed counter', async () => {
    setBaseEnv(testDbPath, {
      LOGIN_MAX_FAILED_ATTEMPTS: '2',
      LOGIN_ATTEMPT_WINDOW_MINUTES: '10',
      LOGIN_BLOCK_MINUTES: '10'
    });
    vi.resetModules();

    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);

    const failed = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@example.com', password: 'wrong-password' },
      headers: {
        cookie: csrf.csrfCookies,
        'x-csrf-token': csrf.csrfToken
      }
    });
    expect(failed.statusCode).toBe(401);

    const success = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);
    expect(success.response.statusCode).toBe(200);

    const failedAgain = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@example.com', password: 'wrong-password' },
      headers: {
        cookie: csrf.csrfCookies,
        'x-csrf-token': csrf.csrfToken
      }
    });
    expect(failedAgain.statusCode).toBe(401);

    setBaseEnv(testDbPath, {
      LOGIN_MAX_FAILED_ATTEMPTS: '1',
      LOGIN_ATTEMPT_WINDOW_MINUTES: '10',
      LOGIN_BLOCK_MINUTES: '10'
    });
    vi.resetModules();
    const { buildApp: buildBlockedApp } = await import('./app.js');
    const blockedApp = await buildBlockedApp();
    const blockedCsrf = await getCsrfBundle(blockedApp);

    await blockedApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@example.com', password: 'wrong-password' },
      headers: {
        cookie: blockedCsrf.csrfCookies,
        'x-csrf-token': blockedCsrf.csrfToken
      }
    });
    const blocked = await blockedApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@example.com', password: 'wrong-password' },
      headers: {
        cookie: blockedCsrf.csrfCookies,
        'x-csrf-token': blockedCsrf.csrfToken
      }
    });
    expect(blocked.statusCode).toBe(429);

    await app.close();
    await blockedApp.close();
  });

  test('protected link rate limit triggers', async () => {
    setBaseEnv(testDbPath, {
      PROTECTED_LINK_MAX_FAILED_ATTEMPTS: '1',
      PROTECTED_LINK_ATTEMPT_WINDOW_MINUTES: '1',
      PROTECTED_LINK_BLOCK_MINUTES: '1'
    });
    vi.resetModules();

    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const { cookies } = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);

    await app.inject({
      method: 'POST',
      url: '/api/links',
      payload: { targetUrl: 'https://example.com', slug: 'secret1', password: '123456' },
      headers: {
        cookie: cookies,
        'x-csrf-token': csrf.csrfToken
      }
    });

    const form = await app.inject({
      method: 'GET',
      url: '/access/secret1',
      headers: { 'accept-language': 'lv-LV,en;q=0.9' }
    });
    expect(form.statusCode).toBe(200);
    expect(form.body).toContain('Ievadi paroli');
    expect(form.body).toContain('<html lang="lv">');

    const invalid = await app.inject({
      method: 'POST',
      url: '/access/secret1',
      payload: { password: 'wrong' },
      headers: { 'accept-language': 'lv-LV,en;q=0.9' }
    });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.body).toContain('Nepareiza parole');

    const blocked = await app.inject({
      method: 'POST',
      url: '/access/secret1',
      payload: { password: 'wrong' },
      headers: { 'accept-language': 'lv-LV,en;q=0.9' }
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.body).toContain('Pārāk daudz mēģinājumu');

    await app.close();
  });

  test('protected link with valid password redirects with 303 See Other', async () => {
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const { cookies } = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);

    const created = await app.inject({
      method: 'POST',
      url: '/api/links',
      payload: { targetUrl: 'https://example.com/protected', slug: 'secret2', password: '123456' },
      headers: {
        cookie: cookies,
        'x-csrf-token': csrf.csrfToken
      }
    });
    expect(created.statusCode).toBe(200);

    const redirect = await app.inject({
      method: 'POST',
      url: '/access/secret2',
      payload: { password: '123456' }
    });

    expect(redirect.statusCode).toBe(303);
    expect(redirect.headers.location).toBe('https://example.com/protected');

    await app.close();
  });

  test('/access/:slug redirects back to the short link when the link is not password protected', async () => {
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const { cookies } = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);

    const created = await app.inject({
      method: 'POST',
      url: '/api/links',
      payload: { targetUrl: 'https://example.com/plain', slug: 'plain01' },
      headers: {
        cookie: cookies,
        'x-csrf-token': csrf.csrfToken
      }
    });
    expect(created.statusCode).toBe(200);

    const getAccess = await app.inject({
      method: 'GET',
      url: '/access/plain01'
    });
    expect(getAccess.statusCode).toBe(302);
    expect(getAccess.headers.location).toBe('/plain01');

    const postAccess = await app.inject({
      method: 'POST',
      url: '/access/plain01',
      payload: { password: 'ignored' }
    });
    expect(postAccess.statusCode).toBe(302);
    expect(postAccess.headers.location).toBe('/plain01');

    await app.close();
  });

  test('expired and protected-link responses are marked no-store to avoid stale browser cache', async () => {
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const { cookies } = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);

    const created = await app.inject({
      method: 'POST',
      url: '/api/links',
      payload: {
        targetUrl: 'https://example.com/cache',
        slug: 'cache01',
        password: '123456',
        expirationValue: 1,
        expirationUnit: 'minutes'
      },
      headers: {
        cookie: cookies,
        'x-csrf-token': csrf.csrfToken
      }
    });
    expect(created.statusCode).toBe(200);

    const { getDb } = await import('./db.js');
    getDb()
      .prepare('UPDATE links SET expires_at = ? WHERE slug = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), 'cache01');

    const expired = await app.inject({ method: 'GET', url: '/cache01' });
    expect(expired.statusCode).toBe(410);
    expect(String(expired.headers['cache-control'] ?? '')).toContain('no-store');

    const protectedPage = await app.inject({ method: 'GET', url: '/access/cache01' });
    expect(protectedPage.statusCode).toBe(410);
    expect(String(protectedPage.headers['cache-control'] ?? '')).toContain('no-store');

    await app.close();
  });

  test('slug traversal, reserved slugs, invalid chars and overlong slugs are rejected while valid custom slug works', async () => {
    setBaseEnv(testDbPath, { MAX_SLUG_LENGTH: '8' });
    vi.resetModules();

    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const { cookies } = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);

    const invalidRequests = [
      { slug: 'static', message: 'Slug is reserved.' },
      { slug: 'bad slug', message: 'Slug contains unsafe characters.' },
      { slug: 'abcdefghi', message: 'Slug is longer than allowed maximum.' },
      { slug: '%2fslug', message: 'Slug contains encoded unsafe characters.' }
    ];

    for (const invalid of invalidRequests) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/links',
        payload: { targetUrl: 'https://example.com', slug: invalid.slug },
        headers: {
          cookie: cookies,
          'x-csrf-token': csrf.csrfToken
        }
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().message).toBe(invalid.message);
    }

    const valid = await app.inject({
      method: 'POST',
      url: '/api/links',
      payload: { targetUrl: 'https://example.com', slug: 'good007' },
      headers: {
        cookie: cookies,
        'x-csrf-token': csrf.csrfToken
      }
    });
    expect(valid.statusCode).toBe(200);

    const dotDot = await app.inject({ method: 'GET', url: '/..' });
    expect(dotDot.statusCode).toBe(302);
    expect(dotDot.headers.location).toBe('/app/links');
    expect([302, 404]).toContain((await app.inject({ method: 'GET', url: '/%2e%2e' })).statusCode);
    expect([302, 404]).toContain((await app.inject({ method: 'GET', url: '/%2f' })).statusCode);
    expect([302, 404]).toContain((await app.inject({ method: 'GET', url: '/%5c' })).statusCode);
    const reservedApi = await app.inject({ method: 'GET', url: '/api' });
    expect(reservedApi.statusCode).toBe(302);
    expect(reservedApi.headers.location).toBe('/app/links');
    expect((await app.inject({ method: 'GET', url: '/login' })).statusCode).toBe(302);
    expect((await app.inject({ method: 'GET', url: '/admin' })).statusCode).toBe(302);
    expect((await app.inject({ method: 'GET', url: '/bad%00slug' })).statusCode).toBe(404);

    await app.close();
  });

  test('manual custom slug can use safe characters outside SLUG_ALLOWED_CHARS while generated slugs still use the configured charset', async () => {
    setBaseEnv(testDbPath, {
      MIN_SLUG_LENGTH: '3',
      MAX_SLUG_LENGTH: '32',
      SLUG_ALLOWED_CHARS: 'abc123'
    });
    vi.resetModules();

    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const { cookies } = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);

    const generated = await app.inject({
      method: 'POST',
      url: '/api/links',
      payload: { targetUrl: 'https://example.com' },
      headers: {
        cookie: cookies,
        'x-csrf-token': csrf.csrfToken
      }
    });
    expect(generated.statusCode).toBe(200);
    expect(generated.json().slug).toMatch(/^[abc123]{3}$/);

    const manual = await app.inject({
      method: 'POST',
      url: '/api/links',
      payload: { targetUrl: 'https://example.com/custom', slug: 'Team-Path_9' },
      headers: {
        cookie: cookies,
        'x-csrf-token': csrf.csrfToken
      }
    });
    expect(manual.statusCode).toBe(200);
    expect(manual.json().slug).toBe('Team-Path_9');
    expect(manual.json().shortUrl).toContain('/Team-Path_9');

    await app.close();
  });

  test('link comments are stored and can be updated', async () => {
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const { cookies } = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);

    const created = await app.inject({
      method: 'POST',
      url: '/api/links',
      payload: { targetUrl: 'https://example.com', slug: 'note001', comment: 'Primary workspace link' },
      headers: {
        cookie: cookies,
        'x-csrf-token': csrf.csrfToken
      }
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().comment).toBe('Primary workspace link');

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/links/${created.json().id}`,
      payload: { comment: 'Updated note' },
      headers: {
        cookie: cookies,
        'x-csrf-token': csrf.csrfToken
      }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().comment).toBe('Updated note');

    await app.close();
  });

  test('analytics can be cleared from settings across Links, Live and Pages', async () => {
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const { cookies } = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);

    const created = await app.inject({
      method: 'POST',
      url: '/api/links',
      payload: { targetUrl: 'https://example.com', slug: 'clear01' },
      headers: {
        cookie: cookies,
        'x-csrf-token': csrf.csrfToken
      }
    });
    expect(created.statusCode).toBe(200);
    const link = created.json();

    const liveCreated = await app.inject({
      method: 'POST', url: '/api/live',
      headers: { cookie: cookies, 'x-csrf-token': csrf.csrfToken },
      payload: {
        title: 'Clear Live', question: 'Clear this?', type: 'open_answer', slug: 'clear-live', status: 'active',
        identityMode: 'anonymous', allowMultipleResponses: false, maxResponsesPerParticipant: 1,
        moderationMode: 'off', maxAnswerLength: 120, publicResults: true
      }
    });
    expect(liveCreated.statusCode).toBe(200);
    expect((await app.inject({
      method: 'POST', url: '/api/live/public/clear-live/responses',
      payload: { participantToken: 'clear_participant_01', text: 'Recorded response' }
    })).statusCode).toBe(201);

    const pageCreated = await app.inject({
      method: 'POST', url: '/api/pages',
      headers: { cookie: cookies, 'x-csrf-token': csrf.csrfToken },
      payload: {
        title: 'Clear Page', slug: 'clear-page', description: '', emoji: '', avatarUrl: '',
        theme: 'classic_cream', layout: 'classic', status: 'published', seoTitle: '', seoDescription: '', blocks: []
      }
    });
    expect(pageCreated.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/pages/public/clear-page' })).statusCode).toBe(200);

    await app.inject({
      method: 'GET',
      url: '/clear01',
      remoteAddress: '203.0.113.10'
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const cleared = await app.inject({
      method: 'POST',
      url: '/api/settings/analytics/clear',
      headers: {
        cookie: cookies,
        'x-csrf-token': csrf.csrfToken
      },
      payload: {}
    });
    expect(cleared.statusCode).toBe(200);

    const { getDb } = await import('./db.js');
    const db = getDb();
    const analyticsCount = db.prepare('SELECT COUNT(*) as count FROM analytics_events').get() as { count: number };
    const clickCount = db.prepare('SELECT click_count as clickCount FROM links WHERE id = ?').get(link.id) as { clickCount: number };
    const liveResponseCount = db.prepare('SELECT COUNT(*) as count FROM live_responses').get() as { count: number };
    const liveParticipantCount = db.prepare('SELECT COUNT(*) as count FROM live_participants').get() as { count: number };
    const pageViewCount = db.prepare('SELECT COUNT(*) as count FROM page_views').get() as { count: number };
    expect(analyticsCount.count).toBe(0);
    expect(clickCount.clickCount).toBe(0);
    expect(liveResponseCount.count).toBe(0);
    expect(liveParticipantCount.count).toBe(0);
    expect(pageViewCount.count).toBe(0);

    await app.close();
  });

  test('analytics can be cleared for a single link without affecting other links', async () => {
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const { cookies } = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);

    const firstCreated = await app.inject({
      method: 'POST',
      url: '/api/links',
      payload: { targetUrl: 'https://example.com/one', slug: 'one001' },
      headers: {
        cookie: cookies,
        'x-csrf-token': csrf.csrfToken
      }
    });
    const secondCreated = await app.inject({
      method: 'POST',
      url: '/api/links',
      payload: { targetUrl: 'https://example.com/two', slug: 'two001' },
      headers: {
        cookie: cookies,
        'x-csrf-token': csrf.csrfToken
      }
    });
    expect(firstCreated.statusCode).toBe(200);
    expect(secondCreated.statusCode).toBe(200);

    const firstLink = firstCreated.json();
    const secondLink = secondCreated.json();

    await app.inject({ method: 'GET', url: '/one001', remoteAddress: '203.0.113.11' });
    await app.inject({ method: 'GET', url: '/two001', remoteAddress: '203.0.113.12' });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const cleared = await app.inject({
      method: 'POST',
      url: `/api/links/${firstLink.id}/analytics/clear`,
      headers: {
        cookie: cookies,
        'x-csrf-token': csrf.csrfToken
      },
      payload: {}
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().id).toBe(firstLink.id);
    expect(cleared.json().clickCount).toBe(0);
    expect(cleared.json().uniqueClickCount).toBe(0);

    const { getDb } = await import('./db.js');
    const db = getDb();
    const firstAnalyticsCount = db
      .prepare('SELECT COUNT(*) as count FROM analytics_events WHERE link_id = ?')
      .get(firstLink.id) as { count: number };
    const secondAnalyticsCount = db
      .prepare('SELECT COUNT(*) as count FROM analytics_events WHERE link_id = ?')
      .get(secondLink.id) as { count: number };
    const firstClickCount = db
      .prepare('SELECT click_count as clickCount FROM links WHERE id = ?')
      .get(firstLink.id) as { clickCount: number };
    const secondClickCount = db
      .prepare('SELECT click_count as clickCount FROM links WHERE id = ?')
      .get(secondLink.id) as { clickCount: number };

    expect(firstAnalyticsCount.count).toBe(0);
    expect(secondAnalyticsCount.count).toBe(1);
    expect(firstClickCount.clickCount).toBe(0);
    expect(secondClickCount.clickCount).toBe(1);

    await app.close();
  });

  test('password change rejects an empty password', async () => {
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const { cookies } = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);

    const response = await app.inject({
      method: 'POST',
      url: '/api/settings/password',
      payload: { password: '' },
      headers: {
        cookie: cookies,
        'x-csrf-token': csrf.csrfToken
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain('New password is required.');

    await app.close();
  });

  test('unsafe redirect targets are rejected and http/https targets are accepted', async () => {
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const { cookies } = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);

    const blockedTargets = ['javascript:alert(1)', 'data:text/html,evil', 'ftp://example.com', 'localhost', 'http://localhost:8080'];

    for (const targetUrl of blockedTargets) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/links',
        payload: { targetUrl, slug: `slug${Math.random().toString(16).slice(2, 8)}` },
        headers: {
          cookie: cookies,
          'x-csrf-token': csrf.csrfToken
        }
      });
      expect(response.statusCode).toBe(400);
    }

    const httpAllowed = await app.inject({
      method: 'POST',
      url: '/api/links',
      payload: { targetUrl: 'http://example.com', slug: 'http001' },
      headers: {
        cookie: cookies,
        'x-csrf-token': csrf.csrfToken
      }
    });
    expect(httpAllowed.statusCode).toBe(200);

    const httpsAllowed = await app.inject({
      method: 'POST',
      url: '/api/links',
      payload: { targetUrl: 'https://example.com', slug: 'https01' },
      headers: {
        cookie: cookies,
        'x-csrf-token': csrf.csrfToken
      }
    });
    expect(httpsAllowed.statusCode).toBe(200);

    await app.close();
  });

  test('analytics remains async, does not store raw IP by default, and analytics endpoints require auth', async () => {
    const analyticsRecordSpy = vi.spyOn((await import('./repositories/analytics-repository.js')).AnalyticsRepository.prototype, 'record');
    analyticsRecordSpy.mockImplementationOnce(() => {
      throw new Error('analytics insert failed');
    });

    const { logger } = await import('./logger.js');
    const loggerErrorSpy = vi.spyOn(logger, 'error');
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const { cookies } = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);

    const created = await app.inject({
      method: 'POST',
      url: '/api/links',
      payload: { targetUrl: 'https://example.com', slug: 'analyt1' },
      headers: {
        cookie: cookies,
        'x-csrf-token': csrf.csrfToken
      }
    });
    const link = created.json();

    const redirect = await app.inject({
      method: 'GET',
      url: '/analyt1',
      remoteAddress: '203.0.113.7'
    });
    expect(redirect.statusCode).toBe(302);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(loggerErrorSpy).toHaveBeenCalled();

    const recordedRedirect = await app.inject({
      method: 'GET',
      url: '/analyt1',
      remoteAddress: '203.0.113.7',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
        referer: 'https://school.example/lesson',
        'accept-language': 'lv-LV,lv;q=0.9'
      }
    });
    expect(recordedRedirect.statusCode).toBe(302);
    await new Promise((resolve) => setImmediate(resolve));

    const { getDb } = await import('./db.js');
    const db = getDb();
    const rawIp = db.prepare('SELECT raw_ip as rawIp FROM analytics_events WHERE link_id = ? LIMIT 1').get(link.id) as { rawIp: string | null } | undefined;
    expect(rawIp?.rawIp ?? null).toBeNull();

    const analyticsAuth = await app.inject({ method: 'GET', url: `/api/links/${link.id}/analytics?range=day&limit=10` });
    expect(analyticsAuth.statusCode).toBe(401);

    const analyticsResponse = await app.inject({
      method: 'GET',
      url: `/api/links/${link.id}/analytics?range=day&limit=10`,
      headers: { cookie: cookies }
    });
    expect(analyticsResponse.statusCode).toBe(200);
    const analytics = analyticsResponse.json();
    expect(analytics.breakdowns.devices).toContainEqual({ label: 'desktop', value: 1 });
    expect(analytics.breakdowns.browsers).toContainEqual({ label: 'Chrome', value: 1 });
    expect(analytics.breakdowns.operatingSystems).toContainEqual({ label: 'Windows', value: 1 });
    expect(analytics.breakdowns.languages).toContainEqual({ label: 'lv-LV', value: 1 });
    expect(analytics.recentClicks[0]).toMatchObject({ browser: 'Chrome 128.0.0.0', os: 'Windows', device: 'desktop', referrer: 'school.example' });

    await app.close();
  });

  test('old analytics rows are deleted by retention cleanup', async () => {
    const { buildApp } = await import('./app.js');
    const { LinkService } = await import('./services/link-service.js');
    const { getDb } = await import('./db.js');
    const { createId, nowIso } = await import('./utils.js');
    const app = await buildApp();
    const db = getDb();
    const admin = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@example.com') as { id: string };
    const linkId = createId();
    db.prepare(
      `INSERT INTO links (id, user_id, slug, target_url, password_hash, enabled, created_at, updated_at, expires_at, click_count)
       VALUES (?, ?, ?, ?, NULL, 1, ?, ?, NULL, 0)`
    ).run(linkId, admin.id, 'cleanup1', 'https://example.com', nowIso(), nowIso());
    db.prepare(
      `INSERT INTO analytics_events (
        id, link_id, slug, timestamp, browser, os, device_type, referrer, country, region, city, language, traffic_type, auth_outcome, visitor_hash, raw_ip
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      createId(),
      linkId,
      'cleanup1',
      new Date(Date.now() - 200 * 24 * 3_600_000).toISOString(),
      'Chrome',
      'Windows',
      'desktop',
      'Direct',
      'Unknown',
      'Unknown',
      null,
      'en-US',
      'human',
      'success',
      'hash',
      null
    );

    const removed = new LinkService().cleanupAnalytics();
    expect(removed).toBeGreaterThan(0);
    await app.close();
  });

  test('failed login and protected link failures do not log passwords or tokens', async () => {
    const { logger, redactedLogPaths } = await import('./logger.js');
    const warnSpy = vi.spyOn(logger, 'warn');
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);

    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@example.com', password: 'super-secret-password' },
      headers: {
        cookie: csrf.csrfCookies,
        'x-csrf-token': csrf.csrfToken
      }
    });

    const { cookies } = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);
    await app.inject({
      method: 'POST',
      url: '/api/links',
      payload: { targetUrl: 'https://example.com', slug: 'pass001', password: 'right-password' },
      headers: {
        cookie: cookies,
        'x-csrf-token': csrf.csrfToken
      }
    });

    await app.inject({
      method: 'POST',
      url: '/access/pass001',
      payload: { password: 'wrong-password' }
    });

    const loggedPayload = JSON.stringify(warnSpy.mock.calls);
    expect(loggedPayload).not.toContain('super-secret-password');
    expect(loggedPayload).not.toContain('wrong-password');
    expect(redactedLogPaths).toContain('sessionId');
    expect(redactedLogPaths).toContain('csrfToken');

    await app.close();
  });

  test('bootstrap admin is created once and only reset when RESET_ADMIN_ON_START=true', async () => {
    let appModule = await import('./app.js');
    let app = await appModule.buildApp();
    await app.close();

    setBaseEnv(testDbPath, {
      ADMIN_PASSWORD: 'new-password',
      RESET_ADMIN_ON_START: 'false'
    });
    vi.resetModules();
    appModule = await import('./app.js');
    app = await appModule.buildApp();

    let csrf = await getCsrfBundle(app);
    let loginOld = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);
    expect(loginOld.response.statusCode).toBe(200);
    let loginNew = await login(app, 'admin@example.com', 'new-password', csrf);
    expect(loginNew.response.statusCode).toBe(401);
    await app.close();

    setBaseEnv(testDbPath, {
      ADMIN_PASSWORD: 'new-password',
      RESET_ADMIN_ON_START: 'true'
    });
    vi.resetModules();
    appModule = await import('./app.js');
    app = await appModule.buildApp();
    csrf = await getCsrfBundle(app);
    loginOld = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);
    loginNew = await login(app, 'admin@example.com', 'new-password', csrf);
    expect(loginOld.response.statusCode).toBe(401);
    expect(loginNew.response.statusCode).toBe(200);

    await app.close();
  });

  test('RESET_ADMIN consolidates existing users into a single bootstrap account', async () => {
    let appModule = await import('./app.js');
    let app = await appModule.buildApp();
    await app.close();

    await seedUser('legacy@example.com', 'legacy-password', 'Legacy User');

    setBaseEnv(testDbPath, {
      ADMIN_EMAIL: 'single@example.com',
      ADMIN_PASSWORD: 'single-password',
      ADMIN_NAME: 'Single Admin',
      RESET_ADMIN: 'true'
    });
    vi.resetModules();

    appModule = await import('./app.js');
    app = await appModule.buildApp();

    const { getDb } = await import('./db.js');
    const db = getDb();
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    expect(userCount.count).toBe(1);

    const onlyUser = db
      .prepare('SELECT email, name, is_bootstrap_admin as isBootstrapAdmin FROM users LIMIT 1')
      .get() as { email: string; name: string; isBootstrapAdmin: number };
    expect(onlyUser.email).toBe('single@example.com');
    expect(onlyUser.name).toBe('Single Admin');
    expect(onlyUser.isBootstrapAdmin).toBe(1);

    const csrf = await getCsrfBundle(app);
    const singleLogin = await login(app, 'single@example.com', 'single-password', csrf);
    expect(singleLogin.response.statusCode).toBe(200);

    const oldAdminLogin = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);
    expect(oldAdminLogin.response.statusCode).toBe(401);

    const legacyLogin = await login(app, 'legacy@example.com', 'legacy-password', csrf);
    expect(legacyLogin.response.statusCode).toBe(401);

    await app.close();
  });

  test('logout works, session expiry is enforced, and password change invalidates other sessions', async () => {
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrfA = await getCsrfBundle(app);
    const csrfB = await getCsrfBundle(app);
    const sessionA = await login(app, 'admin@example.com', 'test-admin-password-42', csrfA);
    const sessionB = await login(app, 'admin@example.com', 'test-admin-password-42', csrfB);

    const passwordChange = await app.inject({
      method: 'POST',
      url: '/api/settings/password',
      payload: { password: 'brand-new-password' },
      headers: {
        cookie: sessionB.cookies,
        'x-csrf-token': csrfB.csrfToken
      }
    });
    expect(passwordChange.statusCode).toBe(200);

    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: sessionA.cookies } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: sessionB.cookies } })).statusCode).toBe(200);

    const csrfC = await getCsrfBundle(app);
    const sessionC = await login(app, 'admin@example.com', 'brand-new-password', csrfC);
    expect(sessionC.response.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: sessionC.cookies } })).statusCode).toBe(200);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie: sessionC.cookies,
        'x-csrf-token': csrfC.csrfToken
      }
    });
    expect(logout.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: sessionC.cookies } })).statusCode).toBe(401);

    const csrfD = await getCsrfBundle(app);
    const sessionD = await login(app, 'admin@example.com', 'brand-new-password', csrfD);
    expect(sessionD.response.statusCode).toBe(200);

    const { getDb } = await import('./db.js');
    getDb().prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(
      new Date(Date.now() - 60_000).toISOString(),
      getCookieValue(sessionD.cookies, process.env.SESSION_COOKIE_NAME ?? 'shortswitch_session')
    );

    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: sessionD.cookies } })).statusCode).toBe(401);

    await app.close();
  });

  test('Live word cloud enforces global slugs, participant limits, filtering, editing and publication', async () => {
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const admin = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);
    const adminHeaders = { cookie: admin.cookies, 'x-csrf-token': csrf.csrfToken };

    const generated = await app.inject({
      method: 'POST', url: '/api/live', headers: adminHeaders,
      payload: {
        title: 'Generated Live', question: 'Does the random URL work?', type: 'open_answer',
        slug: '', status: 'active', identityMode: 'anonymous', allowMultipleResponses: false,
        maxResponsesPerParticipant: 1, moderationMode: 'off', maxAnswerLength: 100,
        publicResults: false
      }
    });
    expect(generated.statusCode).toBe(200);
    const generatedActivity = generated.json();
    expect(generatedActivity.slug).toMatch(/^[A-Za-z0-9]{6}$/);
    expect(generatedActivity.publicUrl).toBe(`http://localhost:3000/${generatedActivity.slug}`);

    expect((await app.inject({
      method: 'POST', url: `/api/live/public/${generatedActivity.slug}/responses`,
      payload: { participantToken: 'participant_generated_01', text: 'Yes' }
    })).statusCode).toBe(201);
    const participantView = await app.inject({ method: 'GET', url: `/api/live/public/${generatedActivity.slug}` });
    expect(participantView.statusCode).toBe(200);
    expect(participantView.json().results).toBeNull();
    expect((await app.inject({ method: 'GET', url: `/api/live/public/${generatedActivity.slug}/results` })).statusCode).toBe(400);
    const presentationView = await app.inject({ method: 'GET', url: `/api/live/public/${generatedActivity.slug}/presentation` });
    expect(presentationView.statusCode).toBe(200);
    expect(presentationView.json().results.responseCount).toBe(1);
    const clearedGenerated = await app.inject({
      method: 'POST', url: `/api/live/${generatedActivity.id}/analytics/clear`, headers: adminHeaders, payload: {}
    });
    expect(clearedGenerated.statusCode).toBe(200);
    expect(clearedGenerated.json().activity.responseCount).toBe(0);
    expect((await app.inject({ method: 'GET', url: `/api/live/public/${generatedActivity.slug}/presentation` })).json().results.responseCount).toBe(0);

    const expiring = await app.inject({
      method: 'POST', url: '/api/live', headers: adminHeaders,
      payload: {
        title: 'Expiring Live', question: 'Will this expire?', type: 'open_answer', slug: 'expiring-live',
        status: 'active', identityMode: 'anonymous', allowMultipleResponses: false,
        maxResponsesPerParticipant: 1, moderationMode: 'off', maxAnswerLength: 100,
        publicResults: true, expirationValue: 1, expirationUnit: 'minutes'
      }
    });
    expect(expiring.statusCode).toBe(200);
    expect(new Date(expiring.json().expiresAt).getTime()).toBeGreaterThan(Date.now());
    const expiringActivity = expiring.json();
    const expiringUpdate = await app.inject({
      method: 'PATCH', url: `/api/live/${expiringActivity.id}`, headers: adminHeaders,
      payload: {
        title: 'Expiring Live updated', question: 'Will this expire?', type: 'open_answer', slug: 'expiring-live',
        status: 'active', identityMode: 'anonymous', allowMultipleResponses: false,
        maxResponsesPerParticipant: 1, moderationMode: 'off', maxAnswerLength: 100,
        publicResults: true
      }
    });
    expect(expiringUpdate.json().expiresAt).toBe(expiringActivity.expiresAt);
    const { getDb } = await import('./db.js');
    getDb().prepare('UPDATE live_activities SET expires_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), expiringActivity.id);
    expect((await app.inject({ method: 'GET', url: '/expiring-live' })).statusCode).toBe(410);
    expect((await app.inject({ method: 'GET', url: '/present/expiring-live' })).statusCode).toBe(410);
    expect((await app.inject({ method: 'GET', url: '/api/live/public/expiring-live' })).statusCode).toBe(410);
    expect((await app.inject({ method: 'GET', url: '/api/live/public/expiring-live/results' })).statusCode).toBe(410);
    expect((await app.inject({
      method: 'POST', url: '/api/live/public/expiring-live/responses',
      payload: { participantToken: 'participant_expired_01', text: 'Too late' }
    })).statusCode).toBe(410);
    const reopened = await app.inject({
      method: 'POST', url: `/api/live/${expiringActivity.id}/status`, headers: adminHeaders,
      payload: { status: 'active', clearExpirationOnReopen: true }
    });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json().expiresAt).toBeNull();
    expect((await app.inject({ method: 'GET', url: '/api/live/public/expiring-live' })).statusCode).toBe(200);

    const rule = await app.inject({
      method: 'POST',
      url: '/api/moderation/rules',
      headers: adminHeaders,
      payload: { pattern: '67', matchMode: 'contains' }
    });
    expect(rule.statusCode).toBe(200);

    const namedChoice = await app.inject({
      method: 'POST', url: '/api/live', headers: adminHeaders,
      payload: {
        title: 'Named choice', question: 'Choose one', type: 'multiple_choice', slug: 'named-choice',
        status: 'active', identityMode: 'named', allowMultipleResponses: false,
        maxResponsesPerParticipant: 1, moderationMode: 'filter_only', maxAnswerLength: 280,
        allowMultipleChoices: false, options: ['One', 'Two'], publicResults: true
      }
    });
    expect(namedChoice.statusCode).toBe(200);
    const nameFiltered = await app.inject({
      method: 'POST', url: '/api/live/public/named-choice/responses',
      payload: {
        participantToken: 'participant_bad_name_01', participantName: 'Gazan67',
        optionIds: [namedChoice.json().options[0].id]
      }
    });
    expect(nameFiltered.statusCode).toBe(201);
    expect(nameFiltered.json().status).toBe('pending');
    const namedChoiceDetails = await app.inject({
      method: 'GET', url: `/api/live/${namedChoice.json().id}`, headers: { cookie: admin.cookies }
    });
    const nameFilteredResponse = namedChoiceDetails.json().responses[0];
    expect(nameFilteredResponse.moderationReason).toContain('Participant name matched ban rule');
    expect(nameFilteredResponse.originalParticipantName).toBe('Gazan67');
    expect((await app.inject({
      method: 'PATCH', url: `/api/live/${namedChoice.json().id}/responses/${nameFilteredResponse.id}`,
      headers: adminHeaders,
      payload: { status: 'approved', participantName: 'Gazan67' }
    })).statusCode).toBe(400);
    const renamedResponse = await app.inject({
      method: 'PATCH', url: `/api/live/${namedChoice.json().id}/responses/${nameFilteredResponse.id}`,
      headers: adminHeaders,
      payload: { status: 'approved', participantName: 'Gazan' }
    });
    expect(renamedResponse.statusCode).toBe(200);
    expect(renamedResponse.json().originalParticipantName).toBe('Gazan67');
    expect(renamedResponse.json().participantName).toBe('Gazan');
    expect(renamedResponse.json().nameEditedByModerator).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/live/public/named-choice/results' })).json().responseCount).toBe(1);

    const created = await app.inject({
      method: 'POST',
      url: '/api/live',
      headers: adminHeaders,
      payload: {
        title: '9.a Refleksija',
        question: 'Kas tev šodien bija visgrūtākais?',
        type: 'word_cloud',
        slug: '9a-refleksija',
        status: 'active',
        identityMode: 'named',
        allowMultipleResponses: true,
        maxResponsesPerParticipant: 2,
        moderationMode: 'filter_only',
        maxAnswerLength: 80,
        publicResults: true
      }
    });
    expect(created.statusCode).toBe(200);
    const activity = created.json();

    const editedActivity = await app.inject({
      method: 'PATCH',
      url: `/api/live/${activity.id}`,
      headers: adminHeaders,
      payload: {
        title: '9.a Refleksija — updated',
        question: 'Kas tev šodien bija visgrūtākais?',
        type: 'word_cloud',
        slug: '9a-refleksija',
        status: 'active',
        identityMode: 'named',
        allowMultipleResponses: true,
        maxResponsesPerParticipant: 2,
        moderationMode: 'filter_only',
        maxAnswerLength: 80,
        publicResults: true
      }
    });
    expect(editedActivity.statusCode).toBe(200);
    expect(editedActivity.json().title).toBe('9.a Refleksija — updated');

    const conflictingLink = await app.inject({
      method: 'POST',
      url: '/api/links',
      headers: adminHeaders,
      payload: { targetUrl: 'https://example.com', slug: '9a-refleksija' }
    });
    expect(conflictingLink.statusCode).toBe(400);

    const participantToken = 'participant_token_000001';
    const approved = await app.inject({
      method: 'POST',
      url: '/api/live/public/9a-refleksija/responses',
      payload: { participantToken, participantName: 'Anna', text: 'Maršrutēšana' }
    });
    expect(approved.statusCode).toBe(201);
    expect(approved.json().status).toBe('approved');

    const pending = await app.inject({
      method: 'POST',
      url: '/api/live/public/9a-refleksija/responses',
      payload: { participantToken, participantName: 'Anna', text: 'Gazan67' }
    });
    expect(pending.statusCode).toBe(201);
    expect(pending.json().status).toBe('pending');
    const liveList = await app.inject({ method: 'GET', url: '/api/live', headers: { cookie: admin.cookies } });
    const listedActivity = liveList.json().find((item: any) => item.id === activity.id);
    expect(listedActivity.identityMode).toBe('named');
    expect(listedActivity.pendingCount).toBe(1);

    const overLimit = await app.inject({
      method: 'POST',
      url: '/api/live/public/9a-refleksija/responses',
      payload: { participantToken, participantName: 'Anna', text: 'Trešā atbilde' }
    });
    expect(overLimit.statusCode).toBe(409);

    const publicBefore = await app.inject({ method: 'GET', url: '/api/live/public/9a-refleksija/results' });
    expect(publicBefore.statusCode).toBe(200);
    expect(publicBefore.json().wordCloud).toEqual([{ text: 'Maršrutēšana', count: 1 }]);

    const details = await app.inject({ method: 'GET', url: `/api/live/${activity.id}`, headers: { cookie: admin.cookies } });
    const pendingResponse = details.json().responses.find((response: any) => response.status === 'pending');
    expect(pendingResponse.originalText).toBe('Gazan67');

    const unsafeApproval = await app.inject({
      method: 'PATCH',
      url: `/api/live/${activity.id}/responses/${pendingResponse.id}`,
      headers: adminHeaders,
      payload: { status: 'approved', publishedText: 'Gazan67' }
    });
    expect(unsafeApproval.statusCode).toBe(400);

    const moderated = await app.inject({
      method: 'PATCH',
      url: `/api/live/${activity.id}/responses/${pendingResponse.id}`,
      headers: adminHeaders,
      payload: { status: 'approved', publishedText: 'Gazan' }
    });
    expect(moderated.statusCode).toBe(200);
    expect(moderated.json().originalText).toBe('Gazan67');
    expect(moderated.json().publishedText).toBe('Gazan');
    expect(moderated.json().editedByModerator).toBe(true);

    const publicAfter = await app.inject({ method: 'GET', url: '/api/live/public/9a-refleksija/results' });
    expect(publicAfter.json().wordCloud).toEqual([
      { text: 'Gazan', count: 1 },
      { text: 'Maršrutēšana', count: 1 }
    ]);

    const hidden = await app.inject({
      method: 'PATCH',
      url: `/api/live/${activity.id}/responses/${pendingResponse.id}`,
      headers: adminHeaders,
      payload: { status: 'rejected', publishedText: 'Gazan' }
    });
    expect(hidden.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/live/public/9a-refleksija/results' })).json().wordCloud)
      .toEqual([{ text: 'Maršrutēšana', count: 1 }]);
    expect((await app.inject({
      method: 'PATCH',
      url: `/api/live/${activity.id}/responses/${pendingResponse.id}`,
      headers: adminHeaders,
      payload: { status: 'approved', publishedText: 'Gazan' }
    })).statusCode).toBe(200);

    const closed = await app.inject({
      method: 'POST', url: `/api/live/${activity.id}/status`, headers: adminHeaders, payload: { status: 'closed' }
    });
    expect(closed.statusCode).toBe(200);
    expect((await app.inject({
      method: 'POST', url: '/api/live/public/9a-refleksija/responses',
      payload: { participantToken: 'participant_after_close', participantName: 'Jānis', text: 'Late' }
    })).statusCode).toBe(409);

    await app.close();
  });

  test('Live response limits are atomic and choice/scale results count submissions correctly', async () => {
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const admin = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);
    const adminHeaders = { cookie: admin.cookies, 'x-csrf-token': csrf.csrfToken };
    const base = {
      status: 'active',
      identityMode: 'anonymous',
      allowMultipleResponses: false,
      maxResponsesPerParticipant: 1,
      moderationMode: 'off',
      maxAnswerLength: 280,
      publicResults: true
    };
    const choiceCreate = await app.inject({
      method: 'POST', url: '/api/live', headers: adminHeaders,
      payload: {
        ...base,
        title: 'Network choice', question: 'Select protocols', type: 'multiple_choice', slug: 'protocols',
        allowMultipleChoices: true, options: ['HTTP', 'DNS', 'SSH']
      }
    });
    const choice = choiceCreate.json();
    const token = 'participant_token_atomic1';
    const payload = {
      participantToken: token,
      optionIds: [choice.options[0].id, choice.options[1].id]
    };
    const concurrent = await Promise.all([
      app.inject({ method: 'POST', url: '/api/live/public/protocols/responses', payload }),
      app.inject({ method: 'POST', url: '/api/live/public/protocols/responses', payload })
    ]);
    expect(concurrent.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    const choiceResults = (await app.inject({ method: 'GET', url: '/api/live/public/protocols/results' })).json();
    expect(choiceResults.responseCount).toBe(1);
    expect(choiceResults.choices.slice(0, 2).map((item: any) => [item.count, item.percentage])).toEqual([[1, 100], [1, 100]]);

    const originalOptionIds = choice.options.map((option: any) => option.id);
    const previewDisabled = await app.inject({
      method: 'PATCH', url: `/api/live/${choice.id}`, headers: adminHeaders,
      payload: {
        ...base,
        title: 'Network choice', question: 'Select protocols', type: 'multiple_choice', slug: 'protocols',
        allowMultipleChoices: true, options: ['HTTP', 'DNS', 'SSH'], publicResults: false
      }
    });
    expect(previewDisabled.statusCode).toBe(200);
    expect(previewDisabled.json().options.map((option: any) => option.id)).toEqual(originalOptionIds);
    expect((await app.inject({ method: 'GET', url: '/api/live/public/protocols/results' })).statusCode).toBe(400);
    const adminChoiceDetails = await app.inject({
      method: 'GET', url: `/api/live/${choice.id}`, headers: { cookie: admin.cookies }
    });
    expect(adminChoiceDetails.json().responses[0].selectedOptionIds).toEqual(originalOptionIds.slice(0, 2));
    expect(adminChoiceDetails.json().results.choices.slice(0, 2).map((item: any) => item.count)).toEqual([1, 1]);

    const previewEnabled = await app.inject({
      method: 'PATCH', url: `/api/live/${choice.id}`, headers: adminHeaders,
      payload: {
        ...base,
        title: 'Network choice', question: 'Select protocols', type: 'multiple_choice', slug: 'protocols',
        allowMultipleChoices: true, options: ['HTTP', 'DNS', 'SSH'], publicResults: true
      }
    });
    expect(previewEnabled.statusCode).toBe(200);
    expect(previewEnabled.json().options.map((option: any) => option.id)).toEqual(originalOptionIds);
    const restoredChoiceResults = (await app.inject({ method: 'GET', url: '/api/live/public/protocols/results' })).json();
    expect(restoredChoiceResults.choices.slice(0, 2).map((item: any) => [item.count, item.percentage]))
      .toEqual([[1, 100], [1, 100]]);

    const scaleCreate = await app.inject({
      method: 'POST', url: '/api/live', headers: adminHeaders,
      payload: { ...base, title: 'Scale', question: 'How hard?', type: 'scale', slug: 'hardness', scaleMin: 1, scaleMax: 5 }
    });
    expect(scaleCreate.statusCode).toBe(200);
    for (const [index, value] of [2, 4].entries()) {
      const response = await app.inject({
        method: 'POST', url: '/api/live/public/hardness/responses',
        payload: { participantToken: index === 0 ? token : `participant_scale_${index}000`, scaleValue: value }
      });
      expect(response.statusCode).toBe(201);
    }
    const scaleResults = (await app.inject({ method: 'GET', url: '/api/live/public/hardness/results' })).json();
    expect(scaleResults.scale.average).toBe(3);

    await app.inject({ method: 'DELETE', url: `/api/live/${choice.id}`, headers: adminHeaders });
    const reusedSlug = await app.inject({
      method: 'POST', url: '/api/links', headers: adminHeaders,
      payload: { targetUrl: 'https://example.com', slug: 'protocols' }
    });
    expect(reusedSlug.statusCode).toBe(200);
    await app.close();
  });

  test('Live admin routes require auth/CSRF and moderation supports whole-word and review-all modes', async () => {
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    expect((await app.inject({ method: 'GET', url: '/api/live' })).statusCode).toBe(401);

    const csrf = await getCsrfBundle(app);
    const admin = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);
    expect((await app.inject({
      method: 'POST',
      url: '/api/live',
      headers: { cookie: admin.cookies },
      payload: {}
    })).statusCode).toBe(403);
    const adminHeaders = { cookie: admin.cookies, 'x-csrf-token': csrf.csrfToken };

    const rule = await app.inject({
      method: 'POST',
      url: '/api/moderation/rules',
      headers: adminHeaders,
      payload: { pattern: 'ļauns vārds', matchMode: 'whole_word' }
    });
    expect(rule.statusCode).toBe(200);

    const base = {
      type: 'open_answer',
      status: 'active',
      identityMode: 'anonymous',
      allowMultipleResponses: true,
      maxResponsesPerParticipant: 5,
      maxAnswerLength: 280,
      publicResults: true
    };
    expect((await app.inject({
      method: 'POST', url: '/api/live', headers: adminHeaders,
      payload: {
        ...base, title: 'Whole word', question: 'Say something', slug: 'whole-filter', moderationMode: 'filter_only'
      }
    })).statusCode).toBe(200);

    const participantToken = 'participant_whole_word_01';
    const embedded = await app.inject({
      method: 'POST', url: '/api/live/public/whole-filter/responses',
      payload: { participantToken, text: 'priekšļauns vārdsx' }
    });
    expect(embedded.statusCode).toBe(201);
    expect(embedded.json().status).toBe('approved');
    const matched = await app.inject({
      method: 'POST', url: '/api/live/public/whole-filter/responses',
      payload: { participantToken, text: 'Tas ir ĻAUNS    VĀRDS!' }
    });
    expect(matched.statusCode).toBe(201);
    expect(matched.json().status).toBe('pending');
    const publicFilterResults = (await app.inject({ method: 'GET', url: '/api/live/public/whole-filter/results' })).json();
    expect(publicFilterResults.responseCount).toBe(1);
    expect(JSON.stringify(publicFilterResults)).not.toContain('ĻAUNS');

    const updatedRule = await app.inject({
      method: 'PATCH', url: `/api/moderation/rules/${rule.json().id}`, headers: adminHeaders,
      payload: { pattern: 'jauns', matchMode: 'whole_word' }
    });
    expect(updatedRule.statusCode).toBe(200);
    const oldPatternAfterUpdate = await app.inject({
      method: 'POST', url: '/api/live/public/whole-filter/responses',
      payload: { participantToken, text: 'ļauns vārds' }
    });
    expect(oldPatternAfterUpdate.json().status).toBe('approved');
    const newPatternAfterUpdate = await app.inject({
      method: 'POST', url: '/api/live/public/whole-filter/responses',
      payload: { participantToken, text: 'JAUNS' }
    });
    expect(newPatternAfterUpdate.json().status).toBe('pending');

    expect((await app.inject({
      method: 'POST', url: '/api/live', headers: adminHeaders,
      payload: {
        ...base, title: 'Review all', question: 'Review me', slug: 'review-everything', moderationMode: 'review_all'
      }
    })).statusCode).toBe(200);
    const reviewAll = await app.inject({
      method: 'POST', url: '/api/live/public/review-everything/responses',
      payload: { participantToken: 'participant_review_all1', text: 'Ordinary answer' }
    });
    expect(reviewAll.statusCode).toBe(201);
    expect(reviewAll.json().status).toBe('pending');
    expect((await app.inject({ method: 'GET', url: '/api/live/public/review-everything/results' })).json().responseCount).toBe(0);

    await app.close();
  });

  test('Live public results are bounded, paginated and revisioned without limiting admin history', async () => {
    process.env.LIVE_SUBMIT_MAX_REQUESTS = '1000';
    vi.resetModules();
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const admin = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);
    const adminHeaders = { cookie: admin.cookies, 'x-csrf-token': csrf.csrfToken };
    const base = {
      status: 'active', identityMode: 'anonymous', allowMultipleResponses: false,
      maxResponsesPerParticipant: 1, moderationMode: 'off', maxAnswerLength: 280, publicResults: true
    };

    const openActivityResponse = await app.inject({
      method: 'POST', url: '/api/live', headers: adminHeaders,
      payload: { ...base, title: 'Paged answers', question: 'Answer', type: 'open_answer', slug: 'paged-answers' }
    });
    expect(openActivityResponse.statusCode).toBe(200);
    const openActivity = openActivityResponse.json();
    for (let index = 0; index < 105; index += 1) {
      const response = await app.inject({
        method: 'POST', url: '/api/live/public/paged-answers/responses',
        payload: { participantToken: `paged_participant_${String(index).padStart(4, '0')}`, text: `Answer ${index}` }
      });
      expect(response.statusCode).toBe(201);
    }

    const publicResponse = await app.inject({ method: 'GET', url: '/api/live/public/paged-answers/results' });
    const publicResults = publicResponse.json();
    expect(publicResponse.headers['cache-control']).toBe('no-store');
    expect(publicResults.responseCount).toBe(105);
    expect(publicResults.openAnswers).toHaveLength(100);
    expect(publicResults.openAnswerTotal).toBe(105);
    expect(publicResults.openAnswerNextCursor).toEqual(expect.any(String));
    expect(publicResults.revision).toBe(105);
    const { getDb } = await import('./db.js');
    const queryPlan = getDb()
      .prepare(
        `EXPLAIN QUERY PLAN SELECT id FROM live_responses
         WHERE activity_id = ? AND moderation_status = 'approved'
         ORDER BY created_at DESC, id DESC LIMIT 100`
      )
      .all(openActivity.id) as Array<{ detail: string }>;
    expect(queryPlan.some((step) => step.detail.includes('idx_live_responses_public_page'))).toBe(true);

    const olderPage = await app.inject({
      method: 'GET',
      url: `/api/live/public/paged-answers/answers?limit=50&cursor=${encodeURIComponent(publicResults.openAnswerNextCursor)}`
    });
    expect(olderPage.statusCode).toBe(200);
    expect(olderPage.json().items).toHaveLength(5);
    expect(olderPage.json().nextCursor).toBeNull();
    expect(olderPage.json().total).toBe(105);

    const adminDetails = await app.inject({ method: 'GET', url: `/api/live/${openActivity.id}`, headers: { cookie: admin.cookies } });
    expect(adminDetails.json().responses).toHaveLength(105);
    expect(adminDetails.json().results.openAnswers).toHaveLength(105);

    const wordActivityResponse = await app.inject({
      method: 'POST', url: '/api/live', headers: adminHeaders,
      payload: { ...base, title: 'Bounded cloud', question: 'Phrase', type: 'word_cloud', slug: 'bounded-cloud' }
    });
    expect(wordActivityResponse.statusCode).toBe(200);
    for (let index = 0; index < 151; index += 1) {
      const response = await app.inject({
        method: 'POST', url: '/api/live/public/bounded-cloud/responses',
        payload: { participantToken: `cloud_participant_${String(index).padStart(4, '0')}`, text: `Phrase ${index}` }
      });
      expect(response.statusCode).toBe(201);
    }
    const wordResults = (await app.inject({ method: 'GET', url: '/api/live/public/bounded-cloud/results' })).json();
    expect(wordResults.wordCloud).toHaveLength(150);
    expect(wordResults.wordCloudTotal).toBe(151);
    const wordPage = (await app.inject({ method: 'GET', url: '/api/live/public/bounded-cloud/words?limit=100' })).json();
    expect(wordPage.items).toHaveLength(100);
    expect(wordPage.total).toBe(151);
    expect(wordPage.nextCursor).toEqual(expect.any(String));
    const searchedWords = (await app.inject({ method: 'GET', url: '/api/live/public/bounded-cloud/words?search=Phrase%20150' })).json();
    expect(searchedWords.items).toEqual([{ text: 'Phrase 150', count: 1 }]);

    await app.close();
  });

  test('Pages CRUD, shared slugs, public visibility, safe blocks and analytics work without affecting Links or Live', async () => {
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const admin = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);
    const adminHeaders = { cookie: admin.cookies, 'x-csrf-token': csrf.csrfToken };

    expect((await app.inject({ method: 'GET', url: '/api/pages' })).statusCode).toBe(401);
    const shortLinkResponse = await app.inject({
      method: 'POST', url: '/api/links', headers: adminHeaders,
      payload: { targetUrl: 'https://example.com/resource', slug: 'page-link' }
    });
    expect(shortLinkResponse.statusCode).toBe(200);
    const shortLink = shortLinkResponse.json();
    const liveResponse = await app.inject({
      method: 'POST', url: '/api/live', headers: adminHeaders,
      payload: {
        title: 'Page Live', question: 'Ready?', type: 'multiple_choice', slug: 'page-live', status: 'active',
        identityMode: 'anonymous', allowMultipleResponses: false, maxResponsesPerParticipant: 1,
        moderationMode: 'off', maxAnswerLength: 120, publicResults: true, options: ['Yes', 'No']
      }
    });
    expect(liveResponse.statusCode).toBe(200);
    const liveActivity = liveResponse.json();
    const pagePayload = {
      title: '<script>alert(1)</script> Datorika', slug: 'datorika-page', description: 'Useful resources', emoji: '💻',
      avatarUrl: 'https://images.example.com/avatar.png', theme: 'ocean_blue', layout: 'soft',
      backgroundPattern: 'waves', patternIntensity: 60, status: 'draft',
      seoTitle: 'Datorika resources', seoDescription: 'Learning links and activities',
      blocks: [
        { type: 'heading', visible: true, config: { text: 'Start here', alignment: 'left', size: 'large' } },
        { type: 'text', visible: true, config: { text: '<img src=x onerror=alert(1)> Plain text', alignment: 'left' } },
        { type: 'link', visible: true, config: { title: 'External', url: 'https://example.org/docs', openInNewTab: true } },
        { type: 'existing_link', visible: true, config: { title: 'Tracked short link', resourceId: shortLink.id } },
        { type: 'live_activity', visible: true, config: { title: 'Join activity', resourceId: liveActivity.id } },
        { type: 'email', visible: true, config: { label: 'Contact', email: 'teacher@example.com', style: 'button' } },
        { type: 'divider', visible: true, config: { style: 'dashed', spacing: 'medium' } },
        { type: 'spacer', visible: false, config: { spacing: 'small' } },
        { type: 'image', visible: true, config: { url: 'https://images.example.com/lesson.png', alt: 'Lesson', alignment: 'center' } },
        { type: 'double', visible: true, config: { children: [
          { id: 'nested-left', type: 'link', visible: true, config: { title: 'Nested docs', url: 'https://nested.example.com/docs', openInNewTab: true } },
          { id: 'nested-right', type: 'email', visible: true, config: { label: 'Nested email', email: 'nested@example.com', style: 'button' } }
        ] } }
      ]
    };
    const createdResponse = await app.inject({ method: 'POST', url: '/api/pages', headers: adminHeaders, payload: pagePayload });
    expect(createdResponse.statusCode).toBe(200);
    const created = createdResponse.json();
    expect(created.blocks).toHaveLength(10);
    expect(created.status).toBe('draft');
    expect(created).toMatchObject({ backgroundPattern: 'waves', patternIntensity: 60 });
    const { getDb } = await import('./db.js');
    const blockQueryPlan = getDb().prepare('EXPLAIN QUERY PLAN SELECT * FROM page_blocks WHERE page_id = ? ORDER BY position').all(created.id) as Array<{ detail: string }>;
    expect(blockQueryPlan.some((step) => step.detail.includes('idx_page_blocks_page_position'))).toBe(true);

    expect((await app.inject({ method: 'GET', url: '/datorika-page' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/pages/public/datorika-page' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/pages', headers: adminHeaders, payload: { ...pagePayload, slug: 'page-link' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/pages', headers: adminHeaders, payload: { ...pagePayload, slug: 'page-live' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/pages', headers: adminHeaders, payload: { ...pagePayload, slug: 'settings' } })).statusCode).toBe(400);
    const invalidUrl = structuredClone(pagePayload);
    invalidUrl.slug = 'invalid-page';
    invalidUrl.blocks[2].config.url = 'javascript:alert(1)';
    expect((await app.inject({ method: 'POST', url: '/api/pages', headers: adminHeaders, payload: invalidUrl })).statusCode).toBe(400);
    const invalidImage = structuredClone(pagePayload);
    invalidImage.slug = 'invalid-image';
    invalidImage.blocks[8].config.url = 'http://images.example.com/lesson.png';
    expect((await app.inject({ method: 'POST', url: '/api/pages', headers: adminHeaders, payload: invalidImage })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/pages', headers: adminHeaders, payload: { ...pagePayload, slug: 'invalid-theme', theme: 'unknown' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/pages', headers: adminHeaders, payload: { ...pagePayload, slug: 'invalid-pattern', backgroundPattern: 'noise' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/pages', headers: adminHeaders, payload: { ...pagePayload, slug: 'invalid-intensity', patternIntensity: 101 } })).statusCode).toBe(400);
    const duplicateBlocks = structuredClone(pagePayload);
    duplicateBlocks.slug = 'duplicate-blocks';
    (duplicateBlocks.blocks[1] as any).id = 'duplicate-block-id';
    (duplicateBlocks.blocks[2] as any).id = 'duplicate-block-id';
    expect((await app.inject({ method: 'POST', url: '/api/pages', headers: adminHeaders, payload: duplicateBlocks })).statusCode).toBe(400);
    const recursiveDouble = structuredClone(pagePayload);
    recursiveDouble.slug = 'recursive-double';
    recursiveDouble.blocks[9].config.children[0].type = 'double';
    expect((await app.inject({ method: 'POST', url: '/api/pages', headers: adminHeaders, payload: recursiveDouble })).statusCode).toBe(400);
    const incompleteDouble = structuredClone(pagePayload);
    incompleteDouble.slug = 'incomplete-double';
    incompleteDouble.blocks[9].config.children.pop();
    expect((await app.inject({ method: 'POST', url: '/api/pages', headers: adminHeaders, payload: incompleteDouble })).statusCode).toBe(400);

    const publishedResponse = await app.inject({
      method: 'POST', url: `/api/pages/${created.id}/status`, headers: adminHeaders, payload: { status: 'published' }
    });
    expect(publishedResponse.statusCode).toBe(200);
    const publicHtml = await app.inject({ method: 'GET', url: '/datorika-page', headers: { 'accept-encoding': 'br' } });
    expect(publicHtml.statusCode).toBe(200);
    expect(publicHtml.headers['cache-control']).toBe('no-cache');
    expect(publicHtml.headers['content-encoding']).toBe('br');
    const { brotliDecompressSync } = await import('node:zlib');
    const html = brotliDecompressSync(publicHtml.rawPayload).toString('utf8');
    expect(html).toContain('name="shortswitch-resource-type" content="page"');
    expect(html).toContain('<title>Datorika resources</title>');
    expect(html).toContain('rel="canonical" href="http://localhost:3000/datorika-page"');
    expect(html).not.toContain('<script>alert(1)</script> Datorika');

    const analyticsHeaders = {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
      referer: 'https://school.example/lesson',
      'accept-language': 'lv-LV,lv;q=0.9,en;q=0.8'
    };
    const publicResponse = await app.inject({ method: 'GET', url: '/api/pages/public/datorika-page', headers: analyticsHeaders });
    expect(publicResponse.statusCode).toBe(200);
    expect(publicResponse.headers['cache-control']).toBe('no-store');
    const publicPage = publicResponse.json();
    expect(publicPage).toMatchObject({ backgroundPattern: 'waves', patternIntensity: 60 });
    expect(publicPage.blocks).toHaveLength(9);
    expect(publicPage.status).toBeUndefined();
    expect(publicPage.seoTitle).toBeUndefined();
    expect(publicPage.blocks.find((block: any) => block.type === 'existing_link').href).toBe('http://localhost:3000/page-link');
    expect(publicPage.blocks.find((block: any) => block.type === 'live_activity').href).toBe('http://localhost:3000/page-live');
    const publicDouble = publicPage.blocks.find((block: any) => block.type === 'double');
    expect(publicDouble.config.children).toHaveLength(2);
    expect(publicDouble.config.children[0]).toMatchObject({ id: 'nested-left', type: 'link' });
    await new Promise((resolve) => setImmediate(resolve));

    const zeroClickAnalytics = (await app.inject({ method: 'GET', url: `/api/pages/${created.id}/analytics`, headers: { cookie: admin.cookies } })).json();
    expect(zeroClickAnalytics.blockClicks.map((block: any) => block.label)).toEqual(['External', 'Tracked short link', 'Join activity', 'Contact', 'Nested docs', 'Nested email']);
    expect(zeroClickAnalytics.blockClicks.every((block: any) => block.clicks === 0)).toBe(true);

    const clickedBlock = publicPage.blocks.find((block: any) => block.type === 'existing_link');
    for (let index = 0; index < 2; index += 1) {
      expect((await app.inject({
        method: 'POST', url: '/api/pages/public/datorika-page/clicks',
        payload: { blockId: clickedBlock.id, eventId: 'pageclick001' },
        headers: analyticsHeaders
      })).statusCode).toBe(202);
    }
    await new Promise((resolve) => setImmediate(resolve));
    const analytics = (await app.inject({ method: 'GET', url: `/api/pages/${created.id}/analytics`, headers: { cookie: admin.cookies } })).json();
    expect(analytics.totalViews).toBe(1);
    expect(analytics.uniqueVisitors).toBe(1);
    expect(analytics.totalLinkClicks).toBe(1);
    expect(analytics.blockClicks).toHaveLength(6);
    expect(analytics.blockClicks[0].clicks).toBe(1);
    expect(analytics.blockClicks[0]).toMatchObject({ label: 'Tracked short link', type: 'existing_link', url: 'http://localhost:3000/page-link' });
    expect(analytics.blockClicks.slice(1).map((block: any) => block.label)).toEqual(['External', 'Join activity', 'Contact', 'Nested docs', 'Nested email']);
    expect(analytics.blockClicks.slice(1).every((block: any) => block.clicks === 0)).toBe(true);
    expect(analytics.breakdowns.devices).toContainEqual({ label: 'desktop', value: 1 });
    expect(analytics.breakdowns.browsers).toContainEqual({ label: 'Chrome', value: 1 });
    expect(analytics.breakdowns.operatingSystems).toContainEqual({ label: 'Windows', value: 1 });
    expect(analytics.breakdowns.languages).toContainEqual({ label: 'lv-LV', value: 1 });
    expect(analytics.recentClicks).toHaveLength(1);
    expect(analytics.recentClicks[0]).toMatchObject({
      context: 'Tracked short link', browser: 'Chrome', os: 'Windows', device: 'desktop', referrer: 'school.example', language: 'lv-LV'
    });

    expect((await app.inject({ method: 'GET', url: '/api/live/public/page-live', headers: analyticsHeaders })).statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    const liveAnalyticsResponse = await app.inject({
      method: 'GET',
      url: `/api/live/${liveActivity.id}?range=day&limit=10&timezoneOffsetMinutes=180`,
      headers: { cookie: admin.cookies }
    });
    expect(liveAnalyticsResponse.statusCode).toBe(200);
    const liveAnalytics = liveAnalyticsResponse.json().analytics;
    expect(liveAnalytics.totalViews).toBe(1);
    expect(liveAnalytics.uniqueVisitors).toBe(1);
    expect(liveAnalytics.viewsOverTime).toHaveLength(24);
    expect(liveAnalytics.breakdowns.devices).toContainEqual({ label: 'desktop', value: 1 });
    expect(liveAnalytics.breakdowns.browsers).toContainEqual({ label: 'Chrome', value: 1 });
    expect(liveAnalytics.breakdowns.operatingSystems).toContainEqual({ label: 'Windows', value: 1 });
    expect(liveAnalytics.breakdowns.languages).toContainEqual({ label: 'lv-LV', value: 1 });
    expect(liveAnalytics.recentViews).toHaveLength(1);
    expect(liveAnalytics.recentViews[0]).toMatchObject({ browser: 'Chrome', os: 'Windows', device: 'desktop', referrer: 'school.example', language: 'lv-LV' });
    const globalAnalyticsResponse = await app.inject({
      method: 'GET',
      url: '/api/analytics/global?range=day&timezoneOffsetMinutes=180',
      headers: { cookie: admin.cookies }
    });
    expect(globalAnalyticsResponse.statusCode).toBe(200);
    const globalAnalytics = globalAnalyticsResponse.json();
    expect(globalAnalytics.totals).toEqual({ clicks: 1, views: 2, uniqueVisitors: 1, devices: 1 });
    expect(globalAnalytics.activityOverTime).toHaveLength(24);
    expect(globalAnalytics.activityOverTime.reduce((sum: number, point: any) => sum + point.clicks, 0)).toBe(1);
    expect(globalAnalytics.activityOverTime.reduce((sum: number, point: any) => sum + point.views, 0)).toBe(2);
    const activityOverTimeResponse = await app.inject({
      method: 'GET',
      url: '/api/analytics/global/activity-over-time?range=day&timezoneOffsetMinutes=180',
      headers: { cookie: admin.cookies }
    });
    expect(activityOverTimeResponse.statusCode).toBe(200);
    expect(activityOverTimeResponse.json()).toEqual(globalAnalytics.activityOverTime);
    expect(globalAnalytics.modules).toEqual([
      { module: 'links', clicks: 0, views: 0, uniqueVisitors: 0 },
      { module: 'pages', clicks: 1, views: 1, uniqueVisitors: 1 },
      { module: 'live', clicks: 0, views: 1, uniqueVisitors: 1 }
    ]);
    expect(globalAnalytics.activityByTime.reduce((sum: number, point: any) => sum + point.clicks, 0)).toBe(1);
    expect(globalAnalytics.activityByTime.reduce((sum: number, point: any) => sum + point.views, 0)).toBe(2);
    expect(globalAnalytics.topReferrers.all[0]).toEqual({ label: 'school.example', value: 2 });
    expect(globalAnalytics.referrerTotals).toEqual({ all: 2, links: 0, pages: 1, live: 1 });
    expect(globalAnalytics.topSlugs.all).toEqual(expect.arrayContaining([
      { slug: 'datorika-page', module: 'pages', value: 1 },
      { slug: 'page-live', module: 'live', value: 1 }
    ]));
    expect(globalAnalytics.breakdowns.devices).toContainEqual({ label: 'desktop', value: 2 });
    expect(globalAnalytics.breakdowns.browsers).toContainEqual({ label: 'Chrome', value: 2 });
    expect(globalAnalytics.breakdowns.operatingSystems).toContainEqual({ label: 'Windows', value: 2 });
    expect(globalAnalytics.breakdowns.languages).toContainEqual({ label: 'lv-LV', value: 2 });

    const dailyAnalytics = (await app.inject({ method: 'GET', url: `/api/pages/${created.id}/analytics?range=day&timezoneOffsetMinutes=180`, headers: { cookie: admin.cookies } })).json();
    const weeklyAnalytics = (await app.inject({ method: 'GET', url: `/api/pages/${created.id}/analytics?range=week&timezoneOffsetMinutes=180`, headers: { cookie: admin.cookies } })).json();
    const monthlyAnalytics = (await app.inject({ method: 'GET', url: `/api/pages/${created.id}/analytics?range=month&timezoneOffsetMinutes=180`, headers: { cookie: admin.cookies } })).json();
    expect(dailyAnalytics.viewsOverTime).toHaveLength(24);
    expect(weeklyAnalytics.viewsOverTime.map((point: any) => point.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(monthlyAnalytics.viewsOverTime).toHaveLength(30);
    const clearedPageAnalytics = await app.inject({
      method: 'POST', url: `/api/pages/${created.id}/analytics/clear`, headers: adminHeaders, payload: {}
    });
    expect(clearedPageAnalytics.statusCode).toBe(200);
    expect(clearedPageAnalytics.json().page.totalViews).toBe(0);
    expect((await app.inject({ method: 'GET', url: `/api/pages/${created.id}/analytics`, headers: { cookie: admin.cookies } })).json().totalLinkClicks).toBe(0);

    const reorderedBlocks = [...created.blocks].reverse().map((block: any, index: number) => ({
      id: block.id, type: block.type, config: block.config, visible: index !== 0
    }));
    const updatedResponse = await app.inject({
      method: 'PATCH', url: `/api/pages/${created.id}`, headers: adminHeaders,
      payload: { ...pagePayload, slug: 'datorika-renamed', status: 'published', blocks: reorderedBlocks }
    });
    expect(updatedResponse.statusCode).toBe(200);
    expect(updatedResponse.json().blocks[0].id).toBe(created.blocks.at(-1).id);
    expect(updatedResponse.json().blocks[0].visible).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/datorika-page' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/datorika-renamed' })).statusCode).toBe(200);

    const duplicateResponse = await app.inject({ method: 'POST', url: `/api/pages/${created.id}/duplicate`, headers: adminHeaders, payload: {} });
    expect(duplicateResponse.statusCode).toBe(200);
    expect(duplicateResponse.json().status).toBe('draft');
    expect(duplicateResponse.json().slug).not.toBe(created.slug);
    expect((await app.inject({ method: 'GET', url: '/api/pages?page=1&pageSize=1', headers: { cookie: admin.cookies } })).json().total).toBe(2);

    expect((await app.inject({ method: 'POST', url: `/api/pages/${created.id}/status`, headers: adminHeaders, payload: { status: 'disabled' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/datorika-renamed' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/pages/public/datorika-renamed' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/pages/${created.id}`, headers: adminHeaders })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/datorika-renamed' })).statusCode).toBe(404);

    expect((await app.inject({ method: 'GET', url: '/page-link', headers: { 'user-agent': 'Mozilla/5.0' } })).statusCode).toBe(302);
    expect((await app.inject({ method: 'GET', url: '/page-live' })).statusCode).toBe(200);
    await app.close();
  });

  test('Activities drafts persist slide order and content blocks while rejecting invalid question layouts', async () => {
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const admin = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);
    const adminHeaders = { cookie: admin.cookies, 'x-csrf-token': csrf.csrfToken };
    const settings = {
      title: 'Network assessment', description: 'Foundation test', slug: 'network-assessment', status: 'closed',
      identityMode: 'named', requiredAnswerBehavior: 'require_all', navigationPolicy: 'linear',
      resultVisibility: 'after_submission', maximumAttempts: 2, attemptTimeLimitSeconds: 900,
      submissionDeadlineAt: null, shuffleQuestionOptions: true
    };
    expect((await app.inject({ method: 'GET', url: '/api/activities' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/activities', headers: { cookie: admin.cookies }, payload: { settings } })).statusCode).toBe(403);
    const createdResponse = await app.inject({ method: 'POST', url: '/api/activities', headers: adminHeaders, payload: { settings } });
    expect(createdResponse.statusCode).toBe(201);
    const created = createdResponse.json();
    expect(created.activity.settings).toMatchObject(settings);
    expect(created.draft).toMatchObject({ revision: 0, slides: [] });
    await seedUser('activities-user@example.com', 'activities-password-42');
    const otherCsrf = await getCsrfBundle(app);
    const other = await login(app, 'activities-user@example.com', 'activities-password-42', otherCsrf);
    expect((await app.inject({
      method: 'GET', url: `/api/activities/${created.activity.id}`, headers: { cookie: other.cookies }
    })).statusCode).toBe(404);

    const draftPayload = {
      expectedRevision: 0,
      slides: [
        {
          id: 'slide_intro', title: 'Introduction', description: 'Read this first.', blocks: [
            { id: 'heading_intro', type: 'heading', config: { text: 'Computer networks', level: 1 } },
            { id: 'text_intro', type: 'text', config: { text: 'Read the material before answering.' } },
            { id: 'divider_intro', type: 'divider', config: { style: 'solid' } }
          ]
        },
        {
          id: 'slide_question', title: 'Question', blocks: [
            { id: 'question_one', type: 'question', questionType: 'single_choice', graded: true, points: 3, required: true,
              config: { prompt: 'Which protocol resolves names?', options: [{ id: 'dns', label: 'DNS' }, { id: 'arp', label: 'ARP' }] },
              answerKey: { correctOptionId: 'dns' } }
          ]
        }
      ]
    };
    const savedResponse = await app.inject({ method: 'PUT', url: `/api/activities/${created.activity.id}/draft`, headers: adminHeaders, payload: draftPayload });
    expect(savedResponse.statusCode).toBe(200);
    const saved = savedResponse.json();
    expect(saved.revision).toBe(1);
    expect(saved.slides.map((slide: any) => [slide.id, slide.position])).toEqual([['slide_intro', 0], ['slide_question', 1]]);
    expect(saved.slides[0].description).toBe('Read this first.');
    expect(saved.slides[0].blocks.map((block: any) => block.id)).toEqual(['heading_intro', 'text_intro', 'divider_intro']);

    const addedResponse = await app.inject({
      method: 'POST', url: `/api/activities/${created.activity.id}/slides`, headers: adminHeaders,
      payload: { expectedRevision: 1, position: 1, slide: { id: 'slide_middle', title: 'Middle', blocks: [] } }
    });
    expect(addedResponse.statusCode).toBe(201);
    expect(addedResponse.json().slides.map((slide: any) => slide.id)).toEqual(['slide_intro', 'slide_middle', 'slide_question']);

    const movedResponse = await app.inject({
      method: 'PATCH', url: `/api/activities/${created.activity.id}/slides/slide_middle`, headers: adminHeaders,
      payload: { expectedRevision: 2, position: 0, slide: { title: 'First slide', blocks: [] } }
    });
    expect(movedResponse.statusCode).toBe(200);
    expect(movedResponse.json().slides.map((slide: any) => [slide.id, slide.position, slide.title])).toEqual([
      ['slide_middle', 0, 'First slide'], ['slide_intro', 1, 'Introduction'], ['slide_question', 2, 'Question']
    ]);

    const deletedSlideResponse = await app.inject({
      method: 'DELETE', url: `/api/activities/${created.activity.id}/slides/slide_middle?expectedRevision=3`, headers: adminHeaders
    });
    expect(deletedSlideResponse.statusCode).toBe(200);
    expect(deletedSlideResponse.json().slides.map((slide: any) => slide.id)).toEqual(['slide_intro', 'slide_question']);

    const invalidQuestions = {
      expectedRevision: 4,
      slides: [{ id: 'bad_slide', title: '', blocks: [draftPayload.slides[1].blocks[0], {
        ...draftPayload.slides[1].blocks[0], id: 'question_two', answerKey: { correctOptionId: 'arp' }
      }] }]
    };
    expect((await app.inject({
      method: 'PUT', url: `/api/activities/${created.activity.id}/draft`, headers: adminHeaders, payload: invalidQuestions
    })).statusCode).toBe(400);

    const invalidBlock = {
      expectedRevision: 4,
      slides: [{ id: 'bad_image_slide', title: '', blocks: [{
        id: 'bad_image', type: 'image', config: { url: 'http://example.com/image.png', alt: 'Image', caption: '' }
      }] }]
    };
    expect((await app.inject({
      method: 'PUT', url: `/api/activities/${created.activity.id}/draft`, headers: adminHeaders, payload: invalidBlock
    })).statusCode).toBe(400);

    expect((await app.inject({
      method: 'POST', url: `/api/activities/${created.activity.id}/publish`, headers: adminHeaders, payload: { expectedRevision: 4 }
    })).statusCode).toBe(201);
    const deletedActivity = await app.inject({ method: 'DELETE', url: `/api/activities/${created.activity.id}`, headers: adminHeaders });
    expect(deletedActivity.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/activities/${created.activity.id}`, headers: { cookie: admin.cookies } })).statusCode).toBe(404);
    await app.close();
  });

  test('Activities publishing workflow validates access, duplicates safely and archives without deleting attempts', async () => {
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const admin = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);
    const adminHeaders = { cookie: admin.cookies, 'x-csrf-token': csrf.csrfToken };
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const deadline = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const settings = {
      title: 'Publishing workflow', description: 'End-to-end Activity', slug: 'publishing-workflow', status: 'active',
      identityMode: 'anonymous', requiredAnswerBehavior: 'require_all', navigationPolicy: 'linear',
      resultVisibility: 'after_submission', feedbackPolicy: 'points_per_question', maximumAttempts: 2,
      attemptTimeLimitSeconds: null, availabilityStartAt: future, submissionDeadlineAt: deadline,
      submissionDeadlineTimezone: 'Europe/Riga', lowTimeWarningSeconds: 300, shuffleQuestionOptions: false
    };
    const created = (await app.inject({ method: 'POST', url: '/api/activities', headers: adminHeaders, payload: { settings } })).json();
    expect(created.activity.lifecycleState).toBe('draft');
    const draft = {
      expectedRevision: 0,
      slides: [{ id: 'workflow_slide', title: 'Question', description: '', blocks: [{
        id: 'workflow_question', type: 'question', questionType: 'single_choice', graded: true, points: 2, required: true,
        config: { prompt: 'Choose A', description: '', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], shuffleOptions: false },
        answerKey: { correctOptionId: 'a', feedback: 'Correct.' }
      }] }]
    };
    expect((await app.inject({ method: 'PUT', url: `/api/activities/${created.activity.id}/draft`, headers: adminHeaders, payload: draft })).statusCode).toBe(200);
    const checklist = await app.inject({ method: 'GET', url: `/api/activities/${created.activity.id}/publish-validation`, headers: { cookie: admin.cookies } });
    expect(checklist.statusCode).toBe(200);
    expect(checklist.json()).toMatchObject({ valid: true, items: expect.arrayContaining([expect.objectContaining({ code: 'content', valid: true })]) });
    expect((await app.inject({ method: 'POST', url: `/api/activities/${created.activity.id}/publish`, headers: adminHeaders, payload: { expectedRevision: 1 } })).statusCode).toBe(201);
    const futureLanding = await app.inject({ method: 'GET', url: '/api/activities/public/publishing-workflow' });
    expect(futureLanding.json().availabilityStartAt).toBe(future);
    expect((await app.inject({
      method: 'POST', url: '/api/activities/public/publishing-workflow/attempts',
      payload: { participantKey: 'publishing_workflow_browser_0001' }
    })).statusCode).toBe(409);

    const updated = (await app.inject({
      method: 'PATCH', url: `/api/activities/${created.activity.id}`, headers: adminHeaders,
      payload: { expectedRevision: 1, settings: { availabilityStartAt: null } }
    })).json();
    const versionTwo = await app.inject({
      method: 'POST', url: `/api/activities/${created.activity.id}/publish`, headers: adminHeaders,
      payload: { expectedRevision: updated.draft.revision }
    });
    expect(versionTwo.json().versionNumber).toBe(2);
    const started = await app.inject({
      method: 'POST', url: '/api/activities/public/publishing-workflow/attempts',
      payload: { participantKey: 'publishing_workflow_browser_0001' }
    });
    expect(started.statusCode).toBe(201);
    const credential = started.json();
    const authorization = { authorization: `Bearer ${credential.attemptToken}` };
    const questionId = credential.attempt.slides[0].blocks[0].id;
    expect((await app.inject({
      method: 'PATCH', url: `/api/activities/public/publishing-workflow/attempts/${credential.attemptId}/responses/${questionId}`,
      headers: authorization, payload: { answer: { questionType: 'single_choice', optionId: 'a' }, clientRevision: 1 }
    })).statusCode).toBe(200);
    const submitted = await app.inject({ method: 'POST', url: `/api/activities/public/publishing-workflow/attempts/${credential.attemptId}/submit`, headers: authorization, payload: {} });
    expect(submitted.json()).toMatchObject({ status: 'submitted', publishedVersionNumber: 2, result: { score: 2, maximumScore: 2 } });
    const results = await app.inject({ method: 'GET', url: `/api/activities/${created.activity.id}/results`, headers: { cookie: admin.cookies } });
    expect(results.json().overview).toMatchObject({ totalAttempts: 1, submittedAttempts: 1 });
    const listedWithRespondent = (await app.inject({ method: 'GET', url: '/api/activities', headers: { cookie: admin.cookies } })).json();
    expect(listedWithRespondent.find((item: any) => item.id === created.activity.id).completedAttemptCount).toBe(1);

    const duplicated = await app.inject({ method: 'POST', url: `/api/activities/${created.activity.id}/duplicate`, headers: adminHeaders, payload: {} });
    expect(duplicated.statusCode).toBe(201);
    expect(duplicated.json().activity).toMatchObject({ lifecycleState: 'draft', publishedVersionId: null });
    expect(duplicated.json().activity.settings.slug).not.toBe(settings.slug);
    expect(duplicated.json().draft.slides[0].id).not.toBe('workflow_slide');

    const archived = await app.inject({ method: 'PATCH', url: `/api/activities/${created.activity.id}/archive`, headers: adminHeaders, payload: { archived: true } });
    expect(archived.json().activity.lifecycleState).toBe('archived');
    expect((await app.inject({ method: 'GET', url: '/api/activities/public/publishing-workflow' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/activities/public/publishing-workflow/attempts/${credential.attemptId}`, headers: authorization })).statusCode).toBe(200);
    const restored = await app.inject({ method: 'PATCH', url: `/api/activities/${created.activity.id}/archive`, headers: adminHeaders, payload: { archived: false } });
    expect(restored.json().activity.lifecycleState).toBe('disabled');
    expect((await app.inject({ method: 'GET', url: '/api/activities/public/publishing-workflow' })).json().status).toBe('closed');
    const cleared = await app.inject({ method: 'POST', url: `/api/activities/${created.activity.id}/analytics/clear`, headers: adminHeaders, payload: {} });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toMatchObject({ clearedAttempts: 1, activity: { completedAttemptCount: 0 } });
    expect((await app.inject({ method: 'GET', url: `/api/activities/${created.activity.id}/results`, headers: { cookie: admin.cookies } })).json().overview.totalAttempts).toBe(0);
    await app.close();
  });

  test('Activities publish immutable key-safe versions and republish beside existing attempts without regressing Live or Pages', async () => {
    const { buildApp } = await import('./app.js');
    const { getDb } = await import('./db.js');
    const { createId, nowIso, sha256 } = await import('./utils.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const admin = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);
    const adminHeaders = { cookie: admin.cookies, 'x-csrf-token': csrf.csrfToken };
    const settings = {
      title: 'Versioned assessment', description: '', slug: 'versioned-assessment', status: 'active',
      identityMode: 'anonymous', requiredAnswerBehavior: 'allow_incomplete', navigationPolicy: 'free',
      resultVisibility: 'after_close', maximumAttempts: 1, attemptTimeLimitSeconds: null,
      submissionDeadlineAt: null, shuffleQuestionOptions: false
    };
    const created = (await app.inject({ method: 'POST', url: '/api/activities', headers: adminHeaders, payload: { settings } })).json();
    const firstDraft = {
      expectedRevision: 0,
      slides: [{ id: 'stable_slide', title: 'Version one', blocks: [
        { id: 'stable_heading', type: 'heading', config: { text: 'Original heading', level: 2 } },
        { id: 'stable_question', type: 'question', questionType: 'single_choice', graded: true, points: 5, required: true,
          config: { prompt: 'Choose A', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
          answerKey: { correctOptionId: 'a' } }
      ] }]
    };
    expect((await app.inject({ method: 'PUT', url: `/api/activities/${created.activity.id}/draft`, headers: adminHeaders, payload: firstDraft })).statusCode).toBe(200);
    const firstPublish = await app.inject({
      method: 'POST', url: `/api/activities/${created.activity.id}/publish`, headers: adminHeaders, payload: { expectedRevision: 1 }
    });
    expect(firstPublish.statusCode).toBe(201);
    const versionOne = firstPublish.json();
    expect(versionOne.versionNumber).toBe(1);
    expect(JSON.stringify(versionOne)).not.toContain('answerKey');
    expect(JSON.stringify(versionOne)).not.toContain('correctOptionId');
    expect(versionOne.slides[0].blocks[1].config).toMatchObject({ questionType: 'single_choice', prompt: 'Choose A' });

    const db = getDb();
    expect(db.prepare('SELECT version, name FROM schema_migrations WHERE version = 1').get()).toEqual({
      version: 1,
      name: 'activities_domain_foundation'
    });
    expect(db.prepare('SELECT version, name FROM schema_migrations WHERE version = 2').get()).toEqual({
      version: 2,
      name: 'activity_slide_descriptions'
    });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const timestamp = nowIso();
    db.prepare(
      `INSERT INTO activity_attempts (
        id, activity_id, published_version_id, attempt_number, access_token_hash, status,
        started_at, revision, maximum_score, grading_revision, created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, 'in_progress', ?, 0, 5, 0, ?, ?)`
    ).run(createId(), created.activity.id, versionOne.id, sha256('attempt-token'), timestamp, timestamp, timestamp);

    const secondDraft = structuredClone(firstDraft);
    secondDraft.expectedRevision = 1;
    secondDraft.slides[0].title = 'Version two';
    (secondDraft.slides[0].blocks[0] as any).config.text = 'Updated heading';
    (secondDraft.slides[0].blocks[1] as any).answerKey.correctOptionId = 'b';
    expect((await app.inject({ method: 'PUT', url: `/api/activities/${created.activity.id}/draft`, headers: adminHeaders, payload: secondDraft })).statusCode).toBe(200);
    const secondPublish = await app.inject({
      method: 'POST', url: `/api/activities/${created.activity.id}/publish`, headers: adminHeaders, payload: { expectedRevision: 2 }
    });
    expect(secondPublish.statusCode).toBe(201);
    const versionTwo = secondPublish.json();
    expect(versionTwo.versionNumber).toBe(2);
    expect(versionTwo.id).not.toBe(versionOne.id);

    const reloadedVersionOne = (await app.inject({
      method: 'GET', url: `/api/activities/${created.activity.id}/versions/${versionOne.id}`, headers: { cookie: admin.cookies }
    })).json();
    expect(reloadedVersionOne.slides[0].title).toBe('Version one');
    expect(reloadedVersionOne.slides[0].blocks[0].config.text).toBe('Original heading');
    expect(JSON.stringify(reloadedVersionOne)).not.toContain('answerKey');
    expect(JSON.stringify(reloadedVersionOne)).not.toContain('correctOptionId');
    expect(db.prepare('SELECT COUNT(*) as count FROM activity_attempts WHERE published_version_id = ?').get(versionOne.id)).toEqual({ count: 1 });
    expect(db.prepare('SELECT COUNT(*) as count FROM activity_versions WHERE activity_id = ?').get(created.activity.id)).toEqual({ count: 2 });
    expect(db.prepare('SELECT COUNT(*) as count FROM activity_version_question_keys').get()).toEqual({ count: 2 });

    const legacyLive = await app.inject({
      method: 'POST', url: '/api/live', headers: adminHeaders,
      payload: {
        title: 'Legacy poll', question: 'One word?', type: 'word_cloud', slug: 'legacy-after-activities', status: 'active',
        identityMode: 'anonymous', allowMultipleResponses: false, maxResponsesPerParticipant: 1,
        moderationMode: 'off', maxAnswerLength: 100, publicResults: true
      }
    });
    expect(legacyLive.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/live/public/legacy-after-activities' })).statusCode).toBe(200);

    const page = await app.inject({
      method: 'POST', url: '/api/pages', headers: adminHeaders,
      payload: {
        title: 'Page after Activities', slug: 'page-after-activities', description: '', emoji: '', avatarUrl: '',
        theme: 'classic_cream', layout: 'classic', backgroundPattern: 'none', patternIntensity: 35,
        status: 'published', seoTitle: '', seoDescription: '', blocks: []
      }
    });
    expect(page.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/pages/public/page-after-activities' })).statusCode).toBe(200);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await app.close();
  });

  test('legacy Live migration is idempotent, preserves history and only converts key-safe question types', async () => {
    const { buildApp } = await import('./app.js');
    const { getDb } = await import('./db.js');
    const { migrateLegacyLiveActivities } = await import('./legacy-live-migration.js');
    const { createId, nowIso } = await import('./utils.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const admin = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);
    const adminHeaders = { cookie: admin.cookies, 'x-csrf-token': csrf.csrfToken };
    const createLegacy = async (payload: Record<string, unknown>) => {
      const response = await app.inject({ method: 'POST', url: '/api/live', headers: adminHeaders, payload });
      expect(response.statusCode).toBe(200);
      return response.json();
    };
    const cloud = await createLegacy({
      title: 'Legacy cloud', question: 'One phrase?', type: 'word_cloud', slug: 'legacy-cloud-migration', status: 'active',
      identityMode: 'named', allowMultipleResponses: true, maxResponsesPerParticipant: 3,
      moderationMode: 'filter_only', maxAnswerLength: 80, publicResults: true
    });
    const choice = await createLegacy({
      title: 'Legacy choice', question: 'Choose any', type: 'multiple_choice', slug: 'legacy-choice-migration', status: 'active',
      identityMode: 'anonymous', allowMultipleResponses: false, maxResponsesPerParticipant: 1,
      moderationMode: 'off', maxAnswerLength: 80, publicResults: false,
      allowMultipleChoices: true, options: ['A', 'B', 'C']
    });
    const open = await createLegacy({
      title: 'Legacy open', question: 'Explain', type: 'open_answer', slug: 'legacy-open-migration', status: 'active',
      identityMode: 'anonymous', allowMultipleResponses: false, maxResponsesPerParticipant: 1,
      moderationMode: 'review_all', maxAnswerLength: 280, publicResults: false
    });
    expect((await app.inject({
      method: 'POST', url: '/api/live/public/legacy-cloud-migration/responses',
      payload: { participantToken: 'legacy_migration_participant_01', participantName: 'Anna', text: 'Rīga' }
    })).statusCode).toBe(201);
    const db = getDb();
    db.prepare(`
      INSERT INTO live_views (
        id, activity_id, timestamp, visitor_hash, device_type, browser, os, referrer, language, raw_ip
      ) VALUES (?, ?, ?, ?, 'desktop', 'Test Browser', 'Test OS', 'Direct', 'lv-LV', NULL)
    `).run(createId(), cloud.id, nowIso(), 'legacy-migration-view-hash');
    const before = {
      responses: Number((db.prepare('SELECT COUNT(*) as count FROM live_responses WHERE activity_id = ?').get(cloud.id) as { count: number }).count),
      participants: Number((db.prepare('SELECT COUNT(*) as count FROM live_participants WHERE activity_id = ?').get(cloud.id) as { count: number }).count),
      views: Number((db.prepare('SELECT COUNT(*) as count FROM live_views WHERE activity_id = ?').get(cloud.id) as { count: number }).count)
    };
    const report = migrateLegacyLiveActivities(db);
    expect(report).toMatchObject({ migrated: 2, unsupported: 1, failed: 0 });
    expect(migrateLegacyLiveActivities(db)).toMatchObject({ migrated: 0, unsupported: 0, failed: 0 });
    expect(db.prepare('SELECT status FROM legacy_activity_migrations WHERE activity_id = ?').get(cloud.id)).toEqual({ status: 'migrated' });
    expect(db.prepare('SELECT status FROM legacy_activity_migrations WHERE activity_id = ?').get(choice.id)).toEqual({ status: 'migrated' });
    expect(db.prepare('SELECT status FROM legacy_activity_migrations WHERE activity_id = ?').get(open.id)).toEqual({ status: 'unsupported' });
    expect(db.prepare('SELECT COUNT(*) as count FROM activity_versions WHERE activity_id IN (?, ?)').get(cloud.id, choice.id)).toEqual({ count: 2 });
    expect(db.prepare('SELECT COUNT(*) as count FROM activity_version_question_keys WHERE block_id IN (SELECT b.id FROM activity_version_blocks b INNER JOIN activity_version_slides s ON s.id = b.slide_id INNER JOIN activity_versions v ON v.id = s.version_id WHERE v.activity_id IN (?, ?))').get(cloud.id, choice.id)).toEqual({ count: 0 });
    expect({
      responses: Number((db.prepare('SELECT COUNT(*) as count FROM live_responses WHERE activity_id = ?').get(cloud.id) as { count: number }).count),
      participants: Number((db.prepare('SELECT COUNT(*) as count FROM live_participants WHERE activity_id = ?').get(cloud.id) as { count: number }).count),
      views: Number((db.prepare('SELECT COUNT(*) as count FROM live_views WHERE activity_id = ?').get(cloud.id) as { count: number }).count)
    }).toEqual(before);
    expect((await app.inject({ method: 'GET', url: '/api/activities/public/legacy-cloud-migration' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/activities/public/legacy-choice-migration' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/live/public/legacy-open-migration' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/live/${cloud.id}`, headers: { cookie: admin.cookies } })).statusCode).toBe(200);
    expect(db.prepare('SELECT slug FROM public_slugs WHERE resource_id = ?').get(cloud.id)).toEqual({ slug: 'legacy-cloud-migration' });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    await app.close();
  });

  test('self-paced Activity attempts autosave, resume, isolate tokens and remain bound to immutable versions', async () => {
    const { buildApp } = await import('./app.js');
    const { getDb } = await import('./db.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const admin = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);
    const adminHeaders = { cookie: admin.cookies, 'x-csrf-token': csrf.csrfToken };
    const settings = {
      title: 'Self-paced networks', description: 'Two short slides', slug: 'self-paced-networks', status: 'active',
      identityMode: 'named', requiredAnswerBehavior: 'require_all', navigationPolicy: 'linear',
      resultVisibility: 'after_submission', maximumAttempts: 1, attemptTimeLimitSeconds: null,
      submissionDeadlineAt: null, shuffleQuestionOptions: false, shuffleSlides: false, allowBackNavigation: false,
      backgroundPattern: 'dots', patternIntensity: 60
    };
    const created = (await app.inject({ method: 'POST', url: '/api/activities', headers: adminHeaders, payload: { settings } })).json();
    const firstDraft = {
      expectedRevision: 0,
      slides: [
        { id: 'attempt_slide_1', title: 'DNS', description: '', blocks: [{
          id: 'attempt_question_1', type: 'question', questionType: 'single_choice', graded: true, points: 2, required: true,
          config: { prompt: 'Which resolves names?', options: [{ id: 'dns', label: 'DNS' }, { id: 'arp', label: 'ARP' }] },
          answerKey: { correctOptionId: 'dns' }
        }] },
        { id: 'attempt_slide_2', title: 'Reflection', description: '', blocks: [{
          id: 'attempt_question_2', type: 'question', questionType: 'open_answer', graded: false, points: 0, required: false,
          config: { prompt: 'What did you learn?', maximumLength: 200 }, answerKey: null
        }] }
      ]
    };
    expect((await app.inject({ method: 'PUT', url: `/api/activities/${created.activity.id}/draft`, headers: adminHeaders, payload: firstDraft })).statusCode).toBe(200);
    const versionOne = (await app.inject({ method: 'POST', url: `/api/activities/${created.activity.id}/publish`, headers: adminHeaders, payload: { expectedRevision: 1 } })).json();

    const landing = await app.inject({ method: 'GET', url: '/api/activities/public/self-paced-networks' });
    expect(landing.statusCode).toBe(200);
    expect(landing.json()).toMatchObject({ identityMode: 'named', publishedVersionNumber: 1, slideCount: 2, backgroundPattern: 'dots', patternIntensity: 60 });
    expect(JSON.stringify(landing.json())).not.toContain('answerKey');
    const missingName = await app.inject({
      method: 'POST', url: '/api/activities/public/self-paced-networks/attempts',
      payload: { participantKey: 'browser_participant_key_000001' }
    });
    expect(missingName.statusCode).toBe(400);
    const started = await app.inject({
      method: 'POST', url: '/api/activities/public/self-paced-networks/attempts',
      payload: { participantKey: 'browser_participant_key_000001', participantName: 'Anna' }
    });
    expect(started.statusCode).toBe(201);
    const credential = started.json();
    const authorization = { authorization: `Bearer ${credential.attemptToken}` };
    expect(credential.attempt).toMatchObject({ status: 'in_progress', participantName: 'Anna', publishedVersionId: versionOne.id });
    expect(JSON.stringify(credential.attempt)).not.toContain('correctOptionId');
    expect(getDb().prepare('SELECT access_token_hash as tokenHash FROM activity_attempts WHERE id = ?').get(credential.attemptId))
      .not.toEqual({ tokenHash: credential.attemptToken });
    expect((await app.inject({
      method: 'GET', url: `/api/activities/public/not-this-activity/attempts/${credential.attemptId}`, headers: authorization
    })).statusCode).toBe(404);

    const blockedNavigation = await app.inject({
      method: 'POST', url: `/api/activities/public/self-paced-networks/attempts/${credential.attemptId}/navigate`,
      headers: authorization, payload: { targetSlideId: credential.attempt.slides[1].id }
    });
    expect(blockedNavigation.statusCode).toBe(409);
    expect((await app.inject({
      method: 'PATCH', url: `/api/activities/public/self-paced-networks/attempts/${credential.attemptId}/responses/${credential.attempt.slides[0].blocks[0].id}`,
      headers: authorization, payload: { answer: { questionType: 'single_choice', optionId: 'not-an-option' }, clientRevision: 1 }
    })).statusCode).toBe(400);
    const saved = await app.inject({
      method: 'PATCH', url: `/api/activities/public/self-paced-networks/attempts/${credential.attemptId}/responses/${credential.attempt.slides[0].blocks[0].id}`,
      headers: authorization, payload: { answer: { questionType: 'single_choice', optionId: 'dns' }, clientRevision: 1 }
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().serverRevision).toBe(1);
    const replayed = await app.inject({
      method: 'PATCH', url: `/api/activities/public/self-paced-networks/attempts/${credential.attemptId}/responses/${credential.attempt.slides[0].blocks[0].id}`,
      headers: authorization, payload: { answer: { questionType: 'single_choice', optionId: 'dns' }, clientRevision: 1 }
    });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json()).toEqual(saved.json());
    expect((await app.inject({
      method: 'PATCH', url: `/api/activities/public/self-paced-networks/attempts/${credential.attemptId}/responses/${credential.attempt.slides[0].blocks[0].id}`,
      headers: authorization, payload: { answer: { questionType: 'single_choice', optionId: 'arp' }, clientRevision: 1 }
    })).statusCode).toBe(409);

    const navigated = await app.inject({
      method: 'POST', url: `/api/activities/public/self-paced-networks/attempts/${credential.attemptId}/navigate`,
      headers: authorization, payload: { targetSlideId: credential.attempt.slides[1].id }
    });
    expect(navigated.statusCode).toBe(200);
    expect(navigated.json().currentSlideId).toBe(credential.attempt.slides[1].id);
    expect(navigated.json().settings.allowBackNavigation).toBe(false);
    expect((await app.inject({
      method: 'POST', url: `/api/activities/public/self-paced-networks/attempts/${credential.attemptId}/navigate`,
      headers: authorization, payload: { targetSlideId: credential.attempt.slides[0].id }
    })).statusCode).toBe(409);
    const resumed = await app.inject({ method: 'GET', url: `/api/activities/public/self-paced-networks/attempts/${credential.attemptId}`, headers: authorization });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().responses).toHaveLength(1);
    expect((await app.inject({
      method: 'GET', url: `/api/activities/public/self-paced-networks/attempts/${credential.attemptId}`,
      headers: { authorization: `Bearer ${'x'.repeat(43)}` }
    })).statusCode).toBe(404);

    const secondDraft = structuredClone(firstDraft);
    secondDraft.expectedRevision = 1;
    secondDraft.slides[0].title = 'DNS updated';
    expect((await app.inject({ method: 'PUT', url: `/api/activities/${created.activity.id}/draft`, headers: adminHeaders, payload: secondDraft })).statusCode).toBe(200);
    const versionTwo = (await app.inject({ method: 'POST', url: `/api/activities/${created.activity.id}/publish`, headers: adminHeaders, payload: { expectedRevision: 2 } })).json();
    expect(versionTwo.id).not.toBe(versionOne.id);
    expect((await app.inject({ method: 'GET', url: `/api/activities/public/self-paced-networks/attempts/${credential.attemptId}`, headers: authorization })).json())
      .toMatchObject({ publishedVersionId: versionOne.id, publishedVersionNumber: 1 });

    const submitted = await app.inject({
      method: 'POST', url: `/api/activities/public/self-paced-networks/attempts/${credential.attemptId}/submit`, headers: authorization, payload: {}
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json()).toMatchObject({ status: 'submitted', submissionReason: 'manual' });
    expect(getDb().prepare('SELECT score FROM activity_attempts WHERE id = ?').get(credential.attemptId)).toEqual({ score: 2 });
    const doubleSubmission = await app.inject({
      method: 'POST', url: `/api/activities/public/self-paced-networks/attempts/${credential.attemptId}/submit`, headers: authorization, payload: {}
    });
    expect(doubleSubmission.statusCode).toBe(200);
    expect(doubleSubmission.json().submittedAt).toBe(submitted.json().submittedAt);
    expect((await app.inject({
      method: 'PATCH', url: `/api/activities/public/self-paced-networks/attempts/${credential.attemptId}/responses/${credential.attempt.slides[0].blocks[0].id}`,
      headers: authorization, payload: { answer: { questionType: 'single_choice', optionId: 'arp' }, clientRevision: 2 }
    })).statusCode).toBe(409);
    expect((await app.inject({
      method: 'POST', url: '/api/activities/public/self-paced-networks/attempts',
      payload: { participantKey: 'browser_participant_key_000001', participantName: 'Anna' }
    })).statusCode).toBe(409);

    const timed = await app.inject({
      method: 'POST', url: '/api/activities/public/self-paced-networks/attempts',
      payload: { participantKey: 'browser_participant_key_000002', participantName: 'Jānis' }
    });
    expect(timed.statusCode).toBe(201);
    const timedCredential = timed.json();
    getDb().prepare('UPDATE activity_attempts SET deadline_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 1_000).toISOString(), timedCredential.attemptId);
    const expiredAttempt = await app.inject({
      method: 'GET', url: `/api/activities/public/self-paced-networks/attempts/${timedCredential.attemptId}`,
      headers: { authorization: `Bearer ${timedCredential.attemptToken}` }
    });
    expect(expiredAttempt.json()).toMatchObject({ status: 'auto_submitted', submissionReason: 'deadline' });
    expect((await app.inject({
      method: 'PATCH', url: `/api/activities/public/self-paced-networks/attempts/${timedCredential.attemptId}/responses/${timedCredential.attempt.slides[0].blocks[0].id}`,
      headers: { authorization: `Bearer ${timedCredential.attemptToken}` },
      payload: { answer: { questionType: 'single_choice', optionId: 'dns' }, clientRevision: 1 }
    })).statusCode).toBe(409);

    const shuffledSettings = await app.inject({
      method: 'PATCH', url: `/api/activities/${created.activity.id}`, headers: adminHeaders,
      payload: { expectedRevision: 2, settings: { shuffleSlides: true, allowBackNavigation: true } }
    });
    expect(shuffledSettings.statusCode).toBe(200);
    expect(shuffledSettings.json().activity.settings).toMatchObject({ shuffleSlides: true, allowBackNavigation: true });
    expect((await app.inject({ method: 'POST', url: `/api/activities/${created.activity.id}/publish`, headers: adminHeaders, payload: { expectedRevision: 3 } })).statusCode).toBe(201);
    const shuffledStart = await app.inject({
      method: 'POST', url: '/api/activities/public/self-paced-networks/attempts',
      payload: { participantKey: 'browser_participant_key_000003', participantName: 'Marta' }
    });
    expect(shuffledStart.statusCode).toBe(201);
    const shuffledCredential = shuffledStart.json();
    expect(shuffledCredential.attempt.currentSlideId).toBe(shuffledCredential.attempt.slides[0].id);
    const shuffledResume = await app.inject({
      method: 'GET', url: `/api/activities/public/self-paced-networks/attempts/${shuffledCredential.attemptId}`,
      headers: { authorization: `Bearer ${shuffledCredential.attemptToken}` }
    });
    expect(shuffledResume.json().slides.map((slide: any) => slide.id))
      .toEqual(shuffledCredential.attempt.slides.map((slide: any) => slide.id));
    await app.close();
  });

  test('Activity deadlines are server-authoritative, extendable, race-safe and finalized after restart', async () => {
    let { buildApp } = await import('./app.js');
    const { getDb, resetDb } = await import('./db.js');
    let app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const admin = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);
    const adminHeaders = { cookie: admin.cookies, 'x-csrf-token': csrf.csrfToken };
    const createTimedActivity = async (slug: string, attemptTimeLimitSeconds: number | null, submissionDeadlineAt: string | null) => {
      const settings = {
        title: `Timer ${slug}`, description: '', slug, status: 'active', identityMode: 'anonymous',
        requiredAnswerBehavior: 'allow_incomplete', navigationPolicy: 'linear', resultVisibility: 'after_submission',
        maximumAttempts: 10, attemptTimeLimitSeconds, submissionDeadlineAt,
        submissionDeadlineTimezone: 'Europe/Riga', lowTimeWarningSeconds: 60, shuffleQuestionOptions: false
      };
      const created = (await app.inject({ method: 'POST', url: '/api/activities', headers: adminHeaders, payload: { settings } })).json();
      const draft = {
        expectedRevision: 0,
        slides: [{ id: `${slug}_slide`, title: 'Timed slide', description: '', blocks: [{
          id: `${slug}_question`, type: 'question', questionType: 'open_answer', graded: false,
          points: 0, required: false,
          config: { prompt: 'Optional answer', instructions: '', responseMode: 'multiline', minimumLength: 0, maximumLength: 200, gradingMode: 'ungraded', ignoreCase: false, normalizeWhitespace: false },
          answerKey: null
        }] }]
      };
      expect((await app.inject({ method: 'PUT', url: `/api/activities/${created.activity.id}/draft`, headers: adminHeaders, payload: draft })).statusCode).toBe(200);
      expect((await app.inject({ method: 'POST', url: `/api/activities/${created.activity.id}/publish`, headers: adminHeaders, payload: { expectedRevision: 1 } })).statusCode).toBe(201);
      return created.activity.id as string;
    };
    const startAttempt = async (slug: string, participantKey: string) => {
      const response = await app.inject({
        method: 'POST', url: `/api/activities/public/${slug}/attempts`,
        payload: { participantKey, clientNow: '2099-01-01T00:00:00.000Z', deadlineAt: '2099-01-01T00:00:00.000Z' }
      });
      expect(response.statusCode).toBe(201);
      return response.json();
    };

    const individualId = await createTimedActivity('individual-timer', 120, null);
    const individual = await startAttempt('individual-timer', 'timer_participant_key_000001');
    expect(Date.parse(individual.attempt.individualDeadlineAt) - Date.parse(individual.attempt.startedAt)).toBe(120_000);
    expect(individual.attempt.deadlineAt).toBe(individual.attempt.individualDeadlineAt);
    expect(individual.attempt.globalDeadlineAt).toBeNull();
    expect(Math.abs(Date.parse(individual.attempt.serverNow) - Date.now())).toBeLessThan(5_000);

    const attempts = await app.inject({ method: 'GET', url: `/api/activities/${individualId}/attempts`, headers: { cookie: admin.cookies } });
    expect(attempts.statusCode).toBe(200);
    expect(attempts.json()[0]).toMatchObject({ id: individual.attemptId, status: 'in_progress', deadlineExtendedSeconds: 0 });
    const originalIndividualDeadline = individual.attempt.individualDeadlineAt;
    const extended = await app.inject({
      method: 'POST', url: `/api/activities/${individualId}/attempts/${individual.attemptId}/extend`,
      headers: adminHeaders, payload: { additionalMinutes: 5 }
    });
    expect(extended.statusCode).toBe(200);
    expect(Date.parse(extended.json().individualDeadlineAt) - Date.parse(originalIndividualDeadline)).toBe(300_000);
    expect(extended.json()).toMatchObject({ deadlineExtendedSeconds: 300, status: 'in_progress' });
    expect((await app.inject({
      method: 'POST', url: `/api/activities/${individualId}/attempts/${individual.attemptId}/extend`,
      payload: { additionalMinutes: 5 }
    })).statusCode).toBe(403);

    const globalAt = new Date(Date.now() + 20 * 60_000).toISOString();
    await createTimedActivity('global-timer', null, globalAt);
    const globalAttempt = await startAttempt('global-timer', 'timer_participant_key_000002');
    expect(globalAttempt.attempt.individualDeadlineAt).toBeNull();
    expect(globalAttempt.attempt.deadlineAt).toBe(globalAttempt.attempt.globalDeadlineAt);
    expect(Date.parse(globalAttempt.attempt.deadlineAt)).toBe(Date.parse(globalAt));

    const combinedGlobalAt = new Date(Date.now() + 60_000).toISOString();
    const combinedId = await createTimedActivity('combined-timer', 600, combinedGlobalAt);
    const combined = await startAttempt('combined-timer', 'timer_participant_key_000003');
    expect(combined.attempt.deadlineAt).toBe(combined.attempt.globalDeadlineAt);
    expect(Date.parse(combined.attempt.individualDeadlineAt)).toBeGreaterThan(Date.parse(combined.attempt.globalDeadlineAt));
    const cappedExtension = await app.inject({
      method: 'POST', url: `/api/activities/${combinedId}/attempts/${combined.attemptId}/extend`,
      headers: adminHeaders, payload: { additionalMinutes: 5 }
    });
    expect(cappedExtension.statusCode).toBe(200);
    expect(cappedExtension.json().effectiveDeadlineAt).toBe(combined.attempt.globalDeadlineAt);

    const authorization = { authorization: `Bearer ${individual.attemptToken}` };
    const questionId = individual.attempt.slides[0].blocks[0].id;
    expect((await app.inject({
      method: 'PATCH', url: `/api/activities/public/individual-timer/attempts/${individual.attemptId}/responses/${questionId}`,
      headers: authorization, payload: { answer: { questionType: 'open_answer', text: 'Persisted before expiry' }, clientRevision: 1 }
    })).statusCode).toBe(200);
    const past = new Date(Date.now() - 1_000).toISOString();
    getDb().prepare('UPDATE activity_attempts SET deadline_at = ?, individual_deadline_at = ? WHERE id = ?')
      .run(past, past, individual.attemptId);
    const [racingSave, racingSubmit] = await Promise.all([
      app.inject({
        method: 'PATCH', url: `/api/activities/public/individual-timer/attempts/${individual.attemptId}/responses/${questionId}`,
        headers: authorization, payload: { answer: { questionType: 'open_answer', text: 'Unsaved race value' }, clientRevision: 2 }
      }),
      app.inject({ method: 'POST', url: `/api/activities/public/individual-timer/attempts/${individual.attemptId}/submit`, headers: authorization, payload: {} })
    ]);
    expect(racingSave.statusCode).toBe(409);
    expect(racingSubmit.statusCode).toBe(200);
    expect(racingSubmit.json()).toMatchObject({ status: 'auto_submitted', submissionReason: 'deadline' });
    const persisted = getDb().prepare('SELECT answer_json as answerJson FROM activity_attempt_responses WHERE attempt_id = ?').get(individual.attemptId) as { answerJson: string };
    expect(JSON.parse(persisted.answerJson).text).toBe('Persisted before expiry');
    expect(getDb().prepare('SELECT grading_revision as revision FROM activity_attempts WHERE id = ?').get(individual.attemptId)).toEqual({ revision: 1 });
    expect((await app.inject({ method: 'POST', url: `/api/activities/public/individual-timer/attempts/${individual.attemptId}/submit`, headers: authorization, payload: {} })).json().submittedAt)
      .toBe(racingSubmit.json().submittedAt);
    expect(getDb().prepare('SELECT grading_revision as revision FROM activity_attempts WHERE id = ?').get(individual.attemptId)).toEqual({ revision: 1 });

    const restartAttempt = await startAttempt('individual-timer', 'timer_participant_key_000004');
    getDb().prepare('UPDATE activity_attempts SET deadline_at = ?, individual_deadline_at = ? WHERE id = ?')
      .run(past, past, restartAttempt.attemptId);
    await app.close();
    resetDb();
    vi.resetModules();
    setBaseEnv(testDbPath);
    ({ buildApp } = await import('./app.js'));
    app = await buildApp();
    const restartedDb = (await import('./db.js')).getDb();
    expect(restartedDb.prepare('SELECT status, submission_reason as reason FROM activity_attempts WHERE id = ?').get(restartAttempt.attemptId))
      .toEqual({ status: 'auto_submitted', reason: 'deadline' });
    await app.close();
  });

  test('choice Activities shuffle deterministically, resume answers and grade partial credit server-side', async () => {
    const { buildApp } = await import('./app.js');
    const { getDb } = await import('./db.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const admin = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);
    const adminHeaders = { cookie: admin.cookies, 'x-csrf-token': csrf.csrfToken };
    const settings = {
      title: 'Choice assessment', description: '', slug: 'choice-assessment', status: 'active',
      identityMode: 'anonymous', requiredAnswerBehavior: 'allow_incomplete', navigationPolicy: 'linear',
      resultVisibility: 'after_submission', feedbackPolicy: 'correct_answers', maximumAttempts: 5, attemptTimeLimitSeconds: null,
      submissionDeadlineAt: null, shuffleQuestionOptions: false
    };
    const created = (await app.inject({ method: 'POST', url: '/api/activities', headers: adminHeaders, payload: { settings } })).json();
    const draft = {
      expectedRevision: 0,
      slides: [
        { id: 'choice_slide_1', title: 'Multiple', description: '', blocks: [{
          id: 'choice_multiple', type: 'question', questionType: 'multiple_choice', graded: true, points: 4, required: true,
          config: {
            prompt: 'Select protocols', description: 'Choose every correct option.', shuffleOptions: true,
            gradingMode: 'partial', minimumSelections: 1, maximumSelections: 4,
            options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }, { id: 'd', label: 'D' }]
          },
          answerKey: { correctOptionIds: ['a', 'c'], feedback: 'Private protocol explanation' }
        }] },
        { id: 'choice_slide_2', title: 'Single', description: '', blocks: [{
          id: 'choice_single', type: 'question', questionType: 'single_choice', graded: true, points: 2, required: false,
          config: {
            prompt: 'Optional choice', description: '', shuffleOptions: false,
            options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }]
          },
          answerKey: { correctOptionId: 'yes', feedback: 'Private single explanation' }
        }] }
      ]
    };
    expect((await app.inject({ method: 'PUT', url: `/api/activities/${created.activity.id}/draft`, headers: adminHeaders, payload: draft })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/activities/${created.activity.id}/publish`, headers: adminHeaders, payload: { expectedRevision: 1 } })).statusCode).toBe(201);

    const started = await app.inject({
      method: 'POST', url: '/api/activities/public/choice-assessment/attempts',
      payload: { participantKey: 'choice_participant_key_000001' }
    });
    expect(started.statusCode).toBe(201);
    const credential = started.json();
    const authorization = { authorization: `Bearer ${credential.attemptToken}` };
    const publicPayload = JSON.stringify(credential.attempt);
    expect(publicPayload).not.toContain('correctOptionIds');
    expect(publicPayload).not.toContain('correctOptionId');
    expect(publicPayload).not.toContain('Private protocol explanation');
    expect(publicPayload).not.toContain('Private single explanation');
    const multipleBlock = credential.attempt.slides[0].blocks[0];
    const firstOrder = multipleBlock.config.options.map((option: { id: string }) => option.id);

    expect((await app.inject({
      method: 'PATCH', url: `/api/activities/public/choice-assessment/attempts/${credential.attemptId}/responses/${multipleBlock.id}`,
      headers: authorization,
      payload: { answer: { questionType: 'multiple_choice', optionIds: ['a', 'b', 'c', 'd'] }, clientRevision: 1 }
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: 'PATCH', url: `/api/activities/public/choice-assessment/attempts/${credential.attemptId}/responses/${multipleBlock.id}`,
      headers: authorization,
      payload: { answer: { questionType: 'multiple_choice', optionIds: ['a'] }, clientRevision: 2 }
    })).statusCode).toBe(200);
    const singleBlock = credential.attempt.slides[1].blocks[0];
    expect((await app.inject({
      method: 'PATCH', url: `/api/activities/public/choice-assessment/attempts/${credential.attemptId}/responses/${singleBlock.id}`,
      headers: authorization,
      payload: { answer: { questionType: 'single_choice', optionId: 'yes' }, clientRevision: 1 }
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: 'PATCH', url: `/api/activities/public/choice-assessment/attempts/${credential.attemptId}/responses/${singleBlock.id}`,
      headers: authorization,
      payload: { answer: { questionType: 'single_choice', optionId: null }, clientRevision: 2 }
    })).statusCode).toBe(200);

    const resumed = await app.inject({
      method: 'GET', url: `/api/activities/public/choice-assessment/attempts/${credential.attemptId}`, headers: authorization
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().slides[0].blocks[0].config.options.map((option: { id: string }) => option.id)).toEqual(firstOrder);
    expect(resumed.json().responses).toEqual(expect.arrayContaining([
      expect.objectContaining({ questionBlockId: multipleBlock.id, answer: { questionType: 'multiple_choice', optionIds: ['a'] } })
    ]));
    expect(resumed.json().responses.some((response: { questionBlockId: string }) => response.questionBlockId === singleBlock.id)).toBe(false);

    const submitted = await app.inject({
      method: 'POST', url: `/api/activities/public/choice-assessment/attempts/${credential.attemptId}/submit`, headers: authorization, payload: {}
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().result).toMatchObject({ score: 2, maximumScore: 6 });
    expect(JSON.stringify(submitted.json().result)).toContain('Private protocol explanation');
    expect(submitted.json().result.questions.every((question: Record<string, unknown>) => 'correctAnswer' in question)).toBe(true);
    expect(JSON.stringify(submitted.json().result)).not.toContain('correctOptionIds');
    expect(JSON.stringify(submitted.json().result)).not.toContain('correctOptionId');
    expect(getDb().prepare('SELECT score, maximum_score as maximumScore FROM activity_attempts WHERE id = ?').get(credential.attemptId))
      .toEqual({ score: 2, maximumScore: 6 });
    const grading = getDb().prepare('SELECT awarded_points as awardedPoints, grading_details_json as details FROM activity_attempt_responses WHERE attempt_id = ? AND question_block_id = ?')
      .get(credential.attemptId, multipleBlock.id) as { awardedPoints: number; details: string };
    expect(grading.awardedPoints).toBe(2);
    expect(JSON.parse(grading.details)).toMatchObject({ correct: false, fraction: 0.5, gradingMode: 'partial' });
    await app.close();
  });

  test('Open Answer and Word Cloud validate Unicode, grade safely, moderate, resume, and disclose only finalized approved results', async () => {
    const { buildApp } = await import('./app.js');
    const { getDb } = await import('./db.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const admin = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);
    const adminHeaders = { cookie: admin.cookies, 'x-csrf-token': csrf.csrfToken };
    expect((await app.inject({ method: 'POST', url: '/api/moderation/rules', headers: adminHeaders, payload: { pattern: 'slikts vārds', matchMode: 'whole_word' } })).statusCode).toBe(200);
    const settings = {
      title: 'Latvian text assessment', description: '', slug: 'latvian-text-assessment', status: 'active',
      identityMode: 'named', requiredAnswerBehavior: 'allow_incomplete', navigationPolicy: 'free',
      resultVisibility: 'after_submission', feedbackPolicy: 'manual_release', maximumAttempts: 5, attemptTimeLimitSeconds: null,
      submissionDeadlineAt: null, shuffleQuestionOptions: false
    };
    const created = (await app.inject({ method: 'POST', url: '/api/activities', headers: adminHeaders, payload: { settings } })).json();
    const draft = {
      expectedRevision: 0,
      slides: [
        { id: 'text_slide_auto', title: 'Automātiska', description: '', blocks: [{
          id: 'open_normalized', type: 'question', questionType: 'open_answer', graded: true, points: 3, required: true,
          config: { prompt: 'Kas ir tīkla adrese?', instructions: 'Atbildi īsi.', responseMode: 'single_line', minimumLength: 2, maximumLength: 40, gradingMode: 'normalized', ignoreCase: true, normalizeWhitespace: true },
          answerKey: { acceptedAnswers: ['tīkla adrese', 'IP adrese'], feedback: 'Tiek pieņemti divi varianti.' }
        }] },
        { id: 'text_slide_manual', title: 'Pamatojums', description: '', blocks: [{
          id: 'open_manual', type: 'question', questionType: 'open_answer', graded: true, points: 2, required: false,
          config: { prompt: 'Pamato atbildi.', instructions: '', responseMode: 'multiline', minimumLength: 0, maximumLength: 200, gradingMode: 'manual', ignoreCase: false, normalizeWhitespace: false },
          answerKey: { acceptedAnswers: [], feedback: '' }
        }] },
        { id: 'text_slide_cloud', title: 'Mākonis', description: '', blocks: [{
          id: 'word_cloud', type: 'question', questionType: 'word_cloud', graded: true, points: 1, required: true,
          config: { prompt: 'Nosauc jēdzienus.', instructions: '', maximumLength: 40, allowMultipleResponses: true, maximumResponses: 3, moderationMode: 'filter_only', showResults: true, showParticipantNames: false, gradingMode: 'participation' },
          answerKey: null
        }] }
      ]
    };
    expect((await app.inject({ method: 'PUT', url: `/api/activities/${created.activity.id}/draft`, headers: adminHeaders, payload: draft })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/activities/${created.activity.id}/publish`, headers: adminHeaders, payload: { expectedRevision: 1 } })).statusCode).toBe(201);

    const started = await app.inject({ method: 'POST', url: '/api/activities/public/latvian-text-assessment/attempts', payload: { participantKey: 'latvian_participant_key_0001', participantName: 'Anna' } });
    expect(started.statusCode).toBe(201);
    const credential = started.json();
    const authorization = { authorization: `Bearer ${credential.attemptToken}` };
    expect(credential.attempt.result).toBeNull();
    const [autoBlock, manualBlock, cloudBlock] = credential.attempt.slides.map((slide: { blocks: Array<{ id: string }> }) => slide.blocks[0]);

    expect((await app.inject({ method: 'PATCH', url: `/api/activities/public/latvian-text-assessment/attempts/${credential.attemptId}/responses/${autoBlock.id}`, headers: authorization, payload: { answer: { questionType: 'open_answer', text: 'TĪKLA   ADRESE' }, clientRevision: 1 } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `/api/activities/public/latvian-text-assessment/attempts/${credential.attemptId}/responses/${manualBlock.id}`, headers: authorization, payload: { answer: { questionType: 'open_answer', text: 'Pirmā rinda\nOtrā rinda ar ā, ē un ģ.' }, clientRevision: 1 } })).statusCode).toBe(200);
    const tooLong = await app.inject({ method: 'PATCH', url: `/api/activities/public/latvian-text-assessment/attempts/${credential.attemptId}/responses/${cloudBlock.id}`, headers: authorization, payload: { answer: { questionType: 'word_cloud', responses: ['x'.repeat(41)] }, clientRevision: 1 } });
    expect(tooLong.statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: `/api/activities/public/latvian-text-assessment/attempts/${credential.attemptId}/responses/${cloudBlock.id}`, headers: authorization, payload: { answer: { questionType: 'word_cloud', responses: ['Datortīkli', 'IP   adrese', 'DATORTĪKLI'] }, clientRevision: 1 } })).statusCode).toBe(200);
    const resumed = (await app.inject({ method: 'GET', url: `/api/activities/public/latvian-text-assessment/attempts/${credential.attemptId}`, headers: authorization })).json();
    expect(resumed.result).toBeNull();
    expect(resumed.responses).toEqual(expect.arrayContaining([
      expect.objectContaining({ questionBlockId: manualBlock.id, answer: { questionType: 'open_answer', text: 'Pirmā rinda\nOtrā rinda ar ā, ē un ģ.' } }),
      expect.objectContaining({ questionBlockId: cloudBlock.id, answer: { questionType: 'word_cloud', responses: ['Datortīkli', 'IP adrese', 'DATORTĪKLI'] } })
    ]));
    const submitted = await app.inject({ method: 'POST', url: `/api/activities/public/latvian-text-assessment/attempts/${credential.attemptId}/submit`, headers: authorization, payload: {} });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json()).toMatchObject({ gradingState: 'awaiting_manual_grading', result: null });
    expect(getDb().prepare('SELECT grading_status as gradingStatus FROM activity_attempt_responses WHERE attempt_id = ? AND question_block_id = ?').get(credential.attemptId, manualBlock.id)).toEqual({ gradingStatus: 'manual_review' });
    expect(getDb().prepare('SELECT awarded_points as points FROM activity_attempt_responses WHERE attempt_id = ? AND question_block_id = ?').get(credential.attemptId, autoBlock.id)).toEqual({ points: 3 });

    const detail = await app.inject({ method: 'GET', url: `/api/activities/${created.activity.id}/attempts/${credential.attemptId}`, headers: { cookie: admin.cookies } });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ gradingState: 'awaiting_manual_grading', pendingManualGrading: 1 });
    expect(JSON.stringify(detail.json())).toContain('Pirmā rinda');
    expect(detail.json().responses.find((response: any) => response.questionBlockId === cloudBlock.id).questionConfig)
      .toMatchObject({ questionType: 'word_cloud', prompt: 'Nosauc jēdzienus.' });
    const invalidGrade = await app.inject({
      method: 'POST', url: `/api/activities/${created.activity.id}/attempts/${credential.attemptId}/responses/${manualBlock.id}/grade`, headers: adminHeaders,
      payload: { awardedPoints: 2.001, teacherFeedback: 'Par daudz' }
    });
    expect(invalidGrade.statusCode).toBe(400);
    const manualGrade = await app.inject({
      method: 'POST', url: `/api/activities/${created.activity.id}/attempts/${credential.attemptId}/responses/${manualBlock.id}/grade`, headers: adminHeaders,
      payload: { awardedPoints: 1.5, teacherFeedback: 'Labs pamatojums.' }
    });
    expect(manualGrade.statusCode).toBe(200);
    expect(manualGrade.json()).toMatchObject({ gradingState: 'fully_graded', score: 5.5, pendingManualGrading: 0 });
    expect(manualGrade.json().audit.some((entry: { action: string }) => entry.action === 'manual')).toBe(true);
    expect((await app.inject({ method: 'GET', url: `/api/activities/public/latvian-text-assessment/attempts/${credential.attemptId}`, headers: authorization })).json().result).toBeNull();
    const released = await app.inject({
      method: 'POST', url: `/api/activities/${created.activity.id}/attempts/${credential.attemptId}/release-results`, headers: adminHeaders, payload: {}
    });
    expect(released.statusCode).toBe(200);
    expect(released.json().resultsReleasedAt).toBeTruthy();
    const disclosed = (await app.inject({ method: 'GET', url: `/api/activities/public/latvian-text-assessment/attempts/${credential.attemptId}`, headers: authorization })).json();
    expect(disclosed.result).toMatchObject({ score: 5.5, maximumScore: 6, wordClouds: [{ totalResponses: 3, uniqueResponses: 2 }] });
    expect(disclosed.result.wordClouds[0].items.every((item: Record<string, unknown>) => !('participantNames' in item))).toBe(true);
    expect(JSON.stringify(disclosed.result)).toContain('Labs pamatojums.');
    expect(JSON.stringify(disclosed.result)).not.toContain('acceptedAnswers');

    const moderatedStart = (await app.inject({ method: 'POST', url: '/api/activities/public/latvian-text-assessment/attempts', payload: { participantKey: 'latvian_participant_key_0002', participantName: 'Jānis' } })).json();
    const moderatedHeaders = { authorization: `Bearer ${moderatedStart.attemptToken}` };
    const moderatedCloud = moderatedStart.attempt.slides[2].blocks[0];
    const moderatedSave = await app.inject({ method: 'PATCH', url: `/api/activities/public/latvian-text-assessment/attempts/${moderatedStart.attemptId}/responses/${moderatedCloud.id}`, headers: moderatedHeaders, payload: { answer: { questionType: 'word_cloud', responses: ['slikts vārds'] }, clientRevision: 1 } });
    expect(moderatedSave.statusCode).toBe(200);
    expect(JSON.stringify(moderatedSave.json())).not.toContain('slikts vārds');
    expect(getDb().prepare('SELECT moderation_status as status, moderation_reason as reason FROM activity_attempt_responses WHERE attempt_id = ? AND question_block_id = ?').get(moderatedStart.attemptId, moderatedCloud.id)).toEqual({ status: 'pending', reason: 'Response matched a moderation rule.' });
    expect((await app.inject({ method: 'GET', url: `/api/activities/public/latvian-text-assessment/attempts/${moderatedStart.attemptId}`, headers: moderatedHeaders })).json().result).toBeNull();
    const moderatedSubmission = await app.inject({ method: 'POST', url: `/api/activities/public/latvian-text-assessment/attempts/${moderatedStart.attemptId}/submit`, headers: moderatedHeaders, payload: {} });
    expect(moderatedSubmission.statusCode).toBe(200);
    expect(moderatedSubmission.json().gradingState).toBe('awaiting_manual_grading');
    const moderatedDetail = await app.inject({ method: 'GET', url: `/api/activities/${created.activity.id}/attempts/${moderatedStart.attemptId}`, headers: { cookie: admin.cookies } });
    expect(moderatedDetail.json().responses).toEqual(expect.arrayContaining([
      expect.objectContaining({ questionBlockId: moderatedCloud.id, moderationStatus: 'pending', moderationReason: 'Response matched a moderation rule.' })
    ]));
    const pendingResults = (await app.inject({
      method: 'GET', url: `/api/activities/${created.activity.id}/results`, headers: { cookie: admin.cookies }
    })).json();
    expect(pendingResults.wordClouds[0]).toMatchObject({ totalResponses: 3, uniqueResponses: 2 });
    expect(pendingResults.wordClouds[0].items).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: 'Datortīkli', count: 2 })
    ]));
    expect(JSON.stringify(pendingResults.wordClouds)).not.toContain('slikts vārds');
    const approvedModeration = await app.inject({
      method: 'POST',
      url: `/api/activities/${created.activity.id}/attempts/${moderatedStart.attemptId}/responses/${moderatedCloud.id}/moderate`,
      headers: adminHeaders,
      payload: { status: 'approved' }
    });
    expect(approvedModeration.statusCode).toBe(200);
    expect(approvedModeration.json()).toMatchObject({ gradingState: 'fully_graded', pendingManualGrading: 0, score: 1 });
    expect(approvedModeration.json().audit.some((entry: { action: string }) => entry.action === 'moderation')).toBe(true);
    const approvedResults = (await app.inject({
      method: 'GET', url: `/api/activities/${created.activity.id}/results`, headers: { cookie: admin.cookies }
    })).json();
    expect(approvedResults.wordClouds[0]).toMatchObject({ totalResponses: 4, uniqueResponses: 3 });
    expect(JSON.stringify(approvedResults.wordClouds)).toContain('slikts vārds');
    await app.close();
  });

  test('Ordering and Matching autosave stable IDs, reject duplicate mappings, shuffle safely, and grade partial credit', async () => {
    const { buildApp } = await import('./app.js');
    const { getDb } = await import('./db.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const admin = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);
    const adminHeaders = { cookie: admin.cookies, 'x-csrf-token': csrf.csrfToken };
    const settings = {
      title: 'Ordering and matching', description: '', slug: 'ordering-matching', status: 'active',
      identityMode: 'anonymous', requiredAnswerBehavior: 'allow_incomplete', navigationPolicy: 'free',
      resultVisibility: 'after_submission', maximumAttempts: 5, attemptTimeLimitSeconds: null,
      submissionDeadlineAt: null, shuffleQuestionOptions: false
    };
    const created = (await app.inject({ method: 'POST', url: '/api/activities', headers: adminHeaders, payload: { settings } })).json();
    const draft = {
      expectedRevision: 0,
      slides: [
        { id: 'ordering_slide', title: 'Order', description: '', blocks: [{
          id: 'ordering_question', type: 'question', questionType: 'ordering', graded: true, points: 6, required: true,
          config: { prompt: 'Order the layers', shuffleItems: true, gradingMode: 'partial', items: [{ id: 'o3', label: 'Layer 3' }, { id: 'o1', label: 'Layer 1' }, { id: 'o4', label: 'Layer 4' }, { id: 'o2', label: 'Layer 2' }] },
          answerKey: { orderedItemIds: ['o1', 'o2', 'o3', 'o4'], feedback: 'Private canonical order' }
        }] },
        { id: 'matching_slide', title: 'Match', description: '', blocks: [{
          id: 'matching_question', type: 'question', questionType: 'matching', graded: true, points: 4, required: true,
          config: {
            prompt: 'Match the terms', shuffleLeftItems: true, shuffleRightItems: true, gradingMode: 'partial',
            leftItems: [{ id: 'l1', label: 'HTTP' }, { id: 'l2', label: 'DNS' }],
            rightItems: [{ id: 'r2', label: 'Names' }, { id: 'r1', label: 'Web' }]
          },
          answerKey: { pairs: [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }], feedback: 'Private pair mapping' }
        }] }
      ]
    };
    expect((await app.inject({ method: 'PUT', url: `/api/activities/${created.activity.id}/draft`, headers: adminHeaders, payload: draft })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/activities/${created.activity.id}/publish`, headers: adminHeaders, payload: { expectedRevision: 1 } })).statusCode).toBe(201);
    const started = await app.inject({ method: 'POST', url: '/api/activities/public/ordering-matching/attempts', payload: { participantKey: 'ordering_matching_participant_001' } });
    expect(started.statusCode).toBe(201);
    const credential = started.json();
    const initialPayload = JSON.stringify(credential.attempt);
    expect(initialPayload).not.toContain('orderedItemIds');
    expect(initialPayload).not.toContain('Private canonical order');
    expect(initialPayload).not.toContain('Private pair mapping');
    const authorization = { authorization: `Bearer ${credential.attemptToken}` };
    const orderingBlock = credential.attempt.slides[0].blocks[0];
    const matchingBlock = credential.attempt.slides[1].blocks[0];
    const displayedOrdering = orderingBlock.config.items.map((item: { id: string }) => item.id);
    const displayedLeft = matchingBlock.config.leftItems.map((item: { id: string }) => item.id);
    const displayedRight = matchingBlock.config.rightItems.map((item: { id: string }) => item.id);

    const duplicateMapping = await app.inject({
      method: 'PATCH', url: `/api/activities/public/ordering-matching/attempts/${credential.attemptId}/responses/${matchingBlock.id}`,
      headers: authorization,
      payload: { answer: { questionType: 'matching', pairs: [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r1' }] }, clientRevision: 1 }
    });
    expect(duplicateMapping.statusCode).toBe(400);
    expect((await app.inject({
      method: 'PATCH', url: `/api/activities/public/ordering-matching/attempts/${credential.attemptId}/responses/${orderingBlock.id}`,
      headers: authorization,
      payload: { answer: { questionType: 'ordering', orderedItemIds: ['o1', 'o3', 'o2', 'o4'] }, clientRevision: 1 }
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: 'PATCH', url: `/api/activities/public/ordering-matching/attempts/${credential.attemptId}/responses/${matchingBlock.id}`,
      headers: authorization,
      payload: { answer: { questionType: 'matching', pairs: [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }] }, clientRevision: 1 }
    })).statusCode).toBe(200);
    const resumed = (await app.inject({ method: 'GET', url: `/api/activities/public/ordering-matching/attempts/${credential.attemptId}`, headers: authorization })).json();
    expect(resumed.slides[0].blocks[0].config.items.map((item: { id: string }) => item.id)).toEqual(displayedOrdering);
    expect(resumed.slides[1].blocks[0].config.leftItems.map((item: { id: string }) => item.id)).toEqual(displayedLeft);
    expect(resumed.slides[1].blocks[0].config.rightItems.map((item: { id: string }) => item.id)).toEqual(displayedRight);
    expect(resumed.responses).toEqual(expect.arrayContaining([
      expect.objectContaining({ questionBlockId: orderingBlock.id, answer: { questionType: 'ordering', orderedItemIds: ['o1', 'o3', 'o2', 'o4'] } }),
      expect.objectContaining({ questionBlockId: matchingBlock.id, answer: { questionType: 'matching', pairs: [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }] } })
    ]));
    const submitted = await app.inject({ method: 'POST', url: `/api/activities/public/ordering-matching/attempts/${credential.attemptId}/submit`, headers: authorization, payload: {} });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().result).toMatchObject({ score: 7, maximumScore: 10 });
    expect(JSON.stringify(submitted.json().result)).not.toContain('orderedItemIds');
    expect(JSON.stringify(submitted.json().result)).not.toContain('rightId');
    const orderingGrade = getDb().prepare('SELECT awarded_points as points FROM activity_attempt_responses WHERE attempt_id = ? AND question_block_id = ?').get(credential.attemptId, orderingBlock.id);
    expect(orderingGrade).toEqual({ points: 3 });
    await app.close();
  });

  test('republishing changed question points rescales finalized grades while preserving immutable versions and allows an admin override', async () => {
    const { buildApp } = await import('./app.js');
    const { getDb } = await import('./db.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const admin = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);
    const adminHeaders = { cookie: admin.cookies, 'x-csrf-token': csrf.csrfToken };
    const settings = {
      title: 'Point reconciliation', description: '', slug: 'point-reconciliation', status: 'active',
      identityMode: 'anonymous', requiredAnswerBehavior: 'allow_incomplete', navigationPolicy: 'free',
      resultVisibility: 'after_submission', feedbackPolicy: 'points_per_question', maximumAttempts: 5,
      attemptTimeLimitSeconds: null, submissionDeadlineAt: null, shuffleQuestionOptions: false
    };
    const created = (await app.inject({ method: 'POST', url: '/api/activities', headers: adminHeaders, payload: { settings } })).json();
    const question = {
      id: 'reconciled_matching_question', type: 'question', questionType: 'matching', graded: true, points: 1, required: false,
      config: {
        prompt: 'Match one of three pairs', shuffleLeftItems: false, shuffleRightItems: false, gradingMode: 'partial',
        leftItems: [{ id: 'l1', label: 'One' }, { id: 'l2', label: 'Two' }, { id: 'l3', label: 'Three' }],
        rightItems: [{ id: 'r1', label: '1' }, { id: 'r2', label: '2' }, { id: 'r3', label: '3' }]
      },
      answerKey: {
        pairs: [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }, { leftId: 'l3', rightId: 'r3' }],
        feedback: ''
      }
    };
    const draft = { expectedRevision: 0, slides: [{ id: 'reconciled_slide', title: 'Match', description: '', blocks: [question] }] };
    expect((await app.inject({ method: 'PUT', url: `/api/activities/${created.activity.id}/draft`, headers: adminHeaders, payload: draft })).statusCode).toBe(200);
    const firstVersion = (await app.inject({ method: 'POST', url: `/api/activities/${created.activity.id}/publish`, headers: adminHeaders, payload: { expectedRevision: 1 } })).json();
    const started = (await app.inject({ method: 'POST', url: '/api/activities/public/point-reconciliation/attempts', payload: { participantKey: 'point_reconciliation_participant' } })).json();
    const block = started.attempt.slides[0].blocks[0];
    const authorization = { authorization: `Bearer ${started.attemptToken}` };
    expect((await app.inject({
      method: 'PATCH',
      url: `/api/activities/public/point-reconciliation/attempts/${started.attemptId}/responses/${block.id}`,
      headers: authorization,
      payload: { answer: { questionType: 'matching', pairs: [{ leftId: 'l1', rightId: 'r1' }] }, clientRevision: 1 }
    })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/activities/public/point-reconciliation/attempts/${started.attemptId}/submit`, headers: authorization, payload: {} })).statusCode).toBe(200);
    const before = (await app.inject({ method: 'GET', url: `/api/activities/${created.activity.id}/attempts/${started.attemptId}`, headers: { cookie: admin.cookies } })).json();
    expect(before).toMatchObject({ maximumScore: 1 });
    expect(before.responses[0]).toMatchObject({ awardedPoints: 0.333, maximumPoints: 1, gradingStatus: 'graded' });

    const changedDraft = {
      expectedRevision: 1,
      slides: [{ id: 'reconciled_slide', title: 'Match', description: '', blocks: [{ ...question, points: 3 }] }]
    };
    expect((await app.inject({ method: 'PUT', url: `/api/activities/${created.activity.id}/draft`, headers: adminHeaders, payload: changedDraft })).statusCode).toBe(200);
    const stillUnchanged = (await app.inject({ method: 'GET', url: `/api/activities/${created.activity.id}/attempts/${started.attemptId}`, headers: { cookie: admin.cookies } })).json();
    expect(stillUnchanged.responses[0]).toMatchObject({ awardedPoints: 0.333, maximumPoints: 1 });

    expect((await app.inject({ method: 'POST', url: `/api/activities/${created.activity.id}/publish`, headers: adminHeaders, payload: { expectedRevision: 2 } })).statusCode).toBe(201);
    const reconciled = (await app.inject({ method: 'GET', url: `/api/activities/${created.activity.id}/attempts/${started.attemptId}`, headers: { cookie: admin.cookies } })).json();
    expect(reconciled).toMatchObject({ score: 1, maximumScore: 3 });
    expect(reconciled.responses[0]).toMatchObject({ awardedPoints: 1, maximumPoints: 3, gradingStatus: 'graded' });
    expect(getDb().prepare(
      `SELECT b.points FROM activity_version_blocks b
       INNER JOIN activity_version_slides s ON s.id = b.slide_id
       WHERE s.version_id = ? AND b.stable_id = ?`
    ).get(firstVersion.id, question.id)).toEqual({ points: 1 });

    const overridden = await app.inject({
      method: 'POST',
      url: `/api/activities/${created.activity.id}/attempts/${started.attemptId}/responses/${block.id}/grade`,
      headers: adminHeaders,
      payload: { awardedPoints: 2.4, teacherFeedback: 'Teacher override.' }
    });
    expect(overridden.statusCode).toBe(200);
    expect(overridden.json()).toMatchObject({ score: 2.4, maximumScore: 3 });
    expect(overridden.json().responses[0]).toMatchObject({ awardedPoints: 2.4, maximumPoints: 3, teacherFeedback: 'Teacher override.' });
    await app.close();
  });

  test('Image Labeling uses external HTTPS images, autosaves stable mappings, and grades on the server', async () => {
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const admin = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);
    const adminHeaders = { cookie: admin.cookies, 'x-csrf-token': csrf.csrfToken };
    expect((await app.inject({ method: 'POST', url: '/api/activities/media', headers: adminHeaders, payload: {} })).statusCode).toBe(404);

    const settings = {
      title: 'Image assessment', description: '', slug: 'image-assessment', status: 'active', identityMode: 'anonymous',
      requiredAnswerBehavior: 'require_all', navigationPolicy: 'free', resultVisibility: 'after_submission',
      maximumAttempts: 5, attemptTimeLimitSeconds: null, submissionDeadlineAt: null, shuffleQuestionOptions: false
    };
    const created = (await app.inject({ method: 'POST', url: '/api/activities', headers: adminHeaders, payload: { settings } })).json();
    const markers = [{ id: 'marker_1', x: 0.1, y: 0.2 }, { id: 'marker_2', x: 0.5, y: 0.5 }, { id: 'marker_3', x: 0.9, y: 0.8 }];
    const labels = [{ id: 'label_1', label: 'A' }, { id: 'label_2', label: 'B' }, { id: 'label_3', label: 'C' }];
    const correctAssignments = [{ markerId: 'marker_1', labelId: 'label_1' }, { markerId: 'marker_2', labelId: 'label_2' }, { markerId: 'marker_3', labelId: 'label_3' }];
    const draft = {
      expectedRevision: 0,
      slides: [{ id: 'image_slide', title: 'Diagram', description: '', blocks: [{
        id: 'image_question', type: 'question', questionType: 'image_labeling', graded: true, points: 6, required: true,
        config: { prompt: 'Label the diagram', imageUrl: 'https://example.com/class-diagram.png', imageAlt: 'Class diagram', markers, labels, oneToOne: true, gradingMode: 'partial' },
        answerKey: { assignments: correctAssignments, feedback: 'Private image feedback' }
      }] }]
    };
    expect((await app.inject({ method: 'PUT', url: `/api/activities/${created.activity.id}/draft`, headers: adminHeaders, payload: draft })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/activities/${created.activity.id}/publish`, headers: adminHeaders, payload: { expectedRevision: 1 } })).statusCode).toBe(201);
    const started = await app.inject({ method: 'POST', url: '/api/activities/public/image-assessment/attempts', payload: { participantKey: 'image_labeling_participant_001' } });
    expect(started.statusCode).toBe(201);
    const credential = started.json();
    const serializedAttempt = JSON.stringify(credential.attempt);
    expect(serializedAttempt).not.toContain('Private image feedback');
    expect(serializedAttempt).not.toContain('correctAssignments');
    const block = credential.attempt.slides[0].blocks[0];
    const authorization = { authorization: `Bearer ${credential.attemptToken}` };
    const partialSave = await app.inject({ method: 'PATCH', url: `/api/activities/public/image-assessment/attempts/${credential.attemptId}/responses/${block.id}`, headers: authorization, payload: { answer: { questionType: 'image_labeling', assignments: [{ markerId: 'marker_1', labelId: 'label_1' }] }, clientRevision: 1 } });
    expect(partialSave.statusCode).toBe(200);
    const partialResume = (await app.inject({ method: 'GET', url: `/api/activities/public/image-assessment/attempts/${credential.attemptId}`, headers: authorization })).json();
    expect(partialResume.responses[0].answer.assignments).toEqual([{ markerId: 'marker_1', labelId: 'label_1' }]);
    expect((await app.inject({ method: 'POST', url: `/api/activities/public/image-assessment/attempts/${credential.attemptId}/submit`, headers: authorization, payload: {} })).statusCode).toBe(409);
    const duplicate = await app.inject({ method: 'PATCH', url: `/api/activities/public/image-assessment/attempts/${credential.attemptId}/responses/${block.id}`, headers: authorization, payload: { answer: { questionType: 'image_labeling', assignments: [{ markerId: 'marker_1', labelId: 'label_1' }, { markerId: 'marker_2', labelId: 'label_1' }] }, clientRevision: 2 } });
    expect(duplicate.statusCode).toBe(400);
    const submittedAssignments = [{ markerId: 'marker_1', labelId: 'label_1' }, { markerId: 'marker_2', labelId: 'label_3' }, { markerId: 'marker_3', labelId: 'label_2' }];
    expect((await app.inject({ method: 'PATCH', url: `/api/activities/public/image-assessment/attempts/${credential.attemptId}/responses/${block.id}`, headers: authorization, payload: { answer: { questionType: 'image_labeling', assignments: submittedAssignments }, clientRevision: 2 } })).statusCode).toBe(200);
    const resumed = (await app.inject({ method: 'GET', url: `/api/activities/public/image-assessment/attempts/${credential.attemptId}`, headers: authorization })).json();
    expect(resumed.responses[0].answer).toEqual({ questionType: 'image_labeling', assignments: submittedAssignments });
    const submitted = await app.inject({ method: 'POST', url: `/api/activities/public/image-assessment/attempts/${credential.attemptId}/submit`, headers: authorization, payload: {} });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().result).toMatchObject({ score: 2, maximumScore: 6 });
    expect(JSON.stringify(submitted.json().result)).not.toContain('marker_1');
    expect(JSON.stringify(submitted.json().result)).not.toContain('label_1');
    await app.close();
  });

  test('Activity results aggregate, filter, paginate and export large UTF-8 datasets safely', async () => {
    const { buildApp } = await import('./app.js');
    const { getDb } = await import('./db.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const admin = await login(app, 'admin@example.com', 'test-admin-password-42', csrf);
    const adminHeaders = { cookie: admin.cookies, 'x-csrf-token': csrf.csrfToken };
    const settings = {
      title: 'Resultu pārbaude', description: '', slug: 'resultu-parbaude', status: 'active', identityMode: 'named',
      requiredAnswerBehavior: 'allow_incomplete', navigationPolicy: 'free', resultVisibility: 'after_submission',
      feedbackPolicy: 'points_per_question', maximumAttempts: 100, attemptTimeLimitSeconds: null,
      submissionDeadlineAt: null, shuffleQuestionOptions: false
    };
    const created = (await app.inject({ method: 'POST', url: '/api/activities', headers: adminHeaders, payload: { settings } })).json();
    const draft = { expectedRevision: 0, slides: [{ id: 'results_slide', title: 'Rezultāti', description: '', blocks: [{
      id: 'results_question', type: 'question', questionType: 'single_choice', graded: true, points: 2, required: false,
      config: { prompt: 'Izvēlies atbildi', description: '', options: [{ id: 'a', label: 'Ābols' }, { id: 'b', label: 'Bumbieris' }], shuffleOptions: false },
      answerKey: { correctOptionId: 'a', feedback: '' }
    }] }] };
    expect((await app.inject({ method: 'PUT', url: `/api/activities/${created.activity.id}/draft`, headers: adminHeaders, payload: draft })).statusCode).toBe(200);
    const published = (await app.inject({ method: 'POST', url: `/api/activities/${created.activity.id}/publish`, headers: adminHeaders, payload: { expectedRevision: 1 } })).json();
    const db = getDb();
    const block = db.prepare(
      `SELECT b.id FROM activity_version_blocks b INNER JOIN activity_version_slides s ON s.id = b.slide_id
       WHERE s.version_id = ? AND b.block_type = 'question'`
    ).get(published.id) as { id: string };

    expect((await app.inject({ method: 'GET', url: `/api/activities/${created.activity.id}/results` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/api/activities/${created.activity.id}/exports/attempts.csv` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/api/activities/${created.activity.id}/exports/responses.xlsx` })).statusCode).toBe(401);
    await seedUser('results-reader@example.com', 'results-reader-password-42');
    const otherCsrf = await getCsrfBundle(app);
    const other = await login(app, 'results-reader@example.com', 'results-reader-password-42', otherCsrf);
    expect((await app.inject({ method: 'GET', url: `/api/activities/${created.activity.id}/results`, headers: { cookie: other.cookies } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/activities/${created.activity.id}/exports/responses.csv`, headers: { cookie: other.cookies } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/activities/${created.activity.id}/exports/responses.xlsx`, headers: { cookie: other.cookies } })).statusCode).toBe(404);
    const empty = (await app.inject({ method: 'GET', url: `/api/activities/${created.activity.id}/results`, headers: { cookie: admin.cookies } })).json();
    expect(empty.overview).toMatchObject({ totalAttempts: 0, averageScore: null, medianScore: null, completionRate: 0 });
    expect(empty.attempts).toEqual([]);

    const insertAttempt = db.prepare(
      `INSERT INTO activity_attempts (
        id, activity_id, published_version_id, participant_name, attempt_number, access_token_hash,
        status, started_at, submitted_at, submission_reason, revision, score, maximum_score,
        grading_revision, created_at, updated_at, score_units, maximum_score_units, grading_state
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 1, ?, 2, 1, ?, ?, ?, 2000, ?)`
    );
    const insertResponse = db.prepare(
      `INSERT INTO activity_attempt_responses (
        attempt_id, question_block_id, answer_json, moderation_status, client_revision, server_revision,
        saved_at, finalized_at, grading_status, awarded_points, grading_details_json, awarded_points_units, teacher_feedback
      ) VALUES (?, ?, ?, 'approved', 1, 1, ?, ?, 'graded', ?, '{}', ?, '')`
    );
    const expectedScores: number[] = [];
    db.exec('BEGIN IMMEDIATE');
    try {
      for (let index = 0; index < 125; index += 1) {
        const id = `analytics_attempt_${String(index).padStart(3, '0')}`;
        const expired = index >= 120;
        const timestamp = new Date(Date.UTC(2026, 0, 1, 10, index)).toISOString();
        const score = index % 3;
        expectedScores.push(score);
        insertAttempt.run(
          id, created.activity.id, published.id,
          index === 7 ? '=SUM(1,1)' : index === 8 ? 'Jānis Bērziņš' : `Student ${index}`,
          `token_hash_${index}`, expired ? 'auto_submitted' : 'submitted', timestamp,
          new Date(Date.parse(timestamp) + 90_000).toISOString(), expired ? 'deadline' : 'manual',
          score, timestamp, new Date(Date.parse(timestamp) + 90_000).toISOString(), score * 1000,
          index === 3 ? 'awaiting_manual_grading' : expired ? 'expired' : 'fully_graded'
        );
        if (index % 2 === 0) insertResponse.run(
          id, block.id, JSON.stringify({ questionType: 'single_choice', optionId: index % 4 === 0 ? 'a' : 'b' }),
          timestamp, timestamp, index % 4 === 0 ? 2 : 0, index % 4 === 0 ? 2000 : 0
        );
      }
      const inProgressAt = new Date(Date.UTC(2026, 0, 2, 12)).toISOString();
      insertAttempt.run(
        'in_progress_attempt', created.activity.id, published.id, 'Still working',
        'in_progress_token_hash', 'in_progress', inProgressAt, null, null,
        null, inProgressAt, inProgressAt, null, 'in_progress'
      );
      insertResponse.run(
        'in_progress_attempt', block.id,
        JSON.stringify({ questionType: 'single_choice', optionId: 'a' }),
        inProgressAt, null, 0, 0
      );
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }

    const pageTwo = (await app.inject({
      method: 'GET',
      url: `/api/activities/${created.activity.id}/results?page=2&pageSize=25`,
      headers: { cookie: admin.cookies }
    })).json();
    expect(pageTwo.pagination).toEqual({ page: 2, pageSize: 25, totalItems: 125, totalPages: 5 });
    expect(pageTwo.attempts).toHaveLength(25);
    expect(pageTwo.overview).toMatchObject({ totalAttempts: 125, submittedAttempts: 120, expiredAttempts: 5, awaitingManualGrading: 1, completionRate: 96 });
    const sortedScores = expectedScores.toSorted((left, right) => left - right);
    expect(pageTwo.overview.averageScore).toBeCloseTo(expectedScores.reduce((sum, value) => sum + value, 0) / expectedScores.length, 6);
    expect(pageTwo.overview.medianScore).toBe(sortedScores[Math.floor(sortedScores.length / 2)]);
    expect(pageTwo.questions[0]).toMatchObject({ attempts: 125, answered: 63, unanswered: 62, fullyCorrect: 32 });
    expect(pageTwo.questions[0].correctnessRate).toBeCloseTo(32 / 63 * 100, 6);
    expect(pageTwo.attempts.some((attempt: any) => attempt.id === 'in_progress_attempt')).toBe(false);
    expect((await app.inject({
      method: 'GET', url: `/api/activities/${created.activity.id}/results?status=in_progress`, headers: { cookie: admin.cookies }
    })).statusCode).toBe(400);

    const searched = (await app.inject({
      method: 'GET', url: `/api/activities/${created.activity.id}/results?search=J%C4%81nis&pageSize=20`, headers: { cookie: admin.cookies }
    })).json();
    expect(searched.pagination.totalItems).toBe(1);
    expect(searched.attempts[0].participantName).toBe('Jānis Bērziņš');
    expect(searched.attempts[0].durationSeconds).toBe(90);
    const expired = (await app.inject({
      method: 'GET', url: `/api/activities/${created.activity.id}/results?status=expired`, headers: { cookie: admin.cookies }
    })).json();
    expect(expired.pagination.totalItems).toBe(5);

    const attemptsCsv = await app.inject({ method: 'GET', url: `/api/activities/${created.activity.id}/exports/attempts.csv`, headers: { cookie: admin.cookies } });
    expect(attemptsCsv.statusCode).toBe(200);
    expect(attemptsCsv.headers['content-type']).toContain('text/csv');
    expect(attemptsCsv.body.charCodeAt(0)).toBe(0xfeff);
    expect(attemptsCsv.body).toContain("\"'=SUM(1,1)\"");
    expect(attemptsCsv.body).toContain('Jānis Bērziņš');
    expect(attemptsCsv.body).not.toContain('in_progress_attempt');
    const responsesCsv = await app.inject({ method: 'GET', url: `/api/activities/${created.activity.id}/exports/responses.csv`, headers: { cookie: admin.cookies } });
    expect(responsesCsv.statusCode).toBe(200);
    expect(responsesCsv.body).toContain('Izvēlies atbildi');
    expect(responsesCsv.body).not.toContain('in_progress_attempt');
    expect(responsesCsv.body.split('\r\n')).toHaveLength(127);
    const responsesXlsx = await app.inject({ method: 'GET', url: `/api/activities/${created.activity.id}/exports/responses.xlsx`, headers: { cookie: admin.cookies } });
    expect(responsesXlsx.statusCode).toBe(200);
    expect(responsesXlsx.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(responsesXlsx.headers['content-disposition']).toContain('activity-responses.xlsx');
    expect(responsesXlsx.rawPayload.subarray(0, 2).toString()).toBe('PK');
    await app.close();
  });
});
