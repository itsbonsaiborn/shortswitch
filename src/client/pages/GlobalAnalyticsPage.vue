<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useElementSize, useMediaQuery, useWindowSize } from '@vueuse/core';
import type { ApexOptions } from 'apexcharts';
import VueApexCharts from 'vue3-apexcharts';
import AnalyticsBreakdownGrid from '../components/AnalyticsBreakdownGrid.vue';
import StatCard from '../components/StatCard.vue';
import { useTheme } from '../composables/useTheme';
import { api } from '../lib/api';
import { createDonutTooltip } from '../lib/chart-tooltip';
import type { GlobalAnalytics, GlobalAnalyticsModuleFilter } from '@/shared/types';

type AnalyticsRange = 'day' | 'week' | 'month';
type ModuleMetric = 'clicks' | 'views' | 'uniqueVisitors';

const readRange = (): AnalyticsRange => {
  if (typeof document === 'undefined') return 'month';
  const value = document.cookie
    .split('; ')
    .find((item) => item.startsWith('ss_global_analytics_range='))
    ?.split('=')
    .slice(1)
    .join('=');
  const decoded = value ? decodeURIComponent(value) : '';
  return decoded === 'day' || decoded === 'week' || decoded === 'month' ? decoded : 'month';
};

const { width } = useWindowSize();
const isCoarsePointer = useMediaQuery('(hover: none), (pointer: coarse)');
const isMobileLayout = useMediaQuery('(max-width: 767px)');
const allowDonutSelection = computed(() => isCoarsePointer.value && isMobileLayout.value);
const { resolvedTheme } = useTheme();
const activityChartContainer = ref<HTMLElement | null>(null);
const { width: activityChartWidth } = useElementSize(activityChartContainer);
const data = ref<GlobalAnalytics | null>(null);
const loading = ref(true);
const refreshing = ref(false);
const errorMessage = ref('');
const range = ref<AnalyticsRange>(readRange());
const moduleMetric = ref<ModuleMetric>('clicks');
const selectedModuleIndex = ref<number | null>(null);
const blockDesktopDonutInteraction = (event: Event) => {
  if (allowDonutSelection.value) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
};
const heatmapMetric = ref<ModuleMetric>('clicks');
const referrerModule = ref<GlobalAnalyticsModuleFilter>('all');
const slugModule = ref<GlobalAnalyticsModuleFilter>('all');
let loadRequestId = 0;

const load = async () => {
  const requestId = ++loadRequestId;
  const isInitialLoad = data.value === null;
  loading.value = isInitialLoad;
  refreshing.value = !isInitialLoad;
  if (isInitialLoad) errorMessage.value = '';
  try {
    const timezoneOffsetMinutes = -new Date().getTimezoneOffset();
    const nextData = await api<GlobalAnalytics>(
      `/api/analytics/global?range=${range.value}&timezoneOffsetMinutes=${timezoneOffsetMinutes}`
    );
    if (requestId !== loadRequestId) return;
    data.value = nextData;
    errorMessage.value = '';
  } catch (error) {
    if (requestId !== loadRequestId) return;
    if (isInitialLoad) {
      errorMessage.value = error instanceof Error ? error.message : 'Unable to load analytics.';
    }
  } finally {
    if (requestId === loadRequestId) {
      loading.value = false;
      refreshing.value = false;
    }
  }
};

const loadActivityOverTime = async () => {
  if (!data.value) {
    await load();
    return;
  }
  const requestId = ++loadRequestId;
  refreshing.value = true;
  try {
    const timezoneOffsetMinutes = -new Date().getTimezoneOffset();
    const nextActivity = await api<GlobalAnalytics['activityOverTime']>(
      `/api/analytics/global/activity-over-time?range=${range.value}&timezoneOffsetMinutes=${timezoneOffsetMinutes}`
    );
    if (requestId !== loadRequestId || !data.value) return;
    data.value.activityOverTime = nextActivity;
  } catch {
    // Keep the last successful chart visible; a later range change can retry.
  } finally {
    if (requestId === loadRequestId) refreshing.value = false;
  }
};

const setRange = (next: AnalyticsRange) => {
  range.value = next;
  if (typeof document !== 'undefined') {
    document.cookie = `ss_global_analytics_range=${next}; path=/; SameSite=Lax`;
  }
};

const isDark = computed(() => resolvedTheme.value === 'dark');
const isMobileChart = computed(() => width.value < 640);
const activityCategories = computed(() => data.value?.activityOverTime.map((point) => point.label) ?? []);
const activityLabelStride = computed(() => {
  const categoryCount = activityCategories.value.length;
  if (categoryCount <= 1) return 1;
  const availableWidth = activityChartWidth.value || width.value;
  const labelWidth = range.value === 'week' ? 72 : 58;
  const visibleLabels = Math.max(2, Math.floor(availableWidth / labelWidth));
  const minimumStride = range.value === 'week' ? 1 : 2;
  return Math.max(minimumStride, Math.ceil(categoryCount / visibleLabels));
});
const activitySeries = computed(() => [
  { name: 'Clicks', data: data.value?.activityOverTime.map((point) => point.clicks) ?? [] },
  { name: 'Views', data: data.value?.activityOverTime.map((point) => point.views) ?? [] },
  { name: 'Unique visitors', data: data.value?.activityOverTime.map((point) => point.uniqueVisitors) ?? [] }
]);

const activityChartOptions = computed<ApexOptions>(() => ({
  chart: {
    type: 'area',
    toolbar: { show: false },
    zoom: { enabled: false },
    foreColor: isDark.value ? '#9f9d96' : '#6f6e69',
    fontFamily: 'Segoe UI, ui-sans-serif, system-ui, sans-serif',
    background: 'transparent',
    animations: {
      enabled: true,
      speed: 500,
      dynamicAnimation: { enabled: true, speed: 500 },
      animateGradually: { enabled: true, delay: 60 }
    }
  },
  theme: { mode: isDark.value ? 'dark' : 'light' },
  colors: isDark.value ? ['#87d3c3', '#eccb60', '#f9ae83'] : ['#24837b', '#ad8301', '#bc5215'],
  stroke: { curve: 'smooth', width: [3, 3, 3] },
  fill: {
    type: 'gradient',
    gradient: { shadeIntensity: 1, opacityFrom: 0.42, opacityTo: 0.08, stops: [0, 90, 100] }
  },
  markers: { size: 0, hover: { size: 5 } },
  dataLabels: { enabled: false },
  legend: {
    position: 'top',
    horizontalAlign: 'left',
    labels: { colors: isDark.value ? '#9f9d96' : '#6f6e69' }
  },
  xaxis: {
    categories: activityCategories.value,
    axisBorder: { show: false },
    axisTicks: { show: false },
    labels: {
      rotate: 0,
      hideOverlappingLabels: true,
      trim: false,
      formatter: (value) => {
        const index = activityCategories.value.indexOf(String(value));
        return index === -1 || index % activityLabelStride.value === 0 ? String(value) : '';
      }
    }
  },
  yaxis: { labels: { formatter: (value) => `${Math.round(value)}` } },
  grid: {
    borderColor: isDark.value ? 'rgba(52, 51, 49, 0.9)' : 'rgba(218, 216, 206, 0.92)',
    strokeDashArray: 4
  },
  tooltip: {
    theme: isDark.value ? 'dark' : 'light',
    x: {
      formatter: (_value, context) => activityCategories.value[context.dataPointIndex] ?? String(_value ?? '')
    }
  }
}));

const moduleColors = computed(() =>
  isDark.value ? ['#87d3c3', '#eccb60', '#f9ae83'] : ['#24837b', '#ad8301', '#bc5215']
);
const moduleTotal = computed(() =>
  (data.value?.modules ?? []).reduce((sum, item) => sum + item[moduleMetric.value], 0)
);
const moduleItems = computed(() => {
  const labels = { links: 'Links', pages: 'Pages', live: 'Live' } as const;
  return (data.value?.modules ?? []).map((item, index) => {
    const value = item[moduleMetric.value];
    return {
      ...item,
      label: labels[item.module],
      value,
      color: moduleColors.value[index],
      percentage: moduleTotal.value > 0 ? (value / moduleTotal.value) * 100 : 0
    };
  });
});
const moduleSeries = computed(() => moduleItems.value.map((item) => item.value));
const selectedModuleItem = computed(() => selectedModuleIndex.value === null
  ? null
  : moduleItems.value[selectedModuleIndex.value] ?? null);
const moduleChartOptions = computed<ApexOptions>(() => ({
  chart: {
    type: 'donut',
    foreColor: isDark.value ? '#9f9d96' : '#6f6e69',
    fontFamily: 'Segoe UI, ui-sans-serif, system-ui, sans-serif',
    background: 'transparent',
    animations: { enabled: true, speed: 450 },
    events: {
      dataPointSelection: (_event, _chart, config) => {
        if (!allowDonutSelection.value || config.dataPointIndex < 0) return;
        selectedModuleIndex.value = selectedModuleIndex.value === config.dataPointIndex
          ? null
          : config.dataPointIndex;
      }
    }
  },
  theme: { mode: isDark.value ? 'dark' : 'light' },
  labels: moduleItems.value.map((item) => item.label),
  colors: moduleColors.value,
  dataLabels: { enabled: false },
  legend: { show: false },
  stroke: { width: 3, colors: [isDark.value ? '#1c1b1a' : '#fffcf0'] },
  plotOptions: {
    pie: {
      expandOnClick: false,
      donut: {
        size: '68%',
        labels: { show: false }
      }
    }
  },
  states: {
    normal: { filter: { type: 'none' } },
    hover: { filter: { type: 'lighten', value: 0.05 } },
    active: { filter: { type: 'none' } }
  },
  tooltip: {
    enabled: !allowDonutSelection.value,
    followCursor: true,
    custom: createDonutTooltip(moduleItems.value, moduleColors.value)
  }
}));

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const heatmapHours = Array.from({ length: 12 }, (_, index) => index * 2);
const heatmapMatrix = computed(() => {
  const valueMap = new Map(
    (data.value?.activityByTime ?? []).map((cell) => [`${cell.day}-${cell.hour}`, cell[heatmapMetric.value]])
  );
  return weekdays.map((label, dayIndex) => ({
    label,
    day: dayIndex + 1,
    cells: heatmapHours.map((hour) => ({ hour, value: valueMap.get(`${dayIndex + 1}-${hour}`) ?? 0 }))
  }));
});
const heatmapMaximum = computed(() =>
  Math.max(0, ...heatmapMatrix.value.flatMap((row) => row.cells.map((cell) => cell.value)))
);
const heatmapCellStyle = (value: number) => {
  if (value <= 0 || heatmapMaximum.value <= 0) return { backgroundColor: 'var(--ui-pill-bg)' };
  const opacity = 0.24 + (value / heatmapMaximum.value) * 0.76;
  return { backgroundColor: isDark.value ? `rgba(135, 211, 195, ${opacity})` : `rgba(36, 131, 123, ${opacity})` };
};
const heatmapMetricLabel = computed(() => heatmapMetric.value === 'uniqueVisitors'
  ? 'Unique visitors'
  : heatmapMetric.value === 'clicks'
    ? 'Clicks'
    : 'Views');
const heatmapTooltip = ref({
  visible: false,
  x: 0,
  y: 0,
  below: false,
  day: '',
  interval: '',
  value: 0
});
const heatmapTooltipElement = ref<HTMLElement | null>(null);
type TooltipAnchor = { x: number; y: number };
const heatmapTooltipAnchor = (event: MouseEvent | FocusEvent): TooltipAnchor => {
  if (event instanceof MouseEvent) {
    return { x: event.clientX, y: event.clientY };
  }
  const target = event.currentTarget as HTMLElement | null;
  const bounds = target?.getBoundingClientRect();
  return bounds
    ? { x: bounds.left + bounds.width / 2, y: bounds.top }
    : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
};
const positionHeatmapTooltip = (anchor: TooltipAnchor) => {
  const bounds = heatmapTooltipElement.value?.getBoundingClientRect();
  const tooltipWidth = bounds?.width ?? 176;
  const tooltipHeight = bounds?.height ?? 64;
  const margin = 8;
  const minimumX = margin + tooltipWidth / 2;
  const maximumX = Math.max(minimumX, window.innerWidth - margin - tooltipWidth / 2);
  heatmapTooltip.value.x = Math.min(Math.max(anchor.x, minimumX), maximumX);
  heatmapTooltip.value.below = anchor.y - tooltipHeight - 12 < margin;
  heatmapTooltip.value.y = heatmapTooltip.value.below
    ? Math.min(anchor.y, window.innerHeight - tooltipHeight - margin - 12)
    : Math.max(anchor.y, tooltipHeight + margin + 12);
};
const showHeatmapTooltip = (
  event: MouseEvent | FocusEvent,
  day: string,
  hour: number,
  value: number
) => {
  const anchor = heatmapTooltipAnchor(event);
  heatmapTooltip.value.day = day;
  heatmapTooltip.value.interval = `${String(hour).padStart(2, '0')}:00–${String(hour + 2).padStart(2, '0')}:00`;
  heatmapTooltip.value.value = value;
  heatmapTooltip.value.visible = true;
  positionHeatmapTooltip(anchor);
  void nextTick(() => {
    if (heatmapTooltip.value.visible) positionHeatmapTooltip(anchor);
  });
};
const moveHeatmapTooltip = (event: MouseEvent) => {
  if (heatmapTooltip.value.visible) positionHeatmapTooltip(heatmapTooltipAnchor(event));
};
const hideHeatmapTooltip = () => {
  heatmapTooltip.value.visible = false;
};

const moduleFilters: Array<{ label: string; value: GlobalAnalyticsModuleFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Links', value: 'links' },
  { label: 'Pages', value: 'pages' },
  { label: 'Live', value: 'live' }
];
const topReferrerItems = computed(() => data.value?.topReferrers[referrerModule.value] ?? []);
const topSlugItems = computed(() => data.value?.topSlugs[slugModule.value] ?? []);
const referrerTotal = computed(() => data.value?.referrerTotals[referrerModule.value] ?? 0);
const referrerLabel = (label: string) => label === 'Direct' ? 'Direct' : label.replace(/^www\./i, '');

const buttonClass = (active: boolean) =>
  active
    ? 'border-transparent bg-[var(--ui-accent-soft)] text-[var(--ui-accent)]'
    : 'border-[var(--ui-border)] bg-[var(--ui-panel)] text-[var(--ui-text-muted)]';

onMounted(load);
watch(range, loadActivityOverTime);
watch(moduleMetric, () => { selectedModuleIndex.value = null; });
</script>

<template>
  <div class="analytics-page min-w-0 space-y-6">
    <section v-if="loading" class="panel p-8 text-center text-[var(--ui-text-muted)]">
      Loading analytics...
    </section>

    <section v-else-if="errorMessage" class="panel p-8 text-center">
      <p class="text-sm text-red-600 dark:text-red-300">{{ errorMessage }}</p>
      <button class="btn-secondary mt-4" type="button" @click="load">Try again</button>
    </section>

    <template v-else-if="data">
      <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total clicks" :value="data.totals.clicks" icon="clicks" />
        <StatCard label="Total views" :value="data.totals.views" icon="views" />
        <StatCard label="Unique visitors" :value="data.totals.uniqueVisitors" icon="visitors" />
        <StatCard label="Total devices" :value="data.totals.devices" icon="devices" />
      </section>

      <section class="grid min-w-0 items-stretch gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(24rem,0.75fr)]">
        <div class="panel flex min-w-0 flex-col p-5 sm:p-6">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 class="text-xl font-semibold">Activity over time</h2>
              <p class="mt-1 text-sm text-[var(--ui-text-muted)]">Clicks, views and unique visitors across every module.</p>
            </div>
            <div class="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto">
              <button
                v-for="option in [
                  { label: 'Daily', value: 'day' },
                  { label: 'Weekly', value: 'week' },
                  { label: 'Monthly', value: 'month' }
                ]"
                :key="option.value"
                type="button"
                class="rounded-2xl border px-3 py-2 text-sm font-medium transition-all duration-200"
                :class="buttonClass(range === option.value)"
                @click="setRange(option.value as AnalyticsRange)"
              >
                {{ option.label }}
              </button>
            </div>
          </div>

          <div
            class="app-scrollbar mt-6 min-w-0 rounded-[2rem] border border-[var(--ui-border)] bg-[var(--ui-panel-muted)] p-3 sm:p-4"
            :class="[
              isMobileChart ? 'overflow-x-auto overflow-y-hidden' : 'overflow-hidden',
              refreshing ? 'opacity-70' : ''
            ]"
          >
            <div ref="activityChartContainer" :class="isMobileChart ? 'min-w-[720px]' : 'min-w-0'">
              <VueApexCharts
                type="area"
                height="330"
                width="100%"
                :options="activityChartOptions"
                :series="activitySeries"
              />
            </div>
          </div>
        </div>

        <div class="panel flex min-w-0 flex-col p-5 sm:p-6">
          <div>
            <h2 class="text-xl font-semibold">Activity by module</h2>
            <p class="mt-1 text-sm text-[var(--ui-text-muted)]">Compare Links, Pages and Live.</p>
          </div>

          <div class="mt-4 grid grid-cols-3 gap-2">
            <button
              v-for="option in [
                { label: 'Clicks', value: 'clicks' },
                { label: 'Views', value: 'views' },
                { label: 'Unique', value: 'uniqueVisitors' }
              ]"
              :key="option.value"
              type="button"
              class="rounded-2xl border px-3 py-2 text-sm font-medium transition-all duration-200"
              :class="buttonClass(moduleMetric === option.value)"
              @click="moduleMetric = option.value as ModuleMetric"
            >
              {{ option.label }}
            </button>
          </div>

          <div class="mt-5 grid flex-1 items-center gap-5 md:grid-cols-[minmax(130px,0.85fr)_minmax(150px,1.15fr)]">
            <div
              class="relative mx-auto w-full max-w-[280px]"
              :class="allowDonutSelection ? 'cursor-pointer' : 'ss-donut-desktop cursor-default'"
              @pointerdown.capture="blockDesktopDonutInteraction"
              @mousedown.capture="blockDesktopDonutInteraction"
              @mouseup.capture="blockDesktopDonutInteraction"
              @touchstart.capture="blockDesktopDonutInteraction"
              @click.capture="blockDesktopDonutInteraction"
            >
              <VueApexCharts type="donut" height="270" :options="moduleChartOptions" :series="moduleSeries" />
              <div class="pointer-events-none absolute inset-0 flex items-center justify-center text-center">
                <div v-if="allowDonutSelection && selectedModuleItem" class="grid max-w-24 gap-1">
                  <span class="truncate text-xs font-semibold leading-tight text-[var(--ui-text-muted)]">{{ selectedModuleItem.label }}</span>
                  <strong class="text-3xl font-bold leading-none text-[var(--ui-text)]">{{ selectedModuleItem.value }}</strong>
                  <span class="text-xs font-bold leading-tight text-[var(--ui-accent)]">{{ selectedModuleItem.percentage.toFixed(1) }}%</span>
                </div>
                <strong v-else class="text-3xl font-bold leading-none text-[var(--ui-text)]">{{ moduleTotal }}</strong>
              </div>
            </div>

            <div class="divide-y divide-[var(--ui-border)]">
              <div
                v-for="item in moduleItems"
                :key="item.module"
                class="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 px-1 py-3"
              >
                <span class="flex h-7 w-7 shrink-0 items-center justify-center" :style="{ color: item.color }">
                  <svg v-if="item.module === 'links'" viewBox="0 0 20 20" class="h-5 w-5" fill="currentColor" aria-hidden="true">
                    <path d="M17.74 2.76a4.32 4.32 0 0 1 0 6.1l-1.53 1.52c-1.12 1.12-2.7 1.47-4.14 1.09l2.62-2.61l.76-.77l.76-.76c.84-.84.84-2.2 0-3.04a2.13 2.13 0 0 0-3.04 0l-.77.76l-3.38 3.38c-.37-1.44-.02-3.02 1.1-4.14l1.52-1.53a4.32 4.32 0 0 1 6.1 0M8.59 13.43l5.34-5.34c.42-.42.42-1.1 0-1.52c-.44-.43-1.13-.39-1.53 0l-5.33 5.34c-.42.42-.42 1.1 0 1.52c.44.43 1.13.39 1.52 0m-.76 2.29l4.14-4.15c.38 1.44.03 3.02-1.09 4.14l-1.52 1.53a4.32 4.32 0 0 1-6.1 0a4.32 4.32 0 0 1 0-6.1l1.53-1.52c1.12-1.12 2.7-1.47 4.14-1.1l-4.14 4.15c-.85.84-.85 2.2 0 3.05c.84.84 2.2.84 3.04 0" />
                  </svg>
                  <svg v-else-if="item.module === 'pages'" viewBox="0 0 20 20" class="h-5 w-5" fill="currentColor" aria-hidden="true">
                    <path d="M6 2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm1.5 4h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1M7 13.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5m.5-4h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1" />
                  </svg>
                  <svg v-else viewBox="0 0 32 32" class="h-5 w-5" fill="currentColor" aria-hidden="true">
                    <path d="M25 30H7c-1.103 0-2-.897-2-2V7c0-1.103.897-2 2-2h3V4c0-1.103.897-2 2-2h8c1.103 0 2 .897 2 2v1h3c1.103 0 2 .897 2 2v21c0 1.103-.897 2-2 2M7 7v21h18V7h-3v3H10V7zm5 1h8V4h-8z" />
                  </svg>
                </span>
                <span class="min-w-0 truncate font-medium">{{ item.label }}</span>
                <strong class="min-w-8 text-right text-lg leading-none">{{ item.value }}</strong>
                <span class="min-w-12 text-right text-xs text-[var(--ui-text-muted)]">{{ item.percentage.toFixed(1) }}%</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="analytics-detail-grid grid min-w-0 items-stretch gap-4">
        <div class="panel flex min-w-0 flex-col p-5 sm:p-6">
          <div class="flex flex-col gap-4">
            <div>
              <h2 class="text-xl font-semibold">Activity by day and hour</h2>
              <p class="mt-1 text-sm text-[var(--ui-text-muted)]">Activity grouped into two-hour intervals.</p>
            </div>
            <div class="grid w-full min-w-0 grid-cols-3 gap-2">
              <button
                v-for="option in [
                  { label: 'Clicks', value: 'clicks' },
                  { label: 'Views', value: 'views' },
                  { label: 'Unique', value: 'uniqueVisitors' }
                ]"
                :key="option.value"
                type="button"
                class="min-w-0 rounded-2xl border px-2 py-2 text-xs font-medium transition-all duration-200"
                :class="buttonClass(heatmapMetric === option.value)"
                @click="heatmapMetric = option.value as ModuleMetric"
              >
                {{ option.label }}
              </button>
            </div>
          </div>

          <div class="app-scrollbar mt-4 flex min-h-[22rem] flex-1 items-center overflow-x-auto rounded-[1.5rem] border border-[var(--ui-border)] bg-[var(--ui-panel-muted)] p-3 xl:min-h-[27rem]">
            <div class="w-full min-w-[560px]">
              <div class="grid grid-cols-[34px_repeat(12,minmax(32px,1fr))] gap-2 text-[10px] font-medium text-[var(--ui-text-muted)]">
                <div></div>
                <div v-for="hour in heatmapHours" :key="`hour-${hour}`" class="text-center">
                  {{ String(hour).padStart(2, '0') }}
                </div>
                <template v-for="row in heatmapMatrix" :key="row.day">
                  <div class="flex items-center text-xs font-semibold text-[var(--ui-text)]">{{ row.label }}</div>
                  <div
                    v-for="cell in row.cells"
                    :key="`${row.day}-${cell.hour}`"
                    class="aspect-square w-full self-center rounded-lg border border-transparent outline-none transition-transform duration-150 hover:scale-110 focus-visible:scale-110 focus-visible:ring-2 focus-visible:ring-[var(--ui-accent)]"
                    :style="heatmapCellStyle(cell.value)"
                    tabindex="0"
                    @mouseenter="showHeatmapTooltip($event, row.label, cell.hour, cell.value)"
                    @mousemove="moveHeatmapTooltip"
                    @mouseleave="hideHeatmapTooltip"
                    @focus="showHeatmapTooltip($event, row.label, cell.hour, cell.value)"
                    @blur="hideHeatmapTooltip"
                  ></div>
                </template>
              </div>
            </div>
          </div>
        </div>

        <div class="panel flex min-w-0 flex-col p-5 sm:p-6">
          <div>
            <h2 class="text-xl font-semibold">Top referrers</h2>
            <p class="mt-1 text-sm text-[var(--ui-text-muted)]">Top 8 traffic sources.</p>
          </div>
          <div class="mt-4 grid grid-cols-4 gap-1.5">
            <button
              v-for="filter in moduleFilters"
              :key="filter.value"
              type="button"
              class="rounded-xl border px-2 py-2 text-xs font-medium transition-all duration-200"
              :class="buttonClass(referrerModule === filter.value)"
              @click="referrerModule = filter.value"
            >
              {{ filter.label }}
            </button>
          </div>
          <div class="mt-5 grid grid-cols-[minmax(0,1fr)_4.5rem_3.25rem] gap-3 border-b border-[var(--ui-border)] px-2 pb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--ui-text-muted)]">
            <span>Referrer</span><span class="text-center">Visits</span><span class="text-right">%</span>
          </div>
          <div v-if="topReferrerItems.length" class="divide-y divide-[var(--ui-border)]">
            <div
              v-for="item in topReferrerItems"
              :key="item.label"
              class="grid grid-cols-[minmax(0,1fr)_4.5rem_3.25rem] items-center gap-3 px-2 py-3"
            >
              <div class="flex min-w-0 items-center gap-2.5">
                <span class="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden text-[var(--ui-accent)]">
                  <svg v-if="item.label !== 'Direct' && item.label !== 'Unknown'" viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3Z" />
                  </svg>
                  <svg v-else viewBox="0 0 20 20" class="h-4 w-4" fill="currentColor" aria-hidden="true">
                    <path fill-rule="evenodd" d="M6.672 1.911a1 1 0 1 0-1.932.518l.259.966a1 1 0 0 0 1.932-.518zM2.429 4.74a1 1 0 1 0-.517 1.932l.966.259a1 1 0 0 0 .517-1.932zm8.814-.569a1 1 0 0 0-1.415-1.414l-.707.707a1 1 0 1 0 1.415 1.415zm-7.071 7.072l.707-.707A1 1 0 0 0 3.465 9.12l-.708.707a1 1 0 0 0 1.415 1.415m3.2-5.171a1 1 0 0 0-1.3 1.3l4 10a1 1 0 0 0 1.823.075l1.38-2.759l3.018 3.02a1 1 0 0 0 1.414-1.415l-3.019-3.02l2.76-1.379a1 1 0 0 0-.076-1.822z" clip-rule="evenodd" />
                  </svg>
                </span>
                <span class="truncate text-sm font-medium" :title="item.label">{{ referrerLabel(item.label) }}</span>
              </div>
              <strong class="text-center text-lg leading-none">{{ item.value }}</strong>
              <span class="text-right text-xs text-[var(--ui-text-muted)]">
                {{ referrerTotal > 0 ? ((item.value / referrerTotal) * 100).toFixed(1) : '0.0' }}%
              </span>
            </div>
          </div>
          <div v-else class="flex min-h-40 items-center justify-center text-sm text-[var(--ui-text-muted)]">No referrers yet.</div>
        </div>

        <div class="panel flex min-w-0 flex-col p-5 sm:p-6">
          <div>
            <h2 class="text-xl font-semibold">Top slugs</h2>
            <p class="mt-1 text-sm text-[var(--ui-text-muted)]">Top 8 public resources.</p>
          </div>
          <div class="mt-4 grid grid-cols-4 gap-1.5">
            <button
              v-for="filter in moduleFilters"
              :key="filter.value"
              type="button"
              class="rounded-xl border px-2 py-2 text-xs font-medium transition-all duration-200"
              :class="buttonClass(slugModule === filter.value)"
              @click="slugModule = filter.value"
            >
              {{ filter.label }}
            </button>
          </div>
          <div class="mt-5 grid grid-cols-[minmax(0,1fr)_5.5rem_4rem] gap-3 border-b border-[var(--ui-border)] px-2 pb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--ui-text-muted)]">
            <span>Slug</span><span class="text-center">Type</span><span class="text-right">Visits</span>
          </div>
          <div v-if="topSlugItems.length" class="divide-y divide-[var(--ui-border)]">
            <div
              v-for="item in topSlugItems"
              :key="`${item.module}-${item.slug}`"
              class="grid grid-cols-[minmax(0,1fr)_5.5rem_4rem] items-center gap-3 px-2 py-3"
            >
              <span class="truncate text-sm font-medium" :title="item.slug">/{{ item.slug }}</span>
              <span class="inline-flex items-center justify-center gap-1.5 text-sm font-medium capitalize text-[var(--ui-text-muted)]">
                <svg v-if="item.module === 'links'" viewBox="0 0 20 20" class="h-4 w-4 text-[var(--ui-accent)]" fill="currentColor" aria-hidden="true">
                  <path d="M17.74 2.76a4.32 4.32 0 0 1 0 6.1l-1.53 1.52c-1.12 1.12-2.7 1.47-4.14 1.09l2.62-2.61l.76-.77l.76-.76c.84-.84.84-2.2 0-3.04a2.13 2.13 0 0 0-3.04 0l-.77.76l-3.38 3.38c-.37-1.44-.02-3.02 1.1-4.14l1.52-1.53a4.32 4.32 0 0 1 6.1 0M8.59 13.43l5.34-5.34c.42-.42.42-1.1 0-1.52c-.44-.43-1.13-.39-1.53 0l-5.33 5.34c-.42.42-.42 1.1 0 1.52c.44.43 1.13.39 1.52 0m-.76 2.29l4.14-4.15c.38 1.44.03 3.02-1.09 4.14l-1.52 1.53a4.32 4.32 0 0 1-6.1 0a4.32 4.32 0 0 1 0-6.1l1.53-1.52c1.12-1.12 2.7-1.47 4.14-1.1l-4.14 4.15c-.85.84-.85 2.2 0 3.05c.84.84 2.2.84 3.04 0" />
                </svg>
                <svg v-else-if="item.module === 'pages'" viewBox="0 0 20 20" class="h-4 w-4 text-[var(--ui-accent)]" fill="currentColor" aria-hidden="true">
                  <path d="M6 2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm1.5 4h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1M7 13.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5m.5-4h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1" />
                </svg>
                <svg v-else viewBox="0 0 32 32" class="h-4 w-4 text-[var(--ui-accent)]" fill="currentColor" aria-hidden="true">
                  <path d="M25 30H7c-1.103 0-2-.897-2-2V7c0-1.103.897-2 2-2h3V4c0-1.103.897-2 2-2h8c1.103 0 2 .897 2 2v1h3c1.103 0 2 .897 2 2v21c0 1.103-.897 2-2 2M7 7v21h18V7h-3v3H10V7zm5 1h8V4h-8z" />
                </svg>
                {{ item.module }}
              </span>
              <strong class="text-right text-lg leading-none">{{ item.value }}</strong>
            </div>
          </div>
          <div v-else class="flex min-h-40 items-center justify-center text-sm text-[var(--ui-text-muted)]">No slugs yet.</div>
        </div>
      </section>

      <AnalyticsBreakdownGrid :breakdowns="data.breakdowns" />
    </template>

    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-150 ease-out"
        enter-from-class="scale-95 opacity-0"
        enter-to-class="scale-100 opacity-100"
        leave-active-class="transition duration-100 ease-in"
        leave-from-class="scale-100 opacity-100"
        leave-to-class="scale-95 opacity-0"
      >
        <div
          ref="heatmapTooltipElement"
          v-if="heatmapTooltip.visible"
          class="pointer-events-none fixed z-[120] min-w-36 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-panel)] px-3 py-2 text-xs shadow-[0_16px_42px_rgba(0,0,0,0.2)]"
          :style="{
            left: `${heatmapTooltip.x}px`,
            top: `${heatmapTooltip.y}px`,
            transform: heatmapTooltip.below ? 'translate(-50%, 12px)' : 'translate(-50%, calc(-100% - 12px))'
          }"
        >
          <div class="font-semibold text-[var(--ui-text)]">{{ heatmapTooltip.day }} · {{ heatmapTooltip.interval }}</div>
          <div class="mt-1 flex items-center justify-between gap-4 text-[var(--ui-text-muted)]">
            <span>{{ heatmapMetricLabel }}</span>
            <strong class="text-[var(--ui-accent)]">{{ heatmapTooltip.value }}</strong>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.analytics-page {
  container-type: inline-size;
}

@container (min-width: 1050px) {
  .analytics-detail-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .analytics-detail-grid > :first-child { grid-column: 1 / -1; }
}

@container (min-width: 1600px) {
  .analytics-detail-grid { grid-template-columns: minmax(0, 1.35fr) minmax(18rem, .825fr) minmax(18rem, .825fr); }
  .analytics-detail-grid > :first-child { grid-column: auto; }
}
</style>
