import type { ActivityPositionGradingMode } from '@/shared/activity-types.js';

const roundScore = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const boundedPoints = (value: number) => Math.max(0, value);

export interface PositionGradeResult {
  awardedPoints: number;
  correct: boolean;
  correctCount: number;
  totalCount: number;
  fraction: number;
  gradingMode: ActivityPositionGradingMode;
}

const resultForCount = (correctCount: number, totalCount: number, points: number, gradingMode: ActivityPositionGradingMode): PositionGradeResult => {
  const safeTotal = Math.max(0, totalCount);
  const safeCorrect = Math.min(safeTotal, Math.max(0, correctCount));
  const correct = safeTotal > 0 && safeCorrect === safeTotal;
  const fraction = gradingMode === 'all_or_nothing'
    ? (correct ? 1 : 0)
    : (safeTotal ? safeCorrect / safeTotal : 0);
  const maximum = boundedPoints(points);
  return {
    awardedPoints: roundScore(Math.min(maximum, Math.max(0, maximum * fraction))),
    correct,
    correctCount: safeCorrect,
    totalCount: safeTotal,
    fraction,
    gradingMode
  };
};

export const gradeOrdering = (input: {
  orderedItemIds: string[];
  correctItemIds: string[];
  points: number;
  gradingMode: ActivityPositionGradingMode;
}) => resultForCount(
  input.correctItemIds.filter((id, index) => input.orderedItemIds[index] === id).length,
  input.correctItemIds.length,
  input.points,
  input.gradingMode
);

export const gradeMatching = (input: {
  pairs: Array<{ leftId: string; rightId: string }>;
  correctPairs: Array<{ leftId: string; rightId: string }>;
  points: number;
  gradingMode: ActivityPositionGradingMode;
}) => {
  const submitted = new Map(input.pairs.map((pair) => [pair.leftId, pair.rightId]));
  const correctCount = input.correctPairs.filter((pair) => submitted.get(pair.leftId) === pair.rightId).length;
  return resultForCount(correctCount, input.correctPairs.length, input.points, input.gradingMode);
};
