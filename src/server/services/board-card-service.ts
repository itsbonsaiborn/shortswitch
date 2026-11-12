import argon2 from 'argon2';
import crypto from 'node:crypto';
import type {
  BoardCard,
  BoardCardCreateResponse,
  BoardCardInput,
  BoardCardOwnershipResetResponse,
  BoardCardRecoveryResponse,
  PublicBoardCard
} from '@/shared/board-types.js';
import { parseBoardCardInput } from '../domain/board-domain.js';
import { BoardRepository } from '../repositories/board-repository.js';
import { RateLimiterService } from './rate-limiter-service.js';
import { sha256 } from '../utils.js';
import { ModerationFilterService } from './moderation-filter-service.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RECOVERY_LIMIT = { maxAttempts: 5, windowMinutes: 10, blockMinutes: 15 } as const;
const RECOVERY_IP_BOARD_LIMIT = { maxAttempts: 100, windowMinutes: 10, blockMinutes: 15 } as const;
const RECOVERY_PERSISTENT_LIMIT = { maxAttempts: 10, windowMs: 10 * 60_000, lockMs: 30 * 60_000 } as const;
const CREATE_BOARD_LIMIT = { maxAttempts: 500, windowMinutes: 1, blockMinutes: 2 } as const;
const CREATE_IP_LIMIT = { maxAttempts: 300, windowMinutes: 1, blockMinutes: 2 } as const;
const CREATE_SESSION_LIMIT = { maxAttempts: 15, windowMinutes: 1, blockMinutes: 2 } as const;
const CREATE_SESSION_BURST_LIMIT = { maxAttempts: 3, windowMinutes: 0.1, blockMinutes: 0.1 } as const;

const randomSecret = () => crypto.randomBytes(32).toString('base64url');
const randomPin = () => crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
const hashRecoveryPin = (pin: string) => argon2.hash(pin, {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1
});

export class BoardCardService {
  private readonly boards = new BoardRepository();
  private readonly dummyRecoveryHash = hashRecoveryPin(randomPin());

  constructor(
    private readonly rateLimiter: RateLimiterService,
    private readonly moderationFilter = new ModerationFilterService()
  ) {}

  private filterReason(boardId: string, input: BoardCardInput) {
    const ownerId = this.boards.getOwnerId(boardId);
    if (!ownerId) throw new Error('Board not found.');
    const matches = [
      ['Card title', input.title],
      ['Card body', input.body],
      ['Participant name', input.authorDisplayName]
    ].flatMap(([label, value]) => {
      if (!value) return [];
      const rule = this.moderationFilter.match(ownerId, value);
      return rule ? [`${label} matched ban rule: ${rule.pattern}`] : [];
    });
    return matches.length ? matches.join('; ') : null;
  }

  cookieName(boardId: string) {
    return `ss_board_${sha256(boardId).slice(0, 16)}`;
  }

  private toPublicCard(card: BoardCard, owned: boolean): PublicBoardCard {
    return {
      id: card.id,
      authorDisplayName: card.authorDisplayName,
      title: card.title,
      body: card.body,
      imageUrl: card.imageUrl,
      layout: card.layout,
      moderationStatus: card.moderationStatus,
      publishedAt: card.publishedAt,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
      position: card.position,
      owned,
      reactions: { likes: 0, dislikes: 0, current: null }
    };
  }

  private getAvailableBoard(slug: string) {
    const board = this.boards.findBySlug(slug);
    if (!board || board.status !== 'published' || board.archivedAt) throw new Error('Board not found.');
    if (board.expiresAt && Date.parse(board.expiresAt) <= Date.now()) throw new Error('Board expired.');
    return board;
  }

  private ensureSession(boardId: string, rawToken?: string) {
    if (rawToken) {
      const existing = this.boards.findOwnershipSession(boardId, sha256(rawToken));
      if (existing) return { session: existing, rawToken, created: false };
    }
    const nextToken = randomSecret();
    const session = this.boards.createOwnershipSession(
      boardId,
      sha256(nextToken),
      new Date(Date.now() + SESSION_TTL_MS).toISOString()
    );
    return { session, rawToken: nextToken, created: true };
  }

  getPublic(slug: string, rawSessionToken?: string, presentation = false, rawReactionSessionToken?: string) {
    this.getAvailableBoard(slug);
    const board = this.boards.findPublicBySlug(
      slug,
      rawSessionToken ? sha256(rawSessionToken) : undefined,
      presentation,
      rawReactionSessionToken ? sha256(rawReactionSessionToken) : undefined
    );
    if (!board) throw new Error('Board not found.');
    return board;
  }

  async create(slug: string, raw: unknown, rawSessionToken?: string): Promise<{
    response: BoardCardCreateResponse;
    sessionToken?: string;
    cookieName: string;
  }>;
  async create(slug: string, raw: unknown, rawSessionToken: string | undefined, requestKey: string): Promise<{
    response: BoardCardCreateResponse;
    sessionToken?: string;
    cookieName: string;
  }>;
  async create(slug: string, raw: unknown, rawSessionToken?: string, requestKey = 'unknown'): Promise<{
    response: BoardCardCreateResponse;
    sessionToken?: string;
    cookieName: string;
  }> {
    const board = this.getAvailableBoard(slug);
    if (board.settings.readOnly || board.settings.locked ||
        (board.settings.submissionsExpiresAt && Date.parse(board.settings.submissionsExpiresAt) <= Date.now())) {
      throw new Error('Board does not accept new cards.');
    }
    if (!this.rateLimiter.consume('board-card-create-board', board.id, CREATE_BOARD_LIMIT, { slug }) ||
        !this.rateLimiter.consume('board-card-create-ip', `${board.id}:${requestKey}`, CREATE_IP_LIMIT, { slug })) {
      throw new Error('Board submissions are temporarily limited.');
    }
    const cardInput = parseBoardCardInput(raw, board.settings);
    const filterReason = this.filterReason(board.id, cardInput);
    const ownership = this.ensureSession(board.id, rawSessionToken);
    if (!this.rateLimiter.consume('board-card-create-session', `${board.id}:${ownership.session.id}`, CREATE_SESSION_LIMIT, { slug }) ||
        !this.rateLimiter.consume('board-card-create-session-burst', `${board.id}:${ownership.session.id}`, CREATE_SESSION_BURST_LIMIT, { slug })) {
      throw new Error('Board submissions are temporarily limited.');
    }
    const participant = this.boards.upsertParticipant(board.id, sha256(ownership.rawToken), cardInput.authorDisplayName);
    const recoveryPin = randomPin();
    const recoveryPinHash = await hashRecoveryPin(recoveryPin);
    const ownerTokenHash = sha256(randomSecret());
    const card = this.boards.createCard({
      boardId: board.id,
      participantId: participant.id,
      card: cardInput,
      position: { x: 0, y: 0, width: 280, height: 180, zIndex: board.cardCount },
      ownerTokenHash,
      recoveryPinHash,
      ownershipSessionId: ownership.session.id,
      moderationStatus: filterReason ? 'pending' : undefined,
      moderationReason: filterReason
    });
    return {
      response: { card: this.toPublicCard(card, true), recoveryPin },
      sessionToken: ownership.created ? ownership.rawToken : undefined,
      cookieName: this.cookieName(board.id)
    };
  }

  update(slug: string, cardId: string, raw: unknown, rawSessionToken?: string) {
    const board = this.getAvailableBoard(slug);
    if (!rawSessionToken) throw new Error('Board card is not editable.');
    const session = this.boards.findOwnershipSession(board.id, sha256(rawSessionToken));
    if (!session) throw new Error('Board card is not editable.');
    const input = parseBoardCardInput(raw, board.settings);
    return this.toPublicCard(this.boards.updateOwnedCard(board.id, cardId, session.id, input, this.filterReason(board.id, input)), true);
  }

  delete(slug: string, cardId: string, rawSessionToken?: string) {
    const board = this.getAvailableBoard(slug);
    if (!rawSessionToken) throw new Error('Board card is not deletable.');
    const session = this.boards.findOwnershipSession(board.id, sha256(rawSessionToken));
    if (!session) throw new Error('Board card is not deletable.');
    this.boards.deleteOwnedCard(board.id, cardId, session.id);
  }

  async recover(slug: string, cardId: string, rawPin: unknown, requestKey: string, rawSessionToken?: string): Promise<{
    response: BoardCardRecoveryResponse;
    sessionToken?: string;
    cookieName: string;
  }> {
    const board = this.getAvailableBoard(slug);
    const rateKey = `${requestKey}:${board.id}:${cardId}`;
    const globalRateKey = `${requestKey}:${board.id}`;
    if (!this.rateLimiter.consume('board-card-recovery-ip-board', globalRateKey, RECOVERY_IP_BOARD_LIMIT, { slug }) ||
        !this.rateLimiter.consume('board-card-recovery', rateKey, RECOVERY_LIMIT, { slug })) {
      throw new Error('Recovery is temporarily unavailable.');
    }
    const pin = typeof rawPin === 'string' && /^\d{6}$/.test(rawPin) ? rawPin : 'invalid';
    const credential = this.boards.getCardCredential(board.id, cardId);
    const hash = credential?.recoveryPinHash ?? await this.dummyRecoveryHash;
    const valid = await argon2.verify(hash, pin).catch(() => false);
    const persistentlyLocked = Boolean(
      credential?.recoveryLockedUntil && Date.parse(credential.recoveryLockedUntil) > Date.now()
    );
    if (!credential?.recoveryPinHash || !valid || persistentlyLocked) {
      if (credential && !persistentlyLocked) {
        this.boards.recordRecoveryFailure(board.id, cardId, RECOVERY_PERSISTENT_LIMIT);
      }
      throw new Error('Invalid recovery PIN.');
    }

    const ownership = this.ensureSession(board.id, rawSessionToken);
    this.boards.rotateCardOwnership(null, board.id, cardId, sha256(randomSecret()), credential.recoveryPinHash, ownership.session.id);
    this.rateLimiter.reset('board-card-recovery', rateKey);
    return {
      response: { ok: true, cardId },
      sessionToken: ownership.created ? ownership.rawToken : undefined,
      cookieName: this.cookieName(board.id)
    };
  }

  listAdmin(userId: string, boardId: string) {
    return this.boards.listCards(userId, boardId);
  }

  updateAdmin(userId: string, boardId: string, cardId: string, raw: unknown) {
    const board = this.boards.findById(userId, boardId);
    if (!board) throw new Error('Board not found.');
    const input = parseBoardCardInput(raw, board.settings);
    return this.boards.updateAdminCard(userId, boardId, cardId, input, this.filterReason(board.id, input));
  }

  deleteAdmin(userId: string, boardId: string, cardId: string) {
    this.boards.deleteAdminCard(userId, boardId, cardId);
  }

  moderate(userId: string, boardId: string, cardId: string, status: unknown, reason: unknown) {
    if (status !== 'pending' && status !== 'approved' && status !== 'rejected') {
      throw new Error('Invalid moderation state.');
    }
    if (reason !== null && reason !== undefined && typeof reason !== 'string') throw new Error('Invalid request.');
    const cleanReason = typeof reason === 'string' ? reason.trim() : '';
    if (cleanReason.length > 1000 || /[\0-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(cleanReason)) {
      throw new Error('Moderation reason is invalid.');
    }
    return this.boards.moderateCard(userId, boardId, cardId, status, cleanReason || null);
  }

  setHidden(userId: string, boardId: string, cardId: string, hidden: boolean) {
    return this.boards.setCardHidden(userId, boardId, cardId, hidden);
  }

  async resetOwnership(userId: string, boardId: string, cardId: string): Promise<BoardCardOwnershipResetResponse> {
    const recoveryPin = randomPin();
    this.boards.rotateCardOwnership(userId, boardId, cardId, sha256(randomSecret()), await hashRecoveryPin(recoveryPin));
    return { cardId, recoveryPin };
  }
}
