<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useElementSize, useWindowSize } from '@vueuse/core';
import type { ApexOptions } from 'apexcharts';
import VueApexCharts from 'vue3-apexcharts';
import { useI18n } from 'vue-i18n';
import type { PageAnalytics, PageDetail } from '@/shared/types';
import { api } from '../lib/api';
import { useTheme } from '../composables/useTheme';
import AnalyticsBreakdownGrid from '../components/AnalyticsBreakdownGrid.vue';
import AnalyticsVisitTable from '../components/AnalyticsVisitTable.vue';
import StatCard from '../components/StatCard.vue';

const route = useRoute();
const router = useRouter();
const { width } = useWindowSize();
const { resolvedTheme } = useTheme();
const { t } = useI18n();
const page = ref<PageDetail | null>(null);
const analytics = ref<PageAnalytics | null>(null);
const loading = ref(true);
const error = ref('');
const failedFavicons = ref(new Set<string>());
const trendChartContainer = ref<HTMLElement | null>(null);
const { width: trendChartWidth } = useElementSize(trendChartContainer);
const displayUrl = (url: string) => url.replace(/^https?:\/\//i, '');
const readRange = () => {
  if (typeof document === 'undefined') return 'day' as const;
  const value = document.cookie.split('; ').find((item) => item.startsWith('ss_page_analytics_range='))?.split('=')[1];
  return value === 'week' || value === 'month' ? value : 'day';
};
const range = ref<'day' | 'week' | 'month'>(readRange());
const readLimit = () => {
  if (typeof document === 'undefined') return 10 as const;
  const value = Number(document.cookie.split('; ').find((item) => item.startsWith('ss_page_analytics_limit='))?.split('=')[1]);
  return (value === 20 || value === 50 ? value : 10) as 10 | 20 | 50;
};
const limit = ref<10 | 20 | 50>(readLimit());
const setRange = (next: 'day' | 'week' | 'month') => {
  range.value = next;
  document.cookie = `ss_page_analytics_range=${next}; path=/; SameSite=Lax`;
};
const setLimit = (next: 10 | 20 | 50) => {
  limit.value = next;
  document.cookie = `ss_page_analytics_limit=${next}; path=/; SameSite=Lax`;
};
const rangeLabel = computed(() => t(range.value === 'month' ? 'pageAnalytics.monthTrend' : range.value === 'week' ? 'pageAnalytics.weeklyTrend' : 'pageAnalytics.dailyTrend'));
const buttonClass = (active: boolean) => active
  ? 'border-transparent bg-[var(--ui-accent-soft)] text-[var(--ui-accent)]'
  : 'border-[var(--ui-border)] bg-[var(--ui-panel)] text-[var(--ui-text-muted)]';

const chartCategories = computed(() => analytics.value?.viewsOverTime.map((point) => point.label) ?? []);
const chartLabelStride = computed(() => {
  const categoryCount = chartCategories.value.length;
  if (categoryCount <= 1) return 1;
  const availableWidth = trendChartWidth.value || width.value;
  const labelWidth = range.value === 'week' ? 72 : range.value === 'day' ? 52 : 58;
  const visibleLabels = Math.max(2, Math.floor(availableWidth / labelWidth));
  const minimumStride = range.value === 'week' ? 1 : 2;
  return Math.max(minimumStride, Math.ceil(categoryCount / visibleLabels));
});
const chartSeries = computed(() => [
  { name: t('analytics.views'), data: analytics.value?.viewsOverTime.map((point) => point.views) ?? [] },
  { name: t('analytics.uniqueVisitors'), data: analytics.value?.viewsOverTime.map((point) => point.uniqueVisitors) ?? [] }
]);
const isDark = computed(() => resolvedTheme.value === 'dark');
const isMobileChart = computed(() => width.value < 640);
const chartOptions = computed<ApexOptions>(() => ({
  chart: {
    type: 'area', toolbar: { show: false }, zoom: { enabled: false }, background: 'transparent',
    foreColor: isDark.value ? '#9f9d96' : '#6f6e69',
    fontFamily: 'Segoe UI, ui-sans-serif, system-ui, sans-serif',
    animations: { enabled: true, speed: 500, dynamicAnimation: { enabled: true, speed: 500 }, animateGradually: { enabled: true, delay: 60 } }
  },
  theme: { mode: isDark.value ? 'dark' : 'light' },
  colors: isDark.value ? ['#87d3c3', '#bec97e'] : ['#24837b', '#66800b'],
  stroke: { curve: 'smooth', width: [3, 3] },
  fill: { type: 'gradient', gradient: { opacityFrom: 0.42, opacityTo: 0.08, stops: [0, 90, 100] } },
  markers: { size: 0, hover: { size: 5 } },
  dataLabels: { enabled: false },
  legend: { position: 'top', horizontalAlign: 'left', labels: { colors: isDark.value ? '#9f9d96' : '#6f6e69' } },
  xaxis: {
    categories: chartCategories.value, axisBorder: { show: false }, axisTicks: { show: false },
    labels: { rotate: 0, hideOverlappingLabels: true, trim: false, formatter: (value, _timestamp, options) => {
      const index = typeof options?.i === 'number'
        ? options.i
        : chartCategories.value.indexOf(String(value));
      return index === -1 || index % chartLabelStride.value === 0 ? String(value) : '';
    } }
  },
  yaxis: { min: 0, forceNiceScale: true, labels: { formatter: (value) => `${Math.round(value)}` } },
  grid: { borderColor: isDark.value ? 'rgba(52, 51, 49, 0.9)' : 'rgba(218, 216, 206, 0.92)', strokeDashArray: 4 },
  tooltip: {
    theme: isDark.value ? 'dark' : 'light',
    x: { formatter: (_value, context) => chartCategories.value[context.dataPointIndex] ?? String(_value ?? '') }
  }
}));

const clickPercent = (clicks: number) => analytics.value?.totalLinkClicks
  ? Math.round(clicks / analytics.value.totalLinkClicks * 100)
  : 0;
const faviconFor = (item: PageAnalytics['blockClicks'][number]) => {
  if (!item.url || item.url.startsWith('mailto:') || failedFavicons.value.has(item.blockId)) return null;
  try { return `${new URL(item.url).origin}/favicon.ico`; }
  catch { return null; }
};
const failFavicon = (id: string) => { failedFavicons.value = new Set([...failedFavicons.value, id]); };

const load = async (initial = page.value === null || analytics.value === null) => {
  if (initial) loading.value = true;
  error.value = '';
  try {
    const timezoneOffsetMinutes = -new Date().getTimezoneOffset();
    const analyticsRequest = api<PageAnalytics>(`/api/pages/${route.params.id}/analytics?range=${range.value}&limit=${limit.value}&timezoneOffsetMinutes=${timezoneOffsetMinutes}`);
    if (initial) {
      [page.value, analytics.value] = await Promise.all([
        api<PageDetail>(`/api/pages/${route.params.id}`),
        analyticsRequest
      ]);
    } else {
      analytics.value = await analyticsRequest;
    }
  } catch (caught) { error.value = (caught as Error).message || t('errors.pageAnalyticsUnavailable'); }
  finally {
    if (initial) loading.value = false;
  }
};

watch([range, limit], () => void load(false));
onMounted(() => void load(true));
</script>

<template>
  <div v-if="loading" class="panel py-20 text-center text-[var(--ui-text-muted)]">{{ t('common.loading') }}</div>
  <div v-else-if="error" class="panel px-6 py-16 text-center">
    <h2 class="text-xl font-semibold">{{ t('pageAnalytics.unavailable') }}</h2>
    <p class="mx-auto mt-2 max-w-md text-sm text-[var(--ui-text-muted)]">{{ error }}</p>
    <button class="btn-primary mt-5" @click="router.push('/app/pages')">{{ t('pageAnalytics.back') }}</button>
  </div>
  <div v-else-if="page && analytics" class="space-y-4 sm:space-y-6">
    <section class="panel flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div><a :href="page.publicUrl" target="_blank" rel="noopener noreferrer" class="block text-sm text-[var(--ui-accent)] hover:underline">{{ displayUrl(page.publicUrl) }}</a><h2 class="mt-1 text-2xl font-semibold">{{ page.title }}</h2></div>
      <div class="flex gap-2">
        <a class="btn-secondary gap-2" :href="page.publicUrl" target="_blank" rel="noopener noreferrer">{{ t('pageAnalytics.open') }}<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 6L6 18M8 6h10v10"/></svg></a>
        <button class="btn-primary" @click="router.push(`/app/pages/${page.id}`)">{{ t('pageAnalytics.edit') }}</button>
      </div>
    </section>
    <section class="grid gap-3 sm:grid-cols-3">
      <StatCard :label="t('analytics.totalViews')" :value="analytics.totalViews" icon="views" />
      <StatCard :label="t('analytics.uniqueVisitors')" :value="analytics.uniqueVisitors" icon="visitors" />
      <StatCard :label="t('pageAnalytics.linkClicks')" :value="analytics.totalLinkClicks" icon="clicks" />
    </section>
    <section class="panel p-5 sm:p-6">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h3 class="text-xl font-semibold">{{ rangeLabel }}</h3><p class="mt-1 text-sm text-[var(--ui-text-muted)]">{{ t('pageAnalytics.periodDescription') }}</p></div>
        <div class="grid w-full gap-2 sm:flex sm:w-auto">
          <button
            v-for="option in [
              { label: t('pageAnalytics.monthTrend'), value: 'month' },
              { label: t('pageAnalytics.weeklyTrend'), value: 'week' },
              { label: t('pageAnalytics.dailyTrend'), value: 'day' }
            ]"
            :key="option.value"
            type="button"
            class="rounded-2xl border px-4 py-2 text-sm font-medium transition-all duration-200"
            :class="buttonClass(range === option.value)"
            @click="setRange(option.value as 'day' | 'week' | 'month')"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
      <div class="app-scrollbar mt-6 rounded-[2rem] border border-[var(--ui-border)] bg-[var(--ui-panel-muted)] p-3 sm:p-4" :class="isMobileChart ? 'overflow-x-auto overflow-y-hidden' : 'overflow-hidden'">
        <div ref="trendChartContainer" :class="isMobileChart ? 'min-w-[720px]' : 'min-w-0'">
          <VueApexCharts :key="`page-trend-${resolvedTheme}`" type="area" height="330" width="100%" :options="chartOptions" :series="chartSeries" />
        </div>
      </div>
    </section>
    <AnalyticsBreakdownGrid :breakdowns="analytics.breakdowns" />
    <section class="panel p-5 sm:p-6">
      <h3 class="text-xl font-semibold">{{ t('pageAnalytics.topLinks') }}</h3>
      <p class="mt-1 text-sm text-[var(--ui-text-muted)]">{{ t('pageAnalytics.topLinksDescription') }}</p>
      <div v-if="!analytics.blockClicks.length" class="py-10 text-center text-sm text-[var(--ui-text-muted)]">{{ t('pageAnalytics.noLinks') }}</div>
      <div v-else class="mt-4 space-y-3">
        <div v-for="item in analytics.blockClicks" :key="item.blockId" class="panel-muted flex items-center gap-3 p-3 sm:p-4">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--ui-border)] bg-white text-[var(--ui-text-muted)]">
            <img v-if="faviconFor(item)" :src="faviconFor(item)!" alt="" class="h-6 w-6 object-contain" @error="failFavicon(item.blockId)" />
            <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M13.544 10.456a4.37 4.37 0 0 0-6.176 0l-3.089 3.088a4.367 4.367 0 1 0 6.177 6.177L12 18.177"/><path d="M10.456 13.544a4.37 4.37 0 0 0 6.176 0l3.089-3.088a4.367 4.367 0 1 0-6.177-6.177L12 5.823"/></svg>
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-3">
              <p class="truncate text-sm font-semibold">{{ item.label }}</p>
              <p class="shrink-0 text-sm"><span class="font-semibold">{{ item.clicks }}</span> <span class="text-[var(--ui-text-muted)]">· {{ clickPercent(item.clicks) }}%</span></p>
            </div>
            <div class="mt-2 h-2 overflow-hidden rounded-full bg-[var(--ui-pill-bg)]" role="progressbar" :aria-label="t('pageAnalytics.clickPercentage', { label: item.label, percentage: clickPercent(item.clicks) })" :aria-valuenow="clickPercent(item.clicks)" aria-valuemin="0" aria-valuemax="100">
              <div class="h-full rounded-full bg-[var(--ui-accent)] transition-[width] duration-500" :style="{ width: `${clickPercent(item.clicks)}%` }" />
            </div>
          </div>
        </div>
      </div>
    </section>
    <AnalyticsVisitTable
      :rows="analytics.recentClicks"
      :limit="limit"
      :title="t('analytics.recentDetails')"
      :description="t('pageAnalytics.recentDescription')"
      :context-label="t('pageAnalytics.block')"
      @update:limit="setLimit"
    />
  </div>
</template>
