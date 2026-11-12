import type { ActivityBackgroundPattern, ActivityLayout } from './activity-types.js';

export type BoardStatus = 'draft' | 'published' | 'disabled';
export type BoardModerationMode = 'auto_approve' | 'review_all';
export type BoardCardModerationStatus = 'pending' | 'approved' | 'rejected';
export type BoardCardLayout = 'text' | 'image_text' | 'compact';
export type BoardLayout = 'grid';
export type BoardReactionType = 'like' | 'dislike';

export interface BoardThemeReference {
  id: string;
  name: string;
  config: Record<string, unknown>;
  system: boolean;
}

export interface BoardSettings {
  themeId: string;
  layout: BoardLayout;
  visualStyle: ActivityLayout;
  backgroundPattern: ActivityBackgroundPattern;
  patternIntensity: number;
  readOnly: boolean;
  locked: boolean;
  submissionsExpiresAt: string | null;
  requireParticipantName: boolean;
  moderationMode: BoardModerationMode;
  maxCardsTotal: number;
  maxCardsPerParticipant: number;
  maxTitleLength: number;
  maxBodyLength: number;
  allowImageUrls: boolean;
  participantCanEdit: boolean;
  participantCanDelete: boolean;
  requireCardTitle: boolean;
}

export interface BoardInput {
  title: string;
  description: string;
  slug?: string;
  status: BoardStatus;
  expiresAt?: string | null;
  settings: BoardSettings;
}

export interface BoardSummary {
  id: string;
  slug: string;
  publicUrl: string;
  title: string;
  description: string;
  status: BoardStatus;
  publicRevision: number;
  publishedAt: string | null;
  archivedAt: string | null;
  expiresAt: string | null;
  cardCount: number;
  pendingCardCount: number;
  presentationUrl: string;
  createdAt: string;
  updatedAt: string;
  settings: BoardSettings;
}

export interface BoardListResponse {
  items: BoardSummary[];
  stats: {
    totalBoards: number;
    publishedBoards: number;
    totalCards: number;
    pendingCards: number;
  };
}

export interface PublicBoard {
  id: string;
  slug: string;
  title: string;
  description: string;
  publicRevision: number;
  expiresAt: string | null;
  theme: BoardThemeReference;
  settings: Pick<BoardSettings,
    'layout' | 'visualStyle' | 'backgroundPattern' | 'patternIntensity' | 'readOnly' | 'locked' | 'submissionsExpiresAt' | 'requireParticipantName' | 'moderationMode' |
    'maxCardsPerParticipant' | 'maxTitleLength' | 'maxBodyLength' | 'allowImageUrls' |
    'participantCanEdit' | 'participantCanDelete' | 'requireCardTitle'>;
  cards: PublicBoardCard[];
}

export type PublicBoardCard = Pick<BoardCard,
  'id' | 'authorDisplayName' | 'title' | 'body' | 'imageUrl' | 'layout' | 'moderationStatus' |
  'publishedAt' | 'createdAt' | 'updatedAt' | 'position'> & {
    owned: boolean;
    reactions: BoardCardReactionState;
  };

export interface BoardCardReactionState {
  likes: number;
  dislikes: number;
  current: BoardReactionType | null;
}

export interface BoardCardPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  revision: number;
  updatedAt: string;
}

export interface BoardCardInput {
  title: string;
  body: string;
  imageUrl: string | null;
  authorDisplayName: string | null;
  layout: BoardCardLayout;
}

export interface BoardCard {
  id: string;
  boardId: string;
  participantId: string | null;
  authorDisplayName: string | null;
  title: string;
  body: string;
  imageUrl: string | null;
  layout: BoardCardLayout;
  moderationStatus: BoardCardModerationStatus;
  moderationReason: string | null;
  hidden: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  position: BoardCardPosition;
}

export interface BoardCardCreateResponse {
  card: PublicBoardCard;
  recoveryPin: string;
}

export interface BoardCardRecoveryResponse {
  ok: true;
  cardId: string;
}

export interface BoardCardOwnershipResetResponse {
  cardId: string;
  recoveryPin: string;
}

export interface BoardParticipant {
  id: string;
  boardId: string;
  displayName: string | null;
  cardCount: number;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
}

export type BoardRealtimeEventType =
  | 'board_updated'
  | 'card_created'
  | 'card_updated'
  | 'card_moved'
  | 'card_moderated'
  | 'card_deleted'
  | 'reaction_updated';

export interface BoardRealtimeEvent {
  revision: number;
  type: BoardRealtimeEventType;
  entityId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export type BoardRealtimeChange =
  | { type: 'board_updated'; board: Omit<PublicBoard, 'cards'> }
  | { type: 'card_upserted'; card: PublicBoardCard }
  | { type: 'card_deleted'; cardId: string }
  | { type: 'reaction_updated'; cardId: string; reactions: Pick<BoardCardReactionState, 'likes' | 'dislikes'> };

export interface BoardRealtimeDelta {
  type: 'delta';
  baseRevision: number;
  revision: number;
  changes: BoardRealtimeChange[];
}
