<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useWindowSize } from '@vueuse/core';
import type { ApexOptions } from 'apexcharts';
import VueApexCharts from 'vue3-apexcharts';
import { api } from '../lib/api';
import { useTheme } from '../composables/useTheme';
import StatCard from '../components/StatCard.vue';
import type { GlobalAnalytics } from '@/shared/types';

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

const router = useRouter();
const { width } = useWindowSize();
const { resolvedTheme } = useTheme();
const data = ref<GlobalAnalytics | null>(null);
const hoveredCell = ref<{ label: string; value: number; x: number; y: number } | null>(null);
const heatmapContainerRef = ref<HTMLElement | null>(null);
const topSlugLimit = ref<10 | 20 | 50>(
  Number(readSessionCookie('ss_global_top_slugs_limit', ['10', '20', '50'] as const, '10')) as 10 | 20 | 50
);

onMounted(async () => {
  const timezoneOffsetMinutes = -new Date().getTimezoneOffset();
  data.value = await api<GlobalAnalytics>(`/api/analytics/global?timezoneOffsetMinutes=${timezoneOffsetMinutes}`);
});

const monthlySeries = computed(() => [
  {
    name: 'Clicks',
    data: data.value?.monthlyTrend.map((point) => point.clicks) ?? []
  }
]);

const isDark = computed(() => resolvedTheme.value === 'dark');
const showMonthlyChart = computed(() => width.value >= 640);
const monthlyChartHeight = computed(() => 420);
const isMobileHeatmap = computed(() => width.value < 640);
const heatmapMinWidth = computed(() => (isMobileHeatmap.value ? 760 : 0));
const monthlyCategories = computed(() => data.value?.monthlyTrend.map((point) => point.label) ?? []);

const monthlyChartOptions = computed<ApexOptions>(() => ({
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
      animateGradually: { enabled: true, delay: 50 }
    }
  },
  theme: {
    mode: isDark.value ? 'dark' : 'light'
  },
  colors: isDark.value ? ['#87d3c3'] : ['#24837b'],
  stroke: {
    curve: 'smooth',
    width: 3
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
  grid: {
    borderColor: isDark.value ? 'rgba(52, 51, 49, 0.9)' : 'rgba(218, 216, 206, 0.92)',
    strokeDashArray: 4
  },
  xaxis: {
    categories: monthlyCategories.value,
    axisBorder: { show: false },
    axisTicks: { show: false },
    labels: {
      formatter: (value) => {
        const index = monthlyCategories.value.indexOf(String(value));
        return index === -1 || index % 2 === 0 ? String(value) : '';
      }
    }
  },
  yaxis: {
    labels: {
      formatter: (value) => `${Math.round(value)}`
    }
  },
  tooltip: {
    theme: isDark.value ? 'dark' : 'light',
    x: {
      formatter: (_value, context) => monthlyCategories.value[context.dataPointIndex] ?? String(_value ?? '')
    }
  },
  legend: { show: false }
}));

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hours = Array.from({ length: 24 }, (_, index) => index);

const heatmapMatrix = computed(() => {
  const valueMap = new Map(
    (data.value?.weeklyHeatmap ?? []).map((cell) => [`${cell.day}-${cell.hour}`, cell.value])
  );

  return weekdays.map((label, rowIndex) => ({
    label,
    day: rowIndex + 1,
    cells: hours.map((hour) => ({
      hour,
      value: valueMap.get(`${rowIndex + 1}-${hour}`) ?? 0
    }))
  }));
});

const maxHeatmapValue = computed(() =>
  Math.max(0, ...heatmapMatrix.value.flatMap((row) => row.cells.map((cell) => cell.value)))
);

const heatmapClass = (value: number) => {
  const maxValue = maxHeatmapValue.value;
  if (value <= 0 || maxValue <= 0) {
    return 'border-transparent bg-[var(--ui-pill-bg)]';
  }

  const intensity = value / maxValue;
  if (intensity >= 0.75) {
    return isDark.value ? 'border-transparent bg-[#87d3c3]' : 'border-transparent bg-[#24837b]';
  }
  if (intensity >= 0.45) {
    return isDark.value ? 'border-transparent bg-[#5abdac]' : 'border-transparent bg-[#3aa99f]';
  }
  if (intensity >= 0.2) {
    return isDark.value ? 'border-transparent bg-[var(--ui-accent-soft)]' : 'border-transparent bg-[var(--ui-accent-soft)]';
  }
  return 'border-transparent bg-[var(--ui-pill-bg)]';
};

const openSlugAnalytics = (id: string) => {
  router.push(`/app/links/${id}`);
};

const setTopSlugLimit = (next: 10 | 20 | 50) => {
  topSlugLimit.value = next;
  writeSessionCookie('ss_global_top_slugs_limit', String(next));
};

const topSlugItems = computed(() => (data.value?.top.slugs ?? []).slice(0, topSlugLimit.value));

const showHeatmapTooltip = (event: MouseEvent, label: string, value: number) => {
  const container = heatmapContainerRef.value;
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const tooltipWidth = width.value < 640 ? 156 : 184;
  const tooltipHeight = 72;
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  const contentX = localX + container.scrollLeft;
  const visibleLeft = container.scrollLeft;
  const visibleRight = visibleLeft + rect.width;
  const hasRightSpace = visibleRight - contentX >= tooltipWidth + 18;
  const hasLeftSpace = contentX - visibleLeft >= tooltipWidth + 18;
  const nextX = hasRightSpace || !hasLeftSpace
    ? Math.min(Math.max(contentX + 14, 10), Math.max(container.scrollLeft + rect.width - tooltipWidth - 10, 10))
    : Math.max(contentX - tooltipWidth - 14, 10);
  const prefersBelow = localY < 88;
  const nextY = prefersBelow
    ? Math.min(localY + 16, Math.max(rect.height - tooltipHeight - 10, 10))
    : Math.max(localY - tooltipHeight - 14, 10);

  hoveredCell.value = {
    label,
    value,
    x: nextX,
    y: nextY
  };
};

const hideHeatmapTooltip = () => {
  hoveredCell.value = null;
};
</script>

<template>
  <div v-if="data" class="min-w-0 space-y-6">
    <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Total clicks" :value="data.totals.clicks" />
      <StatCard label="Total links" :value="data.totals.links" />
      <StatCard label="Total referrers" :value="data.totals.referrers" />
      <StatCard label="Total devices" :value="data.totals.devices" />
    </section>

    <section class="grid min-w-0 items-start gap-4" :class="showMonthlyChart ? 'xl:grid-cols-[1.2fr_0.8fr]' : 'grid-cols-1'">
      <div v-if="showMonthlyChart" class="panel flex min-w-0 h-full min-h-[36rem] flex-col overflow-hidden p-5 sm:p-6">
        <div>
          <h2 class="text-xl font-semibold">Monthly traffic trend</h2>
          <p class="mt-1 text-sm text-[var(--ui-text-muted)]">Daily traffic across the last 30 days.</p>
        </div>
        <div class="mt-5 flex min-h-[520px] min-w-0 flex-1 rounded-[2rem] border border-[var(--ui-border)] bg-[var(--ui-panel-muted)] p-4 sm:p-5">
          <VueApexCharts class="w-full" type="area" width="100%" :height="monthlyChartHeight" :options="monthlyChartOptions" :series="monthlySeries" />
        </div>
      </div>

      <div class="panel flex min-w-0 h-full min-h-0 flex-col overflow-hidden p-4 sm:min-h-[34rem] sm:p-6">
        <div>
          <h2 class="text-xl font-semibold">Weekly activity</h2>
          <p class="mt-1 text-sm text-[var(--ui-text-muted)]">Hours across Monday to Sunday, like a compact contribution map.</p>
        </div>
        <div
          ref="heatmapContainerRef"
          class="app-scrollbar app-scrollbar-x relative mt-4 min-w-0 flex-1 overflow-y-hidden overscroll-x-contain rounded-[2rem] border border-[var(--ui-border)] bg-[var(--ui-panel-muted)] p-2 touch-pan-x sm:mt-5 sm:min-h-[390px] sm:p-4"
          :class="isMobileHeatmap ? 'overflow-x-auto' : 'overflow-x-hidden'"
        >
          <div
            :style="heatmapMinWidth ? { minWidth: `${heatmapMinWidth}px` } : undefined"
            class="min-h-[232px] sm:min-h-[358px]"
            :class="isMobileHeatmap ? 'inline-block w-max' : 'block w-full'"
          >
            <div
              class="grid text-[var(--ui-text-muted)]"
              :class="
                isMobileHeatmap
                  ? 'grid-cols-[58px_repeat(24,minmax(0,1fr))] gap-1.5 text-[10px] sm:grid-cols-[72px_repeat(24,minmax(0,1fr))] sm:gap-2 sm:text-[11px]'
                  : 'grid-cols-[44px_repeat(24,minmax(0,1fr))] gap-1 text-[9px]'
              "
            >
              <div></div>
              <div v-for="hour in hours" :key="`hour-${hour}`" class="text-center font-medium">
                {{ isMobileHeatmap || hour % 2 === 0 ? String(hour).padStart(2, '0') : '' }}
              </div>

              <template v-for="row in heatmapMatrix" :key="row.day">
                <div class="flex items-center font-medium text-[var(--ui-text)]" :class="isMobileHeatmap ? 'text-sm' : 'text-[11px]'">
                  {{ row.label }}
                </div>
                <div
                  v-for="cell in row.cells"
                  :key="`${row.day}-${cell.hour}`"
                  class="border transition-colors duration-200"
                  :class="[isMobileHeatmap ? 'aspect-square rounded-[0.72rem] sm:rounded-[0.9rem]' : 'h-10 rounded-[0.7rem]', heatmapClass(cell.value)]"
                  @mouseenter="showHeatmapTooltip($event, `${row.label} ${String(cell.hour).padStart(2, '0')}:00`, cell.value)"
                  @mousemove="showHeatmapTooltip($event, `${row.label} ${String(cell.hour).padStart(2, '0')}:00`, cell.value)"
                  @mouseleave="hideHeatmapTooltip"
                ></div>
              </template>
            </div>
          </div>

          <Transition
            enter-active-class="transition duration-150 ease-out"
            enter-from-class="opacity-0"
            enter-to-class="opacity-100"
            leave-active-class="transition duration-100 ease-in"
            leave-from-class="opacity-100"
            leave-to-class="opacity-0"
          >
            <div
              v-if="hoveredCell"
              class="pointer-events-none absolute z-30 w-[156px] rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-panel)] px-4 py-3 text-sm backdrop-blur-xl shadow-sm sm:w-[184px]"
              :style="{ left: `${hoveredCell.x}px`, top: `${hoveredCell.y}px` }"
            >
              <p class="font-semibold text-[var(--ui-text)]">{{ hoveredCell.label }}</p>
              <p class="mt-1 text-[var(--ui-text-muted)]">{{ hoveredCell.value }} clicks</p>
            </div>
          </Transition>
        </div>
      </div>
    </section>

    <section class="grid min-w-0 gap-4 xl:grid-cols-2">
      <div class="grid min-w-0 gap-4">
        <div class="panel min-w-0 p-5 sm:p-6">
          <h2 class="text-xl font-semibold">Top referrers</h2>
          <ul class="mt-4 space-y-3">
            <li v-for="item in data.top.referrers" :key="item.label" class="flex items-center justify-between gap-3">
              <span class="truncate text-[var(--ui-text-muted)]">{{ item.label }}</span>
              <strong class="shrink-0">{{ item.value }}</strong>
            </li>
          </ul>
        </div>

        <div class="panel min-w-0 p-5 sm:p-6">
          <h2 class="text-xl font-semibold">Language stats</h2>
          <ul class="mt-4 space-y-3">
            <li v-for="item in data.top.languages" :key="item.label" class="flex items-center justify-between gap-3">
              <span class="truncate text-[var(--ui-text-muted)]">{{ item.label }}</span>
              <strong class="shrink-0">{{ item.value }}</strong>
            </li>
          </ul>
        </div>
      </div>

      <div class="grid min-w-0 gap-4">
        <div class="panel min-w-0 p-5 sm:p-6">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-xl font-semibold">Top slugs</h2>
            <div class="grid w-full gap-2 sm:flex sm:w-auto">
              <button
                v-for="option in [10, 20, 50]"
                :key="option"
                class="rounded-2xl border px-4 py-2 text-sm font-medium transition-all duration-200"
                :class="
                  topSlugLimit === option
                    ? 'border-transparent bg-[var(--ui-accent-soft)] text-[var(--ui-accent)]'
                    : 'border-[var(--ui-border)] bg-[var(--ui-panel)] text-[var(--ui-text-muted)]'
                "
                @click="setTopSlugLimit(option as 10 | 20 | 50)"
              >
                Last {{ option }}
              </button>
            </div>
          </div>
          <ul class="mt-4 space-y-3">
            <li v-for="item in topSlugItems" :key="item.id">
              <button
                class="flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left transition-colors duration-200 hover:bg-[var(--ui-panel-muted)]"
                @click="openSlugAnalytics(item.id)"
              >
                <span class="truncate text-[var(--ui-text-muted)]">{{ item.slug }}</span>
                <strong class="shrink-0">{{ item.value }}</strong>
              </button>
            </li>
          </ul>
        </div>

        <div class="panel min-w-0 p-5 sm:p-6">
          <h2 class="text-xl font-semibold">Device analytics</h2>
          <div class="mt-4 grid gap-5 md:grid-cols-3">
            <div>
              <p class="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ui-text-muted)]">Devices</p>
              <ul class="mt-3 space-y-3">
                <li v-for="item in data.devices.devices" :key="item.label" class="flex items-center justify-between gap-3">
                  <span class="truncate text-[var(--ui-text-muted)]">{{ item.label }}</span>
                  <strong class="shrink-0">{{ item.value }}</strong>
                </li>
              </ul>
            </div>
            <hr class="border-[var(--ui-border)] md:hidden" />
            <div>
              <p class="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ui-text-muted)]">Operating systems</p>
              <ul class="mt-3 space-y-3">
                <li v-for="item in data.devices.operatingSystems" :key="item.label" class="flex items-center justify-between gap-3">
                  <span class="truncate text-[var(--ui-text-muted)]">{{ item.label }}</span>
                  <strong class="shrink-0">{{ item.value }}</strong>
                </li>
              </ul>
            </div>
            <hr class="border-[var(--ui-border)] md:hidden" />
            <div>
              <p class="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ui-text-muted)]">Browsers</p>
              <ul class="mt-3 space-y-3">
                <li v-for="item in data.devices.browsers" :key="item.label" class="flex items-center justify-between gap-3">
                  <span class="truncate text-[var(--ui-text-muted)]">{{ item.label }}</span>
                  <strong class="shrink-0">{{ item.value }}</strong>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
