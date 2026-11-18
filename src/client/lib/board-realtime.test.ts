import { describe, expect, test } from 'vitest';
import type { BoardRealtimeDelta, PublicBoard } from '../../shared/board-types';
import { applyBoardRealtimeDelta } from './board-realtime';
import { sortBoardCards } from './board-card-sort';

const board = (): PublicBoard => ({
  id: 'board', slug: 'board', title: 'Board', description: '', publicRevision: 4, expiresAt: null,
  theme: { id: 'theme', name: 'Theme', config: {}, system: true },
  settings: { layout: 'grid', visualStyle: 'classic', backgroundPattern: 'none', patternIntensity: 35, reactionMode: 'both',
    readOnly: false, locked: false, submissionsExpiresAt: null, requireParticipantName: false, moderationMode: 'auto_approve',
    maxCardsPerParticipant: 10, maxTitleLength: 160, maxBodyLength: 5000, allowImageUrls: true,
    participantCanEdit: true, participantCanDelete: true, requireCardTitle: true },
  cards: [{ id: 'card', title: 'Beta', body: 'Body', imageUrl: null, imageBlurred: false, authorDisplayName: null, layout: 'text',
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

  test('applies reaction mode changes without overwriting participant reaction state', () => {
    const initial = board();
    initial.cards[0].reactions.current = 'like';
    const nextBoard = { ...initial, publicRevision: 5, settings: { ...initial.settings, reactionMode: 'disabled' as const } };
    const { cards: _cards, ...boardUpdate } = nextBoard;
    const result = applyBoardRealtimeDelta(initial, {
      type: 'delta', baseRevision: 4, revision: 5,
      changes: [{ type: 'board_updated', board: boardUpdate }]
    });

    expect(result.state).toBe('applied');
    expect(result.board.settings.reactionMode).toBe('disabled');
    expect(result.board.cards[0].reactions.current).toBe('like');
  });

  test('shares counts while preserving each participant reaction through switches and removals', () => {
    const participantA = board();
    participantA.cards[0].reactions.current = 'like';
    const participantB = board();

    const afterALike = {
      type: 'delta', baseRevision: 4, revision: 5,
      changes: [{
        type: 'reaction_updated', cardId: 'card',
        // Simulate an unsafe or delayed payload from an older server. The
        // reducer must still ignore another participant's personal selection.
        reactions: { likes: 2, dislikes: 0, current: 'like' }
      }]
    } as unknown as BoardRealtimeDelta;
    const aAfterLike = applyBoardRealtimeDelta(participantA, afterALike).board;
    const bAfterLike = applyBoardRealtimeDelta(participantB, afterALike).board;
    expect(aAfterLike.cards[0].reactions).toEqual({ likes: 2, dislikes: 0, current: 'like' });
    expect(bAfterLike.cards[0].reactions).toEqual({ likes: 2, dislikes: 0, current: null });

    bAfterLike.cards[0].reactions.current = 'dislike';
    const simultaneousCounts: BoardRealtimeDelta = {
      type: 'delta', baseRevision: 5, revision: 6,
      changes: [{ type: 'reaction_updated', cardId: 'card', reactions: { likes: 4, dislikes: 3 } }]
    };
    const aAfterBDislike = applyBoardRealtimeDelta(aAfterLike, simultaneousCounts).board;
    const bAfterBDislike = applyBoardRealtimeDelta(bAfterLike, simultaneousCounts).board;
    expect(aAfterBDislike.cards[0].reactions).toEqual({ likes: 4, dislikes: 3, current: 'like' });
    expect(bAfterBDislike.cards[0].reactions).toEqual({ likes: 4, dislikes: 3, current: 'dislike' });

    aAfterBDislike.cards[0].reactions.current = null;
    const afterARemoval: BoardRealtimeDelta = {
      type: 'delta', baseRevision: 6, revision: 7,
      changes: [{ type: 'reaction_updated', cardId: 'card', reactions: { likes: 3, dislikes: 3 } }]
    };
    expect(applyBoardRealtimeDelta(aAfterBDislike, afterARemoval).board.cards[0].reactions.current).toBeNull();
    expect(applyBoardRealtimeDelta(bAfterBDislike, afterARemoval).board.cards[0].reactions.current).toBe('dislike');
  });
});
