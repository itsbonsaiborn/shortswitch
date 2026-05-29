// @vitest-environment node
import argon2 from 'argon2';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const envKeys = [
  'NODE_ENV',
  'DATABASE_PATH',
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
    ADMIN_EMAIL: 'admin@example.com',
    ADMIN_PASSWORD: 'change-me-now',
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
    const { response } = await login(app, 'admin@example.com', 'change-me-now', csrf);
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
    const { cookies } = await login(app, 'admin@example.com', 'change-me-now', csrf);

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
    const adminLogin = await login(app, 'admin@example.com', 'change-me-now', adminCsrf);
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

    const success = await login(app, 'admin@example.com', 'change-me-now', csrf);
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
    const { cookies } = await login(app, 'admin@example.com', 'change-me-now', csrf);

    await app.inject({
      method: 'POST',
      url: '/api/links',
      payload: { targetUrl: 'https://example.com', slug: 'secret1', password: '123456' },
      headers: {
        cookie: cookies,
        'x-csrf-token': csrf.csrfToken
      }
    });

    await app.inject({
      method: 'POST',
      url: '/access/secret1',
      payload: { password: 'wrong' }
    });

    const blocked = await app.inject({
      method: 'POST',
      url: '/access/secret1',
      payload: { password: 'wrong' }
    });
    expect(blocked.statusCode).toBe(429);

    await app.close();
  });

  test('protected link with valid password redirects with 303 See Other', async () => {
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const { cookies } = await login(app, 'admin@example.com', 'change-me-now', csrf);

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
    const { cookies } = await login(app, 'admin@example.com', 'change-me-now', csrf);

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
    const { cookies } = await login(app, 'admin@example.com', 'change-me-now', csrf);

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
    const { cookies } = await login(app, 'admin@example.com', 'change-me-now', csrf);

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
    const { cookies } = await login(app, 'admin@example.com', 'change-me-now', csrf);

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
    const { cookies } = await login(app, 'admin@example.com', 'change-me-now', csrf);

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

  test('analytics can be cleared from settings and link counters are reset', async () => {
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const { cookies } = await login(app, 'admin@example.com', 'change-me-now', csrf);

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
    expect(analyticsCount.count).toBe(0);
    expect(clickCount.clickCount).toBe(0);

    await app.close();
  });

  test('analytics can be cleared for a single link without affecting other links', async () => {
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    const csrf = await getCsrfBundle(app);
    const { cookies } = await login(app, 'admin@example.com', 'change-me-now', csrf);

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
    const { cookies } = await login(app, 'admin@example.com', 'change-me-now', csrf);

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
    const { cookies } = await login(app, 'admin@example.com', 'change-me-now', csrf);

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
    const { cookies } = await login(app, 'admin@example.com', 'change-me-now', csrf);

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

    const { getDb } = await import('./db.js');
    const db = getDb();
    const rawIp = db.prepare('SELECT raw_ip as rawIp FROM analytics_events WHERE link_id = ? LIMIT 1').get(link.id) as { rawIp: string | null } | undefined;
    expect(rawIp?.rawIp ?? null).toBeNull();

    const analyticsAuth = await app.inject({ method: 'GET', url: `/api/links/${link.id}/analytics?range=day&limit=10` });
    expect(analyticsAuth.statusCode).toBe(401);

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

    const { cookies } = await login(app, 'admin@example.com', 'change-me-now', csrf);
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
    let loginOld = await login(app, 'admin@example.com', 'change-me-now', csrf);
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
    loginOld = await login(app, 'admin@example.com', 'change-me-now', csrf);
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

    const oldAdminLogin = await login(app, 'admin@example.com', 'change-me-now', csrf);
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
    const sessionA = await login(app, 'admin@example.com', 'change-me-now', csrfA);
    const sessionB = await login(app, 'admin@example.com', 'change-me-now', csrfB);

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
});
