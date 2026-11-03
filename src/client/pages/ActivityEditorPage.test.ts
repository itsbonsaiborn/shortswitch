// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import { i18n } from '../i18n';
import ActivityEditorPage from './ActivityEditorPage.vue';

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: {}, path: '/app/activities/new' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  onBeforeRouteLeave: vi.fn()
}));

describe('ActivityEditorPage interactions', () => {
  test('supports keyboard slide reordering and exposes the standalone preview action', async () => {
    const wrapper = mount(ActivityEditorPage, { global: { plugins: [i18n] } });
    await Promise.resolve();

    expect(wrapper.text()).toContain('Create Activity');
    expect(wrapper.find('button[aria-label="Preview"]').exists()).toBe(true);
    const addSlide = wrapper.get('button[aria-label="Add slide"]');
    await addSlide.trigger('click');
    let slideCards = wrapper.findAll('[data-slide-id]');
    expect(slideCards).toHaveLength(2);
    const firstId = slideCards[0].attributes('data-slide-id');
    const secondId = slideCards[1].attributes('data-slide-id');

    await slideCards[1].trigger('keydown', { key: 'ArrowUp', altKey: true });
    slideCards = wrapper.findAll('[data-slide-id]');
    expect(slideCards.map((card) => card.attributes('data-slide-id'))).toEqual([secondId, firstId]);
    expect(wrapper.findAll('[data-activity-slide-drag-handle]')).toHaveLength(2);
    expect(wrapper.findAll('[data-slide-id] button[draggable="true"]')).toHaveLength(0);
    wrapper.unmount();
  });

  test('uses a full-card pointer drag ghost and placeholder for slides', async () => {
    const wrapper = mount(ActivityEditorPage, { global: { plugins: [i18n] } });
    await Promise.resolve();
    await wrapper.get('button[aria-label="Add slide"]').trigger('click');
    const handle = wrapper.findAll('[data-activity-slide-drag-handle]')[0].element;
    const pointerDown = new Event('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperties(pointerDown, {
      pointerId: { value: 7 }, pointerType: { value: 'mouse' }, button: { value: 0 },
      isPrimary: { value: true }, clientX: { value: 24 }, clientY: { value: 24 }
    });
    handle.dispatchEvent(pointerDown);
    await wrapper.vm.$nextTick();
    expect(document.body.querySelector('.activity-slide-ghost')).toBeTruthy();
    expect(wrapper.find('.activity-slide-placeholder').exists()).toBe(true);

    const pointerUp = new Event('pointerup', { bubbles: true });
    Object.defineProperties(pointerUp, { pointerId: { value: 7 }, clientX: { value: 24 }, clientY: { value: 24 } });
    document.dispatchEvent(pointerUp);
    await wrapper.vm.$nextTick();
    expect(document.body.querySelector('.activity-slide-ghost')).toBeNull();
    wrapper.unmount();
  });

  test('exposes accessible choice configuration controls with a bounded option editor', async () => {
    const wrapper = mount(ActivityEditorPage, { global: { plugins: [i18n] } });
    await Promise.resolve();
    await wrapper.get('[data-activity-add-block]').trigger('click');
    const singleChoice = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.includes('Single Choice'));
    expect(singleChoice).toBeTruthy();
    singleChoice!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(document.body.textContent).toContain('Question title');
    expect(document.body.textContent).toContain('Shuffle options for each attempt');
    expect(document.body.querySelectorAll('input[type="radio"]')).toHaveLength(2);
    expect(document.body.querySelector('button[aria-label="Move option down"]')).toBeTruthy();
    const addOption = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.includes('Add option'));
    addOption!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(document.body.querySelectorAll('input[type="radio"]')).toHaveLength(3);
    wrapper.unmount();
  });
});
