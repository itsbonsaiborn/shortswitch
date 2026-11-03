import { describe, expect, it } from 'vitest';
import { stableShuffleOptions } from './activity-choice-grading.js';
import { gradeMatching, gradeOrdering } from './activity-pairing-grading.js';

describe('Activity Ordering and Matching grading', () => {
  it('grades canonical and partial ordering deterministically', () => {
    expect(gradeOrdering({ orderedItemIds: ['a', 'b', 'c'], correctItemIds: ['a', 'b', 'c'], points: 5, gradingMode: 'all_or_nothing' })).toMatchObject({ correct: true, awardedPoints: 5 });
    expect(gradeOrdering({ orderedItemIds: ['a', 'c', 'b'], correctItemIds: ['a', 'b', 'c'], points: 5, gradingMode: 'all_or_nothing' })).toMatchObject({ correct: false, awardedPoints: 0 });
    expect(gradeOrdering({ orderedItemIds: ['a', 'c', 'b'], correctItemIds: ['a', 'b', 'c'], points: 5, gradingMode: 'partial' })).toMatchObject({ correct: false, correctCount: 1, fraction: 1 / 3, awardedPoints: 1.666667 });
  });

  it('grades matching pairs without exceeding the configured score', () => {
    const correctPairs = [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }, { leftId: 'l3', rightId: 'r3' }];
    expect(gradeMatching({ pairs: correctPairs, correctPairs, points: 4, gradingMode: 'all_or_nothing' })).toMatchObject({ correct: true, awardedPoints: 4 });
    expect(gradeMatching({ pairs: [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r3' }, { leftId: 'l3', rightId: 'r2' }], correctPairs, points: 4, gradingMode: 'partial' })).toMatchObject({ correct: false, correctCount: 1, awardedPoints: 1.333333 });
    expect(gradeMatching({ pairs: [...correctPairs, ...correctPairs], correctPairs, points: 4, gradingMode: 'partial' }).awardedPoints).toBeLessThanOrEqual(4);
  });

  it('shuffles item IDs deterministically and independently per side', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const first = stableShuffleOptions(items, 'attempt-seed', 'question:left');
    const resumed = stableShuffleOptions(items, 'attempt-seed', 'question:left');
    const right = stableShuffleOptions(items, 'attempt-seed', 'question:right');
    expect(resumed).toEqual(first);
    expect(first.map((item) => item.id)).not.toEqual(right.map((item) => item.id));
    expect(new Set(first.map((item) => item.id))).toEqual(new Set(items.map((item) => item.id)));
  });
});
