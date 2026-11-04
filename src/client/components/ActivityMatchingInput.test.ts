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
    await wrapper.get('[data-match-left="l1"]').trigger('click');
    expect(wrapper.emitted('update:pairs')?.at(-1)?.[0]).toEqual([]);
  });

  test('supports touch pairing and prevents duplicate right-side mappings', async () => {
    const wrapper = mount(ActivityMatchingInput, { props: { leftItems, rightItems, pairs: [{ leftId: 'l1', rightId: 'r1' }] }, global: { plugins: [i18n] } });
    await wrapper.findAll('button')[1].trigger('pointerdown', { pointerType: 'touch', pointerId: 5 });
    await wrapper.get('[data-match-right="r1"]').trigger('pointerup', { pointerType: 'touch', pointerId: 5 });
    expect(wrapper.emitted('update:pairs')?.at(-1)?.[0]).toEqual([{ leftId: 'l2', rightId: 'r1' }]);
  });

  test('connects from the right side to the left side', async () => {
    const wrapper = mount(ActivityMatchingInput, { props: { leftItems, rightItems, pairs: [] }, global: { plugins: [i18n] } });
    await wrapper.get('[data-match-right="r2"]').trigger('click');
    await wrapper.get('[data-match-left="l1"]').trigger('click');
    expect(wrapper.emitted('update:pairs')?.at(-1)?.[0]).toEqual([{ leftId: 'l1', rightId: 'r2' }]);
  });

  test('keeps stable numbered pairs and distinguishes the two mobile choice groups', async () => {
    const wrapper = mount(ActivityMatchingInput, { props: { leftItems, rightItems, pairs: [] }, global: { plugins: [i18n] } });

    expect(wrapper.text()).toContain('1Choose an item');
    expect(wrapper.text()).toContain('2Choose its match');
    expect(wrapper.get('[data-match-left="l2"] [data-match-index]').text()).toBe('2');
    expect(wrapper.get('[data-match-right="r1"] [data-match-index]').text()).toBe('A');
    await wrapper.setProps({ pairs: [{ leftId: 'l2', rightId: 'r1' }] });
    expect(wrapper.get('[data-match-right="r1"] [data-match-index]').text()).toBe('2');
    expect(wrapper.text()).not.toContain('Your matches');
    await wrapper.get('[data-match-right="r1"]').trigger('click');
    expect(wrapper.emitted('update:pairs')?.at(-1)?.[0]).toEqual([]);
  });

  test('uses a single-column mobile layout and wraps long labels without widening the question', () => {
    const longLeft = [{ id: 'long-left', label: 'An exceptionally long matching option that must stay inside the mobile viewport' }];
    const longRight = [{ id: 'long-right', label: 'Another exceptionally long option without forcing horizontal scrolling' }];
    const wrapper = mount(ActivityMatchingInput, { props: { leftItems: longLeft, rightItems: longRight, pairs: [] }, global: { plugins: [i18n] } });

    expect(wrapper.get('.grid').classes()).toEqual(expect.arrayContaining(['grid-cols-1', 'sm:grid-cols-2', 'min-w-0']));
    expect(wrapper.get('[data-match-left="long-left"] span:last-child').classes()).toEqual(expect.arrayContaining(['break-words', '[overflow-wrap:anywhere]']));
    expect(wrapper.get('[data-match-right="long-right"]').classes()).toEqual(expect.arrayContaining(['min-w-0', 'max-w-full']));
  });
});
