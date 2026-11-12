import type { ServerResponse } from 'node:http';
import type {
  BoardRealtimeDelta,
  BoardRealtimeChange,
  PublicBoard,
  PublicBoardCard
} from '@/shared/board-types.js';

interface BoardClient {
  response: ServerResponse;
  provider: () => PublicBoard;
  snapshot: PublicBoard;
  clientKey: string;
  backpressured: boolean;
  drainHandler?: () => void;
  closeHandler?: () => void;
}

const MAX_BUFFERED_BYTES = 256 * 1024;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const withoutCards = ({ cards: _cards, ...board }: PublicBoard): Omit<PublicBoard, 'cards'> => board;
const comparableBoard = (board: PublicBoard) => ({ ...withoutCards(board), publicRevision: 0 });
const withoutReactions = ({ reactions: _reactions, ...card }: PublicBoardCard) => card;

export const buildBoardRealtimeDelta = (previous: PublicBoard, current: PublicBoard): BoardRealtimeDelta => {
  const changes: BoardRealtimeChange[] = [];
  if (!same(comparableBoard(previous), comparableBoard(current))) {
    changes.push({ type: 'board_updated', board: withoutCards(current) });
  }

  const previousCards = new Map(previous.cards.map((card) => [card.id, card]));
  const currentCards = new Map(current.cards.map((card) => [card.id, card]));
  for (const card of previous.cards) {
    if (!currentCards.has(card.id)) changes.push({ type: 'card_deleted', cardId: card.id });
  }
  for (const card of current.cards) {
    const old = previousCards.get(card.id);
    if (!old || !same(withoutReactions(old), withoutReactions(card))) {
      changes.push({ type: 'card_upserted', card });
    } else if (!same(old.reactions, card.reactions)) {
      changes.push({ type: 'reaction_updated', cardId: card.id, reactions: { likes: card.reactions.likes, dislikes: card.reactions.dislikes } });
    }
  }
  return { type: 'delta', baseRevision: previous.publicRevision, revision: current.publicRevision, changes };
};

export class BoardRealtimeService {
  private readonly clients = new Map<string, Set<BoardClient>>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor() {
    this.heartbeat = setInterval(() => {
      for (const [boardId, clients] of this.clients) {
        for (const client of clients) this.write(boardId, client, ': keep-alive\n\n');
      }
    }, 25_000);
    this.heartbeat.unref();
  }

  addClient(boardId: string, response: ServerResponse, provider: () => PublicBoard, clientKey = 'unknown') {
    const snapshot = provider();
    const client: BoardClient = { response, provider, snapshot, clientKey, backpressured: false };
    const clients = this.clients.get(boardId) ?? new Set<BoardClient>();
    clients.add(client);
    this.clients.set(boardId, clients);
    client.closeHandler = () => this.removeClient(boardId, client);
    response.once('close', client.closeHandler);
    this.sendSnapshot(boardId, client, snapshot);
    return () => this.removeClient(boardId, client);
  }

  schedule(boardId: string) {
    if (!this.clients.get(boardId)?.size || this.timers.has(boardId)) return;
    const timer = setTimeout(() => {
      this.timers.delete(boardId);
      for (const client of [...(this.clients.get(boardId) ?? [])]) this.refreshClient(boardId, client);
    }, 75);
    timer.unref();
    this.timers.set(boardId, timer);
  }

  broadcastReaction(boardId: string, cardId: string, reactions: { likes: number; dislikes: number }, revision: number) {
    for (const client of [...(this.clients.get(boardId) ?? [])]) {
      if (revision <= client.snapshot.publicRevision) continue;
      if (revision !== client.snapshot.publicRevision + 1) {
        this.refreshClient(boardId, client);
        continue;
      }
      const card = client.snapshot.cards.find((item) => item.id === cardId);
      client.snapshot = {
        ...client.snapshot,
        publicRevision: revision,
        cards: card
          ? client.snapshot.cards.map((item) => item.id === cardId
            ? { ...item, reactions: { ...item.reactions, ...reactions } }
            : item)
          : client.snapshot.cards
      };
      const delta: BoardRealtimeDelta = {
        type: 'delta', baseRevision: revision - 1, revision,
        changes: card ? [{ type: 'reaction_updated', cardId, reactions }] : []
      };
      this.writeEvent(boardId, client, 'delta', JSON.stringify(delta), revision);
    }
  }

  closeBoard(boardId: string) {
    for (const client of this.clients.get(boardId) ?? []) {
      this.writeEvent(boardId, client, 'gone', JSON.stringify({ message: 'Board is no longer available.' }));
      client.response.end();
    }
    this.clients.delete(boardId);
    const timer = this.timers.get(boardId);
    if (timer) clearTimeout(timer);
    this.timers.delete(boardId);
  }

  connectionCount(boardId?: string, clientKey?: string) {
    if (boardId && clientKey) {
      return [...(this.clients.get(boardId) ?? [])].filter((client) => client.clientKey === clientKey).length;
    }
    if (boardId) return this.clients.get(boardId)?.size ?? 0;
    return [...this.clients.values()].reduce((sum, clients) => sum + clients.size, 0);
  }

  close() {
    clearInterval(this.heartbeat);
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const clients of this.clients.values()) {
      for (const client of clients) client.response.end();
    }
    this.timers.clear();
    this.clients.clear();
  }

  private refreshClient(boardId: string, client: BoardClient) {
    try {
      const current = client.provider();
      if (current.publicRevision <= client.snapshot.publicRevision) return;
      const delta = buildBoardRealtimeDelta(client.snapshot, current);
      const deltaPayload = JSON.stringify(delta);
      const snapshotPayload = JSON.stringify(current);
      client.snapshot = current;
      if (deltaPayload.length < snapshotPayload.length) {
        this.writeEvent(boardId, client, 'delta', deltaPayload, current.publicRevision);
      } else {
        this.sendSnapshot(boardId, client, current);
      }
    } catch {
      this.writeEvent(boardId, client, 'gone', JSON.stringify({ message: 'Board is no longer available.' }));
      client.response.end();
    }
  }

  private sendSnapshot(boardId: string, client: BoardClient, snapshot: PublicBoard) {
    this.writeEvent(boardId, client, 'snapshot', JSON.stringify(snapshot), snapshot.publicRevision);
  }

  private writeEvent(boardId: string, client: BoardClient, event: string, payload: string, id?: number) {
    this.write(boardId, client, `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${payload}\n\n`);
  }

  private write(boardId: string, client: BoardClient, payload: string) {
    const { response } = client;
    if (response.destroyed || response.writableEnded) {
      this.removeClient(boardId, client);
      return;
    }
    if (client.backpressured) {
      if (response.writableLength > MAX_BUFFERED_BYTES) response.destroy();
      return;
    }
    const canContinue = response.write(payload);
    if (canContinue) return;
    client.backpressured = true;
    if (response.writableLength > MAX_BUFFERED_BYTES) {
      response.destroy();
      return;
    }
    client.drainHandler = () => {
      client.backpressured = false;
      client.drainHandler = undefined;
      try {
        const snapshot = client.provider();
        client.snapshot = snapshot;
        this.sendSnapshot(boardId, client, snapshot);
      } catch {
        response.end();
      }
    };
    response.once('drain', client.drainHandler);
  }

  private removeClient(boardId: string, client: BoardClient) {
    if (client.drainHandler) client.response.off('drain', client.drainHandler);
    if (client.closeHandler) client.response.off('close', client.closeHandler);
    const clients = this.clients.get(boardId);
    clients?.delete(client);
    if (clients?.size === 0) this.clients.delete(boardId);
  }
}
