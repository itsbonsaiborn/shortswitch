// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import { i18n } from '../i18n';
import ActivityOrderingInput from './ActivityOrderingInput.vue';

const items = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }];

describe('ActivityOrderingInput', () => {
  test('supports keyboard-accessible move controls', async () => {
    const wrapper = mount(ActivityOrderingInput, { props: { items, modelValue: ['a', 'b', 'c'] }, global: { plugins: [i18n] } });
    await wrapper.get('button[aria-label="Move B up"]').trigger('click');
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual(['b', 'a', 'c']);
  });

  test('starts reordering only from the handle and supports touch-style drops', async () => {
    const wrapper = mount(ActivityOrderingInput, { props: { items, modelValue: ['a', 'b', 'c'] }, global: { plugins: [i18n] } });
    const cards = wrapper.findAll<HTMLElement>('[data-order-id]');
    cards.forEach((card, index) => vi.spyOn(card.element, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: index * 64, top: index * 64, bottom: index * 64 + 56,
      left: 0, right: 320, width: 320, height: 56, toJSON: () => ({})
    }));
    const pointer = (type: string, values: Record<string, unknown>) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.entries(values).forEach(([key, value]) => Object.defineProperty(event, key, { value }));
      return event;
    };
    const handles = wrapper.findAll('[data-order-handle]');
    handles[2].element.dispatchEvent(pointer('pointerdown', { pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0, clientX: 20, clientY: 140 }));
    await wrapper.vm.$nextTick();
    document.dispatchEvent(pointer('pointermove', { pointerId: 7, clientX: 20, clientY: 4 }));
    document.dispatchEvent(pointer('pointerup', { pointerId: 7, clientX: 20, clientY: 4 }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual(['c', 'a', 'b']);
  });
});
