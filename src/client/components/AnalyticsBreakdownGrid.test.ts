// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import { describe, expect, test, vi } from 'vitest';
import AnalyticsBreakdownGrid from './AnalyticsBreakdownGrid.vue';

const mediaState = vi.hoisted(() => ({ coarse: true, mobile: true }));

vi.mock('../composables/useTheme', () => ({
  useTheme: () => ({ resolvedTheme: ref('light') })
}));
vi.mock('@vueuse/core', () => ({
  useMediaQuery: (query: string) => ref(query.includes('max-width') ? mediaState.mobile : mediaState.coarse)
}));
vi.mock('vue3-apexcharts', () => ({
  default: {
    name: 'VueApexCharts',
    props: ['options', 'series'],
    template: '<div class="chart-stub"></div>'
  }
}));

describe('AnalyticsBreakdownGrid', () => {
  test('disables sticky slice expansion and exposes touch selection inside the donut', async () => {
    mediaState.coarse = true;
    mediaState.mobile = true;
    const wrapper = mount(AnalyticsBreakdownGrid, {
      props: {
        breakdowns: {
          devices: [{ label: 'desktop', value: 3 }, { label: 'mobile', value: 1 }],
          browsers: [], operatingSystems: [], languages: []
        }
      }
    });
    const chart = wrapper.findAllComponents({ name: 'VueApexCharts' })[0];
    const options = chart.props('options');

    expect(options.plotOptions.pie.expandOnClick).toBe(false);
    expect(options.tooltip.enabled).toBe(false);
    options.chart.events.dataPointSelection(null, null, { dataPointIndex: 0 });
    await nextTick();

    expect(wrapper.text()).toContain('Desktop');
    expect(wrapper.text()).toContain('75.0%');
  });

  test('blocks ApexCharts selection events throughout the desktop layout', () => {
    mediaState.coarse = true;
    mediaState.mobile = false;
    const wrapper = mount(AnalyticsBreakdownGrid, {
      props: {
        breakdowns: {
          devices: [{ label: 'desktop', value: 3 }],
          browsers: [], operatingSystems: [], languages: []
        }
      }
    });
    const chart = wrapper.find('.chart-stub').element;
    const apexMouseDown = vi.fn();
    chart.addEventListener('mousedown', apexMouseDown);
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });

    chart.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(apexMouseDown).not.toHaveBeenCalled();
    expect(wrapper.find('.breakdown-chart').classes()).toContain('ss-donut-desktop');
  });
});
