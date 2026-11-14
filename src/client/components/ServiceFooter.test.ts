// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import ServiceFooter from './ServiceFooter.vue';

describe('ServiceFooter', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('keeps essential fallback links when public configuration cannot load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const wrapper = mount(ServiceFooter);
    await flushPromises();

    expect(wrapper.get('a[href="/service/security"]')).toBeTruthy();
    expect(wrapper.get('a[href="/service/privacy"]')).toBeTruthy();
    expect(wrapper.get('a[href="/service/contacts"]')).toBeTruthy();
    expect(wrapper.get('a[href="/service/report-abuse"]')).toBeTruthy();
  });

  test('renders the server-controlled footer link selection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ links: [{ type: 'about', label: 'About this service', href: '/service/about' }] })
    }));
    const wrapper = mount(ServiceFooter);
    await flushPromises();

    expect(wrapper.findAll('a')).toHaveLength(1);
    expect(wrapper.get('a').text()).toBe('About this service');
  });
});
