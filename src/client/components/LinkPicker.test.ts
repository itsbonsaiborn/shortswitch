// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import type { LinkRecord } from '@/shared/types';
import LinkPicker from './LinkPicker.vue';

const links: LinkRecord[] = [
  { id: 'link-1', slug: 'docs', shortUrl: 'https://sho.rt/docs', targetUrl: 'https://docs.example.com', comment: 'Documentation', passwordProtected: false, enabled: true, createdAt: '', expiresAt: null, clickCount: 0, uniqueClickCount: 0 },
  { id: 'link-2', slug: 'school', shortUrl: 'https://sho.rt/school', targetUrl: 'https://school.example.com', comment: null, passwordProtected: false, enabled: true, createdAt: '', expiresAt: null, clickCount: 0, uniqueClickCount: 0 }
];

describe('LinkPicker', () => {
  test('combines search and selection in one field', async () => {
    const wrapper = mount(LinkPicker, { props: { modelValue: '', links } });
    const input = wrapper.get('input');

    await input.trigger('focus');
    expect(wrapper.text()).toContain('/docs');
    expect(wrapper.text()).toContain('/school');

    await input.setValue('Documentation');
    expect(wrapper.text()).toContain('/docs');
    expect(wrapper.text()).not.toContain('/school');

    await wrapper.get('[role="option"]').trigger('mousedown');
    expect(wrapper.emitted('update:modelValue')).toEqual([['link-1']]);
  });
});
