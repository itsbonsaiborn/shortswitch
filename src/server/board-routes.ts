import type { FastifyInstance } from 'fastify';
import type { BoardInput, BoardStatus } from '@/shared/board-types.js';
import type { SessionService } from './services/session-service.js';
import { BoardService } from './services/board-service.js';
import { BoardCardService } from './services/board-card-service.js';
import { BoardReactionService } from './services/board-reaction-service.js';
import { RateLimiterService } from './services/rate-limiter-service.js';
import { config } from './config.js';
import type { BoardRealtimeService } from './services/board-realtime-service.js';
import { sha256 } from './utils.js';

const PUBLIC_READ_IP_LIMIT = { maxAttempts: 1_000, windowMinutes: 1, blockMinutes: 2 } as const;
const PUBLIC_READ_BOARD_LIMIT = { maxAttempts: 2_000, windowMinutes: 1, blockMinutes: 2 } as const;
const PUBLIC_MUTATION_IP_LIMIT = { maxAttempts: 600, windowMinutes: 1, blockMinutes: 2 } as const;
const PUBLIC_MUTATION_SESSION_LIMIT = { maxAttempts: 60, windowMinutes: 1, blockMinutes: 2 } as const;
const PUBLIC_MUTATION_SESSION_BURST_LIMIT = { maxAttempts: 20, windowMinutes: 0.1, blockMinutes: 0.1 } as const;
const SSE_CONNECT_IP_LIMIT = { maxAttempts: 300, windowMinutes: 1, blockMinutes: 2 } as const;
const SSE_CONNECT_BOARD_LIMIT = { maxAttempts: 600, windowMinutes: 1, blockMinutes: 2 } as const;
const MAX_SSE_CONNECTIONS_PER_BOARD = 500;
const MAX_SSE_CONNECTIONS_PER_IP = 250;

const errorStatus = (message: string) => message.includes('not found') ? 404
  : message.includes('already in use') ? 409
    : message.includes('temporarily unavailable') || message.includes('temporarily limited') ? 429
      : 400;

export const registerBoardRoutes = async (
  app: FastifyInstance<any, any, any, any>,
  dependencies: {
    boards: BoardService;
    boardCards: BoardCardService;
    boardReactions: BoardReactionService;
    realtime: BoardRealtimeService;
    sessions: SessionService;
    rateLimiter: RateLimiterService;
  }
) => {
  const { boards, boardCards, boardReactions, realtime, sessions, rateLimiter } = dependencies;
  const requireAdmin = async (request: Parameters<SessionService['requireAuth']>[0], reply: Parameters<SessionService['requireAuth']>[1]) =>
    sessions.requireAuth(request, reply);
  const handle = async (reply: any, operation: () => unknown | Promise<unknown>) => {
    try { return await operation(); }
    catch (error) {
      const message = (error as Error).message;
      return reply.code(errorStatus(message)).send({ message });
    }
  };
  const ownershipCookieOptions = {
    httpOnly: true as const,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    path: '/api/boards/public/',
    maxAge: 30 * 24 * 60 * 60
  };
  const publicSession = (request: any, boardId: string) => request.cookies?.[boardCards.cookieName(boardId)] as string | undefined;
  const publicReactionSession = (request: any, boardId: string) =>
    request.cookies?.[boardReactions.cookieName(boardId)] as string | undefined;
  const reactionCookieOptions = {
    httpOnly: true as const,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    path: '/api/boards/public/'
  };
  const publicReadAllowed = (boardId: string, requestKey: string, slug: string) =>
    rateLimiter.consume('board-public-read-board', boardId, PUBLIC_READ_BOARD_LIMIT, { slug }) &&
    rateLimiter.consume('board-public-read-ip', `${boardId}:${requestKey}`, PUBLIC_READ_IP_LIMIT, { slug });
  const publicMutationAllowed = (boardId: string, requestKey: string, rawSession: string | undefined, slug: string) => {
    if (!rateLimiter.consume('board-public-mutation-ip', `${boardId}:${requestKey}`, PUBLIC_MUTATION_IP_LIMIT, { slug })) return false;
    if (!rawSession) return true;
    const sessionKey = `${boardId}:${sha256(rawSession)}`;
    return rateLimiter.consume('board-public-mutation-session', sessionKey, PUBLIC_MUTATION_SESSION_LIMIT, { slug }) &&
      rateLimiter.consume('board-public-mutation-session-burst', sessionKey, PUBLIC_MUTATION_SESSION_BURST_LIMIT, { slug });
  };
  const requireBoolean = (value: unknown) => {
    if (typeof value !== 'boolean') throw new Error('Invalid request.');
    return value;
  };

  app.get('/api/boards', async (request, reply) => {
    const auth = await requireAdmin(request, reply); if (!auth) return;
    return boards.list(auth.currentUser.id);
  });
  app.get('/api/boards/themes', async (request, reply) => {
    const auth = await requireAdmin(request, reply); if (!auth) return;
    return boards.themes(auth.currentUser.id);
  });
  app.post('/api/boards', { onRequest: app.csrfProtection }, async (request, reply) => {
    const auth = await requireAdmin(request, reply); if (!auth) return;
    return handle(reply, () => boards.create(auth.currentUser.id, request.body as BoardInput));
  });
  app.get('/api/boards/:id', async (request, reply) => {
    const auth = await requireAdmin(request, reply); if (!auth) return;
    return handle(reply, () => boards.get(auth.currentUser.id, (request.params as { id: string }).id));
  });
  app.get('/api/boards/:id/cards', async (request, reply) => {
    const auth = await requireAdmin(request, reply); if (!auth) return;
    return handle(reply, () => boardCards.listAdmin(auth.currentUser.id, (request.params as { id: string }).id));
  });
  app.patch('/api/boards/:id/cards/:cardId', { onRequest: app.csrfProtection }, async (request, reply) => {
    const auth = await requireAdmin(request, reply); if (!auth) return;
    const { id, cardId } = request.params as { id: string; cardId: string };
    return handle(reply, () => {
      const card = boardCards.updateAdmin(auth.currentUser.id, id, cardId, request.body);
      realtime.schedule(id);
      return card;
    });
  });
  app.delete('/api/boards/:id/cards/:cardId', { onRequest: app.csrfProtection }, async (request, reply) => {
    const auth = await requireAdmin(request, reply); if (!auth) return;
    const { id, cardId } = request.params as { id: string; cardId: string };
    return handle(reply, () => { boardCards.deleteAdmin(auth.currentUser.id, id, cardId); realtime.schedule(id); return { ok: true }; });
  });
  app.post('/api/boards/:id/cards/:cardId/moderation', { onRequest: app.csrfProtection }, async (request, reply) => {
    const auth = await requireAdmin(request, reply); if (!auth) return;
    const { id, cardId } = request.params as { id: string; cardId: string };
    const body = request.body as { status?: any; reason?: string | null };
    return handle(reply, () => {
      const card = boardCards.moderate(auth.currentUser.id, id, cardId, body.status, body.reason ?? null);
      realtime.schedule(id);
      return card;
    });
  });
  app.post('/api/boards/:id/cards/:cardId/visibility', { onRequest: app.csrfProtection }, async (request, reply) => {
    const auth = await requireAdmin(request, reply); if (!auth) return;
    const { id, cardId } = request.params as { id: string; cardId: string };
    return handle(reply, () => {
      const card = boardCards.setHidden(auth.currentUser.id, id, cardId, requireBoolean((request.body as { hidden?: unknown }).hidden));
      realtime.schedule(id);
      return card;
    });
  });
  app.post('/api/boards/:id/cards/:cardId/ownership/reset', { onRequest: app.csrfProtection }, async (request, reply) => {
    const auth = await requireAdmin(request, reply); if (!auth) return;
    const { id, cardId } = request.params as { id: string; cardId: string };
    return handle(reply, async () => {
      const result = await boardCards.resetOwnership(auth.currentUser.id, id, cardId);
      realtime.schedule(id);
      return result;
    });
  });
  app.patch('/api/boards/:id', { onRequest: app.csrfProtection }, async (request, reply) => {
    const auth = await requireAdmin(request, reply); if (!auth) return;
    const id = (request.params as { id: string }).id;
    return handle(reply, () => {
      const board = boards.update(auth.currentUser.id, id, request.body as BoardInput);
      if (board.status === 'published' && !board.archivedAt) realtime.schedule(id); else realtime.closeBoard(id);
      return board;
    });
  });
  app.delete('/api/boards/:id', { onRequest: app.csrfProtection }, async (request, reply) => {
    const auth = await requireAdmin(request, reply); if (!auth) return;
    const id = (request.params as { id: string }).id;
    return handle(reply, () => { boards.delete(auth.currentUser.id, id); realtime.closeBoard(id); return { ok: true }; });
  });
  app.post('/api/boards/:id/duplicate', { onRequest: app.csrfProtection }, async (request, reply) => {
    const auth = await requireAdmin(request, reply); if (!auth) return;
    return handle(reply, () => boards.duplicate(auth.currentUser.id, (request.params as { id: string }).id));
  });
  app.post('/api/boards/:id/archive', { onRequest: app.csrfProtection }, async (request, reply) => {
    const auth = await requireAdmin(request, reply); if (!auth) return;
    const id = (request.params as { id: string }).id;
    return handle(reply, () => {
      const board = boards.archive(auth.currentUser.id, id, requireBoolean((request.body as { archived?: unknown }).archived));
      if (board.archivedAt) realtime.closeBoard(id); else realtime.schedule(id);
      return board;
    });
  });
  app.post('/api/boards/:id/status', { onRequest: app.csrfProtection }, async (request, reply) => {
    const auth = await requireAdmin(request, reply); if (!auth) return;
    const id = (request.params as { id: string }).id;
    return handle(reply, () => {
      const board = boards.setStatus(auth.currentUser.id, id, (request.body as { status: BoardStatus }).status);
      if (board.status === 'published') realtime.schedule(id); else realtime.closeBoard(id);
      return board;
    });
  });
  app.get('/api/boards/public/:slug', async (request, reply) => {
    const slug = (request.params as { slug: string }).slug;
    const status = boards.publicStatus(slug);
    if (status.state === 'available' && !publicReadAllowed(status.board.id, request.ip ?? 'unknown', slug)) {
      return reply.code(429).send({ message: 'Board requests are temporarily limited.' });
    }
    const rawSession = status.state === 'available' ? publicSession(request, status.board.id) : undefined;
    const presentation = (request.query as { presentation?: string }).presentation === '1';
    const reactionSession = status.state === 'available' && !presentation
      ? publicReactionSession(request, status.board.id)
      : undefined;
    return handle(reply, () => boardCards.getPublic(slug, rawSession, presentation, reactionSession));
  });
  app.get('/api/boards/public/:slug/events', async (request, reply) => {
    const slug = (request.params as { slug: string }).slug;
    const status = boards.publicStatus(slug);
    if (status.state !== 'available') return reply.code(404).send({ message: 'Board not found.' });
    const requestKey = request.ip ?? 'unknown';
    if (!rateLimiter.consume('board-sse-connect-board', status.board.id, SSE_CONNECT_BOARD_LIMIT, { slug }) ||
        !rateLimiter.consume('board-sse-connect-ip', `${status.board.id}:${requestKey}`, SSE_CONNECT_IP_LIMIT, { slug })) {
      return reply.code(429).send({ message: 'Too many connection attempts. Please try again later.' });
    }
    if (realtime.connectionCount(status.board.id) >= MAX_SSE_CONNECTIONS_PER_BOARD ||
        realtime.connectionCount(status.board.id, requestKey) >= MAX_SSE_CONNECTIONS_PER_IP) {
      return reply.code(429).send({ message: 'Board real-time capacity is temporarily unavailable.' });
    }
    const presentation = (request.query as { presentation?: string }).presentation === '1';
    const rawSession = publicSession(request, status.board.id);
    const reactionSession = presentation ? undefined : publicReactionSession(request, status.board.id);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    const snapshotProvider = () => boardCards.getPublic(slug, rawSession, presentation, reactionSession);
    const remove = realtime.addClient(status.board.id, reply.raw, snapshotProvider, requestKey);
    request.raw.once('close', remove);
  });
  app.post('/api/boards/public/:slug/cards', { onRequest: app.csrfProtection }, async (request, reply) => {
    const slug = (request.params as { slug: string }).slug;
    const status = boards.publicStatus(slug);
    return handle(reply, async () => {
      const rawSession = status.state === 'available' ? publicSession(request, status.board.id) : undefined;
      const result = await boardCards.create(slug, request.body, rawSession, request.ip ?? 'unknown');
      if (result.sessionToken) reply.setCookie(result.cookieName, result.sessionToken, ownershipCookieOptions);
      if (status.state === 'available') realtime.schedule(status.board.id);
      return reply.code(201).send(result.response);
    });
  });
  app.patch('/api/boards/public/:slug/cards/:cardId', { onRequest: app.csrfProtection }, async (request, reply) => {
    const { slug, cardId } = request.params as { slug: string; cardId: string };
    const status = boards.publicStatus(slug);
    const rawSession = status.state === 'available' ? publicSession(request, status.board.id) : undefined;
    if (status.state === 'available' && !publicMutationAllowed(status.board.id, request.ip ?? 'unknown', rawSession, slug)) {
      return reply.code(429).send({ message: 'Board changes are temporarily limited.' });
    }
    return handle(reply, () => {
      const card = boardCards.update(slug, cardId, request.body, rawSession);
      if (status.state === 'available') realtime.schedule(status.board.id);
      return card;
    });
  });
  app.delete('/api/boards/public/:slug/cards/:cardId', { onRequest: app.csrfProtection }, async (request, reply) => {
    const { slug, cardId } = request.params as { slug: string; cardId: string };
    const status = boards.publicStatus(slug);
    const rawSession = status.state === 'available' ? publicSession(request, status.board.id) : undefined;
    if (status.state === 'available' && !publicMutationAllowed(status.board.id, request.ip ?? 'unknown', rawSession, slug)) {
      return reply.code(429).send({ message: 'Board changes are temporarily limited.' });
    }
    return handle(reply, () => { boardCards.delete(slug, cardId, rawSession); if (status.state === 'available') realtime.schedule(status.board.id); return { ok: true }; });
  });
  app.post('/api/boards/public/:slug/cards/:cardId/recover', { onRequest: app.csrfProtection }, async (request, reply) => {
    const { slug, cardId } = request.params as { slug: string; cardId: string };
    const status = boards.publicStatus(slug);
    return handle(reply, async () => {
      const rawSession = status.state === 'available' ? publicSession(request, status.board.id) : undefined;
      const result = await boardCards.recover(slug, cardId, (request.body as { pin?: unknown }).pin, request.ip ?? 'unknown', rawSession);
      if (result.sessionToken) reply.setCookie(result.cookieName, result.sessionToken, ownershipCookieOptions);
      if (status.state === 'available') realtime.schedule(status.board.id);
      return result.response;
    });
  });
  app.get('/api/boards/public/:slug/cards/:cardId/reaction', async (request, reply) => {
    const { slug, cardId } = request.params as { slug: string; cardId: string };
    const status = boards.publicStatus(slug);
    if (status.state === 'available' && !publicReadAllowed(status.board.id, request.ip ?? 'unknown', slug)) {
      return reply.code(429).send({ message: 'Board requests are temporarily limited.' });
    }
    const rawSession = status.state === 'available' ? publicReactionSession(request, status.board.id) : undefined;
    return handle(reply, () => boardReactions.get(slug, cardId, rawSession));
  });
  app.put('/api/boards/public/:slug/cards/:cardId/reaction', { onRequest: app.csrfProtection }, async (request, reply) => {
    const { slug, cardId } = request.params as { slug: string; cardId: string };
    const status = boards.publicStatus(slug);
    return handle(reply, () => {
      const rawSession = status.state === 'available' ? publicReactionSession(request, status.board.id) : undefined;
      const result = boardReactions.set(slug, cardId, (request.body as { reaction?: unknown }).reaction, rawSession, request.ip ?? 'unknown');
      if (result.sessionToken) reply.setCookie(result.cookieName, result.sessionToken, reactionCookieOptions);
      realtime.broadcastReaction(result.boardId, cardId, result.state, result.revision);
      return result.state;
    });
  });
  app.delete('/api/boards/public/:slug/cards/:cardId/reaction', { onRequest: app.csrfProtection }, async (request, reply) => {
    const { slug, cardId } = request.params as { slug: string; cardId: string };
    const status = boards.publicStatus(slug);
    const rawSession = status.state === 'available' ? publicReactionSession(request, status.board.id) : undefined;
    return handle(reply, () => {
      const result = boardReactions.remove(slug, cardId, rawSession, request.ip ?? 'unknown');
      realtime.broadcastReaction(result.boardId, cardId, result.state, result.revision);
      return result.state;
    });
  });
};
