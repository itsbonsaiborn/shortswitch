import type { FastifyInstance } from 'fastify';
import { config } from './config.js';
import type { RateLimiterService } from './services/rate-limiter-service.js';
import type { ActivityAttemptService } from './services/activity-attempt-service.js';

interface Dependencies {
  attempts: ActivityAttemptService;
  rateLimiter: RateLimiterService;
}

const bearerToken = (authorization: string | undefined) => {
  const match = /^Bearer\s+([A-Za-z0-9_-]{40,100})$/.exec(authorization ?? '');
  if (!match) throw new Error('Attempt token is required.');
  return match[1];
};

const errorStatus = (error: unknown) => {
  const message = error instanceof Error ? error.message : 'Request failed.';
  if (message.includes('not found')) return { status: 404, message };
  if (message.includes('Maximum attempts') || message.includes('finalized') || message.includes('Required questions') || message.includes('required question before continuing') || message.includes('Back navigation') || message.includes('stale') || message.includes('not available yet') || message.includes('changed')) return { status: 409, message };
  if (message.includes('deadline has passed')) return { status: 410, message };
  return { status: 400, message };
};

export const registerActivityPublicRoutes = async (app: FastifyInstance<any, any, any, any>, dependencies: Dependencies) => {
  const { attempts, rateLimiter } = dependencies;
  const handle = (reply: any, error: unknown) => {
    const result = errorStatus(error);
    return reply.code(result.status).send({ message: result.message });
  };
  const limited = (request: any, slug: string, participantKey = '') => {
    const options = {
      maxAttempts: config.defaults.liveSubmitMaxRequests,
      windowMinutes: config.defaults.liveSubmitWindowMinutes,
      blockMinutes: config.defaults.liveSubmitWindowMinutes
    };
    const byIp = rateLimiter.consume('activity-attempt-ip', `${request.ip ?? 'unknown'}:${slug}`, options, { slug });
    const byParticipant = participantKey
      ? rateLimiter.consume('activity-attempt-participant', `${slug}:${participantKey.slice(0, 64)}`, options, { slug })
      : true;
    return byIp && byParticipant;
  };

  app.get('/api/activities/public/:slug', async (request, reply) => {
    const landing = attempts.getLanding((request.params as { slug: string }).slug);
    if (!landing) return reply.code(404).send({ message: 'Activity not found.' });
    const { activityId: _activityId, versionId: _versionId, settings: _settings, ...publicLanding } = landing;
    return publicLanding;
  });

  app.post('/api/activities/public/:slug/attempts', async (request, reply) => {
    const slug = (request.params as { slug: string }).slug;
    const body = (request.body ?? {}) as { participantKey?: unknown; participantName?: unknown };
    if (!limited(request, slug, typeof body.participantKey === 'string' ? body.participantKey : '')) {
      return reply.code(429).send({ message: 'Too many requests. Please try again later.' });
    }
    try {
      return reply.code(201).send(attempts.start(slug, body));
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.get('/api/activities/public/:slug/attempts/:attemptId', async (request, reply) => {
    try {
      const params = request.params as { slug: string; attemptId: string };
      return attempts.get(params.attemptId, bearerToken(request.headers.authorization), params.slug);
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.patch('/api/activities/public/:slug/attempts/:attemptId/responses/:questionBlockId', async (request, reply) => {
    const params = request.params as { slug: string; attemptId: string; questionBlockId: string };
    if (!limited(request, params.slug, params.attemptId)) return reply.code(429).send({ message: 'Too many requests. Please try again later.' });
    try {
      return attempts.saveAnswer(params.slug, params.attemptId, bearerToken(request.headers.authorization), params.questionBlockId, request.body as any);
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.post('/api/activities/public/:slug/attempts/:attemptId/navigate', async (request, reply) => {
    const params = request.params as { slug: string; attemptId: string };
    if (!limited(request, params.slug, params.attemptId)) return reply.code(429).send({ message: 'Too many requests. Please try again later.' });
    try {
      return attempts.navigate(params.slug, params.attemptId, bearerToken(request.headers.authorization), (request.body as { targetSlideId?: unknown })?.targetSlideId);
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.post('/api/activities/public/:slug/attempts/:attemptId/submit', async (request, reply) => {
    const params = request.params as { slug: string; attemptId: string };
    if (!limited(request, params.slug, params.attemptId)) return reply.code(429).send({ message: 'Too many requests. Please try again later.' });
    try {
      return attempts.submit(params.slug, params.attemptId, bearerToken(request.headers.authorization));
    } catch (error) {
      return handle(reply, error);
    }
  });
};
