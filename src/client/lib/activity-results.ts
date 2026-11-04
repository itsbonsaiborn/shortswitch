import type {
  ActivityAdminAttemptResponse,
  ActivityQuestionPublicConfig,
  ActivityQuestionType
} from '@/shared/activity-types';

export type ActivityAnswerRow = { label: string; value: string };
export type ActivityChoiceReviewOption = {
  id: string;
  label: string;
  selected: boolean;
  correct: boolean;
  incorrectSelection: boolean;
};

export const formatActivityNumber = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : (Math.round((value + Number.EPSILON) * 10) / 10).toFixed(1);

export const formatActivityPercent = (value: number) => `${formatActivityNumber(value)}%`;

export const formatActivityScorePercent = (score: number | null | undefined, maximumScore: number) =>
  score === null || score === undefined || maximumScore <= 0
    ? '—'
    : formatActivityPercent(Math.max(0, Math.min(100, score / maximumScore * 100)));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Build the read-only editor-style option list used by the admin attempt review. */
export const activityChoiceReviewOptions = (response: ActivityAdminAttemptResponse): ActivityChoiceReviewOption[] => {
  const config = response.questionConfig;
  if (config.questionType !== 'single_choice' && config.questionType !== 'multiple_choice') return [];
  const answer = response.answer;
  const selectedIds = new Set(
    answer?.questionType === 'single_choice'
      ? answer.optionId ? [answer.optionId] : []
      : answer?.questionType === 'multiple_choice' ? answer.optionIds : []
  );
  const correctValues = Array.isArray(response.correctAnswer) ? response.correctAnswer : [response.correctAnswer];
  const correctIds = new Set(correctValues.flatMap((value) => isRecord(value) && typeof value.id === 'string' ? [value.id] : []));
  return config.options.map((option) => ({
    ...option,
    selected: selectedIds.has(option.id),
    correct: correctIds.has(option.id),
    incorrectSelection: selectedIds.has(option.id) && !correctIds.has(option.id)
  }));
};

/** Convert a disclosed answer key into readable rows without rendering IDs. */
export const activityCorrectAnswerRows = (
  questionType: ActivityQuestionType,
  correctAnswer: unknown,
  config: ActivityQuestionPublicConfig
): ActivityAnswerRow[] => {
  const values = Array.isArray(correctAnswer) ? correctAnswer : [correctAnswer];
  if (questionType === 'single_choice' || questionType === 'multiple_choice') {
    return values.flatMap((value) => isRecord(value) && typeof value.label === 'string'
      ? [{ label: '', value: value.label }]
      : []);
  }
  if (questionType === 'open_answer') {
    return values.flatMap((value) => typeof value === 'string' && value.length
      ? [{ label: '', value }]
      : []);
  }
  if (questionType === 'ordering') {
    return values.flatMap((value, index) => isRecord(value) && typeof value.label === 'string'
      ? [{ label: `${index + 1}.`, value: value.label }]
      : []);
  }
  if (questionType === 'matching') {
    return values.flatMap((value) => isRecord(value)
      && typeof value.leftLabel === 'string'
      && typeof value.rightLabel === 'string'
      ? [{ label: value.leftLabel, value: value.rightLabel }]
      : []);
  }
  if (questionType === 'image_labeling' && config.questionType === 'image_labeling') {
    const markerNumbers = new Map(config.markers.map((marker, index) => [marker.id, index + 1]));
    return values.flatMap((value) => isRecord(value)
      && typeof value.markerId === 'string'
      && typeof value.label === 'string'
      && markerNumbers.has(value.markerId)
      ? [{ label: `#${markerNumbers.get(value.markerId)}`, value: value.label }]
      : []);
  }
  return [];
};

export const activityAnswerRows = (response: ActivityAdminAttemptResponse): ActivityAnswerRow[] => {
  const answer = response.answer;
  const config = response.questionConfig;
  if (!answer) return [];
  if (answer.questionType === 'single_choice' && config.questionType === 'single_choice') {
    const option = config.options.find((item) => item.id === answer.optionId);
    return option ? [{ label: '', value: option.label }] : [];
  }
  if (answer.questionType === 'multiple_choice' && config.questionType === 'multiple_choice') {
    const options = new Map(config.options.map((item) => [item.id, item.label]));
    return answer.optionIds.map((id) => ({ label: '', value: options.get(id) ?? id }));
  }
  if (answer.questionType === 'open_answer') return answer.text ? [{ label: '', value: answer.text }] : [];
  if (answer.questionType === 'word_cloud') {
    const values = 'responses' in answer ? answer.responses : [answer.text];
    return values.filter(Boolean).map((value) => ({ label: '', value }));
  }
  if (answer.questionType === 'ordering' && config.questionType === 'ordering') {
    const items = new Map(config.items.map((item) => [item.id, item.label]));
    return answer.orderedItemIds.map((id, index) => ({ label: `${index + 1}.`, value: items.get(id) ?? id }));
  }
  if (answer.questionType === 'matching' && config.questionType === 'matching') {
    const left = new Map(config.leftItems.map((item) => [item.id, item.label]));
    const right = new Map(config.rightItems.map((item) => [item.id, item.label]));
    return answer.pairs.map((pair) => ({ label: left.get(pair.leftId) ?? pair.leftId, value: right.get(pair.rightId) ?? pair.rightId }));
  }
  if (answer.questionType === 'image_labeling' && config.questionType === 'image_labeling') {
    const labels = new Map(config.labels.map((item) => [item.id, item.label]));
    const markers = new Map(config.markers.map((item, index) => [item.id, index + 1]));
    return answer.assignments.map((item) => ({ label: labels.get(item.labelId) ?? item.labelId, value: `#${markers.get(item.markerId) ?? item.markerId}` }));
  }
  return [];
};
