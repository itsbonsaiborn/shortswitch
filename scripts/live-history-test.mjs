import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const responseCount = Number(process.argv[2] ?? 2000);
const concurrency = Number(process.argv[3] ?? 50);
if (![100, 500, 2000].includes(responseCount)) throw new Error('History size must be 100, 500 or 2000.');

const databasePath = path.join(os.tmpdir(), `shortswitch-live-history-${randomUUID()}.db`);
Object.assign(process.env, {
  NODE_ENV: 'development',
  DATABASE_PATH: databasePath,
  ADMIN_EMAIL: 'history@example.invalid',
  ADMIN_PASSWORD: `history-${randomUUID()}`,
  ADMIN_NAME: 'History Test',
  COOKIE_SECURE: 'false',
  CORS_ORIGIN: 'http://127.0.0.1',
  PUBLIC_URL: 'http://127.0.0.1',
  STORE_RAW_IP: 'false',
  IP_HASH_SECRET: `history-${randomUUID()}-${randomUUID()}`,
  LIVE_SUBMIT_MAX_REQUESTS: String(responseCount * 2),
  LIVE_SUBMIT_WINDOW_MINUTES: '10',
  ENABLE_CSP: 'false'
});

const pool = async (items, worker, width) => {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    while (index < items.length) await worker(items[index++]);
  }));
};
const cookiesFrom = (response) => response.headers.getSetCookie().map((entry) => entry.split(';')[0]).join('; ');

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
  const slug = `history-${responseCount}-${Date.now()}`;
  const createResponse = await fetch(`${address}/api/live`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: adminCookies, 'x-csrf-token': csrf.csrfToken },
    body: JSON.stringify({
      title: 'History load test', question: 'Answer', type: 'open_answer', slug, status: 'active',
      identityMode: 'anonymous', allowMultipleResponses: false, maxResponsesPerParticipant: 1,
      moderationMode: 'off', maxAnswerLength: 280, publicResults: true
    })
  });
  if (!createResponse.ok) throw new Error(`Activity creation failed: ${createResponse.status}`);

  const startedAt = performance.now();
  const cpuStartedAt = process.cpuUsage();
  const participants = Array.from({ length: responseCount }, (_, index) => index);
  await pool(participants, async (index) => {
    const response = await fetch(`${address}/api/live/public/${slug}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ participantToken: `history_participant_${String(index).padStart(6, '0')}`, text: `History answer ${index}` })
    });
    if (response.status !== 201) throw new Error(`Submit ${index} failed: ${response.status} ${await response.text()}`);
  }, concurrency);

  const resultsResponse = await fetch(`${address}/api/live/public/${slug}/results`);
  const resultsBuffer = await resultsResponse.arrayBuffer();
  const results = JSON.parse(Buffer.from(resultsBuffer).toString('utf8'));
  if (results.openAnswers.length !== Math.min(100, responseCount) || results.openAnswerTotal !== responseCount) {
    throw new Error('Bounded initial Open Answer snapshot is incorrect.');
  }
  let cursor = results.openAnswerNextCursor;
  let paged = results.openAnswers.length;
  while (cursor) {
    const response = await fetch(`${address}/api/live/public/${slug}/answers?limit=100&cursor=${encodeURIComponent(cursor)}`);
    const page = await response.json();
    paged += page.items.length;
    cursor = page.nextCursor;
  }
  if (paged !== responseCount) throw new Error(`Pagination returned ${paged} of ${responseCount} answers.`);

  const cpu = process.cpuUsage(cpuStartedAt);
  console.log(JSON.stringify({
    responses: responseCount,
    concurrency,
    initialVisibleAnswers: results.openAnswers.length,
    initialSnapshotBytes: resultsBuffer.byteLength,
    pagedAnswers: paged,
    durationMs: Math.round(performance.now() - startedAt),
    cpuUserMs: Number((cpu.user / 1000).toFixed(1)),
    cpuSystemMs: Number((cpu.system / 1000).toFixed(1)),
    rssMiB: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1)),
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
