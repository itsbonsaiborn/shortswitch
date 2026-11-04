// @vitest-environment node
import { describe, expect, test } from 'vitest';
import type { ActivityAdminAttemptResponse } from '@/shared/activity-types';
import { activityAnswerRows, activityChoiceReviewOptions, activityCorrectAnswerRows, formatActivityNumber, formatActivityPercent, formatActivityScorePercent } from './activity-results';

const response = (overrides: Partial<ActivityAdminAttemptResponse>): ActivityAdminAttemptResponse => ({
  questionBlockId: 'question', slideNumber: 1, questionType: 'word_cloud', prompt: 'Prompt',
  questionConfig: { questionType: 'word_cloud', prompt: 'Prompt', instructions: '', maximumLength: 80, allowMultipleResponses: true, maximumResponses: 5, moderationMode: 'off', showResults: false, showParticipantNames: false, gradingMode: 'ungraded' },
  answer: null, correctAnswer: null, correct: null, moderationStatus: 'approved', moderationReason: null, gradingStatus: 'graded',
  awardedPoints: 0, maximumPoints: 0, teacherFeedback: '', ...overrides
});

describe('Activity result answer formatting', () => {
  test('formats Activity scores and percentages with one decimal place', () => {
    expect(formatActivityNumber(2)).toBe('2.0');
    expect(formatActivityNumber(2.56)).toBe('2.6');
    expect(formatActivityNumber(null)).toBe('—');
    expect(formatActivityPercent(66.666)).toBe('66.7%');
    expect(formatActivityScorePercent(1, 3)).toBe('33.3%');
    expect(formatActivityScorePercent(null, 3)).toBe('—');
    expect(formatActivityScorePercent(0, 0)).toBe('—');
  });
  test('renders Word Cloud responses as readable values instead of raw JSON', () => {
    expect(activityAnswerRows(response({ answer: { questionType: 'word_cloud', responses: ['yeaaay', 'wwdawa'] } })))
      .toEqual([{ label: '', value: 'yeaaay' }, { label: '', value: 'wwdawa' }]);
  });

  test('resolves stable choice IDs to their published labels', () => {
    expect(activityAnswerRows(response({
      questionType: 'multiple_choice',
      questionConfig: { questionType: 'multiple_choice', prompt: 'Choose', description: '', options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }], shuffleOptions: false, gradingMode: 'all_or_nothing', minimumSelections: 1, maximumSelections: 2 },
      answer: { questionType: 'multiple_choice', optionIds: ['b', 'a'] }
    }))).toEqual([{ label: '', value: 'Beta' }, { label: '', value: 'Alpha' }]);
  });

  test('builds a complete read-only choice review with correct and incorrect selections', () => {
    const reviewed = activityChoiceReviewOptions(response({
      questionType: 'multiple_choice',
      questionConfig: {
        questionType: 'multiple_choice', prompt: 'Choose', description: '',
        options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gamma' }, { id: 'd', label: 'Delta' }],
        shuffleOptions: false, gradingMode: 'all_or_nothing', minimumSelections: 1, maximumSelections: 4
      },
      answer: { questionType: 'multiple_choice', optionIds: ['b', 'c'] },
      correctAnswer: [{ id: 'a', label: 'Alpha' }, { id: 'c', label: 'Gamma' }],
      correct: false
    }));
    expect(reviewed).toHaveLength(4);
    expect(reviewed.find((option) => option.id === 'a')).toMatchObject({ correct: true, selected: false, incorrectSelection: false });
    expect(reviewed.find((option) => option.id === 'b')).toMatchObject({ correct: false, selected: true, incorrectSelection: true });
    expect(reviewed.find((option) => option.id === 'c')).toMatchObject({ correct: true, selected: true, incorrectSelection: false });
    expect(reviewed.find((option) => option.id === 'd')).toMatchObject({ correct: false, selected: false, incorrectSelection: false });
  });

  test('formats Ordering and Matching answers using published labels', () => {
    expect(activityAnswerRows(response({
      questionType: 'ordering',
      questionConfig: { questionType: 'ordering', prompt: 'Order', items: [{ id: 'one', label: 'First' }, { id: 'two', label: 'Second' }], shuffleItems: true, gradingMode: 'all_or_nothing' },
      answer: { questionType: 'ordering', orderedItemIds: ['two', 'one'] }
    }))).toEqual([{ label: '1.', value: 'Second' }, { label: '2.', value: 'First' }]);
  });

  test('renders disclosed correct answers as labels without exposing stable IDs', () => {
    const config = {
      questionType: 'single_choice' as const,
      prompt: 'Choose', description: '',
      options: [{ id: 'option-secret', label: 'Option 1' }], shuffleOptions: false
    };
    expect(activityCorrectAnswerRows('single_choice', { id: 'option-secret', label: 'Option 1' }, config))
      .toEqual([{ label: '', value: 'Option 1' }]);
  });
});
