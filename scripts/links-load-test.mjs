import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const visitorCount = Number(process.argv[2] ?? 200);
const concurrency = Number(process.argv[3] ?? 50);
if (!Number.isInteger(visitorCount) || visitorCount < 1 || visitorCount > 1000) {
  throw new Error('Visitor count must be an integer between 1 and 1000.');
}
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > visitorCount) {
  throw new Error('Concurrency must be an integer between 1 and the visitor count.');
}

const databasePath = path.join(os.tmpdir(), `shortswitch-links-load-${randomUUID()}.db`);
Object.assign(process.env, {
  NODE_ENV: 'development',
  DATABASE_PATH: databasePath,
  ADMIN_EMAIL: 'links-load@example.invalid',
  ADMIN_PASSWORD: `links-${randomUUID()}`,
  ADMIN_NAME: 'Links Load Test Admin',
  COOKIE_SECURE: 'false',
  CORS_ORIGIN: 'http://127.0.0.1',
  PUBLIC_URL: 'http://127.0.0.1',
  STORE_RAW_IP: 'false',
  IP_HASH_SECRET: `links-${randomUUID()}-${randomUUID()}`,
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
  const slug = `link-load-${visitorCount}-${Date.now()}`;
  const targetUrl = 'https://example.com/load-test';
  const createResponse = await fetch(`${address}/api/links`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ targetUrl, slug, comment: `Isolated load test with ${visitorCount} visitors` })
  });
  if (!createResponse.ok) throw new Error(`Link creation failed: ${createResponse.status} ${await createResponse.text()}`);
  const link = await createResponse.json();

  const visitors = Array.from({ length: visitorCount }, (_, index) => index);
  const cpuStartedAt = process.cpuUsage();
  const startedAt = performance.now();
  let peakRssBytes = process.memoryUsage().rss;
  const memoryMonitor = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }, 25);
  memoryMonitor.unref();
  let responseBodyBytes = 0;
  const responseTimes = [];

  await pool(visitors, async (index) => {
    const requestStartedAt = performance.now();
    const forwardedIp = `198.51.${Math.floor(index / 250)}.${(index % 250) + 1}`;
    const response = await fetch(`${address}/${slug}`, {
      redirect: 'manual',
      headers: {
        'accept-language': 'en-US,en;q=0.9',
        referer: 'https://example.org/load-source',
        'user-agent': 'Mozilla/5.0 ShortSwitchLoadTest/1.0',
        'x-forwarded-for': forwardedIp
      }
    });
    if (response.status !== 302 || response.headers.get('location') !== targetUrl) {
      throw new Error(`Redirect failed: ${response.status} ${response.headers.get('location')}`);
    }
    responseBodyBytes += (await response.arrayBuffer()).byteLength;
    responseTimes.push(performance.now() - requestStartedAt);
  }, concurrency);

  let analytics;
  const deadline = Date.now() + 5_000;
  do {
    const response = await fetch(`${address}/api/links/${link.id}/analytics?range=day&limit=10`, {
      headers: { cookie: adminCookies }
    });
    if (!response.ok) throw new Error(`Analytics request failed: ${response.status}`);
    analytics = await response.json();
    if (analytics.overview.totalClicks === visitorCount && analytics.overview.uniqueVisitors === visitorCount) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  if (analytics.overview.totalClicks !== visitorCount || analytics.overview.uniqueVisitors !== visitorCount) {
    throw new Error(`Unexpected analytics totals: ${JSON.stringify(analytics.overview)}`);
  }

  clearInterval(memoryMonitor);
  responseTimes.sort((a, b) => a - b);
  const durationMs = performance.now() - startedAt;
  const cpu = process.cpuUsage(cpuStartedAt);
  console.log(JSON.stringify({
    visitors: visitorCount,
    concurrency,
    redirects: visitorCount,
    responseBodyBytes,
    averageBodyBytesPerRedirect: Math.round(responseBodyBytes / visitorCount),
    durationMs: Math.round(durationMs),
    redirectsPerSecond: Number((visitorCount / (durationMs / 1000)).toFixed(1)),
    medianResponseMs: Number(responseTimes[Math.floor(responseTimes.length * 0.5)].toFixed(1)),
    p95ResponseMs: Number(responseTimes[Math.min(responseTimes.length - 1, Math.floor(responseTimes.length * 0.95))].toFixed(1)),
    peakRssMiB: Number((peakRssBytes / 1024 / 1024).toFixed(1)),
    cpuUserMs: Number((cpu.user / 1000).toFixed(1)),
    cpuSystemMs: Number((cpu.system / 1000).toFixed(1)),
    analytics: {
      clicks: analytics.overview.totalClicks,
      uniqueVisitors: analytics.overview.uniqueVisitors
    },
    note: 'Payload bytes exclude HTTP headers; redirect destination traffic is not served by ShortSwitch.',
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
