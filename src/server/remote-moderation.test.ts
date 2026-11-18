// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const createTestDbPath = () =>
  path.join(process.cwd(), '.data', `test-remote-moderation-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);

const setTestEnv = (databasePath: string) => {
  Object.assign(process.env, {
    NODE_ENV: 'development',
    DATABASE_PATH: databasePath,
    APP_DATA_DIR: `${databasePath}.data`,
    ADMIN_EMAIL: 'admin@example.com',
    ADMIN_PASSWORD: 'test-admin-password-42',
    ADMIN_NAME: 'Admin',
    COOKIE_SECURE: 'false',
    COOKIE_SAME_SITE: 'lax',
    PUBLIC_URL: 'http://localhost:3000',
    CORS_ORIGIN: 'http://localhost:5173',
    ENABLE_CSP: 'false',
    STORE_RAW_IP: 'false',
    IP_HASH_SECRET: 'remote-moderation-test-secret',
    API_RATE_LIMIT_ENABLED: 'false',
    LINK_CREATE_RATE_LIMIT_ENABLED: 'false',
    REDIRECT_RATE_LIMIT_ENABLED: 'false',
    RESET_ADMIN: 'false',
    RESET_ADMIN_ON_START: 'false',
    TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64')
  });
};

const extractCookies = (setCookie: string[] | string | undefined) => {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return values.map((value) => value.split(';')[0]).join('; ');
};

describe.sequential('remote moderation blocklists', () => {
  let databasePath = '';

  beforeEach(() => {
    databasePath = createTestDbPath();
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    setTestEnv(databasePath);
    vi.resetModules();
    vi.useRealTimers();
  });

  afterEach(async () => {
    try {
      const { resetDb } = await import('./db.js');
      resetDb();
    } catch {
      // A parser-only test may not have initialized SQLite.
    }
    fs.rmSync(databasePath, { force: true });
    fs.rmSync(`${databasePath}-wal`, { force: true });
    fs.rmSync(`${databasePath}-shm`, { force: true });
    fs.rmSync(`${databasePath}.data`, { recursive: true, force: true });
    vi.useRealTimers();
  });

  test('parses Contains, Whole word and strict Smart lists with shared normalization', async () => {
    const { parseRemoteModerationList } = await import('./services/remote-moderation-service.js');
    expect(parseRemoteModerationList('# comment\n  BAD\u200B WORD  \n\nBad word', 'contains')).toEqual([
      { pattern: 'BAD WORD', matchMode: 'contains' }
    ]);
    expect(parseRemoteModerationList('term', 'whole')).toEqual([
      { pattern: 'term', matchMode: 'whole_word' }
    ]);
    expect(parseRemoteModerationList('contains:phrase\nwhole:word', 'smart')).toEqual([
      { pattern: 'phrase', matchMode: 'contains' },
      { pattern: 'word', matchMode: 'whole_word' }
    ]);
    expect(() => parseRemoteModerationList('word\nunknown:value', 'smart'))
      .toThrow('Malformed Smart rule on line 1.');
    expect(() => parseRemoteModerationList('# comments only\n\n', 'contains'))
      .toThrow('Remote list does not contain any rules.');
  });

  test('accepts only structured GitHub Raw HTTPS TXT URLs and blocks private addresses', async () => {
    const { validateRemoteModerationUrl, isBlockedRemoteAddress } = await import('./services/remote-moderation-service.js');
    expect(validateRemoteModerationUrl('https://raw.githubusercontent.com/owner/repo/main/list.txt'))
      .toBe('https://raw.githubusercontent.com/owner/repo/main/list.txt');
    expect(() => validateRemoteModerationUrl('http://raw.githubusercontent.com/owner/repo/main/list.txt')).toThrow();
    expect(() => validateRemoteModerationUrl('https://github.com/owner/repo/raw/main/list.txt')).toThrow();
    expect(() => validateRemoteModerationUrl('https://raw.githubusercontent.com/owner/repo/main/list.json')).toThrow();
    expect(() => validateRemoteModerationUrl('https://raw.githubusercontent.com/owner/repo/main/list.txt?token=x')).toThrow();
    expect(isBlockedRemoteAddress('127.0.0.1')).toBe(true);
    expect(isBlockedRemoteAddress('10.0.0.5')).toBe(true);
    expect(isBlockedRemoteAddress('::1')).toBe(true);
    expect(isBlockedRemoteAddress('185.199.108.133')).toBe(false);
  });

  test('atomically updates cached rules, detects unchanged content and retains the last valid list on failure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T10:00:00.000Z'));
    const { getDb } = await import('./db.js');
    const { ModerationFilterService } = await import('./services/moderation-filter-service.js');
    const { ModerationRemoteRepository } = await import('./repositories/moderation-remote-repository.js');
    const { RemoteModerationService } = await import('./services/remote-moderation-service.js');
    const db = getDb();
    db.prepare(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at)
      VALUES ('owner', 'owner@example.test', 'Owner', 'hash', ?, ?)
    `).run(new Date().toISOString(), new Date().toISOString());

    let body = '# list\nwhole:blocked\ncontains:bad phrase';
    const fetchImpl = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' }
    })) as unknown as typeof fetch;
    const filter = new ModerationFilterService();
    const repository = new ModerationRemoteRepository();
    const service = new RemoteModerationService(filter, repository, fetchImpl, async () => ['185.199.108.133']);
    filter.create('owner', 'local-only', 'whole_word');
    const source = service.create('owner', {
      url: 'https://raw.githubusercontent.com/owner/repo/main/list.txt',
      parsingMode: 'smart',
      updateIntervalMinutes: null,
      enabled: true
    });

    const first = await service.sync('owner', source.id);
    expect(first).toMatchObject({ ruleCount: 2, syncStatus: 'success' });
    expect(filter.list('owner')).toHaveLength(1);
    expect(filter.match('owner', 'local-only')).toBeTruthy();
    expect(filter.match('owner', 'A blocked value')?.matchMode).toBe('whole_word');
    expect(filter.match('owner', 'contains a BAD PHRASE here')?.matchMode).toBe('contains');
    const firstSuccessfulAt = first.lastSuccessfulUpdateAt;

    vi.setSystemTime(new Date('2026-11-18T11:00:00.000Z'));
    const unchanged = await service.sync('owner', source.id);
    expect(unchanged.syncStatus).toBe('unchanged');
    expect(unchanged.lastSuccessfulUpdateAt).toBe(firstSuccessfulAt);
    expect(unchanged.lastCheckedAt).toBe('2026-11-18T11:00:00.000Z');

    body = 'not-a-smart-directive';
    vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'));
    await expect(service.sync('owner', source.id)).rejects.toThrow('Malformed Smart rule');
    const failed = service.inspect('owner', source.id);
    expect(failed.source).toMatchObject({ syncStatus: 'error', ruleCount: 2, lastSuccessfulUpdateAt: firstSuccessfulAt });
    expect(failed.rules).toHaveLength(2);
    expect(filter.match('owner', 'blocked')).toBeTruthy();
    expect(db.prepare('SELECT name FROM schema_migrations WHERE version = 28').get())
      .toEqual({ name: 'remote_moderation_blocklists' });
  });

  test('keeps multiple sources independent and removes only deleted source rules', async () => {
    const { getDb } = await import('./db.js');
    const { ModerationFilterService } = await import('./services/moderation-filter-service.js');
    const { ModerationRemoteRepository } = await import('./repositories/moderation-remote-repository.js');
    const { RemoteModerationService } = await import('./services/remote-moderation-service.js');
    const db = getDb();
    db.prepare(`INSERT INTO users (id, email, name, password_hash, created_at, updated_at)
      VALUES ('owner', 'owner@example.test', 'Owner', 'hash', datetime('now'), datetime('now'))`).run();
    const responses = new Map([
      ['https://raw.githubusercontent.com/owner/repo/main/one.txt', 'first'],
      ['https://raw.githubusercontent.com/owner/repo/main/two.txt', 'second']
    ]);
    const fetchImpl = vi.fn(async (url: string | URL | Request) => new Response(responses.get(String(url)) ?? '', { status: 200 })) as unknown as typeof fetch;
    const filter = new ModerationFilterService();
    const service = new RemoteModerationService(filter, new ModerationRemoteRepository(), fetchImpl, async () => ['185.199.108.133']);
    const first = service.create('owner', { url: [...responses.keys()][0], parsingMode: 'whole', enabled: true, updateIntervalMinutes: null });
    const second = service.create('owner', { url: [...responses.keys()][1], parsingMode: 'contains', enabled: true, updateIntervalMinutes: null });
    await service.sync('owner', first.id);
    await service.sync('owner', second.id);
    expect(filter.match('owner', 'first')).toBeTruthy();
    expect(filter.match('owner', 'has second inside')).toBeTruthy();
    service.delete('owner', first.id);
    expect(filter.match('owner', 'first')).toBeUndefined();
    expect(filter.match('owner', 'has second inside')).toBeTruthy();
    service.setEnabled('owner', second.id, false);
    expect(filter.match('owner', 'second')).toBeUndefined();
  });

  test('protects administrative source endpoints with auth and CSRF', async () => {
    const { buildApp } = await import('./app.js');
    const app = await buildApp();
    expect((await app.inject({ method: 'GET', url: '/api/moderation/remote-sources' })).statusCode).toBe(401);
    const csrfResponse = await app.inject({ method: 'GET', url: '/api/auth/csrf-token' });
    const csrfToken = csrfResponse.json().csrfToken as string;
    const csrfCookies = extractCookies(csrfResponse.headers['set-cookie'] as string[] | string | undefined);
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { cookie: csrfCookies, 'x-csrf-token': csrfToken },
      payload: { email: 'admin@example.com', password: 'test-admin-password-42' }
    });
    const cookies = `${csrfCookies}; ${extractCookies(loginResponse.headers['set-cookie'] as string[] | string | undefined)}`;
    const headers = { cookie: cookies, 'x-csrf-token': csrfToken };
    expect((await app.inject({
      method: 'POST', url: '/api/moderation/remote-sources', headers: { cookie: cookies },
      payload: { url: 'https://raw.githubusercontent.com/owner/repo/main/list.txt', parsingMode: 'contains' }
    })).statusCode).toBe(403);
    const createdResponse = await app.inject({
      method: 'POST', url: '/api/moderation/remote-sources', headers,
      payload: {
        url: 'https://raw.githubusercontent.com/owner/repo/main/list.txt',
        parsingMode: 'contains', updateIntervalMinutes: null, enabled: true
      }
    });
    expect(createdResponse.statusCode).toBe(201);
    const created = createdResponse.json();
    expect(created).toMatchObject({ parsingMode: 'contains', ruleCount: 0, syncStatus: 'pending' });
    expect((await app.inject({
      method: 'GET', url: `/api/moderation/remote-sources/${created.id}`, headers: { cookie: cookies }
    })).json()).toMatchObject({ source: { id: created.id }, rules: [] });
    expect((await app.inject({
      method: 'POST', url: `/api/moderation/remote-sources/${created.id}/enabled`, headers,
      payload: { enabled: false }
    })).json()).toMatchObject({ enabled: false });
    expect((await app.inject({
      method: 'DELETE', url: `/api/moderation/remote-sources/${created.id}`, headers
    })).json()).toEqual({ ok: true });
    expect(await app.inject({
      method: 'GET', url: `/api/moderation/remote-sources/${created.id}`, headers: { cookie: cookies }
    })).toMatchObject({ statusCode: 404 });
    await app.close();
  });
});
