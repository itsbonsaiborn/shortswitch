import type { BoardRealtimeDelta, PublicBoard } from '../../shared/board-types';

export type BoardDeltaResult =
  | { state: 'applied' | 'duplicate'; board: PublicBoard }
  | { state: 'refresh'; board: PublicBoard };

export const applyBoardRealtimeDelta = (board: PublicBoard, delta: BoardRealtimeDelta): BoardDeltaResult => {
  if (delta.revision <= board.publicRevision) return { state: 'duplicate', board };
  if (delta.baseRevision !== board.publicRevision) return { state: 'refresh', board };

  let next: PublicBoard = { ...board, cards: [...board.cards] };
  for (const change of delta.changes) {
    if (change.type === 'board_updated') {
      next = { ...change.board, cards: next.cards };
      continue;
    }
    if (change.type === 'card_deleted') {
      next.cards = next.cards.filter((card) => card.id !== change.cardId);
      continue;
    }
    if (change.type === 'card_upserted') {
      const index = next.cards.findIndex((card) => card.id === change.card.id);
      if (index === -1) next.cards.push(change.card);
      else next.cards[index] = change.card;
      continue;
    }
    const card = next.cards.find((item) => item.id === change.cardId);
    if (card) card.reactions = { ...card.reactions, ...change.reactions };
  }
  next.publicRevision = delta.revision;
  return { state: 'applied', board: next };
};
