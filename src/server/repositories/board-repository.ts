import type { DatabaseSync } from 'node:sqlite';
import type {
  BoardCard,
  BoardCardInput,
  BoardCardLayout,
  BoardCardModerationStatus,
  BoardCardPosition,
  BoardCardReactionState,
  BoardReactionType,
  BoardInput,
  BoardParticipant,
  BoardRealtimeEvent,
  BoardRealtimeEventType,
  BoardSettings,
  BoardSummary,
  BoardThemeReference,
  PublicBoard
} from '@/shared/board-types.js';
import { config } from '../config.js';
import { getDb } from '../db.js';
import {
  boardCardPositionInputSchema,
  boardCredentialHashesSchema,
  boardOpaqueTokenHashSchema,
  parseBoardCardInput
} from '../domain/board-domain.js';
import { buildShortUrl, createId, nowIso } from '../utils.js';

interface BoardRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  status: BoardSummary['status'];
  publicRevision: number;
  publishedAt: string | null;
  archivedAt: string | null;
  expiresAt: string | null;
  cardCount: number;
  pendingCardCount: number;
  createdAt: string;
  updatedAt: string;
  themeId: string;
  layout: BoardSettings['layout'];
  visualStyle: BoardSettings['visualStyle'];
  backgroundPattern: BoardSettings['backgroundPattern'];
  patternIntensity: number;
  readOnly: number;
  locked: number;
  submissionsExpiresAt: string | null;
  requireParticipantName: number;
  moderationMode: BoardSettings['moderationMode'];
  maxCardsTotal: number;
  maxCardsPerParticipant: number;
  maxTitleLength: number;
  maxBodyLength: number;
  allowImageUrls: number;
  participantCanEdit: number;
  participantCanDelete: number;
  requireCardTitle: number;
}

interface CardRow {
  id: string;
  boardId: string;
  participantId: string | null;
  authorDisplayName: string | null;
  title: string;
  body: string;
  imageUrl: string | null;
  cardLayout: BoardCardLayout;
  moderationStatus: BoardCardModerationStatus;
  moderationReason: string | null;
  hidden: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  positionRevision: number;
  positionUpdatedAt: string;
}

interface PublicCardRow extends CardRow {
  likes: number;
  dislikes: number;
  currentReaction: BoardReactionType | null;
  owned: number;
}

const boardSelect = `
  SELECT b.id, b.slug, b.title, b.description, b.status,
         b.public_revision as publicRevision, b.published_at as publishedAt,
         b.archived_at as archivedAt, b.created_at as createdAt, b.updated_at as updatedAt,
         b.expires_at as expiresAt,
         (SELECT COUNT(*) FROM board_cards bc WHERE bc.board_id = b.id) as cardCount,
         (SELECT COUNT(*) FROM board_cards bc WHERE bc.board_id = b.id AND bc.moderation_status = 'pending') as pendingCardCount,
         s.theme_id as themeId, s.layout, s.visual_style as visualStyle,
         s.background_pattern as backgroundPattern, s.pattern_intensity as patternIntensity,
         s.is_read_only as readOnly, s.is_locked as locked,
         s.submissions_expires_at as submissionsExpiresAt,
         s.require_participant_name as requireParticipantName, s.moderation_mode as moderationMode,
         s.max_cards_total as maxCardsTotal, s.max_cards_per_participant as maxCardsPerParticipant,
         s.max_title_length as maxTitleLength, s.max_body_length as maxBodyLength,
         s.allow_image_urls as allowImageUrls, s.participant_can_edit as participantCanEdit,
         s.participant_can_delete as participantCanDelete, s.require_card_title as requireCardTitle
  FROM boards b INNER JOIN board_settings s ON s.board_id = b.id`;

const cardSelect = `
  SELECT c.id, c.board_id as boardId, c.participant_id as participantId,
         c.author_display_name as authorDisplayName, c.title, c.body, c.image_url as imageUrl,
         c.card_layout as cardLayout,
         c.moderation_status as moderationStatus, c.moderation_reason as moderationReason,
         c.is_hidden as hidden,
         c.published_at as publishedAt, c.created_at as createdAt, c.updated_at as updatedAt,
         p.x, p.y, p.width, p.height, p.z_index as zIndex,
         p.revision as positionRevision, p.updated_at as positionUpdatedAt
  FROM board_cards c INNER JOIN board_card_positions p ON p.card_id = c.id`;

const parseThemeConfig = (raw: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { surface: 'minimal_light' };
  } catch {
    return { surface: 'minimal_light' };
  }
};

export class BoardRepository {
  constructor(private readonly db: DatabaseSync = getDb()) {}

  private toBoard(row: BoardRow): BoardSummary {
    return {
      id: row.id,
      slug: row.slug,
      publicUrl: buildShortUrl(row.slug),
      title: row.title,
      description: row.description,
      status: row.status,
      publicRevision: Number(row.publicRevision),
      publishedAt: row.publishedAt,
      archivedAt: row.archivedAt,
      expiresAt: row.expiresAt,
      cardCount: Number(row.cardCount),
      pendingCardCount: Number(row.pendingCardCount),
      presentationUrl: `${config.publicUrl.replace(/\/$/, '')}/boards/${encodeURIComponent(row.slug)}/presentation`,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      settings: {
        themeId: row.themeId,
        layout: row.layout,
        visualStyle: row.visualStyle,
        backgroundPattern: row.backgroundPattern,
        patternIntensity: Number(row.patternIntensity),
        readOnly: Boolean(row.readOnly),
        locked: Boolean(row.locked),
        submissionsExpiresAt: row.submissionsExpiresAt,
        requireParticipantName: Boolean(row.requireParticipantName),
        moderationMode: row.moderationMode,
        maxCardsTotal: Number(row.maxCardsTotal),
        maxCardsPerParticipant: Number(row.maxCardsPerParticipant),
        maxTitleLength: Number(row.maxTitleLength),
        maxBodyLength: Number(row.maxBodyLength),
        allowImageUrls: Boolean(row.allowImageUrls),
        participantCanEdit: Boolean(row.participantCanEdit),
        participantCanDelete: Boolean(row.participantCanDelete),
        requireCardTitle: Boolean(row.requireCardTitle)
      }
    };
  }

  private toCard(row: CardRow): BoardCard {
    const position: BoardCardPosition = {
      x: Number(row.x),
      y: Number(row.y),
      width: Number(row.width),
      height: Number(row.height),
      zIndex: Number(row.zIndex),
      revision: Number(row.positionRevision),
      updatedAt: row.positionUpdatedAt
    };
    return {
      id: row.id,
      boardId: row.boardId,
      participantId: row.participantId,
      authorDisplayName: row.authorDisplayName,
      title: row.title,
      body: row.body,
      imageUrl: row.imageUrl,
      layout: row.cardLayout,
      moderationStatus: row.moderationStatus,
      moderationReason: row.moderationReason,
      hidden: Boolean(row.hidden),
      publishedAt: row.publishedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      position
    };
  }

  list(userId: string) {
    return (this.db.prepare(`${boardSelect} WHERE b.user_id = ? ORDER BY b.updated_at DESC`).all(userId) as unknown as BoardRow[])
      .map((row) => this.toBoard(row));
  }

  findById(userId: string, boardId: string) {
    const row = this.db.prepare(`${boardSelect} WHERE b.user_id = ? AND b.id = ?`).get(userId, boardId) as unknown as BoardRow | undefined;
    return row ? this.toBoard(row) : undefined;
  }

  findPublicBySlug(slug: string, sessionTokenHash?: string, presentation = false, reactionSessionTokenHash?: string) {
    const row = this.db.prepare(`${boardSelect} WHERE b.slug = ? AND b.status = 'published' AND b.archived_at IS NULL`).get(slug) as unknown as BoardRow | undefined;
    if (!row) return undefined;
    const board = this.toBoard(row);
    const session = !presentation && sessionTokenHash ? this.findOwnershipSession(board.id, sessionTokenHash) : undefined;
    const reactionSession = !presentation && reactionSessionTokenHash
      ? this.findReactionSession(board.id, reactionSessionTokenHash)
      : undefined;
    const cards = (this.db.prepare(
      `SELECT c.id, c.board_id as boardId, c.participant_id as participantId,
        c.author_display_name as authorDisplayName, c.title, c.body, c.image_url as imageUrl,
        c.card_layout as cardLayout,
        c.moderation_status as moderationStatus, c.moderation_reason as moderationReason,
        c.is_hidden as hidden,
        c.published_at as publishedAt, c.created_at as createdAt, c.updated_at as updatedAt,
        p.x, p.y, p.width, p.height, p.z_index as zIndex,
        p.revision as positionRevision, p.updated_at as positionUpdatedAt,
        COALESCE(reaction_counts.likes, 0) as likes,
        COALESCE(reaction_counts.dislikes, 0) as dislikes,
        current_reaction.reaction_type as currentReaction,
        CASE WHEN ownership.card_id IS NULL THEN 0 ELSE 1 END as owned
      FROM board_cards c INNER JOIN board_card_positions p ON p.card_id = c.id
      LEFT JOIN board_ownership_session_cards ownership
        ON ownership.card_id = c.id AND ownership.session_id = ?
      LEFT JOIN board_card_reactions current_reaction
        ON current_reaction.card_id = c.id AND current_reaction.session_id = ?
      LEFT JOIN (
        SELECT card_id,
          SUM(CASE WHEN reaction_type = 'like' THEN 1 ELSE 0 END) as likes,
          SUM(CASE WHEN reaction_type = 'dislike' THEN 1 ELSE 0 END) as dislikes
        FROM board_card_reactions WHERE board_id = ? GROUP BY card_id
      ) reaction_counts ON reaction_counts.card_id = c.id
      WHERE c.board_id = ? AND c.is_hidden = 0
        AND (c.moderation_status = 'approved' OR (c.moderation_status = 'pending' AND ownership.card_id IS NOT NULL))
      ORDER BY c.created_at DESC, c.id ASC`
    ).all(session?.id ?? '', reactionSession?.id ?? '', board.id, board.id) as unknown as PublicCardRow[]).map((cardRow) => {
      const card = this.toCard(cardRow);
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
        owned: Boolean(cardRow.owned),
        reactions: {
          likes: Number(cardRow.likes),
          dislikes: Number(cardRow.dislikes),
          current: cardRow.currentReaction
        }
      };
    });
    const theme = this.findTheme(board.settings.themeId);
    if (!theme) throw new Error('Board theme not found.');
    const result: PublicBoard = {
      id: board.id,
      slug: board.slug,
      title: board.title,
      description: board.description,
      publicRevision: board.publicRevision,
      expiresAt: board.expiresAt,
      theme,
      settings: {
        layout: board.settings.layout,
        visualStyle: board.settings.visualStyle,
        backgroundPattern: board.settings.backgroundPattern,
        patternIntensity: board.settings.patternIntensity,
        readOnly: board.settings.readOnly,
        locked: board.settings.locked,
        submissionsExpiresAt: board.settings.submissionsExpiresAt,
        requireParticipantName: board.settings.requireParticipantName,
        moderationMode: board.settings.moderationMode,
        maxCardsPerParticipant: board.settings.maxCardsPerParticipant,
        maxTitleLength: board.settings.maxTitleLength,
        maxBodyLength: board.settings.maxBodyLength,
        allowImageUrls: board.settings.allowImageUrls,
        participantCanEdit: board.settings.participantCanEdit,
        participantCanDelete: board.settings.participantCanDelete,
        requireCardTitle: board.settings.requireCardTitle
      },
      cards
    };
    return result;
  }

  findBySlug(slug: string) {
    const row = this.db.prepare(`${boardSelect} WHERE b.slug = ?`).get(slug) as unknown as BoardRow | undefined;
    return row ? this.toBoard(row) : undefined;
  }

  getOwnerId(boardId: string) {
    return (this.db.prepare('SELECT user_id as userId FROM boards WHERE id = ?').get(boardId) as { userId: string } | undefined)?.userId;
  }

  getPublicRevision(boardId: string) {
    return Number((this.db.prepare('SELECT public_revision as revision FROM boards WHERE id = ?').get(boardId) as { revision: number } | undefined)?.revision ?? 0);
  }

  listThemes(userId: string): BoardThemeReference[] {
    return (this.db.prepare(`
      SELECT id, name, config_json as configJson, is_system as system
      FROM board_themes WHERE is_system = 1 OR owner_user_id = ? ORDER BY is_system DESC, name
    `).all(userId) as unknown as Array<{ id: string; name: string; configJson: string; system: number }>).map((row) => ({
      id: row.id,
      name: row.name,
      config: parseThemeConfig(row.configJson),
      system: Boolean(row.system)
    }));
  }

  private findTheme(themeId: string): BoardThemeReference | undefined {
    const row = this.db.prepare(`SELECT id, name, config_json as configJson, is_system as system FROM board_themes WHERE id = ?`)
      .get(themeId) as { id: string; name: string; configJson: string; system: number } | undefined;
    return row ? { id: row.id, name: row.name, config: parseThemeConfig(row.configJson), system: Boolean(row.system) } : undefined;
  }

  create(userId: string, slug: string, input: BoardInput) {
    const id = createId();
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`INSERT INTO public_slugs (slug, resource_type, resource_id, created_at) VALUES (?, 'board', ?, ?)`)
        .run(slug, id, timestamp);
      this.db.prepare(`
        INSERT INTO boards (id, user_id, slug, title, description, status, published_at, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, userId, slug, input.title, input.description, input.status,
        input.status === 'published' ? timestamp : null, input.expiresAt ?? null, timestamp, timestamp
      );
      this.insertSettings(id, input.settings, timestamp);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.findById(userId, id)!;
  }

  update(userId: string, boardId: string, slug: string, input: BoardInput) {
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.db.prepare('SELECT slug, status FROM boards WHERE id = ? AND user_id = ?')
        .get(boardId, userId) as { slug: string; status: BoardSummary['status'] } | undefined;
      if (!current) throw new Error('Board not found.');
      if (current.slug !== slug) {
        this.db.prepare(`UPDATE public_slugs SET slug = ? WHERE resource_type = 'board' AND resource_id = ?`).run(slug, boardId);
      }
      this.db.prepare(`
        UPDATE boards SET slug = ?, title = ?, description = ?, status = ?,
          published_at = CASE WHEN ? = 'published' AND published_at IS NULL THEN ? ELSE published_at END,
          expires_at = ?, public_revision = public_revision + 1, updated_at = ?
        WHERE id = ? AND user_id = ?
      `).run(slug, input.title, input.description, input.status, input.status, timestamp, input.expiresAt ?? null, timestamp, boardId, userId);
      this.db.prepare(`
        UPDATE board_settings SET theme_id = ?, layout = ?, visual_style = ?,
          background_pattern = ?, pattern_intensity = ?, is_read_only = ?, is_locked = ?,
          submissions_expires_at = ?,
          require_participant_name = ?, moderation_mode = ?, max_cards_total = ?,
          max_cards_per_participant = ?, max_title_length = ?, max_body_length = ?,
          allow_image_urls = ?, participant_can_edit = ?, participant_can_delete = ?,
          updated_at = ?, require_card_title = ?
        WHERE board_id = ?
      `).run(
        input.settings.themeId, input.settings.layout, input.settings.visualStyle,
        input.settings.backgroundPattern, input.settings.patternIntensity, input.settings.readOnly ? 1 : 0,
        input.settings.locked ? 1 : 0, input.settings.submissionsExpiresAt,
        input.settings.requireParticipantName ? 1 : 0,
        input.settings.moderationMode, input.settings.maxCardsTotal, input.settings.maxCardsPerParticipant,
        input.settings.maxTitleLength, input.settings.maxBodyLength, input.settings.allowImageUrls ? 1 : 0,
        input.settings.participantCanEdit ? 1 : 0, input.settings.participantCanDelete ? 1 : 0,
        timestamp, input.settings.requireCardTitle ? 1 : 0, boardId
      );
      this.db.prepare(`INSERT INTO board_events (board_id, revision, event_type, entity_id, payload_json, created_at)
        SELECT id, public_revision, 'board_updated', NULL, '{}', ? FROM boards WHERE id = ?`).run(timestamp, boardId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.findById(userId, boardId)!;
  }

  setArchived(userId: string, boardId: string, archived: boolean) {
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.db.prepare('UPDATE boards SET archived_at = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .run(archived ? timestamp : null, timestamp, boardId, userId);
      if (Number(result.changes) !== 1) throw new Error('Board not found.');
      this.appendEvent(boardId, 'board_updated', null, { archived }, timestamp);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.findById(userId, boardId)!;
  }

  private insertSettings(boardId: string, settings: BoardSettings, timestamp: string) {
    this.db.prepare(`
      INSERT INTO board_settings (
        board_id, theme_id, layout, visual_style, background_pattern, pattern_intensity,
        is_read_only, is_locked, submissions_expires_at, require_participant_name,
        moderation_mode, max_cards_total, max_cards_per_participant, max_title_length,
        max_body_length, allow_image_urls, participant_can_edit, participant_can_delete,
        require_card_title, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      boardId, settings.themeId, settings.layout, settings.visualStyle,
      settings.backgroundPattern, settings.patternIntensity, settings.readOnly ? 1 : 0, settings.locked ? 1 : 0,
      settings.submissionsExpiresAt,
      settings.requireParticipantName ? 1 : 0, settings.moderationMode, settings.maxCardsTotal,
      settings.maxCardsPerParticipant, settings.maxTitleLength, settings.maxBodyLength,
      settings.allowImageUrls ? 1 : 0, settings.participantCanEdit ? 1 : 0,
      settings.participantCanDelete ? 1 : 0, settings.requireCardTitle ? 1 : 0, timestamp, timestamp
    );
  }

  delete(userId: string, boardId: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const owned = this.db.prepare('SELECT id FROM boards WHERE id = ? AND user_id = ?').get(boardId, userId);
      if (!owned) throw new Error('Board not found.');
      this.db.prepare(`DELETE FROM public_slugs WHERE resource_type = 'board' AND resource_id = ?`).run(boardId);
      this.db.prepare('DELETE FROM boards WHERE id = ? AND user_id = ?').run(boardId, userId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  upsertParticipant(boardId: string, participantKeyHash: string, displayName: string | null): BoardParticipant {
    const validatedParticipantKeyHash = boardOpaqueTokenHashSchema.parse(participantKeyHash);
    const timestamp = nowIso();
    const existing = this.db.prepare(
      `SELECT id FROM board_participants WHERE board_id = ? AND participant_key_hash = ?`
    ).get(boardId, validatedParticipantKeyHash) as { id: string } | undefined;
    const id = existing?.id ?? createId();
    this.db.prepare(`
      INSERT INTO board_participants (
        id, board_id, participant_key_hash, display_name, card_count, created_at, updated_at, last_seen_at
      ) VALUES (?, ?, ?, ?, 0, ?, ?, ?)
      ON CONFLICT(board_id, participant_key_hash) DO UPDATE SET
        display_name = excluded.display_name, updated_at = excluded.updated_at, last_seen_at = excluded.last_seen_at
    `).run(id, boardId, validatedParticipantKeyHash, displayName, timestamp, timestamp, timestamp);
    const row = this.db.prepare(`
      SELECT id, board_id as boardId, display_name as displayName, card_count as cardCount,
             created_at as createdAt, updated_at as updatedAt, last_seen_at as lastSeenAt
      FROM board_participants WHERE board_id = ? AND participant_key_hash = ?
    `).get(boardId, validatedParticipantKeyHash) as unknown as BoardParticipant;
    return { ...row, cardCount: Number(row.cardCount) };
  }

  createOwnershipSession(boardId: string, sessionTokenHash: string, expiresAt: string) {
    const hash = boardOpaqueTokenHashSchema.parse(sessionTokenHash);
    const timestamp = nowIso();
    const id = createId();
    this.db.prepare('DELETE FROM board_ownership_sessions WHERE board_id = ? AND expires_at <= ?')
      .run(boardId, timestamp);
    this.db.prepare(`
      INSERT INTO board_ownership_sessions (
        id, board_id, session_token_hash, created_at, updated_at, expires_at, last_used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, boardId, hash, timestamp, timestamp, expiresAt, timestamp);
    return { id, boardId, expiresAt };
  }

  createReactionSession(boardId: string, sessionTokenHash: string, expiresAt: string) {
    const hash = boardOpaqueTokenHashSchema.parse(sessionTokenHash);
    const timestamp = nowIso();
    const id = createId();
    this.db.prepare('DELETE FROM board_reaction_sessions WHERE board_id = ? AND expires_at <= ?')
      .run(boardId, timestamp);
    this.db.prepare(`
      INSERT INTO board_reaction_sessions (
        id, board_id, session_token_hash, created_at, updated_at, expires_at, last_used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, boardId, hash, timestamp, timestamp, expiresAt, timestamp);
    return { id, boardId, expiresAt };
  }

  findReactionSession(boardId: string, sessionTokenHash: string) {
    const hash = boardOpaqueTokenHashSchema.parse(sessionTokenHash);
    const row = this.db.prepare(`
      SELECT id, board_id as boardId, expires_at as expiresAt
      FROM board_reaction_sessions
      WHERE board_id = ? AND session_token_hash = ? AND expires_at > ?
    `).get(boardId, hash, nowIso()) as { id: string; boardId: string; expiresAt: string } | undefined;
    if (row) {
      const timestamp = nowIso();
      this.db.prepare('UPDATE board_reaction_sessions SET last_used_at = ?, updated_at = ? WHERE id = ?')
        .run(timestamp, timestamp, row.id);
    }
    return row;
  }

  getReactionState(boardId: string, cardId: string, sessionId?: string): BoardCardReactionState | undefined {
    const row = this.db.prepare(`
      SELECT c.id,
        (SELECT COUNT(*) FROM board_card_reactions r WHERE r.card_id = c.id AND r.reaction_type = 'like') as likes,
        (SELECT COUNT(*) FROM board_card_reactions r WHERE r.card_id = c.id AND r.reaction_type = 'dislike') as dislikes,
        (SELECT reaction_type FROM board_card_reactions r WHERE r.card_id = c.id AND r.session_id = ?) as currentReaction
      FROM board_cards c
      WHERE c.board_id = ? AND c.id = ? AND c.moderation_status = 'approved' AND c.is_hidden = 0
    `).get(sessionId ?? '', boardId, cardId) as {
      id: string; likes: number; dislikes: number; currentReaction: BoardReactionType | null;
    } | undefined;
    return row ? {
      likes: Number(row.likes),
      dislikes: Number(row.dislikes),
      current: row.currentReaction
    } : undefined;
  }

  setReaction(boardId: string, cardId: string, sessionId: string, reaction: BoardReactionType | null) {
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const available = this.db.prepare(`
        SELECT 1 FROM board_cards c
        INNER JOIN boards b ON b.id = c.board_id
        INNER JOIN board_settings s ON s.board_id = c.board_id
        INNER JOIN board_reaction_sessions rs ON rs.id = ? AND rs.board_id = c.board_id
        WHERE c.board_id = ? AND c.id = ? AND c.moderation_status = 'approved' AND c.is_hidden = 0
          AND b.status = 'published' AND b.archived_at IS NULL
          AND (b.expires_at IS NULL OR b.expires_at > ?)
          AND s.is_read_only = 0 AND rs.expires_at > ?
      `).get(sessionId, boardId, cardId, timestamp, timestamp);
      if (!available) throw new Error('Board card is not available for reactions.');
      const existing = this.db.prepare(`
        SELECT reaction_type as reactionType FROM board_card_reactions
        WHERE board_id = ? AND card_id = ? AND session_id = ?
      `).get(boardId, cardId, sessionId) as { reactionType: BoardReactionType } | undefined;
      if ((existing?.reactionType ?? null) === reaction) {
        this.db.exec('COMMIT');
        return this.getReactionState(boardId, cardId, sessionId)!;
      }
      if (reaction) {
        this.db.prepare(`
          INSERT INTO board_card_reactions (
            board_id, card_id, session_id, reaction_type, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(card_id, session_id) DO UPDATE SET
            reaction_type = excluded.reaction_type, updated_at = excluded.updated_at
        `).run(boardId, cardId, sessionId, reaction, timestamp, timestamp);
      } else {
        this.db.prepare('DELETE FROM board_card_reactions WHERE board_id = ? AND card_id = ? AND session_id = ?')
          .run(boardId, cardId, sessionId);
      }
      const counts = this.getReactionState(boardId, cardId, sessionId)!;
      this.appendEvent(boardId, 'reaction_updated', cardId, { likes: counts.likes, dislikes: counts.dislikes }, timestamp);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.getReactionState(boardId, cardId, sessionId)!;
  }

  findOwnershipSession(boardId: string, sessionTokenHash: string) {
    const hash = boardOpaqueTokenHashSchema.parse(sessionTokenHash);
    const row = this.db.prepare(`
      SELECT id, board_id as boardId, expires_at as expiresAt
      FROM board_ownership_sessions
      WHERE board_id = ? AND session_token_hash = ? AND expires_at > ?
    `).get(boardId, hash, nowIso()) as { id: string; boardId: string; expiresAt: string } | undefined;
    if (row) {
      const timestamp = nowIso();
      this.db.prepare('UPDATE board_ownership_sessions SET last_used_at = ?, updated_at = ? WHERE id = ?')
        .run(timestamp, timestamp, row.id);
    }
    return row;
  }

  sessionOwnsCard(sessionId: string, cardId: string) {
    return Boolean(this.db.prepare(`
      SELECT 1 FROM board_ownership_session_cards osc
      INNER JOIN board_ownership_sessions os ON os.id = osc.session_id
      WHERE osc.session_id = ? AND osc.card_id = ? AND os.expires_at > ?
    `).get(sessionId, cardId, nowIso()));
  }

  grantCardOwnership(sessionId: string, cardId: string) {
    this.db.prepare(`
      INSERT OR IGNORE INTO board_ownership_session_cards (session_id, card_id, granted_at)
      VALUES (?, ?, ?)
    `).run(sessionId, cardId, nowIso());
  }

  createCard(input: {
    boardId: string;
    participantId: string;
    card: BoardCardInput;
    position: Omit<BoardCardPosition, 'revision' | 'updatedAt'>;
    ownerTokenHash: string;
    recoveryPinHash: string | null;
    ownershipSessionId?: string;
    moderationStatus?: BoardCardModerationStatus;
    moderationReason?: string | null;
  }) {
    const timestamp = nowIso();
    const cardId = createId();
    const position = boardCardPositionInputSchema.parse(input.position);
    const credentials = boardCredentialHashesSchema.parse({
      ownerTokenHash: input.ownerTokenHash,
      recoveryPinHash: input.recoveryPinHash
    });
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const board = this.db.prepare(`
        SELECT b.status, b.archived_at as archivedAt, b.expires_at as expiresAt,
               s.is_read_only as readOnly, s.is_locked as locked,
               s.submissions_expires_at as submissionsExpiresAt,
               s.moderation_mode as moderationMode, s.max_cards_total as maxCardsTotal,
               s.max_cards_per_participant as maxCardsPerParticipant,
               s.max_title_length as maxTitleLength, s.max_body_length as maxBodyLength,
               s.allow_image_urls as allowImageUrls, s.require_participant_name as requireParticipantName,
               s.require_card_title as requireCardTitle
        FROM boards b INNER JOIN board_settings s ON s.board_id = b.id WHERE b.id = ?
      `).get(input.boardId) as {
        status: BoardSummary['status']; archivedAt: string | null; expiresAt: string | null;
        readOnly: number; locked: number; submissionsExpiresAt: string | null;
        moderationMode: BoardSettings['moderationMode']; maxCardsTotal: number; maxCardsPerParticipant: number;
        maxTitleLength: number; maxBodyLength: number; allowImageUrls: number; requireParticipantName: number;
        requireCardTitle: number;
      } | undefined;
      if (!board || board.status !== 'published' || board.archivedAt) throw new Error('Board is not available.');
      if (board.expiresAt && Date.parse(board.expiresAt) <= Date.now()) throw new Error('Board is expired.');
      if (board.submissionsExpiresAt && Date.parse(board.submissionsExpiresAt) <= Date.now()) {
        throw new Error('Board does not accept new cards.');
      }
      if (board.readOnly || board.locked) throw new Error('Board does not accept new cards.');
      const card = parseBoardCardInput(input.card, {
        maxTitleLength: Number(board.maxTitleLength),
        maxBodyLength: Number(board.maxBodyLength),
        allowImageUrls: Boolean(board.allowImageUrls),
        requireParticipantName: Boolean(board.requireParticipantName),
        requireCardTitle: Boolean(board.requireCardTitle)
      });
      const participant = this.db.prepare('SELECT card_count as cardCount FROM board_participants WHERE id = ? AND board_id = ?')
        .get(input.participantId, input.boardId) as { cardCount: number } | undefined;
      if (!participant) throw new Error('Board participant not found.');
      const total = Number((this.db.prepare('SELECT COUNT(*) as count FROM board_cards WHERE board_id = ?').get(input.boardId) as { count: number }).count);
      if (total >= Number(board.maxCardsTotal)) throw new Error('Board card limit reached.');
      if (Number(participant.cardCount) >= Number(board.maxCardsPerParticipant)) throw new Error('Participant card limit reached.');

      const moderationStatus: BoardCardModerationStatus = board.moderationMode === 'review_all' || input.moderationStatus === 'pending'
        ? 'pending'
        : 'approved';
      this.db.prepare(`
        INSERT INTO board_cards (
          id, board_id, participant_id, author_display_name, title, body, image_url,
          card_layout, moderation_status, moderation_reason, published_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        cardId, input.boardId, input.participantId, card.authorDisplayName,
        card.title, card.body, card.imageUrl, card.layout, moderationStatus,
        moderationStatus === 'pending' ? input.moderationReason ?? null : null,
        moderationStatus === 'approved' ? timestamp : null, timestamp, timestamp
      );
      this.db.prepare(`
        INSERT INTO board_card_positions (card_id, board_id, x, y, width, height, z_index, revision, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
      `).run(
        cardId, input.boardId, position.x, position.y, position.width,
        position.height, position.zIndex, timestamp
      );
      this.db.prepare(`
        INSERT INTO board_card_credentials (
          card_id, board_id, owner_token_hash, recovery_pin_hash, credential_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, ?, ?)
      `).run(cardId, input.boardId, credentials.ownerTokenHash, credentials.recoveryPinHash, timestamp, timestamp);
      this.db.prepare('UPDATE board_participants SET card_count = card_count + 1, updated_at = ?, last_seen_at = ? WHERE id = ?')
        .run(timestamp, timestamp, input.participantId);
      if (input.ownershipSessionId) {
        this.db.prepare(`
          INSERT INTO board_ownership_session_cards (session_id, card_id, granted_at) VALUES (?, ?, ?)
        `).run(input.ownershipSessionId, cardId, timestamp);
      }
      this.appendEvent(input.boardId, 'card_created', cardId, { moderationStatus }, timestamp);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.findCard(input.boardId, cardId)!;
  }

  findCard(boardId: string, cardId: string) {
    const row = this.db.prepare(`${cardSelect} WHERE c.board_id = ? AND c.id = ?`).get(boardId, cardId) as unknown as CardRow | undefined;
    return row ? this.toCard(row) : undefined;
  }

  listCards(userId: string, boardId: string) {
    const owned = this.db.prepare('SELECT 1 FROM boards WHERE id = ? AND user_id = ?').get(boardId, userId);
    if (!owned) throw new Error('Board not found.');
    return (this.db.prepare(`${cardSelect} WHERE c.board_id = ? ORDER BY c.created_at DESC, c.id`).all(boardId) as unknown as CardRow[])
      .map((row) => this.toCard(row));
  }

  getCardCredential(boardId: string, cardId: string) {
    return this.db.prepare(`
      SELECT recovery_pin_hash as recoveryPinHash, credential_version as credentialVersion,
        recovery_failed_attempts as recoveryFailedAttempts,
        recovery_window_started_at as recoveryWindowStartedAt,
        recovery_locked_until as recoveryLockedUntil
      FROM board_card_credentials WHERE board_id = ? AND card_id = ?
    `).get(boardId, cardId) as {
      recoveryPinHash: string | null;
      credentialVersion: number;
      recoveryFailedAttempts: number;
      recoveryWindowStartedAt: string | null;
      recoveryLockedUntil: string | null;
    } | undefined;
  }

  recordRecoveryFailure(boardId: string, cardId: string, options: {
    maxAttempts: number;
    windowMs: number;
    lockMs: number;
  }) {
    const timestamp = nowIso();
    const now = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const credential = this.getCardCredential(boardId, cardId);
      if (!credential) {
        this.db.exec('COMMIT');
        return;
      }
      const windowActive = credential.recoveryWindowStartedAt !== null &&
        now - Date.parse(credential.recoveryWindowStartedAt) < options.windowMs;
      const failedAttempts = windowActive ? Number(credential.recoveryFailedAttempts) + 1 : 1;
      const windowStartedAt = windowActive ? credential.recoveryWindowStartedAt : timestamp;
      const lockedUntil = failedAttempts >= options.maxAttempts
        ? new Date(now + options.lockMs).toISOString()
        : null;
      this.db.prepare(`
        UPDATE board_card_credentials SET recovery_failed_attempts = ?,
          recovery_window_started_at = ?, recovery_locked_until = ?, updated_at = ?
        WHERE board_id = ? AND card_id = ?
      `).run(failedAttempts, windowStartedAt, lockedUntil, timestamp, boardId, cardId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  updateOwnedCard(boardId: string, cardId: string, sessionId: string, input: BoardCardInput, filterReason: string | null = null) {
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare(`
        SELECT s.max_title_length as maxTitleLength, s.max_body_length as maxBodyLength,
               s.allow_image_urls as allowImageUrls, s.require_participant_name as requireParticipantName,
               s.require_card_title as requireCardTitle, s.moderation_mode as moderationMode
        FROM board_cards c
        INNER JOIN boards b ON b.id = c.board_id
        INNER JOIN board_settings s ON s.board_id = c.board_id
        INNER JOIN board_ownership_session_cards osc ON osc.card_id = c.id AND osc.session_id = ?
        INNER JOIN board_ownership_sessions os ON os.id = osc.session_id AND os.board_id = c.board_id
        WHERE c.board_id = ? AND c.id = ? AND os.expires_at > ?
          AND b.status = 'published' AND b.archived_at IS NULL
          AND (b.expires_at IS NULL OR b.expires_at > ?)
          AND s.is_read_only = 0 AND s.participant_can_edit = 1
      `).get(sessionId, boardId, cardId, timestamp, timestamp) as {
        maxTitleLength: number; maxBodyLength: number; allowImageUrls: number;
        requireParticipantName: number; requireCardTitle: number; moderationMode: BoardSettings['moderationMode'];
      } | undefined;
      if (!row) throw new Error('Board card is not editable.');
      const card = parseBoardCardInput(input, {
        maxTitleLength: Number(row.maxTitleLength), maxBodyLength: Number(row.maxBodyLength),
        allowImageUrls: Boolean(row.allowImageUrls), requireParticipantName: Boolean(row.requireParticipantName),
        requireCardTitle: Boolean(row.requireCardTitle)
      });
      const moderationStatus: BoardCardModerationStatus = row.moderationMode === 'review_all' || filterReason ? 'pending' : 'approved';
      this.db.prepare(`
        UPDATE board_cards SET author_display_name = ?, title = ?, body = ?, image_url = ?, card_layout = ?,
          moderation_status = ?, moderation_reason = ?, is_hidden = 0, published_at = ?, updated_at = ?
        WHERE board_id = ? AND id = ?
      `).run(card.authorDisplayName, card.title, card.body, card.imageUrl, card.layout, moderationStatus,
        filterReason, moderationStatus === 'approved' ? timestamp : null, timestamp, boardId, cardId);
      this.appendEvent(boardId, 'card_updated', cardId, { moderationStatus }, timestamp);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.findCard(boardId, cardId)!;
  }

  updateAdminCard(userId: string, boardId: string, cardId: string, input: BoardCardInput, filterReason: string | null = null) {
    const board = this.findById(userId, boardId);
    if (!board) throw new Error('Board not found.');
    const current = this.findCard(boardId, cardId);
    if (!current) throw new Error('Board card not found.');
    const card = parseBoardCardInput(input, board.settings);
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        UPDATE board_cards SET author_display_name = ?, title = ?, body = ?, image_url = ?, card_layout = ?,
          moderation_status = ?, moderation_reason = ?, published_at = ?, updated_at = ?
        WHERE board_id = ? AND id = ?
      `).run(
        card.authorDisplayName, card.title, card.body, card.imageUrl, card.layout,
        filterReason ? 'pending' : current.moderationStatus,
        filterReason ?? current.moderationReason,
        filterReason ? null : current.publishedAt,
        timestamp, boardId, cardId
      );
      this.appendEvent(boardId, 'card_updated', cardId, { moderationStatus: filterReason ? 'pending' : current.moderationStatus }, timestamp);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.findCard(boardId, cardId)!;
  }

  deleteOwnedCard(boardId: string, cardId: string, sessionId: string) {
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const card = this.db.prepare(`
        SELECT c.participant_id as participantId FROM board_cards c
        INNER JOIN boards b ON b.id = c.board_id
        INNER JOIN board_settings s ON s.board_id = c.board_id
        INNER JOIN board_ownership_session_cards osc ON osc.card_id = c.id AND osc.session_id = ?
        INNER JOIN board_ownership_sessions os ON os.id = osc.session_id
        WHERE c.board_id = ? AND c.id = ? AND os.expires_at > ?
          AND b.status = 'published' AND b.archived_at IS NULL
          AND (b.expires_at IS NULL OR b.expires_at > ?)
          AND s.is_read_only = 0 AND s.participant_can_delete = 1
      `).get(sessionId, boardId, cardId, timestamp, timestamp) as { participantId: string | null } | undefined;
      if (!card) throw new Error('Board card is not deletable.');
      this.db.prepare('DELETE FROM board_cards WHERE board_id = ? AND id = ?').run(boardId, cardId);
      if (card.participantId) this.db.prepare(`UPDATE board_participants SET card_count = MAX(card_count - 1, 0), updated_at = ? WHERE id = ?`)
        .run(timestamp, card.participantId);
      this.appendEvent(boardId, 'card_deleted', cardId, {}, timestamp);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  deleteAdminCard(userId: string, boardId: string, cardId: string) {
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const card = this.db.prepare(`
        SELECT c.participant_id as participantId FROM board_cards c
        INNER JOIN boards b ON b.id = c.board_id
        WHERE b.user_id = ? AND c.board_id = ? AND c.id = ?
      `).get(userId, boardId, cardId) as { participantId: string | null } | undefined;
      if (!card) throw new Error('Board card not found.');
      this.db.prepare('DELETE FROM board_cards WHERE board_id = ? AND id = ?').run(boardId, cardId);
      if (card.participantId) this.db.prepare(`UPDATE board_participants SET card_count = MAX(card_count - 1, 0), updated_at = ? WHERE id = ?`)
        .run(timestamp, card.participantId);
      this.appendEvent(boardId, 'card_deleted', cardId, {}, timestamp);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  rotateCardOwnership(userId: string | null, boardId: string, cardId: string, ownerTokenHash: string, recoveryPinHash: string, sessionId?: string) {
    const ownerHash = boardOpaqueTokenHashSchema.parse(ownerTokenHash);
    const credentials = boardCredentialHashesSchema.parse({ ownerTokenHash: ownerHash, recoveryPinHash });
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (userId) {
        const owned = this.db.prepare(`SELECT 1 FROM board_cards c INNER JOIN boards b ON b.id = c.board_id WHERE b.user_id = ? AND c.board_id = ? AND c.id = ?`)
          .get(userId, boardId, cardId);
        if (!owned) throw new Error('Board card not found.');
      } else if (!this.findCard(boardId, cardId)) {
        throw new Error('Board card not found.');
      }
      this.db.prepare('DELETE FROM board_ownership_session_cards WHERE card_id = ?').run(cardId);
      this.db.prepare(`
        UPDATE board_card_credentials SET owner_token_hash = ?, recovery_pin_hash = ?,
          credential_version = credential_version + 1, last_used_at = ?, updated_at = ?,
          recovery_failed_attempts = 0, recovery_window_started_at = NULL, recovery_locked_until = NULL
        WHERE board_id = ? AND card_id = ?
      `).run(credentials.ownerTokenHash, credentials.recoveryPinHash, timestamp, timestamp, boardId, cardId);
      if (sessionId) this.db.prepare(`INSERT INTO board_ownership_session_cards (session_id, card_id, granted_at) VALUES (?, ?, ?)`)
        .run(sessionId, cardId, timestamp);
      this.appendEvent(boardId, 'card_updated', cardId, { ownershipChanged: true }, timestamp);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  moderateCard(userId: string, boardId: string, cardId: string, status: BoardCardModerationStatus, reason: string | null) {
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const card = this.db.prepare(`
        SELECT c.moderation_status as status FROM board_cards c
        INNER JOIN boards b ON b.id = c.board_id WHERE b.user_id = ? AND b.id = ? AND c.id = ?
      `).get(userId, boardId, cardId) as { status: BoardCardModerationStatus } | undefined;
      if (!card) throw new Error('Board card not found.');
      this.db.prepare(`
        UPDATE board_cards SET moderation_status = ?, moderation_reason = ?, is_hidden = 0, published_at = ?, updated_at = ?
        WHERE board_id = ? AND id = ?
      `).run(status, reason, status === 'approved' ? timestamp : null, timestamp, boardId, cardId);
      this.db.prepare(`
        INSERT INTO board_card_moderation_events (
          id, board_id, card_id, previous_status, next_status, reason, moderator_user_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(createId(), boardId, cardId, card.status, status, reason, userId, timestamp);
      this.appendEvent(boardId, 'card_moderated', cardId, { status }, timestamp);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.findCard(boardId, cardId)!;
  }

  setCardHidden(userId: string, boardId: string, cardId: string, hidden: boolean) {
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const card = this.db.prepare(`
        SELECT c.moderation_status as status FROM board_cards c
        INNER JOIN boards b ON b.id = c.board_id
        WHERE b.user_id = ? AND b.id = ? AND c.id = ?
      `).get(userId, boardId, cardId) as { status: BoardCardModerationStatus } | undefined;
      if (!card) throw new Error('Board card not found.');
      if (!hidden && card.status !== 'approved') throw new Error('Only an approved card can be restored.');
      this.db.prepare('UPDATE board_cards SET is_hidden = ?, updated_at = ? WHERE board_id = ? AND id = ?')
        .run(hidden ? 1 : 0, timestamp, boardId, cardId);
      this.appendEvent(boardId, 'card_moderated', cardId, { status: card.status, hidden }, timestamp);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.findCard(boardId, cardId)!;
  }

  listEvents(boardId: string, afterRevision: number, limit = 100): BoardRealtimeEvent[] {
    return (this.db.prepare(`
      SELECT revision, event_type as type, entity_id as entityId, payload_json as payloadJson, created_at as createdAt
      FROM board_events WHERE board_id = ? AND revision > ? ORDER BY revision ASC LIMIT ?
    `).all(boardId, afterRevision, Math.min(Math.max(limit, 1), 500)) as unknown as Array<{
      revision: number; type: BoardRealtimeEventType; entityId: string | null; payloadJson: string; createdAt: string;
    }>).map((row) => ({
      revision: Number(row.revision),
      type: row.type,
      entityId: row.entityId,
      payload: JSON.parse(row.payloadJson) as Record<string, unknown>,
      createdAt: row.createdAt
    }));
  }

  private appendEvent(boardId: string, type: BoardRealtimeEventType, entityId: string | null, payload: Record<string, unknown>, timestamp: string) {
    this.db.prepare('UPDATE boards SET public_revision = public_revision + 1, updated_at = ? WHERE id = ?')
      .run(timestamp, boardId);
    const revision = Number((this.db.prepare('SELECT public_revision as revision FROM boards WHERE id = ?').get(boardId) as { revision: number }).revision);
    this.db.prepare(`
      INSERT INTO board_events (board_id, revision, event_type, entity_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(boardId, revision, type, entityId, JSON.stringify(payload), timestamp);
  }
}
