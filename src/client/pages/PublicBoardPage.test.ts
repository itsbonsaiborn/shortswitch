// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import { i18n } from '../i18n';
import PublicBoardPage from './PublicBoardPage.vue';

const routeState = vi.hoisted(() => ({ path: '/class-board' }));
const api = vi.fn(async (..._args: unknown[]) => ({
  id: 'board-1', slug: 'class-board', title: 'Class board', description: '', publicRevision: 1,
  expiresAt: null, theme: { id: 'theme', name: 'Theme', config: { surface: 'minimal_light' }, system: true },
  settings: {
    layout: 'grid', visualStyle: 'soft', backgroundPattern: 'dots', patternIntensity: 55,
    readOnly: false, locked: false, submissionsExpiresAt: null, requireParticipantName: false,
    moderationMode: 'auto_approve', maxCardsPerParticipant: 10, maxTitleLength: 160,
    maxBodyLength: 5000, allowImageUrls: true, participantCanEdit: true,
    participantCanDelete: true, requireCardTitle: true
  },
  cards: [
    { id: 'card-1', title: 'Long card', body: 'Text '.repeat(80), imageUrl: null, authorDisplayName: null,
      layout: 'text', moderationStatus: 'approved', publishedAt: '2026-01-01T00:00:00Z',
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', owned: false,
      position: { x: 999, y: 999, width: 900, height: 900, zIndex: 99, revision: 0, updatedAt: '2026-01-01T00:00:00Z' },
      reactions: { likes: 2, dislikes: 1, current: null } },
    { id: 'card-2', title: 'Image card', body: 'Body', imageUrl: 'https://images.example/card.png', authorDisplayName: 'Anna',
      layout: 'image_text', moderationStatus: 'approved', publishedAt: '2026-01-02T00:00:00Z',
      createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', owned: false,
      position: { x: 0, y: 0, width: 1200, height: 1600, zIndex: 1, revision: 0, updatedAt: '2026-01-02T00:00:00Z' },
      reactions: { likes: 0, dislikes: 0, current: null } }
  ]
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { slug: 'class-board' }, get path() { return routeState.path; } })
}));
vi.mock('../lib/api', () => ({ api: (...args: unknown[]) => api(...args) }));

describe('PublicBoardPage grid', () => {
  test('renders stable cards in a responsive native grid without legacy coordinates', async () => {
    const wrapper = mount(PublicBoardPage, { global: { plugins: [i18n] } });
    await flushPromises();
    expect(wrapper.find('.board-grid').exists()).toBe(true);
    expect(wrapper.find('main').classes()).toEqual(expect.arrayContaining(['activity-theme-minimal_light', 'activity-layout-soft', 'activity-pattern-dots']));
    expect(wrapper.findAll('.board-grid > article')).toHaveLength(2);
    expect(wrapper.findAll('.board-grid > article').map((item) => item.attributes('style'))).toEqual([undefined, undefined]);
    expect(wrapper.find('.board-card-image').classes()).toContain('aspect-video');
    expect(wrapper.findAll('.board-reaction')).toHaveLength(4);
    wrapper.unmount();
  });

  test('uses the dedicated presentation shell without participant mutations', async () => {
    routeState.path = '/boards/class-board/presentation';
    const wrapper = mount(PublicBoardPage, { global: { plugins: [i18n] } });
    await flushPromises();
    expect(wrapper.find('main').classes()).toContain('board-presentation');
    expect(wrapper.text()).toContain('Exit presentation');
    expect(wrapper.findAll('button.board-reaction')).toHaveLength(0);
    expect(wrapper.findAll('.board-reaction-count')).toHaveLength(4);
    wrapper.unmount();
    routeState.path = '/class-board';
  });

  test('keeps one card menu open and uses a protected centered card dialog', async () => {
    const wrapper = mount(PublicBoardPage, { global: { plugins: [i18n] }, attachTo: document.body });
    await flushPromises();

    const menuButtons = wrapper.findAll('.board-menu-button');
    expect(menuButtons).toHaveLength(2);
    await menuButtons[0]!.trigger('click');
    await flushPromises();
    expect(document.body.querySelectorAll('[data-board-card-menu][role="menu"]')).toHaveLength(1);
    await menuButtons[1]!.trigger('click');
    await flushPromises();
    expect(document.body.querySelectorAll('[data-board-card-menu][role="menu"]')).toHaveLength(1);

    (document.body.querySelector('.board-add-card') as HTMLButtonElement).click();
    await flushPromises();
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect([...dialog!.querySelectorAll('option')].map((option) => option.getAttribute('value')))
      .toEqual(['text', 'image_text']);

    document.body.querySelector<HTMLElement>('.board-dialog-overlay')!.click();
    await flushPromises();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    wrapper.unmount();
  });
});
