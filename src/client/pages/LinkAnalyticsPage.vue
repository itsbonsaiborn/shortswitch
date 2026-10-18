<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useElementSize, useWindowSize } from '@vueuse/core';
import type { ApexOptions } from 'apexcharts';
import VueApexCharts from 'vue3-apexcharts';
import { useI18n } from 'vue-i18n';
import AnalyticsBreakdownGrid from '../components/AnalyticsBreakdownGrid.vue';
import AnalyticsVisitTable from '../components/AnalyticsVisitTable.vue';
import { api } from '../lib/api';
import { useTheme } from '../composables/useTheme';
import type { LinkDetailsResponse } from '@/shared/types';

const readSessionCookie = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
  if (typeof document === 'undefined') return fallback;
  const value = document.cookie
    .split('; ')
    .find((item) => item.startsWith(`${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');
  if (!value) return fallback;
  const decoded = decodeURIComponent(value) as T;
  return allowed.includes(decoded) ? decoded : fallback;
};

const writeSessionCookie = (name: string, value: string) => {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; SameSite=Lax`;
};

const route = useRoute();
const { width } = useWindowSize();
const { resolvedTheme } = useTheme();
const { t } = useI18n();
const range = ref<'day' | 'week' | 'month'>(
  readSessionCookie('ss_link_analytics_range', ['day', 'week', 'month'] as const, 'day')
);
const limit = ref<10 | 20 | 50>(
  Number(readSessionCookie('ss_link_analytics_limit', ['10', '20', '50'] as const, '10')) as 10 | 20 | 50
);
const data = ref<LinkDetailsResponse | null>(null);
const loading = ref(true);
const analyticsFaviconIndex = ref(0);
const trendChartContainer = ref<HTMLElement | null>(null);
const { width: trendChartWidth } = useElementSize(trendChartContainer);

const load = async (initial = data.value === null) => {
  if (initial) loading.value = true;
  try {
    const timezoneOffsetMinutes = -new Date().getTimezoneOffset();
    data.value = await api<LinkDetailsResponse>(
      `/api/links/${route.params.id}/analytics?range=${range.value}&limit=${limit.value}&timezoneOffsetMinutes=${timezoneOffsetMinutes}`
    );
  } finally {
    if (initial) loading.value = false;
  }
};

const setRange = (next: 'day' | 'week' | 'month') => {
  range.value = next;
  writeSessionCookie('ss_link_analytics_range', next);
};

const setLimit = (next: 10 | 20 | 50) => {
  limit.value = next;
  writeSessionCookie('ss_link_analytics_limit', String(next));
};

const rangeLabel = computed(() => {
  if (range.value === 'month') return t('pageAnalytics.monthTrend');
  if (range.value === 'week') return t('pageAnalytics.weeklyTrend');
  return t('pageAnalytics.dailyTrend');
});

const analyticsTargetHost = computed(() => {
  const targetUrl = data.value?.link.targetUrl;
  if (!targetUrl) return '';
  try {
    return new URL(targetUrl).hostname;
  } catch {
    return '';
  }
});

const analyticsTargetOrigin = computed(() => {
  const targetUrl = data.value?.link.targetUrl;
  if (!targetUrl) return '';
  try {
    return new URL(targetUrl).origin;
  } catch {
    return '';
  }
});

const analyticsIsSharePointHost = computed(() => /(^|\.)(sharepoint\.com)$/i.test(analyticsTargetHost.value));

const analyticsFaviconCandidates = computed(() => {
  if (!analyticsTargetOrigin.value) return [];
  if (analyticsIsSharePointHost.value) {
    return [
      `${analyticsTargetOrigin.value}/_layouts/15/images/odbfavicon.ico`,
      `${analyticsTargetOrigin.value}/favicon.ico`,
      `${analyticsTargetOrigin.value}/favicon.png`,
      `${analyticsTargetOrigin.value}/odbfavicon.ico`
    ];
  }
  return [
    `${analyticsTargetOrigin.value}/favicon.ico`,
    `${analyticsTargetOrigin.value}/favicon.png`,
    `${analyticsTargetOrigin.value}/odbfavicon.ico`
  ];
});

const analyticsFaviconUrl = computed(() => analyticsFaviconCandidates.value[analyticsFaviconIndex.value] ?? '');
const analyticsFaviconFailed = computed(() => !analyticsFaviconUrl.value);

const analyticsFaviconFallback = computed(() => {
  const targetUrl = data.value?.link.targetUrl;
  if (!targetUrl) return 'S';
  try {
    return new URL(targetUrl).hostname.charAt(0).toUpperCase() || 'S';
  } catch {
    return 'S';
  }
});

const chartSeries = computed(() => [
  {
    name: t('analytics.visitors'),
    data: data.value?.overview.points.map((point) => point.clicks) ?? []
  },
  {
    name: t('analytics.uniqueVisitors'),
    data: data.value?.overview.points.map((point) => point.uniqueVisitors) ?? []
  },
  {
    name: t('linkAnalytics.failedAuth'),
    data: data.value?.overview.points.map((point) => point.failedAuths) ?? []
  }
]);

const chartCategories = computed(() => data.value?.overview.points.map((point) => point.label) ?? []);
const chartLabelStride = computed(() => {
  const categoryCount = chartCategories.value.length;
  if (categoryCount <= 1) return 1;
  const availableWidth = trendChartWidth.value || width.value;
  const labelWidth = range.value === 'week' ? 72 : range.value === 'day' ? 52 : 58;
  const visibleLabels = Math.max(2, Math.floor(availableWidth / labelWidth));
  const minimumStride = range.value === 'week' ? 1 : 2;
  return Math.max(minimumStride, Math.ceil(categoryCount / visibleLabels));
});

const isMobileChart = computed(() => width.value < 640);
const isDark = computed(() => resolvedTheme.value === 'dark');

const chartOptions = computed<ApexOptions>(() => ({
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
  theme: {
    mode: isDark.value ? 'dark' : 'light'
  },
  colors: isDark.value ? ['#87d3c3', '#bec97e', '#f89a8a'] : ['#24837b', '#66800b', '#af3029'],
  stroke: {
    curve: 'smooth',
    width: [3, 3, 3]
  },
  fill: {
    type: 'gradient',
    gradient: {
      shadeIntensity: 1,
      opacityFrom: 0.42,
      opacityTo: 0.08,
      stops: [0, 90, 100]
    }
  },
  markers: {
    size: 0,
    hover: {
      size: 5
    }
  },
  dataLabels: { enabled: false },
  legend: {
    position: 'top',
    horizontalAlign: 'left',
    labels: { colors: isDark.value ? '#9f9d96' : '#6f6e69' }
  },
  xaxis: {
    categories: chartCategories.value,
    axisBorder: { show: false },
    axisTicks: { show: false },
    labels: {
      rotate: 0,
      hideOverlappingLabels: true,
      trim: false,
      formatter: (value, _timestamp, options) => {
        const index = typeof options?.i === 'number'
          ? options.i
          : chartCategories.value.indexOf(String(value));
        return index === -1 || index % chartLabelStride.value === 0 ? String(value) : '';
      }
    }
  },
  yaxis: {
    labels: {
      formatter: (value) => `${Math.round(value)}`
    }
  },
  grid: {
    borderColor: isDark.value ? 'rgba(52, 51, 49, 0.9)' : 'rgba(218, 216, 206, 0.92)',
    strokeDashArray: 4
  },
  tooltip: {
    theme: isDark.value ? 'dark' : 'light',
    x: {
      formatter: (_value, context) => chartCategories.value[context.dataPointIndex] ?? String(_value ?? '')
    }
  }
}));

const statCards = computed(() => {
  const overview = data.value?.overview;
  if (!overview) return [];

  return [
    {
      label: t('analytics.visits'),
      value: overview.totalClicks,
      icon: 'visits'
    },
    {
      label: t('analytics.uniqueVisitors'),
      value: overview.uniqueVisitors,
      icon: 'users'
    },
    {
      label: t('analytics.referrers'),
      value: overview.referrers,
      icon: 'referrers'
    },
    {
      label: t('linkAnalytics.trend'),
      value: `${overview.trend}%`,
      icon: 'trend'
    }
  ];
});

const buttonClass = (active: boolean) =>
  active
    ? 'border-transparent bg-[var(--ui-accent-soft)] text-[var(--ui-accent)]'
    : 'border-[var(--ui-border)] bg-[var(--ui-panel)] text-[var(--ui-text-muted)]';

onMounted(() => void load(true));
watch([range, limit], () => void load(false));
watch(
  () => data.value?.link.targetUrl,
  () => {
    analyticsFaviconIndex.value = 0;
  }
);

const handleAnalyticsFaviconError = () => {
  if (analyticsFaviconIndex.value < analyticsFaviconCandidates.value.length - 1) {
    analyticsFaviconIndex.value += 1;
    return;
  }
  analyticsFaviconIndex.value = analyticsFaviconCandidates.value.length;
};
</script>

<template>
  <div class="space-y-6">
    <section v-if="loading" class="panel p-8 text-center text-slate-500 dark:text-slate-400">
      {{ t('common.loading') }}
    </section>

    <template v-else-if="data">
      <section class="grid gap-4 xl:grid-cols-4 md:grid-cols-2">
        <div
          v-for="card in statCards"
          :key="card.label"
          class="panel p-5"
        >
          <p class="text-sm font-medium text-slate-500 dark:text-slate-400">{{ card.label }}</p>
          <div class="mt-3 flex items-center gap-3">
            <svg
              v-if="card.icon === 'visits'"
              xmlns="http://www.w3.org/2000/svg"
              class="h-8 w-8 shrink-0 text-[var(--ui-accent)]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M2.06 12.34a1 1 0 0 1 0-.68C3.42 8.1 7.36 5 12 5s8.58 3.1 9.94 6.66a1 1 0 0 1 0 .68C20.58 15.9 16.64 19 12 19s-8.58-3.1-9.94-6.66Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>

            <svg
              v-else-if="card.icon === 'users'"
              xmlns="http://www.w3.org/2000/svg"
              class="h-8 w-8 shrink-0 text-[var(--ui-accent)]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>

            <svg
              v-else-if="card.icon === 'referrers'"
              xmlns="http://www.w3.org/2000/svg"
              class="h-8 w-8 shrink-0 text-[var(--ui-accent)]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07L11.8 5" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 1 0 7.07 7.07L12.2 19" />
            </svg>

            <svg
              v-else
              xmlns="http://www.w3.org/2000/svg"
              class="h-8 w-8 shrink-0 text-[var(--ui-accent)]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="m22 7-8.5 8.5-5-5L2 17" />
              <path d="M16 7h6v6" />
            </svg>
            <p class="text-3xl font-semibold text-slate-950 dark:text-white">{{ card.value }}</p>
          </div>
        </div>
      </section>

      <section class="panel p-6">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p class="text-sm font-semibold uppercase tracking-[0.25em] text-accent-600 dark:text-accent-300">
              {{ rangeLabel }}
            </p>
            <div class="mt-1 flex min-w-0 items-center gap-3">
              <img
                v-if="analyticsFaviconUrl && !analyticsFaviconFailed"
                :src="analyticsFaviconUrl"
                alt=""
                class="h-9 w-9 rounded-2xl border border-[var(--ui-border)] bg-white object-contain p-1"
                @error="handleAnalyticsFaviconError"
              />
              <div
                v-else
                class="flex h-9 w-9 items-center justify-center rounded-2xl border border-[var(--ui-border)] bg-white text-sm font-semibold"
              >
                {{ analyticsFaviconFallback }}
              </div>
              <a
                :href="data.link.shortUrl"
                target="_blank"
                rel="noreferrer"
                class="truncate text-2xl font-semibold transition-colors hover:text-accent-600 dark:hover:text-accent-300"
              >
                {{ data.link.shortUrl }}
              </a>
            </div>
          </div>

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

        <div
          class="app-scrollbar mt-6 rounded-[2rem] border border-[var(--ui-border)] bg-[var(--ui-panel-muted)] p-3 sm:p-4"
          :class="isMobileChart ? 'overflow-x-auto overflow-y-hidden' : 'overflow-hidden'"
        >
          <div ref="trendChartContainer" :class="isMobileChart ? 'min-w-[720px]' : 'min-w-0'">
            <VueApexCharts
              :key="`link-trend-${resolvedTheme}`"
              type="area"
              height="330"
              width="100%"
              :options="chartOptions"
              :series="chartSeries"
            />
          </div>
        </div>
      </section>

      <AnalyticsBreakdownGrid :breakdowns="data.breakdowns" />
      <AnalyticsVisitTable
        :rows="data.recentClicks"
        :limit="limit"
        :title="t('analytics.recentDetails')"
        :description="t('linkAnalytics.recentDescription')"
        @update:limit="setLimit"
      />
    </template>
  </div>
</template>
