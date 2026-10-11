import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const databasePath = path.join(os.tmpdir(), `shortswitch-production-check-${randomUUID()}.db`);
const adminPassword = `verify-${randomUUID()}`;
Object.assign(process.env, {
  NODE_ENV: 'development',
  DATABASE_PATH: databasePath,
  ADMIN_EMAIL: 'verify@example.invalid',
  ADMIN_PASSWORD: adminPassword,
  ADMIN_NAME: 'Verification Admin',
  COOKIE_SECURE: 'false',
  CORS_ORIGIN: 'http://127.0.0.1',
  PUBLIC_URL: 'http://127.0.0.1',
  STORE_RAW_IP: 'false',
  IP_HASH_SECRET: `verify-${randomUUID()}-${randomUUID()}`,
  ENABLE_CSP: 'false',
  API_RATE_LIMIT_ENABLED: 'false',
  LINK_CREATE_RATE_LIMIT_ENABLED: 'false',
  REDIRECT_RATE_LIMIT_ENABLED: 'false'
});

const cookiesFrom = (response) => response.headers.getSetCookie().map((entry) => entry.split(';')[0]).join('; ');
let app;
let controller;
try {
  const { buildApp } = await import('../dist/server/app.js');
  app = await buildApp();
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const html = await fs.readFile(path.resolve('dist/client/index.html'), 'utf8');
  const assetPath = html.match(/\/app\/(assets\/[^"']+\.js)/)?.[1];
  assert(assetPath, 'Hashed JavaScript asset was not found in index.html.');
  const assetsRoot = path.resolve('dist/client/assets');
  const assetEntries = await fs.readdir(assetsRoot);
  const publicPageFile = assetEntries.find((name) => /^PublicLivePage-.+\.js$/.test(name));
  const cssFile = assetEntries.find((name) => /^index-.+\.css$/.test(name));
  assert(publicPageFile && cssFile, 'Public Live build assets were not found.');
  const publicFiles = new Set([path.basename(assetPath), publicPageFile, cssFile]);
  const visitImports = async (fileName) => {
    const source = await fs.readFile(path.join(assetsRoot, fileName), 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\()["']\.\/([^"']+\.js)/g)) {
      if (publicFiles.has(match[1])) continue;
      publicFiles.add(match[1]);
      await visitImports(match[1]);
    }
  };
  await visitImports(publicPageFile);
  const publicSizes = { uncompressed: 0, brotli: 0, gzip: 0 };
  for (const fileName of publicFiles) {
    const filePath = path.join(assetsRoot, fileName);
    const source = await fs.stat(filePath);
    publicSizes.uncompressed += source.size;
    for (const encoding of ['brotli', 'gzip']) {
      const suffix = encoding === 'brotli' ? '.br' : '.gz';
      try {
        publicSizes[encoding] += (await fs.stat(`${filePath}${suffix}`)).size;
      } catch {
        publicSizes[encoding] += source.size;
      }
    }
  }

  const brResponse = await fetch(`${address}/app/${assetPath}`, { headers: { 'accept-encoding': 'br' } });
  assert.equal(brResponse.status, 200);
  assert.equal(brResponse.headers.get('content-encoding'), 'br');
  assert.match(brResponse.headers.get('vary') ?? '', /Accept-Encoding/i);
  assert.match(brResponse.headers.get('cache-control') ?? '', /max-age=31536000/);
  assert.match(brResponse.headers.get('cache-control') ?? '', /immutable/);
  assert.match(brResponse.headers.get('content-type') ?? '', /javascript/);
  const brotliBytes = Number(brResponse.headers.get('content-length'));
  await brResponse.arrayBuffer();

  const gzipResponse = await fetch(`${address}/app/${assetPath}`, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(gzipResponse.headers.get('content-encoding'), 'gzip');
  const gzipBytes = Number(gzipResponse.headers.get('content-length'));
  await gzipResponse.arrayBuffer();

  const csrfResponse = await fetch(`${address}/api/auth/csrf-token`);
  const csrf = await csrfResponse.json();
  const csrfCookies = cookiesFrom(csrfResponse);
  const loginResponse = await fetch(`${address}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: csrfCookies, 'x-csrf-token': csrf.csrfToken },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: adminPassword })
  });
  assert.equal(loginResponse.status, 200);
  const adminCookies = `${csrfCookies}; ${cookiesFrom(loginResponse)}`;
  const adminHeaders = { 'content-type': 'application/json', cookie: adminCookies, 'x-csrf-token': csrf.csrfToken };
  const adminLive = await fetch(`${address}/api/live`, { headers: { cookie: adminCookies } });
  assert.equal(adminLive.headers.get('cache-control'), 'private, no-store');
  await adminLive.arrayBuffer();

  const liveResponse = await fetch(`${address}/api/live`, {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({
      title: 'Production verification', question: 'Does streaming work?', type: 'open_answer', slug: 'verify-live',
      status: 'active', identityMode: 'anonymous', allowMultipleResponses: false, maxResponsesPerParticipant: 1,
      moderationMode: 'off', maxAnswerLength: 280, publicResults: true
    })
  });
  assert.equal(liveResponse.status, 200);
  const linkResponse = await fetch(`${address}/api/links`, {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({ targetUrl: 'https://example.com', slug: 'verify-link' })
  });
  assert.equal(linkResponse.status, 200);

  const liveHtml = await fetch(`${address}/verify-live`, { headers: { 'accept-encoding': 'br' } });
  assert.equal(liveHtml.headers.get('cache-control'), 'no-cache');
  assert.equal(liveHtml.headers.get('content-encoding'), 'br');
  assert.match(liveHtml.headers.get('vary') ?? '', /Accept-Encoding/i);
  const liveHtmlCompressedBytes = Number(liveHtml.headers.get('content-length'));
  const liveHtmlBytes = Buffer.byteLength(await liveHtml.text());
  const dashboardHtml = await fetch(`${address}/app/links`, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(dashboardHtml.headers.get('cache-control'), 'no-cache');
  assert.equal(dashboardHtml.headers.get('content-encoding'), 'gzip');
  await dashboardHtml.arrayBuffer();
  const liveApi = await fetch(`${address}/api/live/public/verify-live`);
  assert.equal(liveApi.headers.get('cache-control'), 'no-store');
  await liveApi.arrayBuffer();
  const shortRedirect = await fetch(`${address}/verify-link`, { redirect: 'manual' });
  assert.match(shortRedirect.headers.get('cache-control') ?? '', /no-store/);

  controller = new AbortController();
  const sse = await fetch(`${address}/api/live/public/verify-live/events?protocol=2`, { signal: controller.signal });
  assert.equal(sse.status, 200);
  assert.equal(sse.headers.get('cache-control'), 'no-cache');
  assert.equal(sse.headers.get('x-accel-buffering'), 'no');
  assert.match(sse.headers.get('content-type') ?? '', /text\/event-stream/);
  const firstEvent = await sse.body.getReader().read();
  assert(firstEvent.value?.byteLength, 'SSE did not stream an initial snapshot.');

  console.log(JSON.stringify({
    assetPath,
    brotliBytes,
    gzipBytes,
    liveHtmlBytes,
    liveHtmlCompressedBytes,
    publicLiveCriticalAssets: {
      requests: publicFiles.size,
      files: [...publicFiles].sort(),
      ...publicSizes
    },
    cache: { hashedAsset: 'immutable', html: 'no-cache', liveApi: 'no-store', adminApi: 'private, no-store', sse: 'no-cache', shortUrl: 'no-store' },
    result: 'passed'
  }, null, 2));
} finally {
  controller?.abort();
  if (app) await app.close();
  try {
    const { resetDb } = await import('../dist/server/db.js');
    resetDb();
  } catch {}
  await Promise.all(['', '-shm', '-wal'].map((suffix) => fs.rm(`${databasePath}${suffix}`, { force: true })));
}
