// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import LiveActivityPicker from './LiveActivityPicker.vue';

const activities = [
  { id: 'activity-1', title: 'Class reflection', slug: 'reflection' },
  { id: 'activity-2', title: 'Network quiz', slug: 'networks' }
] as never[];

describe('LiveActivityPicker', () => {
  test('shows every activity before search and selects a filtered result', async () => {
    const wrapper = mount(LiveActivityPicker, {
      props: { modelValue: '', activities }
    });

    const input = wrapper.get('input');
    await input.trigger('focus');
    expect(wrapper.text()).toContain('Class reflection');
    expect(wrapper.text()).toContain('Network quiz');

    await input.setValue('network');
    expect(wrapper.text()).not.toContain('Class reflection');
    expect(wrapper.text()).toContain('Network quiz');

    await wrapper.get('[role="option"]').trigger('mousedown');
    expect(wrapper.emitted('update:modelValue')).toEqual([['activity-2']]);
  });
});
