// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { reactive } from 'vue';
import {
  addQuestionBlock,
  createContentBlock,
  createQuestionBlock,
  createSlide,
  duplicateSlide,
  moveById,
  publicPreviewSlides,
  validateEditorDraft
} from './activity-editor';

describe('Activity editor domain helpers', () => {
  test('creates and reorders slides without changing stable IDs', () => {
    const first = createSlide(0);
    const second = createSlide(1);
    const moved = moveById([first, second], second.id, 0);
    expect(moved.map((slide) => slide.id)).toEqual([second.id, first.id]);
  });

  test('creates complete choice plugin defaults and reorders stable option IDs', () => {
    const multiple = createQuestionBlock('multiple_choice', 5);
    expect(multiple.points).toBe(5);
    const config = multiple.config as Extract<typeof multiple.config, { questionType: 'multiple_choice' }>;
    expect(config).toMatchObject({
      questionType: 'multiple_choice', description: '', shuffleOptions: false,
      gradingMode: 'all_or_nothing', minimumSelections: 1, maximumSelections: 2
    });
    const reordered = moveById(config.options, config.options[1].id, 0);
    expect(reordered.map((option) => option.id)).toEqual([config.options[1].id, config.options[0].id]);
    expect(multiple.answerKey).toMatchObject({ correctOptionIds: [config.options[0].id], feedback: '' });
  });

  test('creates safe Open Answer and Word Cloud defaults', () => {
    const open = createQuestionBlock('open_answer');
    expect(open).toMatchObject({ graded: true, points: 1, config: { questionType: 'open_answer', responseMode: 'multiline', gradingMode: 'normalized', ignoreCase: true, normalizeWhitespace: true } });
    expect(open.answerKey).toMatchObject({ acceptedAnswers: ['Answer'], feedback: '' });
    const cloud = createQuestionBlock('word_cloud');
    expect(cloud).toMatchObject({ graded: false, points: 0, answerKey: null, config: { questionType: 'word_cloud', allowMultipleResponses: false, maximumResponses: 1, moderationMode: 'off', showResults: false, showParticipantNames: false, gradingMode: 'ungraded' } });
  });

  test('creates Ordering and Matching defaults with private canonical keys', () => {
    const ordering = createQuestionBlock('ordering');
    expect(ordering.config).toMatchObject({ questionType: 'ordering', shuffleItems: true, gradingMode: 'all_or_nothing' });
    if (ordering.questionType === 'ordering') {
      const config = ordering.config as Extract<typeof ordering.config, { questionType: 'ordering' }>;
      const answerKey = ordering.answerKey as { orderedItemIds: string[]; feedback: string };
      expect(answerKey.orderedItemIds).toHaveLength(config.items.length);
      expect(config.items.map((item) => item.id)).not.toEqual(answerKey.orderedItemIds);
    }

    const matching = createQuestionBlock('matching');
    expect(matching.config).toMatchObject({ questionType: 'matching', shuffleLeftItems: true, shuffleRightItems: true, gradingMode: 'all_or_nothing' });
    if (matching.questionType === 'matching') {
      const config = matching.config as Extract<typeof matching.config, { questionType: 'matching' }>;
      const answerKey = matching.answerKey as { pairs: Array<{ leftId: string; rightId: string }>; feedback: string };
      expect(new Set(answerKey.pairs.map((pair) => pair.leftId)).size).toBe(config.leftItems.length);
      expect(new Set(answerKey.pairs.map((pair) => pair.rightId)).size).toBe(config.rightItems.length);
      expect(config.rightItems.map((item) => item.id)).not.toEqual(answerKey.pairs.map((pair) => pair.rightId));
    }
  });

  test('creates an Image Labeling block with normalized private assignments', () => {
    const image = createQuestionBlock('image_labeling');
    const config = image.config as Extract<typeof image.config, { questionType: 'image_labeling' }>;
    expect(config).toMatchObject({ questionType: 'image_labeling', oneToOne: true, gradingMode: 'all_or_nothing' });
    expect(config.markers[0].x).toBeGreaterThanOrEqual(0);
    expect(config.markers[0].x).toBeLessThanOrEqual(1);
    expect(image.answerKey.assignments).toEqual([{ markerId: config.markers[0].id, labelId: config.labels[0].id }]);
    const slide = createSlide(0);
    image.answerKey.feedback = 'Private image key';
    slide.blocks = [image];
    const preview = JSON.stringify(publicPreviewSlides([slide]));
    expect(preview).not.toContain('assignments');
    expect(preview).not.toContain('Private image key');
  });

  test('adds, edits and removes content blocks while rejecting a second question', () => {
    const slide = createSlide(0);
    const heading = createContentBlock('heading');
    slide.blocks.push(heading);
    if (heading.type === 'heading') heading.config.text = 'Updated heading';
    expect(addQuestionBlock(slide, 'single_choice')).toBe(true);
    expect(addQuestionBlock(slide, 'open_answer')).toBe(false);
    slide.blocks = slide.blocks.filter((block) => block.id !== heading.id);
    expect(slide.blocks).toHaveLength(1);
    expect(slide.blocks[0].type).toBe('question');
  });

  test('duplicates slides with new IDs and remaps private key references', () => {
    const slide = reactive(createSlide(0));
    const question = createQuestionBlock('single_choice');
    slide.blocks.push(question);
    const copy = duplicateSlide(slide);
    const copiedQuestion = copy.blocks[0];
    expect(copy.id).not.toBe(slide.id);
    expect(copiedQuestion.id).not.toBe(question.id);
    expect(copiedQuestion.type).toBe('question');
    if (copiedQuestion.type === 'question' && copiedQuestion.questionType === 'single_choice') {
      const copiedOptions = (copiedQuestion.config as Extract<typeof copiedQuestion.config, { questionType: 'single_choice' }>).options;
      const originalOptions = (question.config as Extract<typeof question.config, { questionType: 'single_choice' }>).options;
      expect(copiedOptions.map((option) => option.id)).not.toEqual(originalOptions.map((option) => option.id));
      expect(copiedOptions.some((option) => option.id === copiedQuestion.answerKey.correctOptionId)).toBe(true);
    }
  });

  test('student preview never contains private answer keys', () => {
    const slide = createSlide(0);
    const question = createQuestionBlock('multiple_choice');
    question.answerKey.feedback = 'Private explanation';
    slide.blocks.push(question);
    const preview = publicPreviewSlides([slide]);
    expect(JSON.stringify(preview)).not.toContain('answerKey');
    expect(JSON.stringify(preview)).not.toContain('correctOptionIds');
    expect(JSON.stringify(preview)).not.toContain('Private explanation');
    const open = createQuestionBlock('open_answer');
    open.answerKey.acceptedAnswers = ['slepena atbilde'];
    slide.blocks = [open];
    expect(JSON.stringify(publicPreviewSlides([slide]))).not.toContain('slepena atbilde');

    const ordering = createQuestionBlock('ordering');
    ordering.answerKey.feedback = 'Private ordering feedback';
    slide.blocks = [ordering];
    const orderingPreview = JSON.stringify(publicPreviewSlides([slide]));
    expect(orderingPreview).not.toContain('orderedItemIds');
    expect(orderingPreview).not.toContain('Private ordering feedback');

    const matching = createQuestionBlock('matching');
    matching.answerKey.feedback = 'Private matching feedback';
    slide.blocks = [matching];
    const matchingPreview = JSON.stringify(publicPreviewSlides([slide]));
    expect(matchingPreview).not.toContain('"pairs"');
    expect(matchingPreview).not.toContain('Private matching feedback');
  });

  test('reports publish validation errors without mutating the draft', () => {
    const slide = createSlide(0);
    const question = createQuestionBlock('open_answer');
    question.config.prompt = '';
    slide.blocks.push(question);
    expect(validateEditorDraft([slide])).toContain('Slide 1 has a question without a prompt.');
    expect(slide.blocks).toHaveLength(1);
  });
});
