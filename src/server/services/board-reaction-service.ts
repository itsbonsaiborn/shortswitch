import crypto from 'node:crypto';
import type { BoardReactionType } from '@/shared/board-types.js';
import { BoardRepository } from '../repositories/board-repository.js';
import { sha256 } from '../utils.js';
import { RateLimiterService } from './rate-limiter-service.js';

const REACTION_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REACTION_BOARD_LIMIT = { maxAttempts: 2_000, windowMinutes: 1, blockMinutes: 2 } as const;
const REACTION_IP_LIMIT = { maxAttempts: 600, windowMinutes: 1, blockMinutes: 2 } as const;
const REACTION_SESSION_LIMIT = { maxAttempts: 60, windowMinutes: 1, blockMinutes: 2 } as const;
const REACTION_SESSION_BURST_LIMIT = { maxAttempts: 10, windowMinutes: 0.05, blockMinutes: 0.05 } as const;
const randomSecret = () => crypto.randomBytes(32).toString('base64url');

export class BoardReactionService {
  private readonly boards = new BoardRepository();

  constructor(private readonly rateLimiter: RateLimiterService) {}

  cookieName(boardId: string) {
    return `ss_board_react_${sha256(boardId).slice(0, 16)}`;
  }

  private getAvailableBoard(slug: string) {
    const board = this.boards.findBySlug(slug);
    if (!board || board.status !== 'published' || board.archivedAt) throw new Error('Board not found.');
    if (board.expiresAt && Date.parse(board.expiresAt) <= Date.now()) throw new Error('Board expired.');
    return board;
  }

  private ensureSession(boardId: string, rawToken?: string) {
    if (rawToken) {
      const existing = this.boards.findReactionSession(boardId, sha256(rawToken));
      if (existing) return { session: existing, rawToken, created: false };
    }
    const nextToken = randomSecret();
    const session = this.boards.createReactionSession(
      boardId,
      sha256(nextToken),
      new Date(Date.now() + REACTION_SESSION_TTL_MS).toISOString()
    );
    return { session, rawToken: nextToken, created: true };
  }

  private ensureRequestAllowed(boardId: string, requestKey: string, slug: string) {
    const allowed = this.rateLimiter.consume('board-reaction-board', boardId, REACTION_BOARD_LIMIT, { slug }) &&
      this.rateLimiter.consume('board-reaction-ip', `${boardId}:${requestKey}`, REACTION_IP_LIMIT, { slug });
    if (!allowed) throw new Error('Reaction changes are temporarily limited.');
  }

  private ensureSessionAllowed(boardId: string, sessionId: string, slug: string) {
    const allowed = this.rateLimiter.consume('board-reaction-session', `${boardId}:${sessionId}`, REACTION_SESSION_LIMIT, { slug }) &&
      this.rateLimiter.consume('board-reaction-session-burst', `${boardId}:${sessionId}`, REACTION_SESSION_BURST_LIMIT, { slug });
    if (!allowed) throw new Error('Reaction changes are temporarily limited.');
  }

  get(slug: string, cardId: string, rawSessionToken?: string) {
    const board = this.getAvailableBoard(slug);
    const session = rawSessionToken
      ? this.boards.findReactionSession(board.id, sha256(rawSessionToken))
      : undefined;
    const state = this.boards.getReactionState(board.id, cardId, session?.id);
    if (!state) throw new Error('Board card not found.');
    return state;
  }

  set(slug: string, cardId: string, rawReaction: unknown, rawSessionToken?: string, requestKey = 'unknown') {
    const board = this.getAvailableBoard(slug);
    if (board.settings.readOnly) throw new Error('Board reactions are locked.');
    this.ensureRequestAllowed(board.id, requestKey, slug);
    if (rawReaction !== 'like' && rawReaction !== 'dislike') throw new Error('Invalid board reaction.');
    if (!this.boards.getReactionState(board.id, cardId)) throw new Error('Board card not found.');
    const session = this.ensureSession(board.id, rawSessionToken);
    this.ensureSessionAllowed(board.id, session.session.id, slug);
    const state = this.boards.setReaction(board.id, cardId, session.session.id, rawReaction as BoardReactionType);
    return {
      state,
      boardId: board.id,
      revision: this.boards.getPublicRevision(board.id),
      sessionToken: session.created ? session.rawToken : undefined,
      cookieName: this.cookieName(board.id)
    };
  }

  remove(slug: string, cardId: string, rawSessionToken?: string, requestKey = 'unknown') {
    const board = this.getAvailableBoard(slug);
    if (board.settings.readOnly) throw new Error('Board reactions are locked.');
    this.ensureRequestAllowed(board.id, requestKey, slug);
    if (!rawSessionToken) {
      const state = this.boards.getReactionState(board.id, cardId);
      if (!state) throw new Error('Board card not found.');
      return { state, boardId: board.id, revision: this.boards.getPublicRevision(board.id) };
    }
    const session = this.boards.findReactionSession(board.id, sha256(rawSessionToken));
    if (!session) {
      const state = this.boards.getReactionState(board.id, cardId);
      if (!state) throw new Error('Board card not found.');
      return { state, boardId: board.id, revision: this.boards.getPublicRevision(board.id) };
    }
    this.ensureSessionAllowed(board.id, session.id, slug);
    return {
      state: this.boards.setReaction(board.id, cardId, session.id, null),
      boardId: board.id,
      revision: this.boards.getPublicRevision(board.id)
    };
  }
}
