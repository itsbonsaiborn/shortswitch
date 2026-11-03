import { describe, expect, test } from 'vitest';
import { activitySettingsInputSchema, parseActivityDraftInput } from './activity-domain.js';

describe('Activity settings and external image invariants', () => {
  test('defaults grading on with one point and accepts an explicit disabled policy', () => {
    const defaults = activitySettingsInputSchema.parse({ title: 'Assessment' });
    expect(defaults).toMatchObject({
      gradingEnabled: true,
      defaultQuestionPoints: 1,
      theme: 'minimal_light',
      layout: 'classic',
      backgroundPattern: 'none',
      patternIntensity: 35,
      shuffleSlides: false,
      allowBackNavigation: true
    });
    const disabled = activitySettingsInputSchema.parse({ title: 'Survey', gradingEnabled: false, defaultQuestionPoints: 4 });
    expect(disabled).toMatchObject({ gradingEnabled: false, defaultQuestionPoints: 4 });
    expect(() => activitySettingsInputSchema.parse({ title: 'Invalid', defaultQuestionPoints: 0 })).toThrow();
    expect(() => activitySettingsInputSchema.parse({ title: 'Invalid pattern', backgroundPattern: 'noise' })).toThrow();
    expect(() => activitySettingsInputSchema.parse({ title: 'Invalid intensity', patternIntensity: 101 })).toThrow();
  });

  test('accepts only external HTTPS image references', () => {
    const base = {
      expectedRevision: 0,
      slides: [{
        title: 'Image',
        blocks: [{ id: 'image_block', type: 'image', config: { url: 'https://example.com/image.png', alt: 'Diagram', caption: '' } }]
      }]
    };
    expect(parseActivityDraftInput(base).slides[0].blocks[0]).toMatchObject({ type: 'image' });
    expect(() => parseActivityDraftInput({
      ...base,
      slides: [{ title: 'Image', blocks: [{ id: 'image_block', type: 'image', config: { url: '/api/activities/media/old', alt: 'Diagram', caption: '' } }] }]
    })).toThrow();
  });
});
