import type { ActivityPositionGradingMode } from '@/shared/activity-types.js';

const roundScore = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

export const gradeImageLabeling = (input: {
  assignments: Array<{ markerId: string; labelId: string }>;
  correctAssignments: Array<{ markerId: string; labelId: string }>;
  points: number;
  gradingMode: ActivityPositionGradingMode;
}) => {
  const submitted = new Map(input.assignments.map((assignment) => [assignment.markerId, assignment.labelId]));
  const correctCount = input.correctAssignments.filter((assignment) => submitted.get(assignment.markerId) === assignment.labelId).length;
  const totalCount = input.correctAssignments.length;
  const correct = totalCount > 0 && correctCount === totalCount;
  const fraction = input.gradingMode === 'all_or_nothing' ? (correct ? 1 : 0) : (totalCount ? correctCount / totalCount : 0);
  const maximum = Math.max(0, input.points);
  return {
    awardedPoints: roundScore(Math.min(maximum, Math.max(0, maximum * fraction))),
    correct,
    correctCount,
    totalCount,
    fraction,
    gradingMode: input.gradingMode
  };
};
