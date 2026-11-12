import type { BoardInput, BoardListResponse, BoardStatus } from '@/shared/board-types.js';
import { parseBoardInput } from '../domain/board-domain.js';
import { BoardRepository } from '../repositories/board-repository.js';
import { SettingsRepository } from '../repositories/settings-repository.js';
import { createSlugGenerator, validateCustomSlug, validateGeneratedSlug } from '../utils.js';

const duplicateError = (error: unknown) => {
  if (String((error as Error).message).includes('UNIQUE constraint failed')) {
    throw new Error('This slug is already in use.');
  }
  throw error;
};

export class BoardService {
  private readonly boards = new BoardRepository();
  private readonly settings = new SettingsRepository();

  private resolveSlug(requested?: string) {
    const security = this.settings.getSecuritySettings();
    const manual = requested?.trim();
    const slug = manual || createSlugGenerator(security.slugAllowedChars, security.minSlugLength)();
    const result = manual
      ? validateCustomSlug(slug, { minLength: security.minSlugLength, maxLength: security.maxSlugLength })
      : validateGeneratedSlug(slug, {
          allowedChars: security.slugAllowedChars,
          minLength: security.minSlugLength,
          maxLength: security.maxSlugLength
        });
    if (!result.ok) throw new Error(result.reason);
    return slug;
  }

  private normalize(raw: BoardInput) {
    const input = parseBoardInput(raw);
    if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now()) {
      throw new Error('Board expiration must be in the future.');
    }
    if (input.settings.readOnly) {
      input.settings.participantCanEdit = false;
      input.settings.participantCanDelete = false;
    }
    return input;
  }

  private validateTheme(userId: string, input: BoardInput) {
    if (!this.boards.listThemes(userId).some((theme) => theme.id === input.settings.themeId)) {
      throw new Error('Board theme was not found.');
    }
  }

  list(userId: string): BoardListResponse {
    const items = this.boards.list(userId);
    return {
      items,
      stats: {
        totalBoards: items.length,
        publishedBoards: items.filter((board) => board.status === 'published' && !board.archivedAt).length,
        totalCards: items.reduce((sum, board) => sum + board.cardCount, 0),
        pendingCards: items.reduce((sum, board) => sum + board.pendingCardCount, 0)
      }
    };
  }

  themes(userId: string) {
    return this.boards.listThemes(userId);
  }

  get(userId: string, boardId: string) {
    const board = this.boards.findById(userId, boardId);
    if (!board) throw new Error('Board not found.');
    return board;
  }

  create(userId: string, raw: BoardInput) {
    const input = this.normalize(raw);
    this.validateTheme(userId, input);
    try {
      return this.boards.create(userId, this.resolveSlug(input.slug), input);
    } catch (error) {
      return duplicateError(error);
    }
  }

  update(userId: string, boardId: string, raw: BoardInput) {
    const current = this.get(userId, boardId);
    const input = this.normalize(raw);
    this.validateTheme(userId, input);
    try {
      return this.boards.update(userId, boardId, input.slug ? this.resolveSlug(input.slug) : current.slug, input);
    } catch (error) {
      return duplicateError(error);
    }
  }

  setStatus(userId: string, boardId: string, status: BoardStatus) {
    const current = this.get(userId, boardId);
    return this.update(userId, boardId, {
      title: current.title,
      description: current.description,
      slug: current.slug,
      status,
      expiresAt: current.expiresAt,
      settings: current.settings
    });
  }

  duplicate(userId: string, boardId: string) {
    const current = this.get(userId, boardId);
    return this.create(userId, {
      title: `${current.title} copy`,
      description: current.description,
      status: 'draft',
      expiresAt: null,
      settings: { ...current.settings, locked: true, submissionsExpiresAt: null }
    });
  }

  archive(userId: string, boardId: string, archived: boolean) {
    this.get(userId, boardId);
    return this.boards.setArchived(userId, boardId, archived);
  }

  delete(userId: string, boardId: string) {
    this.get(userId, boardId);
    this.boards.delete(userId, boardId);
  }

  publicStatus(slug: string) {
    const board = this.boards.findBySlug(slug);
    if (!board || board.archivedAt || board.status === 'draft') return { state: 'not_found' as const };
    if (board.status === 'disabled') return { state: 'disabled' as const, board };
    if (board.expiresAt && Date.parse(board.expiresAt) <= Date.now()) return { state: 'expired' as const, board };
    return { state: 'available' as const, board };
  }

  getPublic(slug: string) {
    const status = this.publicStatus(slug);
    if (status.state !== 'available') throw new Error('Board not found.');
    const board = this.boards.findPublicBySlug(slug);
    if (!board) throw new Error('Board not found.');
    return board;
  }
}
