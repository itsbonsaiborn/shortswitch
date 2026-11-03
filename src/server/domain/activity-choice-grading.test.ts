import { describe, expect, it } from 'vitest';
import { gradeMultipleChoice, gradeSingleChoice, stableShuffleOptions } from './activity-choice-grading.js';

describe('activity choice grading', () => {
  it('grades single choice by exact option ID and keeps scores bounded', () => {
    expect(gradeSingleChoice({ selectedOptionId: 'a', correctOptionId: 'a', points: 3 })).toMatchObject({ awardedPoints: 3, correct: true, fraction: 1 });
    expect(gradeSingleChoice({ selectedOptionId: 'b', correctOptionId: 'a', points: 3 })).toMatchObject({ awardedPoints: 0, correct: false, fraction: 0 });
    expect(gradeSingleChoice({ selectedOptionId: null, correctOptionId: 'a', points: 3 })).toMatchObject({ awardedPoints: 0, correct: false });
  });

  it('uses exact-set all-or-nothing grading for multiple choice', () => {
    const base = { correctOptionIds: ['a', 'c'], optionIds: ['a', 'b', 'c', 'd'], points: 4, gradingMode: 'all_or_nothing' as const };
    expect(gradeMultipleChoice({ ...base, selectedOptionIds: ['c', 'a'] })).toMatchObject({ awardedPoints: 4, correct: true });
    expect(gradeMultipleChoice({ ...base, selectedOptionIds: ['a'] })).toMatchObject({ awardedPoints: 0, correct: false });
    expect(gradeMultipleChoice({ ...base, selectedOptionIds: ['a', 'b', 'c'] })).toMatchObject({ awardedPoints: 0, correct: false });
    expect(gradeMultipleChoice({ ...base, selectedOptionIds: [] })).toMatchObject({ awardedPoints: 0, correct: false });
  });

  it('awards partial credit with a penalty for distractors', () => {
    const base = { correctOptionIds: ['a', 'c'], optionIds: ['a', 'b', 'c', 'd'], points: 4, gradingMode: 'partial' as const };
    expect(gradeMultipleChoice({ ...base, selectedOptionIds: ['a'] })).toMatchObject({ awardedPoints: 2, fraction: 0.5, correct: false });
    expect(gradeMultipleChoice({ ...base, selectedOptionIds: ['a', 'b'] })).toMatchObject({ awardedPoints: 0, fraction: 0, correct: false });
    expect(gradeMultipleChoice({ ...base, selectedOptionIds: ['a', 'b', 'c', 'd'] })).toMatchObject({ awardedPoints: 0, fraction: 0, correct: false });
    expect(gradeMultipleChoice({ ...base, selectedOptionIds: ['a', 'c'] })).toMatchObject({ awardedPoints: 4, fraction: 1, correct: true });
  });

  it('keeps deterministic option order for a participant seed', () => {
    const options = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, label: id.toUpperCase() }));
    const first = stableShuffleOptions(options, 'attempt-1', 'question-1');
    const resumed = stableShuffleOptions([...options].reverse(), 'attempt-1', 'question-1');
    expect(resumed.map((option) => option.id)).toEqual(first.map((option) => option.id));
    expect(first).not.toEqual(options);
    expect(options.map((option) => option.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
