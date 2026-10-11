import type { FastifyInstance } from 'fastify';
import type { LiveActivityInput, LiveActivityStatus, LiveResponseStatus, ModerationMatchMode } from '@/shared/types.js';
import { config } from './config.js';
import { LiveService } from './services/live-service.js';
import { LiveRealtimeService } from './services/live-realtime-service.js';
import type { RateLimiterService } from './services/rate-limiter-service.js';
import type { SessionService } from './services/session-service.js';

interface LiveRouteDependencies {
  live: LiveService;
  realtime: LiveRealtimeService;
  sessions: SessionService;
  rateLimiter: RateLimiterService;
}

const errorStatus = (message: string) => {
  if (message.includes('not found')) return 404;
  if (message.includes('expired')) return 410;
  if (message.includes('closed') || message.includes('limit reached') || message.includes('already in use')) return 409;
  return 400;
};

export const registerLiveRoutes = async (app: FastifyInstance<any, any, any, any>, dependencies: LiveRouteDependencies) => {
  const { live, realtime, sessions, rateLimiter } = dependencies;
  const publish = (activityId: string, forceSnapshot = false) => {
    realtime.schedule(activityId, () => live.getResultsForActivityId(activityId), { forceSnapshot });
  };
  const requireAdmin = async (request: Parameters<SessionService['requireAuth']>[0], reply: Parameters<SessionService['requireAuth']>[1]) =>
    sessions.requireAuth(request, reply);

  app.get('/api/live', async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    return live.list(authenticated.currentUser.id);
  });

  app.post('/api/live', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      return live.create(authenticated.currentUser.id, request.body as LiveActivityInput);
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(errorStatus(message)).send({ message });
    }
  });

  app.get('/api/live/moderation/pending', async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    return live.list(authenticated.currentUser.id).flatMap((activity) =>
      live.getAdminDetails(authenticated.currentUser.id, activity.id).responses
        .filter((response) => response.status === 'pending')
        .map((response) => ({ ...response, activityTitle: activity.title }))
    );
  });

  app.get('/api/live/:id', async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      return live.getAdminDetails(authenticated.currentUser.id, (request.params as { id: string }).id);
    } catch (error) {
      return reply.code(404).send({ message: (error as Error).message });
    }
  });

  app.patch('/api/live/:id', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      const id = (request.params as { id: string }).id;
      const result = live.update(authenticated.currentUser.id, id, request.body as LiveActivityInput);
      publish(id, true);
      return result;
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(errorStatus(message)).send({ message });
    }
  });

  app.delete('/api/live/:id', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      const id = (request.params as { id: string }).id;
      live.delete(authenticated.currentUser.id, id);
      realtime.closeActivity(id);
      return { ok: true };
    } catch (error) {
      return reply.code(404).send({ message: (error as Error).message });
    }
  });

  app.post('/api/live/:id/status', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      const id = (request.params as { id: string }).id;
      const body = request.body as { status: LiveActivityStatus; clearExpirationOnReopen?: boolean };
      const result = live.setStatus(authenticated.currentUser.id, id, body.status, Boolean(body.clearExpirationOnReopen));
      publish(id, true);
      return result;
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(errorStatus(message)).send({ message });
    }
  });

  app.patch('/api/live/:id/responses/:responseId', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    const params = request.params as { id: string; responseId: string };
    try {
      const body = request.body as {
        status: LiveResponseStatus;
        publishedText?: string | null;
        participantName?: string | null;
        confirmRuleMatch?: boolean;
      };
      const result = live.moderate(authenticated.currentUser.id, params.id, params.responseId, body);
      publish(params.id, true);
      return result;
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(errorStatus(message)).send({ message });
    }
  });

  app.get('/api/moderation/rules', async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    return live.listRules(authenticated.currentUser.id);
  });

  app.post('/api/moderation/rules', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      const body = request.body as { pattern: string; matchMode: ModerationMatchMode };
      return live.createRule(authenticated.currentUser.id, body.pattern, body.matchMode);
    } catch (error) {
      return reply.code(400).send({ message: (error as Error).message });
    }
  });

  app.patch('/api/moderation/rules/:id', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      const body = request.body as { pattern: string; matchMode: ModerationMatchMode };
      return live.updateRule(authenticated.currentUser.id, (request.params as { id: string }).id, body.pattern, body.matchMode);
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(errorStatus(message)).send({ message });
    }
  });

  app.delete('/api/moderation/rules/:id', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      live.deleteRule(authenticated.currentUser.id, (request.params as { id: string }).id);
      return { ok: true };
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(errorStatus(message)).send({ message });
    }
  });

  app.get('/api/live/public/:slug', async (request, reply) => {
    const slug = (request.params as { slug: string }).slug;
    const participantToken = request.headers['x-live-participant'];
    const deferResults = (request.query as { deferResults?: string }).deferResults === '1';
    try {
      return live.getPublic(slug, typeof participantToken === 'string' ? participantToken : undefined, deferResults);
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(errorStatus(message)).send({ message });
    }
  });

  app.get('/api/live/public/:slug/presentation', async (request, reply) => {
    try {
      return live.getPresentation((request.params as { slug: string }).slug);
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(errorStatus(message)).send({ message });
    }
  });

  app.get('/api/live/public/:slug/results', async (request, reply) => {
    try {
      return live.getPublicResults((request.params as { slug: string }).slug);
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(errorStatus(message)).send({ message });
    }
  });

  app.get('/api/live/public/:slug/answers', async (request, reply) => {
    try {
      const query = request.query as { cursor?: string; limit?: string };
      return live.listPublicOpenAnswers(
        (request.params as { slug: string }).slug,
        query.cursor,
        query.limit === undefined ? undefined : Number(query.limit)
      );
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(errorStatus(message)).send({ message });
    }
  });

  app.get('/api/live/public/:slug/words', async (request, reply) => {
    try {
      const query = request.query as { cursor?: string; limit?: string; search?: string };
      return live.listPublicWordCloud(
        (request.params as { slug: string }).slug,
        query.cursor,
        query.limit === undefined ? undefined : Number(query.limit),
        query.search
      );
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(errorStatus(message)).send({ message });
    }
  });

  app.post('/api/live/public/:slug/responses', async (request, reply) => {
    const slug = (request.params as { slug: string }).slug;
    const body = request.body as {
      participantToken?: string;
      participantName?: string;
      text?: string;
      optionIds?: string[];
      scaleValue?: number;
    };
    const options = {
      maxAttempts: config.defaults.liveSubmitMaxRequests,
      windowMinutes: config.defaults.liveSubmitWindowMinutes,
      blockMinutes: config.defaults.liveSubmitWindowMinutes
    };
    if (!rateLimiter.consume('live-submit-ip', `${request.ip}:${slug}`, options, { slug })) {
      return reply.code(429).send({ message: 'Too many responses. Please try again later.' });
    }
    if (body.participantToken && !rateLimiter.consume('live-submit-participant', `${slug}:${body.participantToken}`, options, { slug })) {
      return reply.code(429).send({ message: 'Too many responses. Please try again later.' });
    }
    try {
      const response = live.submit(slug, body);
      publish(response.activityId);
      return reply.code(201).send({
        id: response.id,
        status: response.status,
        participantResponseCount: live.getParticipantResponseCount(response.activityId, String(body.participantToken ?? ''))
      });
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(errorStatus(message)).send({ message });
    }
  });

  app.get('/api/live/public/:slug/events', async (request, reply) => {
    const slug = (request.params as { slug: string }).slug;
    try {
      const activity = live.findBySlug(slug);
      if (!activity) return reply.code(404).send({ message: 'Activity not found.' });
      if (live.isExpired(activity.expiresAt)) return reply.code(410).send({ message: 'This activity has expired.' });
      if (!activity.publicResults) return reply.code(404).send({ message: 'Results are not public.' });
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      reply.raw.write('retry: 2000\n\n');
      const protocol = (request.query as { protocol?: string }).protocol === '2' ? 'delta' : 'legacy';
      const remove = realtime.addClient(activity.id, reply.raw, () => live.getResultsForActivityId(activity.id), protocol, 'public');
      request.raw.on('close', remove);
      request.raw.on('error', remove);
    } catch (error) {
      if (!reply.sent) return reply.code(404).send({ message: (error as Error).message });
    }
  });

  app.get('/api/live/public/:slug/presentation/events', async (request, reply) => {
    const slug = (request.params as { slug: string }).slug;
    try {
      const activity = live.findBySlug(slug);
      if (!activity) return reply.code(404).send({ message: 'Activity not found.' });
      if (live.isExpired(activity.expiresAt)) return reply.code(410).send({ message: 'This activity has expired.' });
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      reply.raw.write('retry: 2000\n\n');
      const protocol = (request.query as { protocol?: string }).protocol === '2' ? 'delta' : 'legacy';
      const remove = realtime.addClient(activity.id, reply.raw, () => live.getResultsForActivityId(activity.id), protocol, 'presentation');
      request.raw.on('close', remove);
      request.raw.on('error', remove);
    } catch (error) {
      if (!reply.sent) return reply.code(404).send({ message: (error as Error).message });
    }
  });
};
