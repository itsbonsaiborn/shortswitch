import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const participantCount = Number(process.argv[2] ?? 200);
const concurrency = Number(process.argv[3] ?? 50);
if (!Number.isInteger(participantCount) || participantCount < 1 || participantCount > 1000) {
  throw new Error('Participant count must be an integer between 1 and 1000.');
}
const databasePath = path.join(os.tmpdir(), `shortswitch-activities-load-${randomUUID()}.db`);
Object.assign(process.env, {
  NODE_ENV: 'development', DATABASE_PATH: databasePath,
  ADMIN_EMAIL: 'activities-load@example.invalid', ADMIN_PASSWORD: `load-${randomUUID()}`,
  ADMIN_NAME: 'Activities Load Admin', COOKIE_SECURE: 'false',
  CORS_ORIGIN: 'http://127.0.0.1', PUBLIC_URL: 'http://127.0.0.1',
  STORE_RAW_IP: 'false', IP_HASH_SECRET: `load-${randomUUID()}-${randomUUID()}`,
  LIVE_SUBMIT_MAX_REQUESTS: String(Math.max(5000, participantCount * 8)),
  LIVE_SUBMIT_WINDOW_MINUTES: '5', ENABLE_CSP: 'false'
});
const cookiesFrom = (response) => response.headers.getSetCookie().map((entry) => entry.split(';')[0]).join('; ');
const pool = async (items, worker, width) => {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    while (index < items.length) await worker(items[index++]);
  }));
};
const percentile = (values, value) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))] ?? 0;
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
    method: 'POST', headers: { 'content-type': 'application/json', cookie: csrfCookies, 'x-csrf-token': csrf.csrfToken },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })
  });
  if (!loginResponse.ok) throw new Error(`Login failed: ${loginResponse.status}`);
  const adminHeaders = { 'content-type': 'application/json', cookie: `${csrfCookies}; ${cookiesFrom(loginResponse)}`, 'x-csrf-token': csrf.csrfToken };
  const slug = `activity-load-${participantCount}-${Date.now()}`;
  const createdResponse = await fetch(`${address}/api/activities`, {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({ settings: {
      title: `Activity load ${participantCount}`, description: '', slug, status: 'active',
      identityMode: 'anonymous', requiredAnswerBehavior: 'allow_incomplete', navigationPolicy: 'linear',
      resultVisibility: 'after_submission', feedbackPolicy: 'total_points', maximumAttempts: 1,
      attemptTimeLimitSeconds: null, availabilityStartAt: null, submissionDeadlineAt: null,
      submissionDeadlineTimezone: 'UTC', lowTimeWarningSeconds: 300, shuffleQuestionOptions: false
    } })
  });
  if (!createdResponse.ok) throw new Error(`Create failed: ${createdResponse.status} ${await createdResponse.text()}`);
  const created = await createdResponse.json();
  const activityId = created.activity.id;
  const draftResponse = await fetch(`${address}/api/activities/${activityId}/draft`, {
    method: 'PUT', headers: adminHeaders,
    body: JSON.stringify({ expectedRevision: 0, slides: [{ id: 'load_slide', title: 'Load slide', description: '', blocks: [{
      id: 'load_question', type: 'question', questionType: 'single_choice', graded: true, points: 1, required: false,
      config: { prompt: 'Choose A', description: '', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], shuffleOptions: false },
      answerKey: { correctOptionId: 'a', feedback: '' }
    }] }] })
  });
  if (!draftResponse.ok) throw new Error(`Draft failed: ${draftResponse.status} ${await draftResponse.text()}`);
  const publishResponse = await fetch(`${address}/api/activities/${activityId}/publish`, {
    method: 'POST', headers: adminHeaders, body: JSON.stringify({ expectedRevision: 1 })
  });
  if (!publishResponse.ok) throw new Error(`Publish failed: ${publishResponse.status} ${await publishResponse.text()}`);

  const participants = Array.from({ length: participantCount }, (_, index) => ({ index }));
  const startLatencies = [];
  const autosaveLatencies = [];
  const submitLatencies = [];
  let peakRssBytes = process.memoryUsage().rss;
  const monitor = setInterval(() => { peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss); }, 20);
  monitor.unref();
  const cpuStart = process.cpuUsage();
  const totalStart = performance.now();
  await pool(participants, async (participant) => {
    const started = performance.now();
    const response = await fetch(`${address}/api/activities/public/${slug}/attempts`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ participantKey: `participant_${String(participant.index).padStart(20, '0')}` })
    });
    startLatencies.push(performance.now() - started);
    if (!response.ok) throw new Error(`Attempt start failed: ${response.status} ${await response.text()}`);
    participant.credential = await response.json();
  }, concurrency);
  await pool(participants, async (participant) => {
    const questionId = participant.credential.attempt.slides[0].blocks[0].id;
    const started = performance.now();
    const response = await fetch(`${address}/api/activities/public/${slug}/attempts/${participant.credential.attemptId}/responses/${questionId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${participant.credential.attemptToken}` },
      body: JSON.stringify({ answer: { questionType: 'single_choice', optionId: participant.index % 2 ? 'b' : 'a' }, clientRevision: 1 })
    });
    autosaveLatencies.push(performance.now() - started);
    if (!response.ok) throw new Error(`Autosave failed: ${response.status} ${await response.text()}`);
  }, concurrency);
  await pool(participants, async (participant) => {
    const started = performance.now();
    const response = await fetch(`${address}/api/activities/public/${slug}/attempts/${participant.credential.attemptId}/submit`, {
      method: 'POST', headers: { authorization: `Bearer ${participant.credential.attemptToken}` }
    });
    submitLatencies.push(performance.now() - started);
    if (!response.ok) throw new Error(`Submit failed: ${response.status} ${await response.text()}`);
  }, concurrency);

  const expirationCount = Math.min(50, participantCount);
  const expiring = Array.from({ length: expirationCount }, (_, index) => ({ index }));
  await pool(expiring, async (participant) => {
    const response = await fetch(`${address}/api/activities/public/${slug}/attempts`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ participantKey: `expiring_${String(participant.index).padStart(20, '0')}` })
    });
    if (!response.ok) throw new Error(`Expiring start failed: ${response.status}`);
    participant.credential = await response.json();
  }, concurrency);
  const { getDb } = await import('../dist/server/db.js');
  const { ActivityAttemptService } = await import('../dist/server/services/activity-attempt-service.js');
  const db = getDb();
  const expireIds = expiring.map((item) => item.credential.attemptId);
  const expireStatement = db.prepare("UPDATE activity_attempts SET deadline_at = '2000-01-01T00:00:00.000Z' WHERE id = ?");
  for (const id of expireIds) expireStatement.run(id);
  const expirationStarted = performance.now();
  const expired = new ActivityAttemptService().expireDueAttempts();
  const expirationDurationMs = performance.now() - expirationStarted;
  if (expired !== expirationCount) throw new Error(`Expected ${expirationCount} expirations, got ${expired}.`);

  const exportStarted = performance.now();
  const exportResponse = await fetch(`${address}/api/activities/${activityId}/exports/attempts.csv`, { headers: { cookie: adminHeaders.cookie } });
  const exportBytes = (await exportResponse.arrayBuffer()).byteLength;
  const exportDurationMs = performance.now() - exportStarted;
  if (!exportResponse.ok) throw new Error(`Export failed: ${exportResponse.status}`);
  const totalDurationMs = performance.now() - totalStart;
  clearInterval(monitor);
  const cpu = process.cpuUsage(cpuStart);
  console.log(JSON.stringify({
    participants: participantCount, concurrency,
    attemptStarts: participantCount + expirationCount, autosaves: participantCount, submissions: participantCount,
    startLatencyMs: { p50: Math.round(percentile(startLatencies, .5)), p95: Math.round(percentile(startLatencies, .95)), max: Math.round(Math.max(...startLatencies)) },
    autosaveLatencyMs: { p50: Math.round(percentile(autosaveLatencies, .5)), p95: Math.round(percentile(autosaveLatencies, .95)), max: Math.round(Math.max(...autosaveLatencies)) },
    submitLatencyMs: { p50: Math.round(percentile(submitLatencies, .5)), p95: Math.round(percentile(submitLatencies, .95)), max: Math.round(Math.max(...submitLatencies)) },
    expiration: { finalized: expired, durationMs: Math.round(expirationDurationMs) },
    export: { rows: participantCount + expirationCount, bytes: exportBytes, durationMs: Math.round(exportDurationMs) },
    peakRssMiB: Number((peakRssBytes / 1024 / 1024).toFixed(1)),
    cpuUserMs: Number((cpu.user / 1000).toFixed(1)), cpuSystemMs: Number((cpu.system / 1000).toFixed(1)),
    totalDurationMs: Math.round(totalDurationMs), result: 'passed'
  }, null, 2));
} finally {
  if (app) await app.close();
  try { const { resetDb } = await import('../dist/server/db.js'); resetDb(); } catch {}
  await Promise.all(['', '-shm', '-wal'].map((suffix) => fs.rm(`${databasePath}${suffix}`, { force: true })));
}
