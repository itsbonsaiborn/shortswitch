// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import { i18n } from '../i18n';
import ActivityMatchingInput from './ActivityMatchingInput.vue';

const leftItems = [{ id: 'l1', label: 'Left 1' }, { id: 'l2', label: 'Left 2' }];
const rightItems = [{ id: 'r1', label: 'Right 1' }, { id: 'r2', label: 'Right 2' }];

describe('ActivityMatchingInput', () => {
  test('connects with click/keyboard controls and removes a connection', async () => {
    const wrapper = mount(ActivityMatchingInput, { props: { leftItems, rightItems, pairs: [] }, global: { plugins: [i18n] } });
    await wrapper.findAll('button')[0].trigger('click');
    await wrapper.get('button[aria-label="Connect to Right 2"]').trigger('click');
    const pairs = wrapper.emitted('update:pairs')?.at(-1)?.[0];
    expect(pairs).toEqual([{ leftId: 'l1', rightId: 'r2' }]);
    await wrapper.setProps({ pairs });
    await wrapper.get('button[aria-label="Remove connection for Left 1"]').trigger('click');
    expect(wrapper.emitted('update:pairs')?.at(-1)?.[0]).toEqual([]);
  });

  test('supports touch pairing and prevents duplicate right-side mappings', async () => {
    const wrapper = mount(ActivityMatchingInput, { props: { leftItems, rightItems, pairs: [{ leftId: 'l1', rightId: 'r1' }] }, global: { plugins: [i18n] } });
    await wrapper.findAll('button')[1].trigger('pointerdown', { pointerType: 'touch', pointerId: 5 });
    await wrapper.get('button[aria-label="Connect to Right 1"]').trigger('pointerup', { pointerType: 'touch', pointerId: 5 });
    expect(wrapper.emitted('update:pairs')?.at(-1)?.[0]).toEqual([{ leftId: 'l2', rightId: 'r1' }]);
  });

  test('connects from the right side to the left side', async () => {
    const wrapper = mount(ActivityMatchingInput, { props: { leftItems, rightItems, pairs: [] }, global: { plugins: [i18n] } });
    await wrapper.get('[data-match-right="r2"]').trigger('click');
    await wrapper.get('[data-match-left="l1"]').trigger('click');
    expect(wrapper.emitted('update:pairs')?.at(-1)?.[0]).toEqual([{ leftId: 'l1', rightId: 'r2' }]);
  });
});
