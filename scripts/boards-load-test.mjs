import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const participantCount = Number(process.argv[2] ?? 200);
const targetCardCount = Number(process.argv[3] ?? participantCount);
const writeConcurrency = Number(process.argv[4] ?? Math.min(50, participantCount));
const accessConcurrency = Number(process.argv[5] ?? participantCount);
for (const [name, value, maximum] of [
  ['participant count', participantCount, 500],
  ['target card count', targetCardCount, 500],
  ['write concurrency', writeConcurrency, 100],
  ['access concurrency', accessConcurrency, 500]
]) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
}
if (targetCardCount < participantCount) throw new Error('Target card count must be at least the participant count.');

const databasePath = path.join(os.tmpdir(), `shortswitch-boards-load-${randomUUID()}.db`);
Object.assign(process.env, {
  NODE_ENV: 'development', DATABASE_PATH: databasePath,
  ADMIN_EMAIL: 'boards-load@example.invalid', ADMIN_PASSWORD: `load-${randomUUID()}`,
  ADMIN_NAME: 'Boards Load Admin', COOKIE_SECURE: 'false',
  CORS_ORIGIN: 'http://127.0.0.1', PUBLIC_URL: 'http://127.0.0.1',
  STORE_RAW_IP: 'false', IP_HASH_SECRET: `load-${randomUUID()}-${randomUUID()}`,
  ENABLE_CSP: 'false', API_RATE_LIMIT_ENABLED: 'false'
});

const cookiesFrom = (response) => response.headers.getSetCookie().map((entry) => entry.split(';')[0]).join('; ');
const mergeCookies = (...values) => values.filter(Boolean).join('; ');
const percentile = (values, ratio) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
};
const summary = (values) => ({
  p50: Number(percentile(values, 0.5).toFixed(1)),
  p95: Number(percentile(values, 0.95).toFixed(1)),
  p99: Number(percentile(values, 0.99).toFixed(1)),
  max: Number(Math.max(0, ...values).toFixed(1))
});
const pool = async (items, width, worker) => {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      await worker(items[current], current);
    }
  }));
};
const timedFetch = async (url, options, latencies, errors) => {
  const started = performance.now();
  try {
    const response = await fetch(url, options);
    latencies.push(performance.now() - started);
    if (!response.ok) errors.push({ status: response.status, body: (await response.clone().text()).slice(0, 160) });
    return response;
  } catch (error) {
    latencies.push(performance.now() - started);
    errors.push({ status: 0, body: String(error) });
    return undefined;
  }
};
const readSseEvent = async (reader) => {
  let payload = '';
  while (!payload.includes('\n\n')) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error('SSE stream ended before an event arrived.');
    payload += new TextDecoder().decode(chunk.value, { stream: true });
  }
  return payload;
};

let app;
let monitor;
const openStreams = [];
try {
  const { buildApp } = await import('../dist/server/app.js');
  app = await buildApp();
  const address = await app.listen({ host: '127.0.0.1', port: 0, backlog: 1024 });

  const adminCsrfResponse = await fetch(`${address}/api/auth/csrf-token`);
  const adminCsrf = await adminCsrfResponse.json();
  const adminCsrfCookies = cookiesFrom(adminCsrfResponse);
  const loginResponse = await fetch(`${address}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: adminCsrfCookies, 'x-csrf-token': adminCsrf.csrfToken },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })
  });
  if (!loginResponse.ok) throw new Error(`Login failed: ${loginResponse.status}`);
  const adminHeaders = {
    'content-type': 'application/json',
    cookie: mergeCookies(adminCsrfCookies, cookiesFrom(loginResponse)),
    'x-csrf-token': adminCsrf.csrfToken
  };
  const slug = `boards-load-${participantCount}-${targetCardCount}-${Date.now()}`;
  const boardResponse = await fetch(`${address}/api/boards`, {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({
      title: `Boards load ${participantCount}`, description: 'Synthetic local load test', slug, status: 'published',
      settings: {
        moderationMode: 'auto_approve', maxCardsTotal: targetCardCount + 10,
        maxCardsPerParticipant: 1, requireCardTitle: true, participantCanEdit: true,
        participantCanDelete: true, allowImageUrls: true
      }
    })
  });
  if (!boardResponse.ok) throw new Error(`Board creation failed: ${boardResponse.status} ${await boardResponse.text()}`);
  const board = await boardResponse.json();

  const identities = Array.from({ length: targetCardCount }, (_, index) => ({
    index, ip: `198.51.${Math.floor(index / 250)}.${(index % 250) + 1}`
  }));
  console.error(`[boards-load] preparing ${identities.length} anonymous sessions`);
  await pool(identities, writeConcurrency, async (identity) => {
    const response = await fetch(`${address}/api/auth/csrf-token`, { headers: { 'x-forwarded-for': identity.ip } });
    if (!response.ok) throw new Error(`Participant CSRF failed: ${response.status}`);
    identity.csrf = await response.json();
    identity.csrfCookies = cookiesFrom(response);
  });

  const metrics = {
    access: [], create: [], edit: [], react: [], switchReaction: [], removeReaction: [],
    sseConnect: [], ssePropagation: [], sseReconnect: []
  };
  const errors = [];
  let peakRssBytes = process.memoryUsage().rss;
  let peakHeapBytes = process.memoryUsage().heapUsed;
  monitor = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
  }, 20);
  monitor.unref();
  const cpuStart = process.cpuUsage();
  const eluStart = performance.eventLoopUtilization();
  const totalStarted = performance.now();

  console.error(`[boards-load] creating ${identities.length} cards`);
  await pool(identities, writeConcurrency, async (identity) => {
    const response = await timedFetch(`${address}/api/boards/public/${slug}/cards`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', cookie: identity.csrfCookies,
        'x-csrf-token': identity.csrf.csrfToken, 'x-forwarded-for': identity.ip
      },
      body: JSON.stringify({
        title: identity.index % 11 === 0 ? 'Vienāds virsraksts' : `Card ${String(identity.index).padStart(4, '0')}`,
        body: identity.index % 3 !== 1 && identity.index % 7 === 0
          ? 'Long classroom response '.repeat(120)
          : `Response ${identity.index}\nSecond line`,
        imageUrl: identity.index % 3 === 0 ? 'https://example.com/classroom-image.jpg' : null,
        authorDisplayName: `Student ${identity.index + 1}`,
        layout: identity.index % 3 === 0 ? 'image_text' : identity.index % 3 === 1 ? 'compact' : 'text'
      })
    }, metrics.create, errors);
    if (!response?.ok) return;
    const result = await response.json();
    identity.card = result.card;
    identity.ownershipCookies = cookiesFrom(response);
  });
  if (errors.length) throw new Error(`Card creation produced ${errors.length} errors: ${JSON.stringify(errors.slice(0, 3))}`);

  const active = identities.slice(0, participantCount);
  console.error(`[boards-load] opening ${active.length} board snapshots`);
  await pool(active, accessConcurrency, async (identity) => {
    const response = await timedFetch(`${address}/api/boards/public/${slug}`, {
      headers: { cookie: identity.csrfCookies, 'x-forwarded-for': identity.ip }
    }, metrics.access, errors);
    await response?.arrayBuffer();
  });

  console.error(`[boards-load] editing ${active.length} owned cards`);
  await pool(active, writeConcurrency, async (identity) => {
    const response = await timedFetch(`${address}/api/boards/public/${slug}/cards/${identity.card.id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: mergeCookies(identity.csrfCookies, identity.ownershipCookies),
        'x-csrf-token': identity.csrf.csrfToken, 'x-forwarded-for': identity.ip
      },
      body: JSON.stringify({
        title: `Edited ${String(identity.index).padStart(4, '0')}`,
        body: `Edited response ${identity.index}`,
        imageUrl: null, authorDisplayName: `Student ${identity.index + 1}`, layout: 'text'
      })
    }, metrics.edit, errors);
    await response?.arrayBuffer();
  });

  const reactionCard = identities[targetCardCount - 1].card;
  console.error(`[boards-load] running ${active.length} reaction lifecycles`);
  await pool(active, writeConcurrency, async (identity) => {
    const baseHeaders = {
      'content-type': 'application/json', cookie: identity.csrfCookies,
      'x-csrf-token': identity.csrf.csrfToken, 'x-forwarded-for': identity.ip
    };
    const liked = await timedFetch(`${address}/api/boards/public/${slug}/cards/${reactionCard.id}/reaction`, {
      method: 'PUT', headers: baseHeaders, body: JSON.stringify({ reaction: 'like' })
    }, metrics.react, errors);
    if (!liked) return;
    identity.reactionCookies = cookiesFrom(liked);
    await liked.arrayBuffer();
    const headers = { ...baseHeaders, cookie: mergeCookies(identity.csrfCookies, identity.reactionCookies) };
    const switched = await timedFetch(`${address}/api/boards/public/${slug}/cards/${reactionCard.id}/reaction`, {
      method: 'PUT', headers, body: JSON.stringify({ reaction: 'dislike' })
    }, metrics.switchReaction, errors);
    await switched?.arrayBuffer();
    const deleteHeaders = {
      cookie: mergeCookies(identity.csrfCookies, identity.reactionCookies),
      'x-csrf-token': identity.csrf.csrfToken, 'x-forwarded-for': identity.ip
    };
    const removed = await timedFetch(`${address}/api/boards/public/${slug}/cards/${reactionCard.id}/reaction`, {
      method: 'DELETE', headers: deleteHeaders
    }, metrics.removeReaction, errors);
    await removed?.arrayBuffer();
  });

  const connectStream = async (identity, latencies) => {
    const started = performance.now();
    let response;
    try {
      response = await fetch(`${address}/api/boards/public/${slug}/events`, {
        headers: { 'x-forwarded-for': identity.ip }
      });
    } catch (error) {
      latencies.push(performance.now() - started);
      errors.push({ status: 0, body: String(error) });
      return null;
    }
    if (!response.ok) {
      errors.push({ status: response.status, body: (await response.text()).slice(0, 160) });
      return null;
    }
    const reader = response.body.getReader();
    const initial = await readSseEvent(reader);
    latencies.push(performance.now() - started);
    if (!initial.includes('event: snapshot') || initial.includes('recoveryPin') || initial.includes('ownerToken')) {
      errors.push({ status: 0, body: 'Unsafe or invalid SSE snapshot.' });
    }
    const stream = { reader, identity };
    openStreams.push(stream);
    return stream;
  };
  const streams = [];
  console.error(`[boards-load] opening ${active.length} SSE streams`);
  await pool(active, Math.min(100, participantCount), async (identity) => {
    const stream = await connectStream(identity, metrics.sseConnect);
    if (stream) streams.push(stream);
  });

  if (streams.length) {
    const eventStarted = performance.now();
    const target = active[0];
    const response = await fetch(`${address}/api/boards/public/${slug}/cards/${target.card.id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json', cookie: mergeCookies(target.csrfCookies, target.ownershipCookies),
        'x-csrf-token': target.csrf.csrfToken, 'x-forwarded-for': target.ip
      },
      body: JSON.stringify({ title: 'Realtime title update', body: 'Realtime body', imageUrl: null, authorDisplayName: 'Student 1', layout: 'text' })
    });
    if (!response.ok) errors.push({ status: response.status, body: await response.text() });
    await Promise.all(streams.map(async (stream) => {
      const event = await readSseEvent(stream.reader);
      metrics.ssePropagation.push(performance.now() - eventStarted);
      if (!event.includes('event: delta') && !event.includes('event: snapshot')) {
        errors.push({ status: 0, body: 'SSE update was not a delta or snapshot.' });
      }
    }));
  }

  await Promise.all(openStreams.splice(0).map(({ reader }) => reader.cancel().catch(() => undefined)));
  await new Promise((resolve) => setTimeout(resolve, 25));
  const postDisconnectHealth = await fetch(`${address}/api/health`);
  if (!postDisconnectHealth.ok) throw new Error(`Health check after SSE disconnect failed: ${postDisconnectHealth.status}`);
  await postDisconnectHealth.arrayBuffer();
  const reconnectCount = Math.min(participantCount, Math.max(30, 600 - participantCount));
  const reconnectStreams = [];
  console.error(`[boards-load] reconnecting ${reconnectCount} SSE streams`);
  await pool(active.slice(0, reconnectCount), Math.min(100, reconnectCount), async (identity) => {
    const stream = await connectStream(identity, metrics.sseReconnect);
    if (stream) reconnectStreams.push(stream);
  });
  await Promise.all(openStreams.splice(0).map(({ reader }) => reader.cancel().catch(() => undefined)));

  const totalDurationMs = performance.now() - totalStarted;
  clearInterval(monitor);
  monitor = undefined;
  const cpu = process.cpuUsage(cpuStart);
  const elu = performance.eventLoopUtilization(eluStart);
  const { getDb } = await import('../dist/server/db.js');
  const db = getDb();
  const cardRows = Number(db.prepare('SELECT COUNT(*) AS count FROM board_cards WHERE board_id = ?').get(board.id).count);
  const reactionRows = Number(db.prepare('SELECT COUNT(*) AS count FROM board_card_reactions WHERE board_id = ?').get(board.id).count);
  const foreignKeyErrors = db.prepare('PRAGMA foreign_key_check').all().length;
  const quickCheck = db.prepare('PRAGMA quick_check').get()['quick_check'];
  const queryPlan = db.prepare(`EXPLAIN QUERY PLAN SELECT c.id FROM board_cards c
    WHERE c.board_id = ? AND c.moderation_status = 'approved' AND c.is_hidden = 0
    ORDER BY c.created_at DESC, c.id`).all(board.id).map((row) => row.detail);
  const walBytes = await fs.stat(`${databasePath}-wal`).then((value) => value.size).catch(() => 0);
  if (cardRows !== targetCardCount || reactionRows !== 0 || foreignKeyErrors !== 0 || quickCheck !== 'ok') {
    errors.push({ status: 0, body: `Database verification failed: cards=${cardRows}, reactions=${reactionRows}, fk=${foreignKeyErrors}, quick=${quickCheck}` });
  }

  const requestCount = Object.values(metrics).reduce((sum, values) => sum + values.length, 0);
  console.log(JSON.stringify({
    environment: 'synthetic loopback, server and load generator in one Node.js process',
    participants: participantCount, cards: targetCardCount, writeConcurrency, accessConcurrency,
    requestsMeasured: requestCount, errors: errors.length, errorRatePercent: Number((errors.length / Math.max(1, requestCount) * 100).toFixed(3)),
    throughputRequestsPerSecond: Number((requestCount / totalDurationMs * 1000).toFixed(1)),
    latencyMs: Object.fromEntries(Object.entries(metrics).map(([key, values]) => [key, summary(values)])),
    sse: { connected: streams.length, reconnectAttempts: reconnectCount, reconnected: reconnectStreams.length },
    resources: {
      peakRssMiB: Number((peakRssBytes / 1024 / 1024).toFixed(1)),
      peakHeapMiB: Number((peakHeapBytes / 1024 / 1024).toFixed(1)),
      cpuUserMs: Number((cpu.user / 1000).toFixed(1)), cpuSystemMs: Number((cpu.system / 1000).toFixed(1)),
      approximateCpuPercent: Number(((cpu.user + cpu.system) / 1000 / totalDurationMs * 100).toFixed(1)),
      eventLoopUtilizationPercent: Number((elu.utilization * 100).toFixed(1)), walMiB: Number((walBytes / 1024 / 1024).toFixed(2))
    },
    database: { cards: cardRows, activeReactions: reactionRows, foreignKeyErrors, quickCheck, queryPlan },
    totalDurationMs: Math.round(totalDurationMs), result: errors.length ? 'failed' : 'passed', errorSamples: errors.slice(0, 5)
  }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  if (monitor) clearInterval(monitor);
  await Promise.all(openStreams.splice(0).map(({ reader }) => reader.cancel().catch(() => undefined)));
  if (app) await app.close();
  try { const { resetDb } = await import('../dist/server/db.js'); resetDb(); } catch {}
  await Promise.all(['', '-shm', '-wal'].map((suffix) => fs.rm(`${databasePath}${suffix}`, { force: true })));
}
