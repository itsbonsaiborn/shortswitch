import type { ActivityQuestionType, ActivitySlide } from '@/shared/activity-types';

export type AdminQuestionBlock = Extract<ActivitySlide['blocks'][number], { type: 'question' }> & { answerKey: any };
export type AdminBlock = Exclude<ActivitySlide['blocks'][number], { type: 'question' }> | AdminQuestionBlock;
export type AdminSlide = Omit<ActivitySlide, 'blocks'> & { blocks: AdminBlock[] };

export const editorId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;

export const createContentBlock = (type: 'heading' | 'text' | 'image' | 'divider'): AdminBlock => {
  const id = editorId('block');
  if (type === 'heading') return { id, type, config: { text: 'Section heading', level: 2 } };
  if (type === 'text') return { id, type, config: { text: 'Add supporting text.' } };
  if (type === 'image') return { id, type, config: { url: 'https://example.com/image.jpg', alt: 'Activity image', caption: '' } };
  return { id, type, config: { style: 'solid' } };
};

export const createQuestionBlock = (questionType: ActivityQuestionType, defaultPoints = 1): AdminQuestionBlock => {
  const id = editorId('question');
  const optionA = { id: editorId('option'), label: 'Option 1' };
  const optionB = { id: editorId('option'), label: 'Option 2' };
  const base = { id, type: 'question' as const, questionType, graded: true, points: Math.max(1, Math.round(defaultPoints)), required: true };
  if (questionType === 'single_choice') return { ...base, config: { questionType, prompt: 'Question', description: '', options: [optionA, optionB], shuffleOptions: false }, answerKey: { correctOptionId: optionA.id, feedback: '' } };
  if (questionType === 'multiple_choice') return { ...base, config: { questionType, prompt: 'Question', description: '', options: [optionA, optionB], minimumSelections: 1, maximumSelections: 2, shuffleOptions: false, gradingMode: 'all_or_nothing' }, answerKey: { correctOptionIds: [optionA.id], feedback: '' } };
  if (questionType === 'open_answer') return {
    ...base,
    config: {
      questionType, prompt: 'Question', instructions: '', responseMode: 'multiline',
      minimumLength: 1, maximumLength: 1000, gradingMode: 'normalized',
      ignoreCase: true, normalizeWhitespace: true
    },
    answerKey: { acceptedAnswers: ['Answer'], feedback: '' }
  };
  if (questionType === 'word_cloud') return {
    ...base,
    graded: false,
    points: 0,
    config: {
      questionType, prompt: 'Question', instructions: '', maximumLength: 100,
      allowMultipleResponses: false, maximumResponses: 1, moderationMode: 'off',
      showResults: false, showParticipantNames: false, gradingMode: 'ungraded'
    },
    answerKey: null
  };
  if (questionType === 'ordering') return { ...base, config: { questionType, prompt: 'Put the items in order', items: [optionB, optionA], shuffleItems: true, gradingMode: 'all_or_nothing' }, answerKey: { orderedItemIds: [optionA.id, optionB.id], feedback: '' } };
  if (questionType === 'matching') {
    const rightA = { id: editorId('match'), label: 'Match 1' };
    const rightB = { id: editorId('match'), label: 'Match 2' };
    return { ...base, config: { questionType, prompt: 'Match the items', leftItems: [optionA, optionB], rightItems: [rightB, rightA], shuffleLeftItems: true, shuffleRightItems: true, gradingMode: 'all_or_nothing' }, answerKey: { pairs: [{ leftId: optionA.id, rightId: rightA.id }, { leftId: optionB.id, rightId: rightB.id }], feedback: '' } };
  }
  const marker = { id: editorId('marker'), x: 0.5, y: 0.5, label: 'Marker 1' };
  return { ...base, config: { questionType, prompt: 'Label the image', imageUrl: 'https://example.com/image.jpg', imageAlt: 'Question image', markers: [marker], labels: [optionA], oneToOne: true, gradingMode: 'all_or_nothing' }, answerKey: { assignments: [{ markerId: marker.id, labelId: optionA.id }], feedback: '' } };
};

export const createSlide = (position = 0): AdminSlide => ({
  id: editorId('slide'), position, title: `Slide ${position + 1}`, description: '', blocks: []
});

export const normalizePositions = (slides: AdminSlide[]) => slides.map((slide, position) => ({ ...slide, position }));

export const moveById = <T extends { id: string }>(items: T[], id: string, targetIndex: number) => {
  const next = [...items];
  const source = next.findIndex((item) => item.id === id);
  if (source < 0) return next;
  const [item] = next.splice(source, 1);
  next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, item);
  return next;
};

const collectIds = (value: unknown, map: Map<string, string>) => {
  if (Array.isArray(value)) return value.forEach((item) => collectIds(item, map));
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'id' && typeof child === 'string') map.set(child, editorId(child.startsWith('slide') ? 'slide' : 'item'));
    else collectIds(child, map);
  }
};

const remapIds = (value: unknown, map: Map<string, string>): any => {
  if (typeof value === 'string') return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => remapIds(item, map));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, remapIds(child, map)]));
};

export const duplicateSlide = (slide: AdminSlide): AdminSlide => {
  const map = new Map<string, string>();
  collectIds(slide, map);
  // Slides passed from Vue components are reactive proxies. `structuredClone`
  // cannot clone proxies in browsers, while Activity drafts are deliberately
  // JSON-only data, so a JSON round-trip also gives us the plain object that
  // the ID remapper expects.
  const plainSlide = JSON.parse(JSON.stringify(slide)) as AdminSlide;
  return remapIds(plainSlide, map) as AdminSlide;
};

export const hasQuestionBlock = (slide: AdminSlide) => slide.blocks.some((block) => block.type === 'question');

export const addQuestionBlock = (slide: AdminSlide, type: ActivityQuestionType, defaultPoints = 1) => {
  if (hasQuestionBlock(slide)) return false;
  slide.blocks.push(createQuestionBlock(type, defaultPoints));
  return true;
};

export const publicPreviewSlides = (slides: AdminSlide[]): ActivitySlide[] => slides.map((slide) => ({
  ...slide,
  blocks: slide.blocks.map((block) => {
    if (block.type !== 'question') return JSON.parse(JSON.stringify(block));
    const { answerKey: _answerKey, ...publicBlock } = block;
    return JSON.parse(JSON.stringify(publicBlock));
  })
}));

export const validateEditorDraft = (slides: AdminSlide[]) => {
  const errors: string[] = [];
  if (!slides.length) errors.push('Add at least one slide.');
  for (const [index, slide] of slides.entries()) {
    if (slide.blocks.filter((block) => block.type === 'question').length > 1) errors.push(`Slide ${index + 1} contains more than one question.`);
    for (const block of slide.blocks) {
      if (block.type === 'question' && !block.config.prompt.trim()) errors.push(`Slide ${index + 1} has a question without a prompt.`);
      if (block.type === 'question' && block.graded && block.points < 1) errors.push(`Slide ${index + 1} has a graded question without points.`);
      if (block.type === 'question' && (block.config.questionType === 'single_choice' || block.config.questionType === 'multiple_choice')) {
        if (block.config.options.length < 2 || block.config.options.length > 50 || block.config.options.some((option) => !option.label.trim())) {
          errors.push(`Slide ${index + 1} has invalid choice options.`);
        }
        const optionIds = new Set(block.config.options.map((option) => option.id));
        if (block.config.questionType === 'single_choice' && block.graded && !optionIds.has(block.answerKey?.correctOptionId)) {
          errors.push(`Slide ${index + 1} needs one correct option.`);
        }
        if (block.config.questionType === 'multiple_choice') {
          const correctIds = block.answerKey?.correctOptionIds ?? [];
          if (block.graded && (!correctIds.length || correctIds.some((id: string) => !optionIds.has(id)))) {
            errors.push(`Slide ${index + 1} needs at least one valid correct option.`);
          }
          if (block.config.minimumSelections < 1 || block.config.minimumSelections > block.config.maximumSelections || block.config.maximumSelections > block.config.options.length || correctIds.length > block.config.maximumSelections) {
            errors.push(`Slide ${index + 1} has invalid multiple-choice selection limits.`);
          }
        }
      }
      if (block.type === 'question' && block.config.questionType === 'open_answer') {
        if (block.config.minimumLength < 0 || block.config.minimumLength > block.config.maximumLength) errors.push(`Slide ${index + 1} has invalid answer length limits.`);
        if ((block.config.gradingMode === 'exact' || block.config.gradingMode === 'normalized') && !(block.answerKey?.acceptedAnswers?.length)) {
          errors.push(`Slide ${index + 1} needs at least one accepted answer.`);
        }
      }
      if (block.type === 'question' && block.config.questionType === 'word_cloud') {
        if (!block.config.allowMultipleResponses && block.config.maximumResponses !== 1) errors.push(`Slide ${index + 1} has invalid Word Cloud response limits.`);
      }
      if (block.type === 'question' && block.config.questionType === 'ordering') {
        const itemIds = block.config.items.map((item) => item.id);
        if (itemIds.length < 2 || new Set(itemIds).size !== itemIds.length || block.answerKey?.orderedItemIds?.length !== itemIds.length || block.answerKey.orderedItemIds.some((id: string) => !itemIds.includes(id))) {
          errors.push(`Slide ${index + 1} has an invalid canonical order.`);
        }
      }
      if (block.type === 'question' && block.config.questionType === 'matching') {
        const leftIds = new Set(block.config.leftItems.map((item) => item.id));
        const rightIds = new Set(block.config.rightItems.map((item) => item.id));
        const pairs = block.answerKey?.pairs ?? [];
        if (leftIds.size !== rightIds.size || pairs.length !== leftIds.size || new Set(pairs.map((pair: any) => pair.leftId)).size !== pairs.length || new Set(pairs.map((pair: any) => pair.rightId)).size !== pairs.length || pairs.some((pair: any) => !leftIds.has(pair.leftId) || !rightIds.has(pair.rightId))) {
          errors.push(`Slide ${index + 1} has invalid matching pairs.`);
        }
      }
      if (block.type === 'question' && block.config.questionType === 'image_labeling') {
        const markerIds = new Set(block.config.markers.map((marker) => marker.id));
        const labelIds = new Set(block.config.labels.map((label) => label.id));
        const assignments = block.answerKey?.assignments ?? [];
        if (!block.config.imageUrl || !block.config.imageAlt.trim() || markerIds.size !== block.config.markers.length || labelIds.size !== block.config.labels.length || assignments.length !== markerIds.size || new Set(assignments.map((assignment: any) => assignment.markerId)).size !== assignments.length || (block.config.oneToOne && new Set(assignments.map((assignment: any) => assignment.labelId)).size !== assignments.length) || assignments.some((assignment: any) => !markerIds.has(assignment.markerId) || !labelIds.has(assignment.labelId))) {
          errors.push(`Slide ${index + 1} has invalid image marker assignments.`);
        }
      }
    }
  }
  return errors;
};
