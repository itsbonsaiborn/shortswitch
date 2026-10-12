import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const visitorCount = Number(process.argv[2] ?? 200);
const concurrency = Number(process.argv[3] ?? 50);
if (!Number.isInteger(visitorCount) || visitorCount < 1 || visitorCount > 1000) {
  throw new Error('Visitor count must be an integer between 1 and 1000.');
}

const databasePath = path.join(os.tmpdir(), `shortswitch-pages-load-${randomUUID()}.db`);
Object.assign(process.env, {
  NODE_ENV: 'development',
  DATABASE_PATH: databasePath,
  ADMIN_EMAIL: 'pages-load@example.invalid',
  ADMIN_PASSWORD: `pages-${randomUUID()}`,
  ADMIN_NAME: 'Pages Load Test Admin',
  COOKIE_SECURE: 'false',
  CORS_ORIGIN: 'http://127.0.0.1',
  PUBLIC_URL: 'http://127.0.0.1',
  STORE_RAW_IP: 'false',
  IP_HASH_SECRET: `pages-${randomUUID()}-${randomUUID()}`,
  ENABLE_CSP: 'false',
  API_RATE_LIMIT_ENABLED: 'false',
  LINK_CREATE_RATE_LIMIT_ENABLED: 'false',
  REDIRECT_RATE_LIMIT_ENABLED: 'false'
});

const cookiesFrom = (response) => response.headers.getSetCookie().map((entry) => entry.split(';')[0]).join('; ');
const pool = async (items, worker, width) => {
  let index = 0;
  const workers = Array.from({ length: Math.min(width, items.length) }, async () => {
    while (index < items.length) await worker(items[index++]);
  });
  await Promise.all(workers);
};

let app;
try {
  const { buildApp } = await import('../dist/server/app.js');
  app = await buildApp();
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const csrfResponse = await fetch(`${address}/api/auth/csrf-token`);
  const csrf = await csrfResponse.json();
  const csrfCookies = cookiesFrom(csrfResponse);
  const loginResponse = await fetch(`${address}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: csrfCookies, 'x-csrf-token': csrf.csrfToken },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })
  });
  if (!loginResponse.ok) throw new Error(`Admin login failed: ${loginResponse.status}`);
  const adminCookies = `${csrfCookies}; ${cookiesFrom(loginResponse)}`;
  const adminHeaders = { 'content-type': 'application/json', cookie: adminCookies, 'x-csrf-token': csrf.csrfToken };
  const slug = `page-load-${visitorCount}-${Date.now()}`;
  const createResponse = await fetch(`${address}/api/pages`, {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({
      title: `Pages load test ${visitorCount}`, slug, description: 'Isolated loopback performance verification',
      emoji: '🚀', theme: 'minimal_light', layout: 'classic', status: 'published',
      blocks: Array.from({ length: 12 }, (_, index) => index === 0
        ? { type: 'heading', visible: true, config: { text: 'Useful resources', alignment: 'center', size: 'large' } }
        : { type: 'link', visible: true, config: { title: `Resource ${index}`, subtitle: 'Short description', url: `https://example.com/${index}`, openInNewTab: true } })
    })
  });
  if (!createResponse.ok) throw new Error(`Page creation failed: ${createResponse.status} ${await createResponse.text()}`);
  const page = await createResponse.json();
  const clickableBlock = page.blocks.find((block) => block.type === 'link');
  if (!clickableBlock) throw new Error('Created Page has no clickable block.');

  const visitors = Array.from({ length: visitorCount }, (_, index) => index);
  const cpuStartedAt = process.cpuUsage();
  const startedAt = performance.now();
  let peakRssBytes = process.memoryUsage().rss;
  const memoryMonitor = setInterval(() => { peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss); }, 25);
  memoryMonitor.unref();
  let htmlBytes = 0;
  let apiBytes = 0;
  const responseTimes = [];

  await pool(visitors, async (index) => {
    const requestStartedAt = performance.now();
    const forwardedIp = `198.51.${Math.floor(index / 250)}.${(index % 250) + 1}`;
    const [htmlResponse, apiResponse] = await Promise.all([
      fetch(`${address}/${slug}`, { headers: { 'accept-encoding': 'br', 'x-forwarded-for': forwardedIp } }),
      fetch(`${address}/api/pages/public/${slug}`, { headers: { 'x-forwarded-for': forwardedIp } })
    ]);
    if (!htmlResponse.ok || !apiResponse.ok) throw new Error(`Page load failed: ${htmlResponse.status}/${apiResponse.status}`);
    htmlBytes += Number(htmlResponse.headers.get('content-length')) || (await htmlResponse.arrayBuffer()).byteLength;
    apiBytes += (await apiResponse.arrayBuffer()).byteLength;
    responseTimes.push(performance.now() - requestStartedAt);
    const clickResponse = await fetch(`${address}/api/pages/public/${slug}/clicks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': forwardedIp },
      body: JSON.stringify({ blockId: clickableBlock.id, eventId: randomUUID().replaceAll('-', '') })
    });
    if (clickResponse.status !== 202) throw new Error(`Click tracking failed: ${clickResponse.status}`);
  }, concurrency);

  let analytics;
  const deadline = Date.now() + 5_000;
  do {
    const response = await fetch(`${address}/api/pages/${page.id}/analytics`, { headers: { cookie: adminCookies } });
    analytics = await response.json();
    if (analytics.totalViews === visitorCount && analytics.totalLinkClicks === visitorCount) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  if (analytics.totalViews !== visitorCount || analytics.uniqueVisitors !== visitorCount || analytics.totalLinkClicks !== visitorCount) {
    throw new Error(`Unexpected analytics totals: ${JSON.stringify(analytics)}`);
  }

  clearInterval(memoryMonitor);
  responseTimes.sort((a, b) => a - b);
  const durationMs = performance.now() - startedAt;
  const cpu = process.cpuUsage(cpuStartedAt);
  const transferredBytes = htmlBytes + apiBytes;
  console.log(JSON.stringify({
    visitors: visitorCount,
    concurrency,
    pageBlocks: page.blocks.length,
    htmlBytes,
    apiBytes,
    transferredBytes,
    averageBytesPerVisitor: Math.round(transferredBytes / visitorCount),
    durationMs: Math.round(durationMs),
    visitorsPerSecond: Number((visitorCount / (durationMs / 1000)).toFixed(1)),
    medianResponseMs: Number(responseTimes[Math.floor(responseTimes.length * 0.5)].toFixed(1)),
    p95ResponseMs: Number(responseTimes[Math.min(responseTimes.length - 1, Math.floor(responseTimes.length * 0.95))].toFixed(1)),
    peakRssMiB: Number((peakRssBytes / 1024 / 1024).toFixed(1)),
    cpuUserMs: Number((cpu.user / 1000).toFixed(1)),
    cpuSystemMs: Number((cpu.system / 1000).toFixed(1)),
    estimatedTransferMsAt25Mbps: Number(((transferredBytes * 8 / 25_000_000) * 1000).toFixed(2)),
    analytics: { views: analytics.totalViews, uniqueVisitors: analytics.uniqueVisitors, clicks: analytics.totalLinkClicks },
    environment: 'isolated local loopback; not a real 25 Mbps network test',
    result: 'passed'
  }, null, 2));
} finally {
  if (app) await app.close();
  try {
    const { resetDb } = await import('../dist/server/db.js');
    resetDb();
  } catch {}
  await Promise.all(['', '-shm', '-wal'].map((suffix) => fs.rm(`${databasePath}${suffix}`, { force: true })));
}
