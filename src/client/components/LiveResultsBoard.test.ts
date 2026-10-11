// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import LiveResultsBoard from './LiveResultsBoard.vue';

describe('LiveResultsBoard', () => {
  test('uses stable varied colors while keeping frequency-based word sizes', () => {
    const wrapper = mount(LiveResultsBoard, {
      props: {
        activity: { type: 'word_cloud', scaleMin: null, scaleMax: null },
        results: {
          activityId: 'activity-1', slug: 'colors', type: 'word_cloud', status: 'active',
          responseCount: 8, uniqueParticipantCount: 8, openAnswers: [], choices: [], scale: null,
          wordCloud: [
            { text: 'Routing', count: 8 },
            { text: 'Security', count: 5 },
            { text: 'Database', count: 4 },
            { text: 'Docker', count: 3 },
            { text: 'Frontend', count: 2 },
            { text: 'Backend', count: 1 },
            { text: 'Testing', count: 1 },
            { text: 'Realtime', count: 1 }
          ],
          revision: '8:test'
        }
      }
    });

    const words = wrapper.findAll('[data-word-cloud-item]');
    const colors = new Set(words.map((word) => word.classes().find((name) => name.startsWith('text-[#'))));
    expect(colors.size).toBeGreaterThan(3);
    expect(Number.parseFloat((words[0].element as HTMLElement).style.fontSize))
      .toBeGreaterThan(Number.parseFloat((words[5].element as HTMLElement).style.fontSize));

    const routingColor = words[0].classes().find((name) => name.startsWith('text-[#'));
    expect(routingColor).toBeTruthy();
    wrapper.unmount();

    const repeated = mount(LiveResultsBoard, {
      props: {
        activity: { type: 'word_cloud', scaleMin: null, scaleMax: null },
        results: {
          activityId: 'activity-1', slug: 'colors', type: 'word_cloud', status: 'active',
          responseCount: 1, uniqueParticipantCount: 1, openAnswers: [], choices: [], scale: null,
          wordCloud: [{ text: 'Routing', count: 1 }], revision: '1:test'
        }
      }
    });
    expect(repeated.get('[data-word-cloud-item]').classes()).toContain(routingColor!);
  });

  test('constrains long word-cloud entries and keeps a ten-point scale inside a fluid grid', () => {
    const cloud = mount(LiveResultsBoard, {
      props: {
        activity: { type: 'word_cloud', scaleMin: null, scaleMax: null },
        results: {
          activityId: 'activity-long', slug: 'long', type: 'word_cloud', status: 'active',
          responseCount: 1, uniqueParticipantCount: 1, openAnswers: [], choices: [], scale: null,
          wordCloud: [{ text: 'AnExtremelyLongUnbrokenAnswerThatMustStayInsideTheMobileCard', count: 1 }],
          revision: '1:long'
        }
      }
    });
    const longWord = cloud.get('[data-word-cloud-item]');
    expect(longWord.classes()).toContain('max-w-full');
    expect(longWord.classes()).toContain('[overflow-wrap:anywhere]');
    expect((longWord.element as HTMLElement).style.transform).toBe('rotate(0deg)');

    const distribution = Array.from({ length: 10 }, (_, index) => ({ value: index + 1, count: index }));
    const scale = mount(LiveResultsBoard, {
      props: {
        activity: { type: 'scale', scaleMin: 1, scaleMax: 10 },
        results: {
          activityId: 'activity-scale', slug: 'scale', type: 'scale', status: 'active',
          responseCount: 9, uniqueParticipantCount: 9, openAnswers: [], choices: [], wordCloud: [],
          scale: { average: 5, distribution }, revision: '9:scale'
        }
      }
    });
    expect((scale.get('[data-scale-results]').element as HTMLElement).style.gridTemplateColumns)
      .toBe('repeat(10, minmax(0, 1fr))');
    expect(scale.text()).toContain('10');
  });
});
