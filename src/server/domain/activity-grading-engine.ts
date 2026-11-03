import { z } from 'zod';
import type {
  ActivityFeedbackPolicy,
  ActivityQuestionPublicConfig,
  ActivityQuestionType,
  ActivityResultVisibility,
  ActivitySupportedAnswer
} from '@/shared/activity-types.js';
import { QuestionTypeRegistry } from './activity-domain.js';
import { normalizeOpenAnswer } from './activity-text-grading.js';

export const ACTIVITY_POINT_UNITS = 1000;

export const pointsToUnits = (points: number) => Math.max(0, Math.round(points * ACTIVITY_POINT_UNITS));
export const unitsToPoints = (units: number) => Math.round((units / ACTIVITY_POINT_UNITS) * 1000) / 1000;

export const resolveActivityResultDisclosure = (input: {
  attemptFinalized: boolean;
  activityClosed: boolean;
  resultVisibility: ActivityResultVisibility;
  feedbackPolicy: ActivityFeedbackPolicy;
  resultsReleased: boolean;
}) => {
  const availabilityAllows = input.resultVisibility === 'after_submission'
    || (input.resultVisibility === 'after_close' && input.activityClosed);
  const discloseResult = input.attemptFinalized
    && input.feedbackPolicy !== 'none'
    && availabilityAllows
    && (input.feedbackPolicy !== 'manual_release' || input.resultsReleased);
  return {
    discloseResult,
    showQuestionPoints: discloseResult && (
      input.feedbackPolicy === 'points_per_question'
      || input.feedbackPolicy === 'correct_answers'
      || input.feedbackPolicy === 'manual_release'
    ),
    showCorrectAnswers: discloseResult && input.feedbackPolicy === 'correct_answers'
  };
};

const id = z.string().trim().min(1).max(128);
const singleChoiceResponse = z.object({ questionType: z.literal('single_choice'), optionId: id.nullable() }).strict();
const multipleChoiceResponse = z.object({ questionType: z.literal('multiple_choice'), optionIds: z.array(id).max(50) }).strict();
const openAnswerResponse = z.object({ questionType: z.literal('open_answer'), text: z.string().max(5000) }).strict();
const wordCloudResponse = z.union([
  z.object({ questionType: z.literal('word_cloud'), responses: z.array(z.string().max(500)).max(20) }).strict(),
  z.object({ questionType: z.literal('word_cloud'), text: z.string().max(500) }).strict()
]);
const orderingResponse = z.object({ questionType: z.literal('ordering'), orderedItemIds: z.array(id).max(50) }).strict();
const matchingResponse = z.object({ questionType: z.literal('matching'), pairs: z.array(z.object({ leftId: id, rightId: id }).strict()).max(50) }).strict();
const imageLabelingResponse = z.object({ questionType: z.literal('image_labeling'), assignments: z.array(z.object({ markerId: id, labelId: id }).strict()).max(30) }).strict();

type GradeStatus = 'graded' | 'manual_review';

export interface ActivityPluginGrade {
  status: GradeStatus;
  awardedUnits: number | null;
  correct: boolean | null;
  details: Record<string, unknown>;
}

interface GradeContext {
  config: ActivityQuestionPublicConfig;
  answer: ActivitySupportedAnswer;
  key: Record<string, unknown>;
  maximumUnits: number;
}

interface ActivityQuestionPlugin {
  configurationSchema: z.ZodType;
  responseSchema: z.ZodType;
  serializePublic: (config: ActivityQuestionPublicConfig) => ActivityQuestionPublicConfig;
  grade: (context: GradeContext) => ActivityPluginGrade;
  feedback?: (key: Record<string, unknown>) => string;
  serializeCorrectAnswer?: (config: ActivityQuestionPublicConfig, key: Record<string, unknown>) => unknown;
}

const exactGrade = (correct: boolean, maximumUnits: number, gradingMode: string): ActivityPluginGrade => ({
  status: 'graded',
  awardedUnits: correct ? maximumUnits : 0,
  correct,
  details: { automaticallyGraded: true, gradingMode, fraction: correct ? 1 : 0, correct }
});

const ratioUnits = (maximumUnits: number, numerator: number, denominator: number) => denominator > 0
  ? Math.min(maximumUnits, Math.max(0, Math.round(maximumUnits * numerator / denominator)))
  : 0;

const optionLabels = (config: ActivityQuestionPublicConfig, ids: string[]) => {
  if (config.questionType !== 'single_choice' && config.questionType !== 'multiple_choice') return [];
  const selected = new Set(ids);
  return config.options.filter((option) => selected.has(option.id)).map((option) => ({ id: option.id, label: option.label }));
};

const commonFeedback = (key: Record<string, unknown>) => typeof key.feedback === 'string' ? key.feedback : '';

export const ActivityQuestionPluginRegistry: Record<ActivityQuestionType, ActivityQuestionPlugin> = {
  single_choice: {
    configurationSchema: QuestionTypeRegistry.single_choice,
    responseSchema: singleChoiceResponse,
    serializePublic: (config) => config,
    grade: ({ answer, key, maximumUnits }) => exactGrade(
      answer.questionType === 'single_choice' && answer.optionId !== null && answer.optionId === key.correctOptionId,
      maximumUnits,
      'exact'
    ),
    feedback: commonFeedback,
    serializeCorrectAnswer: (config, key) => optionLabels(config, [String(key.correctOptionId ?? '')])[0] ?? null
  },
  multiple_choice: {
    configurationSchema: QuestionTypeRegistry.multiple_choice,
    responseSchema: multipleChoiceResponse,
    serializePublic: (config) => config,
    grade: ({ config, answer, key, maximumUnits }) => {
      if (config.questionType !== 'multiple_choice' || answer.questionType !== 'multiple_choice') return exactGrade(false, maximumUnits, 'all_or_nothing');
      const selected = new Set(answer.optionIds);
      const correctIds = new Set(Array.isArray(key.correctOptionIds) ? key.correctOptionIds.filter((value): value is string => typeof value === 'string') : []);
      const exact = selected.size === correctIds.size && [...selected].every((value) => correctIds.has(value));
      if (config.gradingMode === 'all_or_nothing') return exactGrade(exact, maximumUnits, config.gradingMode);
      const distractors = config.options.filter((option) => !correctIds.has(option.id)).length;
      const correctSelected = [...selected].filter((value) => correctIds.has(value)).length;
      const incorrectSelected = [...selected].filter((value) => !correctIds.has(value)).length;
      const denominator = correctIds.size * Math.max(1, distractors);
      const numerator = distractors > 0
        ? correctSelected * distractors - incorrectSelected * correctIds.size
        : correctSelected;
      const awardedUnits = ratioUnits(maximumUnits, Math.max(0, numerator), distractors > 0 ? denominator : Math.max(1, correctIds.size));
      return {
        status: 'graded', awardedUnits, correct: exact,
        details: { automaticallyGraded: true, gradingMode: config.gradingMode, correct: exact, fraction: maximumUnits ? awardedUnits / maximumUnits : 0 }
      };
    },
    feedback: commonFeedback,
    serializeCorrectAnswer: (config, key) => optionLabels(config, Array.isArray(key.correctOptionIds) ? key.correctOptionIds as string[] : [])
  },
  open_answer: {
    configurationSchema: QuestionTypeRegistry.open_answer,
    responseSchema: openAnswerResponse,
    serializePublic: (config) => config,
    grade: ({ config, answer, key, maximumUnits }) => {
      if (config.questionType !== 'open_answer' || answer.questionType !== 'open_answer') return exactGrade(false, maximumUnits, 'invalid');
      if (config.gradingMode === 'manual') return { status: 'manual_review', awardedUnits: null, correct: null, details: { automaticallyGraded: false, gradingMode: 'manual' } };
      if (config.gradingMode === 'ungraded') return { status: 'graded', awardedUnits: 0, correct: null, details: { automaticallyGraded: true, gradingMode: 'ungraded' } };
      const accepted = Array.isArray(key.acceptedAnswers) ? key.acceptedAnswers.filter((value): value is string => typeof value === 'string') : [];
      const normalize = config.gradingMode === 'exact'
        ? (value: string) => value
        : (value: string) => normalizeOpenAnswer(value, { ignoreCase: config.ignoreCase, normalizeWhitespace: config.normalizeWhitespace });
      return exactGrade(accepted.some((value) => normalize(value) === normalize(answer.text)), maximumUnits, config.gradingMode);
    },
    feedback: commonFeedback,
    serializeCorrectAnswer: (_config, key) => Array.isArray(key.acceptedAnswers) ? key.acceptedAnswers : []
  },
  word_cloud: {
    configurationSchema: QuestionTypeRegistry.word_cloud,
    responseSchema: wordCloudResponse,
    serializePublic: (config) => config,
    grade: ({ config, answer, maximumUnits }) => {
      if (config.questionType !== 'word_cloud' || answer.questionType !== 'word_cloud') return exactGrade(false, maximumUnits, 'participation');
      if (config.gradingMode === 'ungraded') return { status: 'graded', awardedUnits: 0, correct: null, details: { automaticallyGraded: true, gradingMode: 'ungraded' } };
      const responses = 'responses' in answer ? answer.responses : [answer.text];
      return exactGrade(responses.some((value) => value.trim().length > 0), maximumUnits, 'participation');
    },
    feedback: commonFeedback
  },
  ordering: {
    configurationSchema: QuestionTypeRegistry.ordering,
    responseSchema: orderingResponse,
    serializePublic: (config) => config,
    grade: ({ config, answer, key, maximumUnits }) => {
      if (config.questionType !== 'ordering' || answer.questionType !== 'ordering') return exactGrade(false, maximumUnits, 'all_or_nothing');
      const correctIds = Array.isArray(key.orderedItemIds) ? key.orderedItemIds.filter((value): value is string => typeof value === 'string') : [];
      const correctCount = correctIds.filter((value, index) => answer.orderedItemIds[index] === value).length;
      const correct = correctIds.length > 0 && correctCount === correctIds.length;
      const awardedUnits = config.gradingMode === 'all_or_nothing' ? (correct ? maximumUnits : 0) : ratioUnits(maximumUnits, correctCount, correctIds.length);
      return { status: 'graded', awardedUnits, correct, details: { automaticallyGraded: true, gradingMode: config.gradingMode, correct, correctCount, totalCount: correctIds.length, fraction: maximumUnits ? awardedUnits / maximumUnits : 0 } };
    },
    feedback: commonFeedback,
    serializeCorrectAnswer: (config, key) => {
      if (config.questionType !== 'ordering') return [];
      const items = new Map(config.items.map((item) => [item.id, item.label]));
      return (Array.isArray(key.orderedItemIds) ? key.orderedItemIds : []).map((value) => ({ id: String(value), label: items.get(String(value)) ?? '' }));
    }
  },
  matching: {
    configurationSchema: QuestionTypeRegistry.matching,
    responseSchema: matchingResponse,
    serializePublic: (config) => config,
    grade: ({ config, answer, key, maximumUnits }) => {
      if (config.questionType !== 'matching' || answer.questionType !== 'matching') return exactGrade(false, maximumUnits, 'all_or_nothing');
      const correctPairs = Array.isArray(key.pairs) ? key.pairs as Array<{ leftId: string; rightId: string }> : [];
      const submitted = new Map(answer.pairs.map((pair) => [pair.leftId, pair.rightId]));
      const correctCount = correctPairs.filter((pair) => submitted.get(pair.leftId) === pair.rightId).length;
      const correct = correctPairs.length > 0 && correctCount === correctPairs.length;
      const awardedUnits = config.gradingMode === 'all_or_nothing' ? (correct ? maximumUnits : 0) : ratioUnits(maximumUnits, correctCount, correctPairs.length);
      return { status: 'graded', awardedUnits, correct, details: { automaticallyGraded: true, gradingMode: config.gradingMode, correct, correctCount, totalCount: correctPairs.length, fraction: maximumUnits ? awardedUnits / maximumUnits : 0 } };
    },
    feedback: commonFeedback,
    serializeCorrectAnswer: (config, key) => {
      if (config.questionType !== 'matching') return [];
      const left = new Map(config.leftItems.map((item) => [item.id, item.label]));
      const right = new Map(config.rightItems.map((item) => [item.id, item.label]));
      return (Array.isArray(key.pairs) ? key.pairs as Array<{ leftId: string; rightId: string }> : []).map((pair) => ({ ...pair, leftLabel: left.get(pair.leftId) ?? '', rightLabel: right.get(pair.rightId) ?? '' }));
    }
  },
  image_labeling: {
    configurationSchema: QuestionTypeRegistry.image_labeling,
    responseSchema: imageLabelingResponse,
    serializePublic: (config) => config,
    grade: ({ config, answer, key, maximumUnits }) => {
      if (config.questionType !== 'image_labeling' || answer.questionType !== 'image_labeling') return exactGrade(false, maximumUnits, 'all_or_nothing');
      const correctAssignments = Array.isArray(key.assignments) ? key.assignments as Array<{ markerId: string; labelId: string }> : [];
      const submitted = new Map(answer.assignments.map((assignment) => [assignment.markerId, assignment.labelId]));
      const correctCount = correctAssignments.filter((assignment) => submitted.get(assignment.markerId) === assignment.labelId).length;
      const correct = correctAssignments.length > 0 && correctCount === correctAssignments.length;
      const awardedUnits = config.gradingMode === 'all_or_nothing' ? (correct ? maximumUnits : 0) : ratioUnits(maximumUnits, correctCount, correctAssignments.length);
      return { status: 'graded', awardedUnits, correct, details: { automaticallyGraded: true, gradingMode: config.gradingMode, correct, correctCount, totalCount: correctAssignments.length, fraction: maximumUnits ? awardedUnits / maximumUnits : 0 } };
    },
    feedback: commonFeedback,
    serializeCorrectAnswer: (config, key) => {
      if (config.questionType !== 'image_labeling') return [];
      const labels = new Map(config.labels.map((item) => [item.id, item.label]));
      return (Array.isArray(key.assignments) ? key.assignments as Array<{ markerId: string; labelId: string }> : []).map((assignment) => ({ ...assignment, label: labels.get(assignment.labelId) ?? '' }));
    }
  }
};

export const parseActivityPluginResponse = (questionType: ActivityQuestionType, value: unknown) =>
  ActivityQuestionPluginRegistry[questionType].responseSchema.parse(value) as ActivitySupportedAnswer;

export const serializeActivityQuestionPublicConfig = (config: ActivityQuestionPublicConfig) =>
  ActivityQuestionPluginRegistry[config.questionType].serializePublic(config);

export const gradeActivityQuestion = (input: {
  questionType: ActivityQuestionType;
  config: ActivityQuestionPublicConfig;
  answer: ActivitySupportedAnswer;
  key: Record<string, unknown>;
  maximumUnits: number;
  graded: boolean;
  moderationStatus: 'approved' | 'pending' | 'rejected';
}): ActivityPluginGrade => {
  if (!input.graded) return { status: 'graded', awardedUnits: 0, correct: null, details: { automaticallyGraded: true, gradingMode: 'ungraded' } };
  if (input.moderationStatus === 'pending') return { status: 'manual_review', awardedUnits: null, correct: null, details: { automaticallyGraded: false, moderationPending: true } };
  if (input.moderationStatus === 'rejected') return exactGrade(false, input.maximumUnits, 'moderation_rejected');
  const plugin = ActivityQuestionPluginRegistry[input.questionType];
  const answer = plugin.responseSchema.parse(input.answer) as ActivitySupportedAnswer;
  return plugin.grade({ config: input.config, answer, key: input.key, maximumUnits: input.maximumUnits });
};

export const activityQuestionFeedback = (questionType: ActivityQuestionType, key: Record<string, unknown>) =>
  ActivityQuestionPluginRegistry[questionType].feedback?.(key) ?? '';

export const serializeActivityCorrectAnswer = (questionType: ActivityQuestionType, config: ActivityQuestionPublicConfig, key: Record<string, unknown>) =>
  ActivityQuestionPluginRegistry[questionType].serializeCorrectAnswer?.(config, key);
