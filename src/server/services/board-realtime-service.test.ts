// @vitest-environment node
import { EventEmitter } from 'node:events';
import { describe, expect, test, vi } from 'vitest';
import type { PublicBoard } from '@/shared/board-types.js';
import { BoardRealtimeService, buildBoardRealtimeDelta } from './board-realtime-service.js';

const snapshot = (revision = 1): PublicBoard => ({
  id: 'board', slug: 'board', title: 'Board', description: '', publicRevision: revision, expiresAt: null,
  theme: { id: 'theme', name: 'Theme', config: {}, system: true },
  settings: { layout: 'grid', visualStyle: 'classic', backgroundPattern: 'none', patternIntensity: 35,
    readOnly: false, locked: false, submissionsExpiresAt: null, requireParticipantName: false, moderationMode: 'auto_approve',
    maxCardsPerParticipant: 10, maxTitleLength: 160, maxBodyLength: 5000, allowImageUrls: true,
    participantCanEdit: true, participantCanDelete: true, requireCardTitle: true },
  cards: [{ id: 'card', title: 'Card', body: 'Body', imageUrl: null, authorDisplayName: null, layout: 'text',
    moderationStatus: 'approved', publishedAt: '', createdAt: '', updatedAt: '', owned: false,
    position: { x: 0, y: 0, width: 280, height: 180, zIndex: 0, revision: 0, updatedAt: '' },
    reactions: { likes: revision - 1, dislikes: 0, current: null } }]
});

class FakeResponse extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  writableLength = 0;
  writes: string[] = [];
  write(value: string) { this.writes.push(value); return true; }
  destroy() { this.destroyed = true; this.emit('close'); return this; }
  end() { this.writableEnded = true; this.emit('close'); return this; }
}

describe('Board realtime SSE', () => {
  test('builds compact server-authoritative reaction deltas', () => {
    expect(buildBoardRealtimeDelta(snapshot(1), snapshot(2))).toMatchObject({
      baseRevision: 1, revision: 2,
      changes: [{ type: 'reaction_updated', cardId: 'card', reactions: { likes: 1, dislikes: 0 } }]
    });
  });

  test('encodes create, edit, delete, moderation visibility and board lock changes', () => {
    const empty = { ...snapshot(1), cards: [] };
    const created = snapshot(2);
    expect(buildBoardRealtimeDelta(empty, created).changes[0]).toMatchObject({ type: 'card_upserted', card: { id: 'card' } });

    const edited = { ...snapshot(3), cards: [{ ...snapshot(2).cards[0], title: 'Edited' }] };
    expect(buildBoardRealtimeDelta(created, edited).changes).toContainEqual(expect.objectContaining({ type: 'card_upserted' }));

    const hidden = { ...snapshot(4), cards: [] };
    expect(buildBoardRealtimeDelta(edited, hidden).changes).toContainEqual({ type: 'card_deleted', cardId: 'card' });

    const locked = { ...hidden, publicRevision: 5, settings: { ...hidden.settings, locked: true } };
    expect(buildBoardRealtimeDelta(hidden, locked).changes).toContainEqual(expect.objectContaining({ type: 'board_updated' }));
  });

  test('sends a snapshot, a scoped delta and removes disconnected clients', async () => {
    vi.useFakeTimers();
    let current = snapshot(1);
    const response = new FakeResponse();
    const realtime = new BoardRealtimeService();
    realtime.addClient('board', response as never, () => current, 'classroom-ip');
    expect(response.writes.join('')).toContain('event: snapshot');
    current = snapshot(2);
    realtime.schedule('board');
    await vi.advanceTimersByTimeAsync(80);
    expect(response.writes.join('')).toContain('event: delta');
    response.emit('close');
    expect(realtime.connectionCount('board')).toBe(0);
    realtime.close();
    vi.useRealTimers();
  });

  test('tracks active connections by board and client key for shared-IP caps', () => {
    const realtime = new BoardRealtimeService();
    realtime.addClient('board', new FakeResponse() as never, () => snapshot(), 'shared-ip');
    realtime.addClient('board', new FakeResponse() as never, () => snapshot(), 'shared-ip');
    realtime.addClient('board', new FakeResponse() as never, () => snapshot(), 'other-ip');
    expect(realtime.connectionCount('board')).toBe(3);
    expect(realtime.connectionCount('board', 'shared-ip')).toBe(2);
    expect(realtime.connectionCount('board', 'other-ip')).toBe(1);
    realtime.close();
  });

  test('closes every board-scoped connection when its board is deleted or made unavailable', () => {
    const first = new FakeResponse();
    const second = new FakeResponse();
    const other = new FakeResponse();
    const realtime = new BoardRealtimeService();
    realtime.addClient('board', first as never, () => snapshot());
    realtime.addClient('board', second as never, () => snapshot());
    realtime.addClient('other-board', other as never, () => ({ ...snapshot(), id: 'other-board' }));

    realtime.closeBoard('board');
    expect(first.writableEnded).toBe(true);
    expect(second.writableEnded).toBe(true);
    expect(other.writableEnded).toBe(false);
    expect(realtime.connectionCount('board')).toBe(0);
    expect(realtime.connectionCount('other-board')).toBe(1);
    realtime.close();
  });

  test('disconnects slow clients instead of growing memory without bounds', () => {
    const response = new FakeResponse();
    response.writableLength = 300 * 1024;
    response.write = () => false;
    const realtime = new BoardRealtimeService();
    realtime.addClient('board', response as never, () => snapshot());
    expect(response.destroyed).toBe(true);
    realtime.close();
  });

  test('broadcasts frequent reaction counts without calling every snapshot provider', () => {
    const response = new FakeResponse();
    const provider = vi.fn(() => snapshot());
    const realtime = new BoardRealtimeService();
    realtime.addClient('board', response as never, provider);
    realtime.broadcastReaction('board', 'card', { likes: 3, dislikes: 1 }, 2);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(response.writes.join('')).toContain('"reaction_updated"');
    expect(response.writes.join('')).toContain('"likes":3');
    realtime.close();
  });
});
