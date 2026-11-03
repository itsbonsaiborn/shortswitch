// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import ActivityStudentPreview from './ActivityStudentPreview.vue';
import { createQuestionBlock, createSlide, publicPreviewSlides } from '../lib/activity-editor';

describe('ActivityStudentPreview', () => {
  test('renders responsive student content without private answer keys', () => {
    const slide = createSlide(0);
    slide.title = 'Network basics';
    slide.blocks.push(createQuestionBlock('single_choice'));
    const publicSlide = publicPreviewSlides([slide])[0];
    const wrapper = mount(ActivityStudentPreview, {
      props: { slide: publicSlide, activityTitle: 'Assessment', mode: 'mobile' }
    });

    expect(wrapper.classes()).toContain('max-w-[390px]');
    expect(wrapper.text()).toContain('Network basics');
    expect(wrapper.text()).toContain('Option 1');
    expect(wrapper.html()).not.toContain('answerKey');
    expect(wrapper.html()).not.toContain('correctOptionId');
  });

  test('switches to the desktop preview width without changing slide content', async () => {
    const slide = createSlide(0);
    const wrapper = mount(ActivityStudentPreview, {
      props: { slide, activityTitle: 'Assessment', mode: 'mobile' }
    });
    await wrapper.setProps({ mode: 'desktop' });
    expect(wrapper.classes()).toContain('max-w-[960px]');
    expect(wrapper.text()).toContain(slide.title);
  });

  test('uses the natural standalone width and supports dummy answer selection', async () => {
    const slide = createSlide(0);
    slide.blocks.push(createQuestionBlock('single_choice'));
    const publicSlide = publicPreviewSlides([slide])[0];
    const wrapper = mount(ActivityStudentPreview, {
      props: { slide: publicSlide, activityTitle: 'Assessment', mode: 'desktop', standalone: true }
    });

    expect(wrapper.classes()).toContain('max-w-none');
    const choices = wrapper.findAll('input[type="radio"]');
    expect(choices.length).toBeGreaterThan(1);
    await choices[1].setValue(true);
    expect((choices[1].element as HTMLInputElement).checked).toBe(true);
    expect(choices[1].element.closest('label')?.className).toContain('border-[var(--ui-accent)]');
  });

  test('applies the saved manual theme and background pattern', () => {
    const wrapper = mount(ActivityStudentPreview, {
      props: {
        slide: createSlide(0), activityTitle: 'Assessment', mode: 'desktop',
        theme: 'forest_dark', layout: 'soft', backgroundPattern: 'grid', patternIntensity: 60
      }
    });
    expect(wrapper.classes()).toEqual(expect.arrayContaining(['activity-theme-forest_dark', 'activity-layout-soft', 'activity-pattern-grid']));
    expect(wrapper.attributes('style')).toContain('--activity-pattern-opacity: 0.6');
  });
});
