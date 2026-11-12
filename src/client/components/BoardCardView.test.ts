// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import type { PublicBoardCard } from '@/shared/board-types';
import BoardCardView from './BoardCardView.vue';

const card: PublicBoardCard = {
  id: 'card', title: 'A very long title', body: 'longword'.repeat(40),
  imageUrl: 'https://images.example/missing.png', authorDisplayName: null,
  layout: 'image_text', moderationStatus: 'approved', publishedAt: null,
  createdAt: '', updatedAt: '', owned: false,
  position: { x: 0, y: 0, width: 280, height: 180, zIndex: 0, revision: 0, updatedAt: '' },
  reactions: { likes: 0, dislikes: 0, current: null }
};

describe('BoardCardView', () => {
  test('renders the image layout and replaces failed external images with an accessible fallback', async () => {
    const wrapper = mount(BoardCardView, { props: { card, imageFallbackLabel: 'Image unavailable' } });
    expect(wrapper.classes()).toContain('board-card-layout-image_text');
    expect(wrapper.find('img').attributes('loading')).toBe('lazy');
    expect(wrapper.find('.board-card-image').classes()).toContain('aspect-video');
    await wrapper.find('img').trigger('error');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).toContain('Image unavailable');
  });

  test('uses the compact layout without hiding the body text', () => {
    const wrapper = mount(BoardCardView, {
      props: { card: { ...card, imageUrl: null, layout: 'compact' }, imageFallbackLabel: 'Image unavailable' }
    });
    expect(wrapper.classes()).toContain('board-card-layout-compact');
    expect(wrapper.text()).toContain(card.body);
  });

  test('renders participant HTML as inert text instead of executable markup', () => {
    const wrapper = mount(BoardCardView, {
      props: {
        card: { ...card, imageUrl: null, title: '<img src=x onerror=alert(1)>', body: '<script>alert(1)</script>' },
        imageFallbackLabel: 'Image unavailable'
      }
    });
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).toContain('<script>alert(1)</script>');
  });
});
