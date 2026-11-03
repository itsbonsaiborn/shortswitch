import { z } from 'zod';
import type {
  ActivityQuestionPublicConfig,
  ActivityQuestionType,
  ActivitySettings,
  ActivitySlide,
  SlideBlock
} from '@/shared/activity-types.js';
import { createId } from '../utils.js';
import { isValidActivityTimeZone } from '../../shared/activity-deadline.js';

const stableIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/, 'IDs may contain letters, numbers, underscores and hyphens only.');
const optionalStableIdSchema = stableIdSchema.optional();
const shortText = (maximum: number) => z.string().trim().min(1).max(maximum);
const optionalText = (maximum: number) => z.string().trim().max(maximum).default('');
const httpsUrlSchema = z.string().trim().url().max(2048).refine((value) => new URL(value).protocol === 'https:', 'Image URL must use HTTPS.');
const optionSchema = z.object({ id: stableIdSchema, label: shortText(160) }).strict();

const uniqueIds = (values: Array<{ id: string }>) => new Set(values.map((value) => value.id)).size === values.length;

export const activitySettingsInputSchema = z.object({
  title: shortText(120),
  description: optionalText(1000),
  slug: z.string().trim().max(128).optional(),
  status: z.enum(['active', 'closed']).default('closed'),
  identityMode: z.enum(['anonymous', 'named']).default('anonymous'),
  requiredAnswerBehavior: z.enum(['require_all', 'allow_incomplete']).default('require_all'),
  navigationPolicy: z.enum(['linear', 'free']).default('linear'),
  resultVisibility: z.enum(['never', 'after_submission', 'after_close']).default('after_submission'),
  feedbackPolicy: z.enum(['none', 'total_points', 'points_per_question', 'correct_answers', 'manual_release']).default('points_per_question'),
  theme: z.enum(['classic_cream', 'forest_dark', 'soft_lavender', 'ocean_blue', 'minimal_light']).default('minimal_light'),
  layout: z.enum(['classic', 'minimal', 'soft', 'bold']).default('classic'),
  backgroundPattern: z.enum(['none', 'dots', 'grid', 'soft_glow', 'crosses']).default('none'),
  patternIntensity: z.number().int().min(0).max(100).default(35),
  gradingEnabled: z.boolean().default(true),
  defaultQuestionPoints: z.number().int().min(1).max(1000).default(1),
  maximumAttempts: z.number().int().min(1).max(100).default(1),
  attemptTimeLimitSeconds: z.number().int().min(30).max(7 * 24 * 60 * 60).nullable().default(null),
  availabilityStartAt: z.string().datetime({ offset: true }).nullable().default(null),
  submissionDeadlineAt: z.string().datetime({ offset: true }).nullable().default(null),
  submissionDeadlineTimezone: z.string().trim().min(1).max(100).refine(isValidActivityTimeZone, 'Deadline timezone must be a valid IANA timezone.').default('UTC'),
  lowTimeWarningSeconds: z.number().int().min(10).max(60 * 60).nullable().default(300),
  shuffleQuestionOptions: z.boolean().default(false),
  shuffleSlides: z.boolean().default(false),
  allowBackNavigation: z.boolean().default(true)
}).strict();

export const normalizeStoredActivitySettings = (settings: ActivitySettings): ActivitySettings => ({
  ...settings,
  availabilityStartAt: settings.availabilityStartAt ?? null,
  feedbackPolicy: settings.feedbackPolicy ?? 'points_per_question',
  theme: settings.theme ?? 'minimal_light',
  layout: settings.layout ?? 'classic',
  backgroundPattern: settings.backgroundPattern ?? 'none',
  patternIntensity: settings.patternIntensity ?? 35,
  gradingEnabled: settings.gradingEnabled ?? true,
  defaultQuestionPoints: settings.defaultQuestionPoints ?? 1,
  submissionDeadlineTimezone: settings.submissionDeadlineTimezone || 'UTC',
  lowTimeWarningSeconds: settings.lowTimeWarningSeconds === undefined ? 300 : settings.lowTimeWarningSeconds,
  shuffleSlides: settings.shuffleSlides ?? false,
  allowBackNavigation: settings.allowBackNavigation ?? true
});

const questionBase = {
  id: optionalStableIdSchema,
  type: z.literal('question'),
  graded: z.boolean().default(true),
  points: z.number().int().min(0).max(1000).default(1),
  required: z.boolean().default(true)
};

const singleChoiceSchema = z.object({
  ...questionBase,
  questionType: z.literal('single_choice'),
  config: z.object({
    prompt: shortText(1000),
    description: optionalText(2000),
    options: z.array(optionSchema).min(2).max(50),
    shuffleOptions: z.boolean().default(false)
  }).strict(),
  answerKey: z.object({ correctOptionId: stableIdSchema, feedback: optionalText(2000) }).strict().nullable()
}).strict().superRefine((value, context) => {
  if (!uniqueIds(value.config.options)) context.addIssue({ code: 'custom', message: 'Choice option IDs must be unique.', path: ['config', 'options'] });
  if (value.graded && !value.answerKey) context.addIssue({ code: 'custom', message: 'A graded question requires an answer key.', path: ['answerKey'] });
  if (value.answerKey && !value.config.options.some((option) => option.id === value.answerKey?.correctOptionId)) {
    context.addIssue({ code: 'custom', message: 'The correct option must reference an existing option.', path: ['answerKey'] });
  }
});

const multipleChoiceSchema = z.object({
  ...questionBase,
  questionType: z.literal('multiple_choice'),
  config: z.object({
    prompt: shortText(1000),
    description: optionalText(2000),
    options: z.array(optionSchema).min(2).max(50),
    minimumSelections: z.number().int().min(1),
    maximumSelections: z.number().int().min(1),
    shuffleOptions: z.boolean().default(false),
    gradingMode: z.enum(['all_or_nothing', 'partial']).default('all_or_nothing')
  }).strict(),
  answerKey: z.object({ correctOptionIds: z.array(stableIdSchema).min(1).max(50), feedback: optionalText(2000) }).strict().nullable()
}).strict().superRefine((value, context) => {
  const optionIds = new Set(value.config.options.map((option) => option.id));
  if (optionIds.size !== value.config.options.length) context.addIssue({ code: 'custom', message: 'Choice option IDs must be unique.', path: ['config', 'options'] });
  if (value.config.minimumSelections > value.config.maximumSelections || value.config.maximumSelections > value.config.options.length) {
    context.addIssue({ code: 'custom', message: 'Selection limits must fit the available options.', path: ['config'] });
  }
  if (value.graded && !value.answerKey) context.addIssue({ code: 'custom', message: 'A graded question requires an answer key.', path: ['answerKey'] });
  if (value.answerKey && (new Set(value.answerKey.correctOptionIds).size !== value.answerKey.correctOptionIds.length || value.answerKey.correctOptionIds.some((id) => !optionIds.has(id)))) {
    context.addIssue({ code: 'custom', message: 'Correct options must be unique existing option IDs.', path: ['answerKey'] });
  }
  if (value.answerKey && value.answerKey.correctOptionIds.length > value.config.maximumSelections) {
    context.addIssue({ code: 'custom', message: 'The maximum selections must allow every correct option.', path: ['config', 'maximumSelections'] });
  }
});

const acceptedAnswerKey = z.object({
  acceptedAnswers: z.array(shortText(500)).max(100),
  feedback: optionalText(2000)
}).strict();
const openAnswerSchema = z.object({
  ...questionBase,
  questionType: z.literal('open_answer'),
  config: z.object({
    prompt: shortText(1000),
    instructions: optionalText(2000),
    responseMode: z.enum(['single_line', 'multiline']).default('multiline'),
    minimumLength: z.number().int().min(0).max(5000).default(1),
    maximumLength: z.number().int().min(1).max(5000),
    gradingMode: z.enum(['manual', 'exact', 'normalized', 'ungraded']).default('normalized'),
    ignoreCase: z.boolean().default(true),
    normalizeWhitespace: z.boolean().default(true)
  }).strict(),
  answerKey: acceptedAnswerKey.nullable()
}).strict().superRefine((value, context) => {
  if (value.config.minimumLength > value.config.maximumLength) context.addIssue({ code: 'custom', message: 'Minimum length cannot exceed maximum length.', path: ['config', 'minimumLength'] });
  if (value.graded && (value.config.gradingMode === 'exact' || value.config.gradingMode === 'normalized') && (!value.answerKey || value.answerKey.acceptedAnswers.length === 0)) {
    context.addIssue({ code: 'custom', message: 'Automatic grading requires at least one accepted answer.', path: ['answerKey'] });
  }
  if (value.config.gradingMode === 'ungraded' && (value.graded || value.points !== 0)) {
    context.addIssue({ code: 'custom', message: 'Ungraded open answers must use zero points.', path: ['graded'] });
  }
});

const wordCloudSchema = z.object({
  ...questionBase,
  questionType: z.literal('word_cloud'),
  config: z.object({
    prompt: shortText(1000),
    instructions: optionalText(2000),
    maximumLength: z.number().int().min(1).max(500),
    allowMultipleResponses: z.boolean().default(false),
    maximumResponses: z.number().int().min(1).max(20).default(1),
    moderationMode: z.enum(['off', 'filter_only', 'review_all']).default('off'),
    showResults: z.boolean().default(false),
    showParticipantNames: z.boolean().default(false),
    gradingMode: z.enum(['ungraded', 'participation']).default('participation')
  }).strict(),
  answerKey: acceptedAnswerKey.nullable()
}).strict().superRefine((value, context) => {
  if (!value.config.allowMultipleResponses && value.config.maximumResponses !== 1) {
    context.addIssue({ code: 'custom', message: 'Single-response word clouds must use a maximum of one response.', path: ['config', 'maximumResponses'] });
  }
  if (value.config.gradingMode === 'ungraded' && (value.graded || value.points !== 0)) {
    context.addIssue({ code: 'custom', message: 'Ungraded word clouds must use zero points.', path: ['graded'] });
  }
  if (value.config.gradingMode === 'participation' && !value.graded) {
    context.addIssue({ code: 'custom', message: 'Participation points require a graded question.', path: ['graded'] });
  }
});

const orderingSchema = z.object({
  ...questionBase,
  questionType: z.literal('ordering'),
  config: z.object({
    prompt: shortText(1000),
    items: z.array(optionSchema).min(2).max(50),
    shuffleItems: z.boolean().default(true),
    gradingMode: z.enum(['all_or_nothing', 'partial']).default('all_or_nothing')
  }).strict(),
  answerKey: z.object({ orderedItemIds: z.array(stableIdSchema).min(2).max(50), feedback: optionalText(2000) }).strict().nullable()
}).strict().superRefine((value, context) => {
  const itemIds = value.config.items.map((item) => item.id);
  if (new Set(itemIds).size !== itemIds.length) context.addIssue({ code: 'custom', message: 'Ordering item IDs must be unique.', path: ['config', 'items'] });
  if (value.graded && !value.answerKey) context.addIssue({ code: 'custom', message: 'A graded question requires an answer key.', path: ['answerKey'] });
  if (value.answerKey && (value.answerKey.orderedItemIds.length !== itemIds.length || value.answerKey.orderedItemIds.some((id) => !itemIds.includes(id)) || new Set(value.answerKey.orderedItemIds).size !== itemIds.length)) {
    context.addIssue({ code: 'custom', message: 'The answer key must contain every ordering item exactly once.', path: ['answerKey'] });
  }
});

const matchingSchema = z.object({
  ...questionBase,
  questionType: z.literal('matching'),
  config: z.object({
    prompt: shortText(1000),
    leftItems: z.array(optionSchema).min(1).max(50),
    rightItems: z.array(optionSchema).min(1).max(50),
    shuffleLeftItems: z.boolean().default(true),
    shuffleRightItems: z.boolean().default(true),
    gradingMode: z.enum(['all_or_nothing', 'partial']).default('all_or_nothing')
  }).strict(),
  answerKey: z.object({ pairs: z.array(z.object({ leftId: stableIdSchema, rightId: stableIdSchema }).strict()).min(1).max(50), feedback: optionalText(2000) }).strict().nullable()
}).strict().superRefine((value, context) => {
  const leftIds = new Set(value.config.leftItems.map((item) => item.id));
  const rightIds = new Set(value.config.rightItems.map((item) => item.id));
  if (leftIds.size !== value.config.leftItems.length || rightIds.size !== value.config.rightItems.length) context.addIssue({ code: 'custom', message: 'Matching item IDs must be unique.', path: ['config'] });
  if (value.config.leftItems.length !== value.config.rightItems.length) context.addIssue({ code: 'custom', message: 'Matching questions require the same number of left and right items.', path: ['config'] });
  if (value.graded && !value.answerKey) context.addIssue({ code: 'custom', message: 'A graded question requires an answer key.', path: ['answerKey'] });
  if (value.answerKey) {
    const usedLeft = new Set<string>();
    const usedRight = new Set<string>();
    for (const pair of value.answerKey.pairs) {
      if (!leftIds.has(pair.leftId) || !rightIds.has(pair.rightId) || usedLeft.has(pair.leftId) || usedRight.has(pair.rightId)) {
        context.addIssue({ code: 'custom', message: 'Matching pairs must reference existing items and use each item once.', path: ['answerKey'] });
        break;
      }
      usedLeft.add(pair.leftId);
      usedRight.add(pair.rightId);
    }
    if (value.answerKey.pairs.length !== value.config.leftItems.length) context.addIssue({ code: 'custom', message: 'The answer key must pair every matching item.', path: ['answerKey'] });
  }
});

const activityImageUrlSchema = httpsUrlSchema;

const imageLabelingSchema = z.object({
  ...questionBase,
  questionType: z.literal('image_labeling'),
  config: z.object({
    prompt: shortText(1000),
    imageUrl: activityImageUrlSchema,
    imageAlt: shortText(300),
    markers: z.array(z.object({ id: stableIdSchema, x: z.number().min(0).max(1), y: z.number().min(0).max(1), label: optionalText(120).optional() }).strict()).min(1).max(30),
    labels: z.array(optionSchema).min(1).max(30),
    oneToOne: z.boolean().default(true),
    gradingMode: z.enum(['all_or_nothing', 'partial']).default('all_or_nothing')
  }).strict(),
  answerKey: z.object({ assignments: z.array(z.object({ markerId: stableIdSchema, labelId: stableIdSchema }).strict()).min(1).max(30), feedback: optionalText(2000) }).strict().nullable()
}).strict().superRefine((value, context) => {
  const markerIds = new Set(value.config.markers.map((marker) => marker.id));
  const labelIds = new Set(value.config.labels.map((label) => label.id));
  if (markerIds.size !== value.config.markers.length || labelIds.size !== value.config.labels.length) context.addIssue({ code: 'custom', message: 'Marker and label IDs must be unique.', path: ['config'] });
  if (value.graded && !value.answerKey) context.addIssue({ code: 'custom', message: 'A graded question requires an answer key.', path: ['answerKey'] });
  if (value.answerKey) {
    const usedMarkers = new Set<string>();
    const usedLabels = new Set<string>();
    for (const assignment of value.answerKey.assignments) {
      if (!markerIds.has(assignment.markerId) || !labelIds.has(assignment.labelId) || usedMarkers.has(assignment.markerId) || (value.config.oneToOne && usedLabels.has(assignment.labelId))) {
        context.addIssue({ code: 'custom', message: 'Label assignments must reference existing items without forbidden duplicates.', path: ['answerKey'] });
        break;
      }
      usedMarkers.add(assignment.markerId);
      usedLabels.add(assignment.labelId);
    }
    if (value.answerKey.assignments.length !== value.config.markers.length) context.addIssue({ code: 'custom', message: 'Every marker requires a correct label assignment.', path: ['answerKey'] });
  }
});

export const QuestionTypeRegistry = {
  single_choice: singleChoiceSchema,
  multiple_choice: multipleChoiceSchema,
  open_answer: openAnswerSchema,
  word_cloud: wordCloudSchema,
  ordering: orderingSchema,
  matching: matchingSchema,
  image_labeling: imageLabelingSchema
} satisfies Record<ActivityQuestionType, z.ZodType>;

const questionBlockSchema = z.union([
  singleChoiceSchema,
  multipleChoiceSchema,
  openAnswerSchema,
  wordCloudSchema,
  orderingSchema,
  matchingSchema,
  imageLabelingSchema
]);

const contentBlockSchema = z.discriminatedUnion('type', [
  z.object({ id: optionalStableIdSchema, type: z.literal('heading'), config: z.object({ text: shortText(500), level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2) }).strict() }).strict(),
  z.object({ id: optionalStableIdSchema, type: z.literal('text'), config: z.object({ text: shortText(10_000) }).strict() }).strict(),
  z.object({ id: optionalStableIdSchema, type: z.literal('image'), config: z.object({ url: httpsUrlSchema, alt: shortText(300), caption: optionalText(500) }).strict() }).strict(),
  z.object({ id: optionalStableIdSchema, type: z.literal('divider'), config: z.object({ style: z.enum(['solid', 'dashed', 'dotted']).default('solid') }).strict() }).strict()
]);

export const activityDraftInputSchema = z.object({
  expectedRevision: z.number().int().min(0),
  slides: z.array(z.object({
    id: optionalStableIdSchema,
    title: optionalText(200),
    description: optionalText(1000),
    blocks: z.array(z.union([contentBlockSchema, questionBlockSchema])).max(100)
  }).strict()).max(200)
}).strict();

export type ValidatedActivitySettingsInput = z.infer<typeof activitySettingsInputSchema>;
export type ValidatedActivityDraftInput = z.infer<typeof activityDraftInputSchema>;
export type ValidatedActivityDraftBlock = ValidatedActivityDraftInput['slides'][number]['blocks'][number];
export type NormalizedActivityDraftBlock = ValidatedActivityDraftBlock & { id: string };
export interface NormalizedActivityDraftSlide {
  id: string;
  position: number;
  title: string;
  description: string;
  blocks: NormalizedActivityDraftBlock[];
}

export interface PrivateQuestionKeyRecord {
  questionType: ActivityQuestionType;
  answerKey: unknown;
}

export interface InternalActivityDraft {
  activityId: string;
  revision: number;
  slides: Array<{
    id: string;
    position: number;
    title: string;
    description: string;
    blocks: NormalizedActivityDraftBlock[];
  }>;
  createdAt: string;
  updatedAt: string;
}

const validateQuestionCount = (slides: ValidatedActivityDraftInput['slides'], context: z.RefinementCtx) => {
  slides.forEach((slide, slideIndex) => {
    const gradedQuestions = slide.blocks.filter((block) => block.type === 'question' && block.graded);
    if (gradedQuestions.length > 1) {
      context.addIssue({ code: 'custom', message: 'A slide can contain at most one graded question block.', path: ['slides', slideIndex, 'blocks'] });
    }
  });
};

export const parseActivityDraftInput = (input: unknown) => {
  const parsed = activityDraftInputSchema.superRefine((value, context) => validateQuestionCount(value.slides, context)).parse(input);
  const ids = new Set<string>();
  const slides = parsed.slides.map((slide, position) => {
    const slideId = slide.id ?? createId();
    if (ids.has(slideId)) throw new Error('Slide and block IDs must be unique.');
    ids.add(slideId);
    return {
      id: slideId,
      position,
      title: slide.title,
      description: slide.description,
      blocks: slide.blocks.map((block) => {
        const id = block.id ?? createId();
        if (ids.has(id)) throw new Error('Slide and block IDs must be unique.');
        ids.add(id);
        return { ...block, id };
      })
    };
  });
  return { expectedRevision: parsed.expectedRevision, slides };
};

export const toPublicSlideBlock = (block: ValidatedActivityDraftBlock & { id: string }): SlideBlock => {
  if (block.type !== 'question') return block as SlideBlock;
  return {
    id: block.id,
    type: 'question',
    questionType: block.questionType,
    graded: block.graded,
    points: block.graded ? block.points : 0,
    required: block.required,
    config: { questionType: block.questionType, ...block.config } as ActivityQuestionPublicConfig
  };
};

export const parseStoredQuestionBlock = (value: unknown) => questionBlockSchema.parse(value);

export const toStoredActivitySettings = (settings: ActivitySettings) => ({ ...settings });

export const toActivitySlides = (draft: ReturnType<typeof parseActivityDraftInput>): ActivitySlide[] =>
  draft.slides.map((slide) => ({
    id: slide.id,
    position: slide.position,
    title: slide.title,
    description: slide.description,
    blocks: slide.blocks.map((block) => toPublicSlideBlock(block))
  }));
