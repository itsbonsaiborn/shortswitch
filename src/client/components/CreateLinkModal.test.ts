// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import CreateLinkModal from './CreateLinkModal.vue';

describe('CreateLinkModal', () => {
  test('reveals advanced fields when toggled', async () => {
    const wrapper = mount(CreateLinkModal, {
      props: {
        open: true
      }
    });

    expect(wrapper.text()).toContain('Create a fast, tracked short link');
    expect(wrapper.get('.fixed').classes()).toContain('z-[80]');
    expect(wrapper.text()).not.toContain('Custom slug');

    await wrapper.get('button.text-sm').trigger('click');

    expect(wrapper.text()).toContain('domain.com/');
    expect(wrapper.text()).toContain('Password protection');
    wrapper.unmount();
  });

  test('closes only through an explicit action or Escape, not the backdrop', async () => {
    const wrapper = mount(CreateLinkModal, { props: { open: true } });

    await wrapper.get('.fixed').trigger('click');
    expect(wrapper.emitted('close')).toBeUndefined();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('close')).toHaveLength(1);

    await wrapper.get('button.btn-secondary').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(2);
    wrapper.unmount();
  });
});
