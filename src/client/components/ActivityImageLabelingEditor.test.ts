// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import { i18n } from '../i18n';
import type { ActivityQuestionPublicConfig } from '@/shared/activity-types';
import ActivityImageLabelingEditor from './ActivityImageLabelingEditor.vue';

describe('ActivityImageLabelingEditor', () => {
  test('creates and moves markers using normalized image coordinates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }));
    const config: Extract<ActivityQuestionPublicConfig, { questionType: 'image_labeling' }> = { questionType: 'image_labeling', prompt: 'Label', imageUrl: 'https://example.com/a.png', imageAlt: 'Diagram', markers: [], labels: [], oneToOne: true, gradingMode: 'partial' };
    const answerKey = { assignments: [] as Array<{ markerId: string; labelId: string }>, feedback: '' };
    const wrapper = mount(ActivityImageLabelingEditor, { props: { config, answerKey }, global: { plugins: [i18n] } });
    const image = wrapper.get('img').element as HTMLImageElement;
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 200, height: 100, right: 210, bottom: 120, x: 10, y: 20, toJSON: () => ({}) });
    await wrapper.get('[data-marker-surface]').trigger('click', { clientX: 110, clientY: 45 });
    expect(config.markers[0]).toMatchObject({ x: 0.5, y: 0.25 });
    expect(config.labels).toHaveLength(1);
    expect(answerKey.assignments).toEqual([{ markerId: config.markers[0].id, labelId: config.labels[0].id }]);
    expect(wrapper.text()).not.toContain(config.markers[0].id);
    expect(wrapper.text()).not.toContain(config.labels[0].id);
    expect(wrapper.findAll('select')).toHaveLength(1);
    const marker = wrapper.get('button[aria-label="Move marker 1"]');
    await marker.trigger('pointerdown', { pointerId: 4, pointerType: 'touch' });
    wrapper.get('[data-marker-surface]').element.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 210, clientY: 120 }));
    await wrapper.vm.$nextTick();
    expect(config.markers[0]).toMatchObject({ x: 1, y: 1 });
    wrapper.unmount();
    vi.unstubAllGlobals();
  });
});
