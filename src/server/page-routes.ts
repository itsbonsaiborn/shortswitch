import type { FastifyInstance } from 'fastify';
import type { PageInput, PageStatus } from '@/shared/types.js';
import type { SessionService } from './services/session-service.js';
import { PageService } from './services/page-service.js';

const errorStatus = (message: string) => {
  if (message.includes('not found')) return 404;
  if (message.includes('already in use')) return 409;
  return 400;
};

export const registerPageRoutes = async (
  app: FastifyInstance<any, any, any, any>,
  dependencies: { pages: PageService; sessions: SessionService }
) => {
  const { pages, sessions } = dependencies;
  const requireAdmin = async (
    request: Parameters<SessionService['requireAuth']>[0],
    reply: Parameters<SessionService['requireAuth']>[1]
  ) => sessions.requireAuth(request, reply);

  app.get('/api/pages', async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    return pages.list(authenticated.currentUser.id, request.query as Record<string, string>);
  });

  app.post('/api/pages', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      return pages.create(authenticated.currentUser.id, request.body as PageInput);
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(errorStatus(message)).send({ message });
    }
  });

  app.get('/api/pages/:id', async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      return pages.get(authenticated.currentUser.id, (request.params as { id: string }).id);
    } catch (error) {
      return reply.code(404).send({ message: (error as Error).message });
    }
  });

  app.patch('/api/pages/:id', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      return pages.update(authenticated.currentUser.id, (request.params as { id: string }).id, request.body as PageInput);
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(errorStatus(message)).send({ message });
    }
  });

  app.delete('/api/pages/:id', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      pages.delete(authenticated.currentUser.id, (request.params as { id: string }).id);
      return { ok: true };
    } catch (error) {
      return reply.code(404).send({ message: (error as Error).message });
    }
  });

  app.post('/api/pages/:id/duplicate', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      return pages.duplicate(authenticated.currentUser.id, (request.params as { id: string }).id);
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(errorStatus(message)).send({ message });
    }
  });

  app.post('/api/pages/:id/status', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      const status = (request.body as { status?: PageStatus }).status as PageStatus;
      return pages.setStatus(authenticated.currentUser.id, (request.params as { id: string }).id, status);
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(errorStatus(message)).send({ message });
    }
  });

  app.get('/api/pages/:id/analytics', async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      const query = request.query as { range?: 'day' | 'week' | 'month'; timezoneOffsetMinutes?: string; limit?: string };
      const range = ['day', 'week', 'month'].includes(String(query.range)) ? query.range! : 'month';
      return pages.analytics(
        authenticated.currentUser.id,
        (request.params as { id: string }).id,
        range,
        Number(query.timezoneOffsetMinutes ?? 0),
        Number(query.limit ?? 10)
      );
    } catch (error) {
      return reply.code(404).send({ message: (error as Error).message });
    }
  });

  app.post('/api/pages/:id/analytics/clear', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      return pages.clearAnalytics(authenticated.currentUser.id, (request.params as { id: string }).id);
    } catch (error) {
      return reply.code(404).send({ message: (error as Error).message });
    }
  });

  app.get('/api/pages/public/:slug', async (request, reply) => {
    try {
      return pages.getPublic((request.params as { slug: string }).slug, {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
        referrer: request.headers.referer,
        language: request.headers['accept-language']
      });
    } catch (error) {
      return reply.code(404).send({ message: (error as Error).message });
    }
  });

  app.post('/api/pages/public/:slug/clicks', async (request, reply) => {
    try {
      pages.trackClick(
        (request.params as { slug: string }).slug,
        request.body as { blockId?: string; eventId?: string },
        {
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          referrer: request.headers.referer,
          language: request.headers['accept-language']
        }
      );
      return reply.code(202).send({ ok: true });
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(errorStatus(message)).send({ message });
    }
  });
};
