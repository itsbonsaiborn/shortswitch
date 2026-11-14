// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import type { ServiceContactConfig } from '@/shared/types';
import ServiceContactsRenderer from './ServiceContactsRenderer.vue';

const config: ServiceContactConfig = { blocks: [
  { id: 'heading', type: 'heading', titleEn: 'Contact us', titleLv: 'Sazinies ar mums' },
  { id: 'text', type: 'text', bodyEn: '<script>not executable</script>', bodyLv: 'Drošs teksts' },
  { id: 'email', type: 'contact_email', titleEn: 'Email', titleLv: 'E-pasts', email: 'teacher@example.test' },
  { id: 'social', type: 'social_card', titleEn: 'Community', titleLv: 'Kopiena', descriptionEn: 'Open site', descriptionLv: 'Atvērt vietni', icon: 'website', url: 'https://example.test/community' },
  { id: 'form', type: 'contact_form', titleEn: 'Contact form', titleLv: 'Saziņas forma', descriptionEn: 'Coming later', descriptionLv: 'Būs vēlāk' }
] };

const mountRenderer = (locale: 'en' | 'lv') => mount(ServiceContactsRenderer, {
  props: { config, locale }
});

describe('ServiceContactsRenderer', () => {
  test('renders localized safe blocks without executing administrator text', () => {
    const wrapper = mountRenderer('en');
    expect(wrapper.text()).toContain('Contact us');
    expect(wrapper.text()).toContain('<script>not executable</script>');
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.get('a[href="mailto:teacher@example.test"]')).toBeTruthy();
    expect(wrapper.get('a[href="https://example.test/community"]')).toBeTruthy();
    expect(wrapper.get('img[data-page-favicon]').attributes('src')).toBe('https://example.test/favicon.ico');
    expect(wrapper.get('img[data-page-favicon]').attributes('referrerpolicy')).toBe('no-referrer');
    expect(wrapper.get('[data-contact-form-component]')).toBeTruthy();
  });

  test('switches block copy to Latvian and refuses unsafe draft URLs', async () => {
    const unsafe: ServiceContactConfig = { blocks: config.blocks.map((block) => block.type === 'social_card' ? { ...block, url: 'javascript:alert(1)' } : block) };
    const wrapper = mount(ServiceContactsRenderer, {
      props: { config: unsafe, locale: 'lv' }
    });
    expect(wrapper.text()).toContain('Sazinies ar mums');
    expect(wrapper.find('a[href^="javascript:"]').exists()).toBe(false);
  });
});
