// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import { i18n } from '../i18n';
import { useToast } from '../composables/useToast';
import PublicBoardPage from './PublicBoardPage.vue';

const routeState = vi.hoisted(() => ({ path: '/class-board' }));
const MockApiError = vi.hoisted(() => class extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
});
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
vi.mock('../lib/api', () => ({ ApiError: MockApiError, api: (...args: unknown[]) => api(...args) }));

describe('PublicBoardPage grid', () => {
  test('packs different card heights on desktop without legacy position coordinates', async () => {
    const wrapper = mount(PublicBoardPage, { global: { plugins: [i18n] } });
    await flushPromises();
    expect(wrapper.find('.board-grid').exists()).toBe(true);
    expect(wrapper.find('main').classes()).toContain('overflow-x-clip');
    expect(wrapper.find('main > div').classes()).toEqual(expect.arrayContaining(['min-w-0', 'max-w-[120rem]']));
    expect(wrapper.find('.board-grid').classes()).toEqual(expect.arrayContaining(['min-w-0', 'w-full']));
    expect(wrapper.find('main').classes()).toEqual(expect.arrayContaining(['activity-theme-minimal_light', 'activity-layout-soft', 'activity-pattern-dots']));
    const cards = wrapper.findAll('.board-grid > article');
    expect(cards).toHaveLength(2);
    cards[0]!.element.getBoundingClientRect = () => ({ height: 480 } as DOMRect);
    cards[1]!.element.getBoundingClientRect = () => ({ height: 120 } as DOMRect);
    window.dispatchEvent(new Event('resize'));
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    expect(wrapper.find('.board-grid').classes()).toContain('board-grid-masonry');
    expect(cards.map((item) => item.attributes('style'))).toEqual(['grid-row-end: span 21;', 'grid-row-end: span 6;']);
    expect(cards.map((item) => item.attributes('style')).join('')).not.toMatch(/(?:left|top|position|width):/);
    wrapper.vm.$forceUpdate();
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.board-grid').classes()).toContain('board-grid-masonry');
    expect(cards.map((item) => item.attributes('style'))).toEqual(['grid-row-end: span 21;', 'grid-row-end: span 6;']);
    expect(wrapper.find('.board-card-image').classes()).toContain('aspect-video');
    expect(wrapper.findAll('.board-reaction')).toHaveLength(4);

    const desktopWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 600 });
    window.dispatchEvent(new Event('resize'));
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    expect(wrapper.find('.board-grid').classes()).not.toContain('board-grid-masonry');
    expect(cards.every((item) => !item.attributes('style'))).toBe(true);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: desktopWidth });
    wrapper.unmount();
  });

  test('enables masonry after an SSE snapshot wins the initial HTTP loading race', async () => {
    const snapshot = await api();
    let resolveLoad: (() => void) | undefined;
    api.mockImplementationOnce(() => new Promise((resolve) => {
      resolveLoad = () => resolve(snapshot);
    }));
    const listeners = new Map<string, EventListener>();
    class FakeEventSource {
      onerror: ((event: Event) => void) | null = null;
      constructor(_url: string, _options?: EventSourceInit) {}
      addEventListener(type: string, listener: EventListener) { listeners.set(type, listener); }
      close() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);

    const wrapper = mount(PublicBoardPage, { global: { plugins: [i18n] } });
    listeners.get('snapshot')?.(new MessageEvent('snapshot', { data: JSON.stringify(snapshot) }));
    await flushPromises();
    expect(wrapper.find('.board-grid').exists()).toBe(false);

    resolveLoad?.();
    await flushPromises();
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.board-grid').classes()).toContain('board-grid-masonry');

    wrapper.unmount();
    vi.unstubAllGlobals();
  });

  test('uses the dedicated presentation shell without participant mutations', async () => {
    routeState.path = '/boards/class-board/presentation';
    const wrapper = mount(PublicBoardPage, { global: { plugins: [i18n] } });
    await flushPromises();
    expect(wrapper.find('main').classes()).toContain('board-presentation');
    expect(wrapper.find('main > div').classes()).toContain('max-w-[120rem]');
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
    const titleInput = dialog!.querySelector<HTMLInputElement>('input[type="text"]')!;
    const bodyInput = dialog!.querySelector<HTMLElement>('[contenteditable="true"]')!;
    const saveButton = dialog!.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(titleInput.required).toBe(true);
    expect(bodyInput.getAttribute('aria-required')).toBe('true');
    expect(saveButton.disabled).toBe(true);
    expect(dialog!.textContent).toContain('Complete the required fields marked with *');

    titleInput.value = 'Complete card';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    bodyInput.textContent = 'Card body';
    bodyInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    expect(saveButton.disabled).toBe(false);

    document.body.querySelector<HTMLElement>('.board-dialog-overlay')!.click();
    await flushPromises();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    wrapper.unmount();
  });

  test('shows a localized toast when the participant card limit is reached', async () => {
    i18n.global.locale.value = 'en';
    const wrapper = mount(PublicBoardPage, { global: { plugins: [i18n] }, attachTo: document.body });
    await flushPromises();
    (document.body.querySelector('.board-add-card') as HTMLButtonElement).click();
    await flushPromises();
    const dialog = document.body.querySelector<HTMLElement>('.board-dialog')!;
    const titleInput = dialog.querySelector<HTMLInputElement>('input[type="text"]')!;
    const bodyInput = dialog.querySelector<HTMLElement>('[contenteditable="true"]')!;
    titleInput.value = 'Card at the limit';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    bodyInput.textContent = 'Card body';
    bodyInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    api.mockRejectedValueOnce(new MockApiError('Participant card limit reached.', 400));
    document.body.querySelector<HTMLFormElement>('.board-dialog form')!.requestSubmit();
    await flushPromises();

    const { toasts, removeToast } = useToast();
    const toast = toasts.items.at(-1);
    expect(toast).toMatchObject({
      title: 'You have reached the maximum number of cards allowed on this Board.',
      tone: 'error'
    });
    if (toast) removeToast(toast.id);
    wrapper.unmount();
  });
});
