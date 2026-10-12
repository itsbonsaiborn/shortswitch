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
  const publicLivePageFile = assetEntries.find((name) => /^PublicLivePage-.+\.js$/.test(name));
  const publicSlugPageFile = assetEntries.find((name) => /^PublicSlugPage-.+\.js$/.test(name));
  const publicPageFile = assetEntries.find((name) => /^PublicPagePage-.+\.js$/.test(name));
  const cssFile = assetEntries.find((name) => /^index-.+\.css$/.test(name));
  assert(publicLivePageFile && publicSlugPageFile && publicPageFile && cssFile, 'Public build assets were not found.');
  const collectCriticalFiles = async (entryFiles) => {
    const files = new Set([path.basename(assetPath), cssFile, ...entryFiles]);
    const visitImports = async (fileName) => {
      const source = await fs.readFile(path.join(assetsRoot, fileName), 'utf8');
      for (const match of source.matchAll(/(?:from\s*|import\()["']\.\/([^"']+\.js)/g)) {
        if (files.has(match[1])) continue;
        files.add(match[1]);
        await visitImports(match[1]);
      }
    };
    for (const fileName of entryFiles) await visitImports(fileName);
    return files;
  };
  const publicLiveFiles = await collectCriticalFiles([publicSlugPageFile, publicLivePageFile]);
  const publicPageFiles = await collectCriticalFiles([publicSlugPageFile, publicPageFile]);
  const measureFiles = async (files) => {
    const sizes = { uncompressed: 0, brotli: 0, gzip: 0 };
    for (const fileName of files) {
      const filePath = path.join(assetsRoot, fileName);
      const source = await fs.stat(filePath);
      sizes.uncompressed += source.size;
      for (const encoding of ['brotli', 'gzip']) {
        const suffix = encoding === 'brotli' ? '.br' : '.gz';
        try {
          sizes[encoding] += (await fs.stat(`${filePath}${suffix}`)).size;
        } catch {
          sizes[encoding] += source.size;
        }
      }
    }
    return sizes;
  };
  const publicLiveSizes = await measureFiles(publicLiveFiles);
  const publicPageSizes = await measureFiles(publicPageFiles);

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
  const pageResponse = await fetch(`${address}/api/pages`, {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({
      title: 'Verification Page', slug: 'verify-page', description: 'Public Page verification', emoji: '✅',
      theme: 'minimal_light', layout: 'classic', status: 'published',
      seoTitle: 'Verification Page SEO', seoDescription: 'SEO metadata verification',
      blocks: [
        { type: 'heading', visible: true, config: { text: 'Welcome', alignment: 'center', size: 'large' } },
        { type: 'link', visible: true, config: { title: 'Example', url: 'https://example.com', openInNewTab: true } }
      ]
    })
  });
  assert.equal(pageResponse.status, 200);
  const createdPage = await pageResponse.json();

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
  const pageHtml = await fetch(`${address}/verify-page`, { headers: { 'accept-encoding': 'br' } });
  assert.equal(pageHtml.status, 200);
  assert.equal(pageHtml.headers.get('cache-control'), 'no-cache');
  assert.equal(pageHtml.headers.get('content-encoding'), 'br');
  const pageHtmlCompressedBytes = Number(pageHtml.headers.get('content-length'));
  const pageHtmlText = await pageHtml.text();
  assert.match(pageHtmlText, /Verification Page SEO/);
  assert.match(pageHtmlText, /SEO metadata verification/);
  assert.match(pageHtmlText, /rel="canonical" href="http:\/\/127\.0\.0\.1\/verify-page"/);
  assert.match(pageHtmlText, /shortswitch-resource-type" content="page"/);
  const pageApi = await fetch(`${address}/api/pages/public/verify-page`);
  assert.equal(pageApi.status, 200);
  assert.equal(pageApi.headers.get('cache-control'), 'no-store');
  const publicPage = await pageApi.json();
  assert.equal(publicPage.title, 'Verification Page');
  assert.equal(publicPage.blocks.length, 2);
  assert.equal('status' in publicPage, false);
  const adminPages = await fetch(`${address}/api/pages`, { headers: { cookie: adminCookies } });
  assert.equal(adminPages.headers.get('cache-control'), 'private, no-store');
  await adminPages.arrayBuffer();
  const clickResponse = await fetch(`${address}/api/pages/public/verify-page/clicks`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ blockId: createdPage.blocks[1].id, eventId: randomUUID().replaceAll('-', '') })
  });
  assert.equal(clickResponse.status, 202);
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
    pageHtmlBytes: Buffer.byteLength(pageHtmlText),
    pageHtmlCompressedBytes,
    publicLiveCriticalAssets: {
      requests: publicLiveFiles.size,
      files: [...publicLiveFiles].sort(),
      ...publicLiveSizes
    },
    publicPageCriticalAssets: {
      requests: publicPageFiles.size,
      files: [...publicPageFiles].sort(),
      ...publicPageSizes
    },
    cache: { hashedAsset: 'immutable', html: 'no-cache', liveApi: 'no-store', pageApi: 'no-store', adminApi: 'private, no-store', sse: 'no-cache', shortUrl: 'no-store' },
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
