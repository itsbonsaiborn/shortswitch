// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import GlobalAnalyticsPage from './GlobalAnalyticsPage.vue';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock('../lib/api', () => ({ api: apiMock }));
vi.mock('../composables/useTheme', () => ({
  useTheme: () => ({ resolvedTheme: ref('light') })
}));
vi.mock('@vueuse/core', () => ({
  useWindowSize: () => ({ width: ref(1280) }),
  useElementSize: () => ({ width: ref(800), height: ref(330) }),
  useMediaQuery: () => ref(false)
}));
vi.mock('vue3-apexcharts', () => ({
  default: {
    name: 'VueApexCharts',
    props: ['type', 'height', 'options', 'series'],
    template: '<div class="chart-stub"></div>'
  }
}));

const analytics = {
  totals: { clicks: 3, views: 5, uniqueVisitors: 4, devices: 4 },
  activityOverTime: [{ date: '2026-10-14', label: '14 Oct', clicks: 3, views: 5, uniqueVisitors: 4 }],
  modules: [
    { module: 'links', clicks: 2, views: 0, uniqueVisitors: 2 },
    { module: 'pages', clicks: 1, views: 3, uniqueVisitors: 1 },
    { module: 'live', clicks: 0, views: 2, uniqueVisitors: 1 }
  ],
  activityByTime: [{ day: 3, hour: 12, clicks: 3, views: 5, uniqueVisitors: 4 }],
  topReferrers: {
    all: [{ label: 'school.example', value: 5 }],
    links: [],
    pages: [],
    live: []
  },
  referrerTotals: { all: 5, links: 0, pages: 3, live: 2 },
  topSlugs: {
    all: [{ slug: 'lesson', module: 'pages', value: 3 }],
    links: [],
    pages: [{ slug: 'lesson', module: 'pages', value: 3 }],
    live: []
  },
  breakdowns: {
    devices: [{ label: 'desktop', value: 5 }],
    browsers: [{ label: 'Chrome', value: 5 }],
    operatingSystems: [{ label: 'Windows', value: 5 }],
    languages: [{ label: 'lv-LV', value: 5 }]
  }
};

describe('GlobalAnalyticsPage', () => {
  beforeEach(() => {
    apiMock.mockReset();
    document.cookie = 'ss_global_analytics_range=month; path=/';
    apiMock.mockImplementation((url: string) => Promise.resolve(
      url.includes('/activity-over-time')
        ? [{ date: '2026-10-14T12:00', label: '12:00', clicks: 1, views: 2, uniqueVisitors: 2 }]
        : structuredClone(analytics)
    ));
  });

  test('loads only the trend when the selected range changes and uses local referrer icons', async () => {
    const wrapper = mount(GlobalAnalyticsPage);
    await flushPromises();

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock.mock.calls[0][0]).toContain('/api/analytics/global?range=month');
    expect(wrapper.text()).toContain('school.example');
    expect(wrapper.find('img[src^="http"]').exists()).toBe(false);

    const dailyButton = wrapper.findAll('button').find((button) => button.text() === 'Daily');
    expect(dailyButton).toBeDefined();
    await dailyButton!.trigger('click');
    await flushPromises();

    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(apiMock.mock.calls[1][0]).toContain('/api/analytics/global/activity-over-time?range=day');
    expect(wrapper.text()).toContain('school.example');
    expect(wrapper.findAllComponents({ name: 'VueApexCharts' })).toHaveLength(6);
    wrapper.unmount();
  });
});
