import crypto from 'node:crypto';
import type { ActivityMultipleChoiceGradingMode } from '@/shared/activity-types.js';

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const roundScore = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

export interface ChoiceGradeResult {
  awardedPoints: number;
  correct: boolean;
  fraction: number;
  gradingMode: 'exact' | ActivityMultipleChoiceGradingMode;
}

export const gradeSingleChoice = (input: {
  selectedOptionId: string | null;
  correctOptionId: string;
  points: number;
}): ChoiceGradeResult => {
  const correct = input.selectedOptionId !== null && input.selectedOptionId === input.correctOptionId;
  return {
    awardedPoints: correct ? Math.max(0, input.points) : 0,
    correct,
    fraction: correct ? 1 : 0,
    gradingMode: 'exact'
  };
};

export const gradeMultipleChoice = (input: {
  selectedOptionIds: string[];
  correctOptionIds: string[];
  optionIds: string[];
  points: number;
  gradingMode: ActivityMultipleChoiceGradingMode;
}): ChoiceGradeResult => {
  const selected = new Set(input.selectedOptionIds);
  const correctIds = new Set(input.correctOptionIds);
  const exact = selected.size === correctIds.size && [...selected].every((id) => correctIds.has(id));

  if (input.gradingMode === 'all_or_nothing') {
    return {
      awardedPoints: exact ? Math.max(0, input.points) : 0,
      correct: exact,
      fraction: exact ? 1 : 0,
      gradingMode: input.gradingMode
    };
  }

  const correctSelected = [...selected].filter((id) => correctIds.has(id)).length;
  const incorrectOptionCount = input.optionIds.filter((id) => !correctIds.has(id)).length;
  const incorrectSelected = [...selected].filter((id) => !correctIds.has(id)).length;
  const correctFraction = correctIds.size ? correctSelected / correctIds.size : 0;
  const incorrectPenalty = incorrectOptionCount ? incorrectSelected / incorrectOptionCount : 0;
  const fraction = clamp(correctFraction - incorrectPenalty, 0, 1);

  return {
    awardedPoints: roundScore(clamp(input.points * fraction, 0, Math.max(0, input.points))),
    correct: exact,
    fraction,
    gradingMode: input.gradingMode
  };
};

export const stableShuffleOptions = <T extends { id: string }>(
  options: T[],
  seed: string,
  blockStableId: string
) => {
  const rank = (optionId: string) => crypto
    .createHash('sha256')
    .update(`${seed}:${blockStableId}:${optionId}`)
    .digest('hex');
  return [...options].sort((left, right) => rank(left.id).localeCompare(rank(right.id)));
};
