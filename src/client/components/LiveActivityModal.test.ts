// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import LiveActivityModal from './LiveActivityModal.vue';

describe('LiveActivityModal', () => {
  test('closes only through an explicit action or Escape, not the backdrop', async () => {
    const wrapper = mount(LiveActivityModal, { props: { open: true } });

    await wrapper.get('.fixed').trigger('click');
    expect(wrapper.emitted('close')).toBeUndefined();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('close')).toHaveLength(1);

    await wrapper.get('button.btn-secondary').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(2);
    wrapper.unmount();
  });
});
