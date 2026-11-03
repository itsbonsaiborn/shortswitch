// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import { i18n } from '../i18n';
import ActivityImageLabelingInput from './ActivityImageLabelingInput.vue';

const markers = [{ id: 'm1', x: 0.25, y: 0.5 }, { id: 'm2', x: 0.75, y: 0.5 }];
const labels = [{ id: 'l1', label: 'Left' }, { id: 'l2', label: 'Right' }];

describe('ActivityImageLabelingInput', () => {
  test('renders numbered markers without connector lines and fills the left column first', async () => {
    const wrapper = mount(ActivityImageLabelingInput, { props: { imageUrl: '/image.png', imageAlt: 'Diagram', markers, labels, assignments: [], oneToOne: true }, global: { plugins: [i18n] } });
    expect(wrapper.get('[data-image-marker="m1"]').attributes('style')).toContain('left: 25%');
    expect(wrapper.find('line').exists()).toBe(false);
    const columns = wrapper.findAll('.flex-col.justify-around');
    expect(columns[0].findAll('select')).toHaveLength(1);
    expect(columns[1].findAll('select')).toHaveLength(1);

    await columns[0].findAll('select')[0].setValue('l1');
    expect(wrapper.emitted('update:assignments')?.at(-1)?.[0]).toEqual([{ markerId: 'm1', labelId: 'l1' }]);
  });

  test('preserves assignments, supports clearing, and prevents duplicate one-to-one labels', async () => {
    const wrapper = mount(ActivityImageLabelingInput, { props: { imageUrl: '/image.png', imageAlt: 'Diagram', markers, labels, assignments: [{ markerId: 'm1', labelId: 'l1' }], oneToOne: true }, global: { plugins: [i18n] } });
    const selects = wrapper.findAll('select');
    expect((selects[0].element as HTMLSelectElement).value).toBe('l1');
    expect(selects[1].find('option[value="l1"]').attributes('disabled')).toBeDefined();
    await selects[0].setValue('');
    expect(wrapper.emitted('update:assignments')?.at(-1)?.[0]).toEqual([]);
  });

  test('balances larger marker sets between left and right columns', () => {
    const fourMarkers = [
      { id: 'm1', x: 0.1, y: 0.2 }, { id: 'm2', x: 0.3, y: 0.8 },
      { id: 'm3', x: 0.7, y: 0.3 }, { id: 'm4', x: 0.9, y: 0.7 }
    ];
    const fourLabels = fourMarkers.map((_marker, index) => ({ id: `l${index + 1}`, label: `Label ${index + 1}` }));
    const wrapper = mount(ActivityImageLabelingInput, { props: { imageUrl: '/image.png', imageAlt: 'Diagram', markers: fourMarkers, labels: fourLabels, assignments: [], oneToOne: true }, global: { plugins: [i18n] } });
    const columns = wrapper.findAll('.flex-col.justify-around');
    expect(columns[0].findAll('select')).toHaveLength(2);
    expect(columns[1].findAll('select')).toHaveLength(2);
    expect(columns[0].findAll('.rounded-full').map((item) => item.text())).toEqual(['1', '2']);
    expect(columns[1].findAll('.rounded-full').map((item) => item.text())).toEqual(['3', '4']);
  });
});
