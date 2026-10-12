// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import type { PageDetail } from '@/shared/types';
import PageRenderer from './PageRenderer.vue';

const page: PageDetail = {
  id: 'page-1', slug: 'datorika', publicUrl: 'https://example.com/datorika', title: 'Datorika',
  description: 'Useful links', emoji: '💻', avatarUrl: null, theme: 'soft_lavender', layout: 'bold', status: 'published',
  seoTitle: null, seoDescription: null, blockCount: 4, totalViews: 0, uniqueVisitors: 0, totalLinkClicks: 0,
  createdAt: '', updatedAt: '',
  blocks: [
    { id: 'text-1', type: 'text', config: { text: '<img src=x onerror=alert(1)>', alignment: 'left' }, position: 0, visible: true, createdAt: '', updatedAt: '' },
    { id: 'link-1', type: 'link', config: { title: 'Docs', url: 'https://example.com', openInNewTab: true }, position: 1, visible: true, createdAt: '', updatedAt: '' },
    { id: 'double-1', type: 'double', config: { children: [
      { id: 'nested-link', type: 'link', config: { title: 'Nested', url: 'https://nested.example.com' }, visible: true },
      { id: 'nested-email', type: 'email', config: { label: 'Email', email: 'hello@example.com', style: 'button' }, visible: true }
    ] }, position: 2, visible: true, createdAt: '', updatedAt: '' },
    { id: 'hidden-1', type: 'heading', config: { text: 'Hidden title' }, position: 3, visible: false, createdAt: '', updatedAt: '' }
  ]
};

describe('PageRenderer', () => {
  test('applies theme and layout while rendering user text safely', () => {
    const wrapper = mount(PageRenderer, { props: { page } });
    expect(wrapper.classes()).toContain('page-theme-soft_lavender');
    expect(wrapper.classes()).toContain('page-layout-bold');
    expect(wrapper.classes()).toContain('min-h-dvh');
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>');
    expect(wrapper.find('img[src="x"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Hidden title');
    const anchor = wrapper.get('a');
    expect(anchor.attributes('href')).toBe('https://example.com');
    expect(anchor.attributes('target')).toBe('_blank');
    expect(anchor.attributes('rel')).toBe('noopener noreferrer');
    expect(anchor.find('svg').exists()).toBe(true);
    expect(wrapper.findAll('[data-page-favicon]')).toHaveLength(2);
    expect(wrapper.find('[data-page-email-icon]').exists()).toBe(true);
    expect(wrapper.get('[data-page-double]').classes()).toContain('items-stretch');
    expect(wrapper.get('footer').text()).toBe('Powered by ShortSwitch');
    expect(wrapper.get('footer strong').text()).toBe('ShortSwitch');
    expect(wrapper.get('footer img').attributes('src')).toBe('/icons/favicon-32.png');
  });

  test('preview prevents navigation and public mode emits analytics click', async () => {
    const preview = mount(PageRenderer, { props: { page, preview: true } });
    await preview.get('a').trigger('click');
    expect(preview.emitted('blockClick')).toBeUndefined();

    const publicView = mount(PageRenderer, { props: { page } });
    await publicView.get('a').trigger('click');
    expect(publicView.emitted('blockClick')?.[0]?.[0]).toMatchObject({ id: 'link-1' });
  });
});
