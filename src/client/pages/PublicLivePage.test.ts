// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import PublicLivePage from './PublicLivePage.vue';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock('vue-router', () => ({ useRoute: () => ({ params: { slug: 'choice-test' } }) }));
vi.mock('../lib/api', () => ({ api: mocks.api }));
vi.mock('../composables/useTheme', () => ({ useTheme: () => ({}) }));

describe('PublicLivePage', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear()
    });
    vi.stubGlobal('crypto', { randomUUID: () => 'participant_token_client_01' });
    mocks.api.mockResolvedValue({
      id: 'activity-1',
      slug: 'choice-test',
      publicUrl: 'http://localhost:3000/choice-test',
      title: 'Choice test',
      question: 'Choose one',
      type: 'multiple_choice',
      status: 'active',
      identityMode: 'anonymous',
      allowMultipleResponses: false,
      maxResponsesPerParticipant: 1,
      maxAnswerLength: 280,
      allowMultipleChoices: false,
      options: [{ id: 'option-1', label: 'One' }, { id: 'option-2', label: 'Two' }],
      scaleMin: null,
      scaleMax: null,
      publicResults: false,
      participantResponseCount: 0,
      results: null
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  test('does not send an empty multiple-choice response to the server', async () => {
    const wrapper = mount(PublicLivePage, {
      global: { stubs: { LiveResultsBoard: true } }
    });
    await flushPromises();

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('Choose at least one answer.');
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(mocks.api).toHaveBeenCalledWith('/api/live/public/choice-test?deferResults=1', expect.any(Object));
  });

  test('wraps a ten-point scale into mobile-friendly option rows', async () => {
    mocks.api.mockResolvedValueOnce({
      id: 'activity-scale',
      slug: 'choice-test',
      publicUrl: 'http://localhost:3000/choice-test',
      title: 'Scale test',
      question: 'Rate this',
      type: 'scale',
      status: 'active',
      identityMode: 'anonymous',
      allowMultipleResponses: false,
      maxResponsesPerParticipant: 1,
      maxAnswerLength: 280,
      allowMultipleChoices: false,
      options: [],
      scaleMin: 1,
      scaleMax: 10,
      publicResults: false,
      participantResponseCount: 0,
      results: null
    });
    const wrapper = mount(PublicLivePage, {
      global: { stubs: { LiveResultsBoard: true } }
    });
    await flushPromises();

    const scale = wrapper.get('[data-scale-options]');
    expect(scale.classes()).toContain('grid-cols-[repeat(auto-fit,minmax(3rem,1fr))]');
    expect(scale.findAll('button')).toHaveLength(10);
    expect(scale.findAll('button').at(-1)?.text()).toBe('10');
  });
});
