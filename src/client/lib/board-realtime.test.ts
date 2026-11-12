import { describe, expect, test } from 'vitest';
import type { BoardRealtimeDelta, PublicBoard } from '../../shared/board-types';
import { applyBoardRealtimeDelta } from './board-realtime';
import { sortBoardCards } from './board-card-sort';

const board = (): PublicBoard => ({
  id: 'board', slug: 'board', title: 'Board', description: '', publicRevision: 4, expiresAt: null,
  theme: { id: 'theme', name: 'Theme', config: {}, system: true },
  settings: { layout: 'grid', visualStyle: 'classic', backgroundPattern: 'none', patternIntensity: 35,
    readOnly: false, locked: false, submissionsExpiresAt: null, requireParticipantName: false, moderationMode: 'auto_approve',
    maxCardsPerParticipant: 10, maxTitleLength: 160, maxBodyLength: 5000, allowImageUrls: true,
    participantCanEdit: true, participantCanDelete: true, requireCardTitle: true },
  cards: [{ id: 'card', title: 'Beta', body: 'Body', imageUrl: null, authorDisplayName: null, layout: 'text',
    moderationStatus: 'approved', publishedAt: '', createdAt: '', updatedAt: '', owned: false,
    position: { x: 0, y: 0, width: 280, height: 180, zIndex: 0, revision: 0, updatedAt: '' },
    reactions: { likes: 1, dislikes: 0, current: null } }]
});

describe('Board realtime client reducer', () => {
  test('upserts cards without duplicates and lets computed sorting react to title changes', () => {
    const delta: BoardRealtimeDelta = { type: 'delta', baseRevision: 4, revision: 5, changes: [
      { type: 'card_upserted', card: { ...board().cards[0], title: 'Alpha' } }
    ] };
    const result = applyBoardRealtimeDelta(board(), delta);
    expect(result.state).toBe('applied');
    expect(result.board.cards).toHaveLength(1);
    expect(result.board.cards[0].title).toBe('Alpha');
    expect(sortBoardCards(result.board.cards, 'title_asc', 'lv')[0].title).toBe('Alpha');
  });

  test('ignores duplicate events and requests refresh for an out-of-order gap', () => {
    const duplicate = applyBoardRealtimeDelta(board(), { type: 'delta', baseRevision: 3, revision: 4, changes: [] });
    const gap = applyBoardRealtimeDelta(board(), { type: 'delta', baseRevision: 6, revision: 7, changes: [] });
    expect(duplicate.state).toBe('duplicate');
    expect(gap.state).toBe('refresh');
  });

  test('does not restore a deleted card from a delayed older event', () => {
    const removed = applyBoardRealtimeDelta(board(), { type: 'delta', baseRevision: 4, revision: 5, changes: [{ type: 'card_deleted', cardId: 'card' }] });
    const delayed = applyBoardRealtimeDelta(removed.board, { type: 'delta', baseRevision: 4, revision: 5, changes: [{ type: 'card_upserted', card: board().cards[0] }] });
    expect(delayed.state).toBe('duplicate');
    expect(delayed.board.cards).toEqual([]);
  });
});
