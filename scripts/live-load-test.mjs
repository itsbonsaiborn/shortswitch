import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const participantCount = Number(process.argv[2] ?? 200);
const concurrency = Number(process.argv[3] ?? 50);
const scenario = process.argv[4] ?? 'multiple_choice';
if (!Number.isInteger(participantCount) || participantCount < 1 || participantCount > 1000) {
  throw new Error('Participant count must be an integer between 1 and 1000.');
}
if (!['multiple_choice', 'word_cloud', 'open_answer'].includes(scenario)) {
  throw new Error('Scenario must be multiple_choice, word_cloud or open_answer.');
}

const databasePath = path.join(os.tmpdir(), `shortswitch-live-load-${randomUUID()}.db`);
Object.assign(process.env, {
  NODE_ENV: 'development',
  DATABASE_PATH: databasePath,
  ADMIN_EMAIL: 'load-test@example.invalid',
  ADMIN_PASSWORD: `load-${randomUUID()}`,
  ADMIN_NAME: 'Load Test Admin',
  COOKIE_SECURE: 'false',
  CORS_ORIGIN: 'http://127.0.0.1',
  PUBLIC_URL: 'http://127.0.0.1',
  STORE_RAW_IP: 'false',
  IP_HASH_SECRET: `load-${randomUUID()}-${randomUUID()}`,
  LIVE_SUBMIT_MAX_REQUESTS: String(Math.max(2000, participantCount * 2)),
  LIVE_SUBMIT_WINDOW_MINUTES: '5',
  ENABLE_CSP: 'false'
});

const cookiesFrom = (response) => response.headers.getSetCookie().map((entry) => entry.split(';')[0]).join('; ');
const pool = async (items, worker, width) => {
  let index = 0;
  const workers = Array.from({ length: Math.min(width, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  });
  await Promise.all(workers);
};
const readWithTimeout = (reader, timeoutMs) => Promise.race([
  reader.read(),
  new Promise((_, reject) => setTimeout(() => reject(new Error('SSE update timed out.')), timeoutMs))
]);
const readSseEvent = async (stream, eventNames, timeoutMs) => {
  const deadline = performance.now() + timeoutMs;
  let bytes = 0;
  while (true) {
    const separator = stream.buffer.indexOf('\n\n');
    if (separator >= 0) {
      const block = stream.buffer.slice(0, separator);
      stream.buffer = stream.buffer.slice(separator + 2);
      const event = block.match(/^event: (.+)$/m)?.[1];
      const data = block.match(/^data: (.+)$/m)?.[1];
      if (event && data && eventNames.includes(event)) return { bytes, event, data: JSON.parse(data) };
      continue;
    }
    const remaining = Math.max(1, deadline - performance.now());
    const chunk = await readWithTimeout(stream.reader, remaining);
    if (chunk.done) throw new Error('SSE stream closed before the expected event.');
    bytes += chunk.value?.byteLength ?? 0;
    stream.buffer += new TextDecoder().decode(chunk.value, { stream: true });
  }
};

let app;
const streams = [];
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
  const slug = `load-${participantCount}-${Date.now()}`;
  const createResponse = await fetch(`${address}/api/live`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: adminCookies, 'x-csrf-token': csrf.csrfToken },
    body: JSON.stringify({
      title: `Load test ${scenario} ${participantCount}`,
      question: scenario === 'multiple_choice' ? 'Choose one option' : 'Share a short answer',
      type: scenario,
      slug,
      status: 'active',
      identityMode: 'anonymous',
      allowMultipleResponses: false,
      maxResponsesPerParticipant: 1,
      moderationMode: 'off',
      maxAnswerLength: 100,
      allowMultipleChoices: false,
      options: scenario === 'multiple_choice' ? ['A', 'B', 'C', 'D'] : undefined,
      publicResults: true
    })
  });
  if (!createResponse.ok) throw new Error(`Activity creation failed: ${createResponse.status} ${await createResponse.text()}`);
  const activity = await createResponse.json();
  const participants = Array.from({ length: participantCount }, (_, index) => ({
    token: `load_participant_${String(index).padStart(6, '0')}`,
    submission: scenario === 'multiple_choice'
      ? { optionIds: [activity.options[index % activity.options.length].id] }
      : { text: scenario === 'word_cloud' ? `Unique phrase ${index}` : `Open answer ${index}` }
  }));

  const startedAt = performance.now();
  const cpuStartedAt = process.cpuUsage();
  let peakRssBytes = process.memoryUsage().rss;
  const memoryMonitor = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }, 25);
  memoryMonitor.unref();
  let pageLoads = 0;
  let pageApiBytes = 0;
  await pool(participants, async (participant) => {
    const response = await fetch(`${address}/api/live/public/${slug}?deferResults=1`, { headers: { 'x-live-participant': participant.token } });
    if (!response.ok) throw new Error(`Public page API failed: ${response.status}`);
    pageApiBytes += (await response.arrayBuffer()).byteLength;
    pageLoads += 1;
  }, concurrency);

  const connectStartedAt = performance.now();
  let initialSseBytes = 0;
  await pool(participants, async () => {
    const controller = new AbortController();
    const response = await fetch(`${address}/api/live/public/${slug}/events?protocol=2`, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`SSE connect failed: ${response.status}`);
    const reader = response.body.getReader();
    const stream = { reader, controller, buffer: '' };
    const initial = await readSseEvent(stream, ['snapshot'], 5_000);
    initialSseBytes += initial.bytes;
    streams.push(stream);
  }, concurrency);
  const connectDurationMs = performance.now() - connectStartedAt;

  let submitted = 0;
  const submitStartedAt = performance.now();
  await pool(participants, async (participant) => {
    const response = await fetch(`${address}/api/live/public/${slug}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ participantToken: participant.token, ...participant.submission })
    });
    if (response.status !== 201) throw new Error(`Submit failed: ${response.status} ${await response.text()}`);
    submitted += 1;
  }, concurrency);
  const submitDurationMs = performance.now() - submitStartedAt;

  const resultsResponse = await fetch(`${address}/api/live/public/${slug}/results`);
  const results = await resultsResponse.json();
  if (results.responseCount !== participantCount || results.uniqueParticipantCount !== participantCount) {
    throw new Error(`Unexpected totals: ${JSON.stringify({ responses: results.responseCount, participants: results.uniqueParticipantCount })}`);
  }

  let sseUpdates = 0;
  let sseDeltaBytes = 0;
  const updateTypes = new Map();
  const sseWaitStartedAt = performance.now();
  await pool(streams, async (stream) => {
    let revision = -1;
    while (revision !== results.revision) {
      const update = await readSseEvent(stream, ['delta', 'snapshot'], 8_000);
      revision = update.data.revision;
      sseUpdates += 1;
      sseDeltaBytes += update.bytes;
      updateTypes.set(update.event, (updateTypes.get(update.event) ?? 0) + 1);
    }
  }, concurrency);
  const sseUpdateLatencyMs = performance.now() - sseWaitStartedAt;
  if (scenario === 'word_cloud' && (results.wordCloud.length !== Math.min(150, participantCount) || results.wordCloudTotal !== participantCount)) {
    throw new Error(`Unexpected word cloud limits: ${JSON.stringify({ visible: results.wordCloud.length, total: results.wordCloudTotal })}`);
  }
  if (scenario === 'open_answer' && (results.openAnswers.length !== Math.min(100, participantCount) || results.openAnswerTotal !== participantCount)) {
    throw new Error(`Unexpected open answer limits: ${JSON.stringify({ visible: results.openAnswers.length, total: results.openAnswerTotal })}`);
  }

  const totalDurationMs = performance.now() - startedAt;
  clearInterval(memoryMonitor);
  const cpu = process.cpuUsage(cpuStartedAt);
  console.log(JSON.stringify({
    participants: participantCount,
    scenario,
    concurrency,
    pageLoads,
    sseConnections: streams.length,
    submissions: submitted,
    sseUpdates,
    pageApiBytes,
    averagePageApiBytes: Math.round(pageApiBytes / participantCount),
    initialSseBytes,
    averageInitialSseBytes: Math.round(initialSseBytes / participantCount),
    sseDeltaBytes,
    averageDeltaBytes: Math.round(sseDeltaBytes / participantCount),
    updateTypes: Object.fromEntries(updateTypes),
    connectDurationMs: Math.round(connectDurationMs),
    submitDurationMs: Math.round(submitDurationMs),
    submissionsPerSecond: Number((submitted / (submitDurationMs / 1000)).toFixed(1)),
    sseUpdateLatencyMs: Math.round(sseUpdateLatencyMs),
    peakRssMiB: Number((peakRssBytes / 1024 / 1024).toFixed(1)),
    cpuUserMs: Number((cpu.user / 1000).toFixed(1)),
    cpuSystemMs: Number((cpu.system / 1000).toFixed(1)),
    estimatedDeltaBroadcastMsAt25Mbps: Number(((sseDeltaBytes * 8 / 25_000_000) * 1000).toFixed(2)),
    totalDurationMs: Math.round(totalDurationMs),
    result: 'passed'
  }, null, 2));
} finally {
  for (const { reader, controller } of streams) {
    await reader.cancel().catch(() => undefined);
    controller.abort();
  }
  if (app) await app.close();
  try {
    const { resetDb } = await import('../dist/server/db.js');
    resetDb();
  } catch {}
  await Promise.all(['', '-shm', '-wal'].map((suffix) => fs.rm(`${databasePath}${suffix}`, { force: true })));
}
