import { describe, expect, it } from 'vitest';
import { gradeImageLabeling } from './activity-image-grading.js';

describe('Activity Image Labeling grading', () => {
  const correctAssignments = [
    { markerId: 'm1', labelId: 'l1' },
    { markerId: 'm2', labelId: 'l2' },
    { markerId: 'm3', labelId: 'l3' }
  ];

  it('supports exact and deterministic partial credit', () => {
    expect(gradeImageLabeling({ assignments: correctAssignments, correctAssignments, points: 7, gradingMode: 'all_or_nothing' })).toMatchObject({ correct: true, awardedPoints: 7 });
    const partial = gradeImageLabeling({ assignments: [{ markerId: 'm1', labelId: 'l1' }, { markerId: 'm2', labelId: 'l3' }, { markerId: 'm3', labelId: 'l2' }], correctAssignments, points: 7, gradingMode: 'partial' });
    expect(partial).toMatchObject({ correct: false, correctCount: 1, fraction: 1 / 3, awardedPoints: 2.333333 });
    expect(partial.awardedPoints).toBeLessThanOrEqual(7);
  });
});
