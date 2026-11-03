import { describe, expect, it } from 'vitest';
import type { ActivityQuestionPublicConfig, ActivityQuestionType, ActivitySupportedAnswer } from '@/shared/activity-types.js';
import {
  ACTIVITY_POINT_UNITS,
  ActivityQuestionPluginRegistry,
  gradeActivityQuestion,
  pointsToUnits,
  resolveActivityResultDisclosure,
  unitsToPoints
} from './activity-grading-engine.js';

const grade = (questionType: ActivityQuestionType, config: ActivityQuestionPublicConfig, answer: ActivitySupportedAnswer, key: Record<string, unknown>, points = 5) =>
  gradeActivityQuestion({ questionType, config, answer, key, maximumUnits: pointsToUnits(points), graded: true, moderationStatus: 'approved' });

describe('unified Activity grading engine', () => {
  it('registers validation, public serialization and grading for every supported question type', () => {
    expect(Object.keys(ActivityQuestionPluginRegistry).sort()).toEqual([
      'image_labeling', 'matching', 'multiple_choice', 'open_answer', 'ordering', 'single_choice', 'word_cloud'
    ]);
    for (const plugin of Object.values(ActivityQuestionPluginRegistry)) {
      expect(plugin.configurationSchema).toBeDefined();
      expect(plugin.responseSchema).toBeDefined();
      expect(plugin.serializePublic).toBeTypeOf('function');
      expect(plugin.grade).toBeTypeOf('function');
    }
  });

  it('uses integer units for exact, zero-point and fractional partial scores', () => {
    expect(ACTIVITY_POINT_UNITS).toBe(1000);
    expect(pointsToUnits(1.25)).toBe(1250);
    expect(unitsToPoints(1667)).toBe(1.667);
    const single = grade('single_choice', { questionType: 'single_choice', prompt: 'Q', description: '', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], shuffleOptions: false }, { questionType: 'single_choice', optionId: 'a' }, { correctOptionId: 'a' }, 0);
    expect(single.awardedUnits).toBe(0);
    const ordering = grade('ordering', { questionType: 'ordering', prompt: 'Order', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], shuffleItems: false, gradingMode: 'partial' }, { questionType: 'ordering', orderedItemIds: ['a', 'c', 'b'] }, { orderedItemIds: ['a', 'b', 'c'] }, 5);
    expect(ordering.awardedUnits).toBe(1667);
    expect(unitsToPoints(ordering.awardedUnits!)).toBe(1.667);
  });

  it('grades choice, text, participation, matching and image questions within boundaries', () => {
    const multiple = grade('multiple_choice', { questionType: 'multiple_choice', prompt: 'Q', description: '', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }, { id: 'd', label: 'D' }], minimumSelections: 1, maximumSelections: 4, shuffleOptions: false, gradingMode: 'partial' }, { questionType: 'multiple_choice', optionIds: ['a', 'c'] }, { correctOptionIds: ['a', 'b'] }, 4);
    expect(multiple.awardedUnits).toBe(0);
    const exactText = grade('open_answer', { questionType: 'open_answer', prompt: 'Q', instructions: '', responseMode: 'single_line', minimumLength: 0, maximumLength: 100, gradingMode: 'normalized', ignoreCase: true, normalizeWhitespace: true }, { questionType: 'open_answer', text: 'TĪKLA   ADRESE' }, { acceptedAnswers: ['tīkla adrese'] }, 2);
    expect(exactText.awardedUnits).toBe(2000);
    const manual = grade('open_answer', { questionType: 'open_answer', prompt: 'Q', instructions: '', responseMode: 'multiline', minimumLength: 0, maximumLength: 100, gradingMode: 'manual', ignoreCase: false, normalizeWhitespace: false }, { questionType: 'open_answer', text: 'Essay' }, {}, 3);
    expect(manual).toMatchObject({ status: 'manual_review', awardedUnits: null, correct: null });
    const cloud = grade('word_cloud', { questionType: 'word_cloud', prompt: 'Q', instructions: '', maximumLength: 50, allowMultipleResponses: false, maximumResponses: 1, moderationMode: 'off', showResults: false, showParticipantNames: false, gradingMode: 'participation' }, { questionType: 'word_cloud', responses: ['Rīga'] }, {}, 1);
    expect(cloud.awardedUnits).toBe(1000);
    const matching = grade('matching', { questionType: 'matching', prompt: 'Q', leftItems: [{ id: 'l1', label: 'L1' }, { id: 'l2', label: 'L2' }], rightItems: [{ id: 'r1', label: 'R1' }, { id: 'r2', label: 'R2' }], shuffleLeftItems: false, shuffleRightItems: false, gradingMode: 'partial' }, { questionType: 'matching', pairs: [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r1' }] }, { pairs: [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }] }, 3);
    expect(matching.awardedUnits).toBe(1500);
    const image = grade('image_labeling', { questionType: 'image_labeling', prompt: 'Q', imageUrl: 'https://example.com/a.png', imageAlt: 'A', markers: [{ id: 'm1', x: 0.2, y: 0.2 }, { id: 'm2', x: 0.8, y: 0.8 }], labels: [{ id: 'l1', label: 'One' }, { id: 'l2', label: 'Two' }], oneToOne: true, gradingMode: 'partial' }, { questionType: 'image_labeling', assignments: [{ markerId: 'm1', labelId: 'l1' }, { markerId: 'm2', labelId: 'l1' }] }, { assignments: [{ markerId: 'm1', labelId: 'l1' }, { markerId: 'm2', labelId: 'l2' }] }, 3);
    expect(image.awardedUnits).toBe(1500);
    for (const result of [multiple, exactText, cloud, matching, image]) {
      expect(result.awardedUnits).toBeGreaterThanOrEqual(0);
      expect(result.awardedUnits).toBeLessThanOrEqual(5000);
    }
  });

  it('routes pending moderation to manual review and rejected moderation to zero', () => {
    const config = { questionType: 'word_cloud', prompt: 'Q', instructions: '', maximumLength: 50, allowMultipleResponses: false, maximumResponses: 1, moderationMode: 'filter_only', showResults: false, showParticipantNames: false, gradingMode: 'participation' } as const;
    const answer = { questionType: 'word_cloud', responses: ['text'] } as const;
    expect(gradeActivityQuestion({ questionType: 'word_cloud', config, answer, key: {}, maximumUnits: 1000, graded: true, moderationStatus: 'pending' }).status).toBe('manual_review');
    expect(gradeActivityQuestion({ questionType: 'word_cloud', config, answer, key: {}, maximumUnits: 1000, graded: true, moderationStatus: 'rejected' }).awardedUnits).toBe(0);
  });

  it('enforces availability and feedback disclosure without leaking answer keys early', () => {
    const base = {
      attemptFinalized: true,
      activityClosed: false,
      resultVisibility: 'after_submission' as const,
      resultsReleased: false
    };
    expect(resolveActivityResultDisclosure({ ...base, feedbackPolicy: 'none' })).toEqual({
      discloseResult: false, showQuestionPoints: false, showCorrectAnswers: false
    });
    expect(resolveActivityResultDisclosure({ ...base, feedbackPolicy: 'total_points' })).toEqual({
      discloseResult: true, showQuestionPoints: false, showCorrectAnswers: false
    });
    expect(resolveActivityResultDisclosure({ ...base, feedbackPolicy: 'correct_answers' })).toEqual({
      discloseResult: true, showQuestionPoints: true, showCorrectAnswers: true
    });
    expect(resolveActivityResultDisclosure({ ...base, feedbackPolicy: 'manual_release' }).discloseResult).toBe(false);
    expect(resolveActivityResultDisclosure({ ...base, feedbackPolicy: 'manual_release', resultsReleased: true })).toEqual({
      discloseResult: true, showQuestionPoints: true, showCorrectAnswers: false
    });
    expect(resolveActivityResultDisclosure({
      ...base, resultVisibility: 'after_close', feedbackPolicy: 'points_per_question'
    }).discloseResult).toBe(false);
    expect(resolveActivityResultDisclosure({
      ...base, resultVisibility: 'after_close', activityClosed: true, feedbackPolicy: 'points_per_question'
    }).discloseResult).toBe(true);
    expect(resolveActivityResultDisclosure({
      ...base, attemptFinalized: false, feedbackPolicy: 'correct_answers'
    }).showCorrectAnswers).toBe(false);
  });
});
