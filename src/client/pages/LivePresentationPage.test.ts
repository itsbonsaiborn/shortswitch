// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import LivePresentationPage from './LivePresentationPage.vue';

const mocks = vi.hoisted(() => ({ api: vi.fn(), toDataURL: vi.fn() }));

vi.mock('vue-router', () => ({ useRoute: () => ({ params: { slug: 'testins' } }) }));
vi.mock('../lib/api', () => ({ api: mocks.api }));
vi.mock('../composables/useTheme', () => ({ useTheme: () => ({}) }));
vi.mock('qrcode', () => ({ default: { toDataURL: mocks.toDataURL } }));

class EventSourceStub {
  addEventListener() {}
  close() {}
}

describe('LivePresentationPage', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', EventSourceStub);
    mocks.toDataURL.mockResolvedValue('data:image/png;base64,presentation-qr');
    mocks.api.mockResolvedValue({
      id: 'activity-1',
      slug: 'testins',
      publicUrl: 'http://localhost:3000/testins',
      title: 'Test activity',
      question: 'Who are you?',
      type: 'word_cloud',
      status: 'active',
      identityMode: 'anonymous',
      allowMultipleResponses: false,
      maxResponsesPerParticipant: 1,
      maxAnswerLength: 80,
      allowMultipleChoices: false,
      options: [],
      scaleMin: null,
      scaleMax: null,
      publicResults: false,
      participantResponseCount: 0,
      results: {
        activityId: 'activity-1', slug: 'testins', type: 'word_cloud', status: 'active',
        responseCount: 0, uniqueParticipantCount: 0, openAnswers: [], wordCloud: [], choices: [],
        scale: null, revision: '0:test'
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  test('renders the public URL without reading window from the Vue template proxy', async () => {
    const wrapper = mount(LivePresentationPage);
    await flushPromises();

    expect(wrapper.text()).toContain('Test activity');
    expect(wrapper.text()).toContain('http://localhost:3000/testins');
    expect(wrapper.text()).toContain('Exit presentation');
    expect(mocks.api).toHaveBeenCalledWith('/api/live/public/testins/presentation');
    expect(mocks.toDataURL).toHaveBeenCalledWith('http://localhost:3000/testins', { width: 280, margin: 1 });

    wrapper.unmount();
  });
});
