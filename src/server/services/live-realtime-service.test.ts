// @vitest-environment node
import { EventEmitter } from 'node:events';
import { describe, expect, test } from 'vitest';
import type { LiveResultsSnapshot } from '@/shared/types.js';
import { buildLiveResultsDelta, LiveRealtimeService } from './live-realtime-service.js';

const snapshot = (overrides: Partial<LiveResultsSnapshot> = {}): LiveResultsSnapshot => ({
  activityId: 'activity-1',
  slug: 'realtime',
  type: 'open_answer',
  status: 'active',
  publicResults: true,
  responseCount: 1,
  uniqueParticipantCount: 1,
  openAnswers: [{ id: 'one', text: 'First', participantName: null, editedByModerator: false, createdAt: '2026-01-01T00:00:00.000Z' }],
  openAnswerTotal: 1,
  openAnswerNextCursor: null,
  wordCloud: [],
  wordCloudTotal: 0,
  choices: [],
  scale: null,
  revision: 1,
  ...overrides
});

describe('Live realtime deltas', () => {
  test('contains only changed answers and aggregate counters', () => {
    const previous = snapshot();
    const current = snapshot({
      responseCount: 2,
      uniqueParticipantCount: 2,
      openAnswerTotal: 2,
      revision: 2,
      openAnswers: [
        { id: 'two', text: 'Second', participantName: null, editedByModerator: false, createdAt: '2026-01-02T00:00:00.000Z' },
        ...previous.openAnswers
      ]
    });
    const delta = buildLiveResultsDelta(previous, current);
    expect(delta).toMatchObject({
      type: 'delta', baseRevision: 1, revision: 2, responseCount: 2, uniqueParticipantCount: 2,
      openAnswerTotal: 2, openAnswers: { upsert: [current.openAnswers[0]], removeIds: [] }
    });
    expect(JSON.stringify(delta).length).toBeLessThan(JSON.stringify(current).length);
  });

  test('reports removals so moderated answers disappear', () => {
    const previous = snapshot();
    const current = snapshot({ responseCount: 0, uniqueParticipantCount: 0, openAnswerTotal: 0, openAnswers: [], revision: 2 });
    expect(buildLiveResultsDelta(previous, current).openAnswers?.removeIds).toEqual(['one']);
  });

  test('disconnects a client whose writable buffer exceeds the safety limit', () => {
    class SlowResponse extends EventEmitter {
      destroyed = false;
      writableEnded = false;
      writableLength = 300 * 1024;
      write() { return false; }
      destroy() { this.destroyed = true; return this; }
      end() { this.writableEnded = true; return this; }
    }
    const realtime = new LiveRealtimeService();
    const response = new SlowResponse();
    realtime.addClient('activity-1', response as never, () => snapshot());
    expect(response.destroyed).toBe(true);
    realtime.close();
  });
});
