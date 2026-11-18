// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { i18n } from '../i18n';
import BoardEditorPage from './BoardEditorPage.vue';

const api = vi.fn<(...args: unknown[]) => Promise<unknown>>(async (..._args: unknown[]) => []);
const replace = vi.fn();
const push = vi.fn();
const pushToast = vi.fn();
const routeParams: { id?: string } = {};

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: routeParams }),
  useRouter: () => ({ replace, push })
}));
vi.mock('../lib/api', () => ({ api: (...args: unknown[]) => api(...args) }));
vi.mock('../composables/useToast', () => ({ useToast: () => ({ pushToast }) }));

const settings = {
  themeId: 'board_theme_minimal_light',
  layout: 'grid',
  visualStyle: 'classic',
  backgroundPattern: 'none',
  patternIntensity: 35,
  reactionMode: 'both',
  readOnly: false,
  locked: false,
  submissionsExpiresAt: null,
  requireParticipantName: false,
  moderationMode: 'review_all',
  maxCardsTotal: 500,
  maxCardsPerParticipant: 10,
  maxTitleLength: 160,
  maxBodyLength: 5000,
  allowImageUrls: true,
  blurImagesByDefault: false,
  participantCanEdit: true,
  participantCanDelete: true,
  requireCardTitle: true
} as const;

const board = {
  id: 'board-1', slug: 'class', publicUrl: '/class', title: 'Class board', description: '', status: 'published',
  publicRevision: 1, publishedAt: '2026-11-18T08:00:00.000Z', archivedAt: null, expiresAt: null,
  cardCount: 1, pendingCardCount: 1, presentationUrl: '/boards/class/presentation',
  createdAt: '2026-11-18T08:00:00.000Z', updatedAt: '2026-11-18T08:00:00.000Z', settings
};

const card = (id: string, title: string) => ({
  id, boardId: 'board-1', participantId: null, authorDisplayName: 'Student', title, body: 'Answer', imageUrl: null, imageBlurred: false,
  layout: 'text', moderationStatus: 'pending', moderationReason: null, hidden: false, publishedAt: null,
  createdAt: '2026-11-18T08:00:00.000Z', updatedAt: '2026-11-18T08:00:00.000Z',
  position: { x: 0, y: 0, width: 1, height: 1, zIndex: 0, revision: 0, updatedAt: '2026-11-18T08:00:00.000Z' }
});

beforeEach(() => {
  delete routeParams.id;
  api.mockReset();
  api.mockResolvedValue([]);
  replace.mockReset();
  push.mockReset();
  pushToast.mockReset();
});

describe('BoardEditorPage reaction settings', () => {
  test('shows the effective disabled mode in read-only mode and restores the configured mode', async () => {
    i18n.global.locale.value = 'en';
    const wrapper = mount(BoardEditorPage, { global: { plugins: [i18n] } });
    await flushPromises();

    const reactionLabel = wrapper.findAll('label').find((label) => label.text().includes('Reactions'))!;
    const reactionSelect = reactionLabel.find('select');
    expect(reactionSelect.findAll('option').map((option) => option.text())).toEqual([
      'Likes and dislikes', 'Likes only', 'Dislikes only', 'Disabled'
    ]);
    await reactionSelect.setValue('likes_only');

    const readOnlyLabel = wrapper.findAll('label').find((label) => label.text().includes('Read-only presentation mode'))!;
    await readOnlyLabel.find('input[type="checkbox"]').setValue(true);
    expect(reactionSelect.attributes('disabled')).toBeDefined();
    expect((reactionSelect.element as HTMLSelectElement).value).toBe('disabled');
    expect(reactionLabel.text()).toContain('Your selected mode will be restored');

    await readOnlyLabel.find('input[type="checkbox"]').setValue(false);
    expect(reactionSelect.attributes('disabled')).toBeUndefined();
    expect((reactionSelect.element as HTMLSelectElement).value).toBe('likes_only');
    wrapper.unmount();
  });
});

describe('BoardEditorPage card moderation refresh', () => {
  test('lets an administrator change a persisted image blur state', async () => {
    i18n.global.locale.value = 'en';
    routeParams.id = 'board-1';
    const blurredCard = { ...card('image', 'Image card'), imageUrl: 'https://images.example/card.png', imageBlurred: true, layout: 'image_text' };
    let cardRequests = 0;
    let blurRequests = 0;
    let resolveBlur: ((value: unknown) => void) | undefined;
    api.mockImplementation(async (url: unknown) => {
      if (url === '/api/boards/themes') return [];
      if (url === '/api/boards/board-1') return board;
      if (url === '/api/boards/board-1/cards') {
        cardRequests += 1;
        return [blurredCard];
      }
      if (url === '/api/boards/board-1/cards/image/image-blur') {
        blurRequests += 1;
        return await new Promise((resolve) => { resolveBlur = resolve; });
      }
      throw new Error(`Unexpected request: ${String(url)}`);
    });

    const wrapper = mount(BoardEditorPage, { global: { plugins: [i18n] } });
    await flushPromises();
    await wrapper.findAll('button').find((button) => button.text() === 'Cards and moderation')!.trigger('click');
    const preview = wrapper.find('[data-admin-image-preview="true"]');
    expect(preview.attributes('src')).toBe('https://images.example/card.png');
    expect(preview.classes().some((name) => name.includes('blur'))).toBe(false);
    const statusPills = wrapper.findAll('[data-moderation-status], [data-image-visibility-status]');
    expect(statusPills.find((pill) => pill.text() === 'Pending')?.classes()).toContain('bg-amber-100');
    expect(statusPills.find((pill) => pill.text() === 'Blurred')?.classes()).toContain('bg-blue-100');
    expect(wrapper.findAll('button').some((button) => button.attributes('aria-label') === 'Approve')).toBe(true);
    expect(wrapper.findAll('button').some((button) => button.attributes('aria-label') === 'Reject')).toBe(true);

    const unblur = wrapper.findAll('button').find((button) => button.attributes('aria-label') === 'Unblur')!;
    await unblur.trigger('click');
    await unblur.trigger('click');
    expect(unblur.attributes('disabled')).toBeDefined();
    expect(unblur.attributes('aria-label')).toBe('Updating…');
    expect(blurRequests).toBe(1);

    resolveBlur?.({ ...blurredCard, imageBlurred: false });
    await flushPromises();

    expect(api).toHaveBeenCalledWith('/api/boards/board-1/cards/image/image-blur', {
      method: 'POST', body: JSON.stringify({ blurred: false })
    });
    expect(cardRequests).toBe(1);
    expect(wrapper.text()).toContain('Visible');
    expect(wrapper.findAll('button').some((button) => button.attributes('aria-label') === 'Blur')).toBe(true);
    wrapper.unmount();
  });

  test('preserves the persisted blur state and shows an error when the update fails', async () => {
    i18n.global.locale.value = 'en';
    routeParams.id = 'board-1';
    const blurredCard = { ...card('image', 'Image card'), imageUrl: 'https://images.example/card.png', imageBlurred: true, layout: 'image_text' };
    api.mockImplementation(async (url: unknown) => {
      if (url === '/api/boards/themes') return [];
      if (url === '/api/boards/board-1') return board;
      if (url === '/api/boards/board-1/cards') return [blurredCard];
      if (url === '/api/boards/board-1/cards/image/image-blur') throw new Error('Update unavailable');
      throw new Error(`Unexpected request: ${String(url)}`);
    });

    const wrapper = mount(BoardEditorPage, { global: { plugins: [i18n] } });
    await flushPromises();
    await wrapper.findAll('button').find((button) => button.text() === 'Cards and moderation')!.trigger('click');
    await wrapper.findAll('button').find((button) => button.attributes('aria-label') === 'Unblur')!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Blurred');
    expect(wrapper.findAll('button').some((button) => button.attributes('aria-label') === 'Unblur')).toBe(true);
    expect(pushToast).toHaveBeenCalledWith({
      tone: 'error',
      title: 'Could not update image visibility',
      description: 'Update unavailable'
    });

    await wrapper.find('[data-admin-image-preview="true"]').trigger('error');
    expect(wrapper.text()).toContain('Image unavailable');
    wrapper.unmount();
  });

  test('refreshes cards in place, shows progress and ignores a duplicate request', async () => {
    i18n.global.locale.value = 'en';
    routeParams.id = 'board-1';
    let cardRequests = 0;
    let resolveRefresh: ((value: unknown) => void) | undefined;
    api.mockImplementation(async (url: unknown) => {
      if (url === '/api/boards/themes') return [];
      if (url === '/api/boards/board-1') return board;
      if (url === '/api/boards/board-1/cards') {
        cardRequests += 1;
        if (cardRequests === 1) return [card('old', 'Older card')];
        return await new Promise((resolve) => { resolveRefresh = resolve; });
      }
      throw new Error(`Unexpected request: ${String(url)}`);
    });

    const wrapper = mount(BoardEditorPage, { global: { plugins: [i18n] } });
    await flushPromises();
    await wrapper.findAll('button').find((button) => button.text() === 'Cards and moderation')!.trigger('click');

    expect(wrapper.find('form').classes()).toContain('max-w-none');
    expect(wrapper.find('.board-moderation-grid').exists()).toBe(true);
    const refresh = wrapper.findAll('button').find((button) => button.text() === 'Refresh')!;
    await refresh.trigger('click');
    await refresh.trigger('click');

    expect(cardRequests).toBe(2);
    expect(refresh.attributes('disabled')).toBeDefined();
    expect(refresh.text()).toBe('Refreshing cards…');
    expect(wrapper.text()).toContain('Older card');

    resolveRefresh?.([card('new', 'Latest card')]);
    await flushPromises();
    expect(wrapper.text()).toContain('Latest card');
    expect(wrapper.text()).not.toContain('Older card');
    expect(refresh.attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });

  test('keeps the current cards and reports a non-disruptive error when refresh fails', async () => {
    i18n.global.locale.value = 'en';
    routeParams.id = 'board-1';
    let cardRequests = 0;
    api.mockImplementation(async (url: unknown) => {
      if (url === '/api/boards/themes') return [];
      if (url === '/api/boards/board-1') return board;
      if (url === '/api/boards/board-1/cards') {
        cardRequests += 1;
        if (cardRequests === 1) return [card('kept', 'Keep this card')];
        throw new Error('Network unavailable');
      }
      throw new Error(`Unexpected request: ${String(url)}`);
    });

    const wrapper = mount(BoardEditorPage, { global: { plugins: [i18n] } });
    await flushPromises();
    await wrapper.findAll('button').find((button) => button.text() === 'Cards and moderation')!.trigger('click');
    await wrapper.findAll('button').find((button) => button.text() === 'Refresh')!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Keep this card');
    expect(pushToast).toHaveBeenCalledWith({
      tone: 'error',
      title: 'Could not refresh cards',
      description: 'Network unavailable'
    });
    wrapper.unmount();
  });
});
