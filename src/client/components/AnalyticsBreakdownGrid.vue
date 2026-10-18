<script setup lang="ts">
import { computed, ref } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import type { ApexOptions } from 'apexcharts';
import VueApexCharts from 'vue3-apexcharts';
import type { AnalyticsBreakdowns } from '@/shared/types';
import { useTheme } from '../composables/useTheme';
import { createDonutTooltip } from '../lib/chart-tooltip';
import AnalyticsBreakdownIcon from './AnalyticsBreakdownIcon.vue';
import { chartCategoryColors, chartDonutDividerColor } from '../lib/chart-colors';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ breakdowns: AnalyticsBreakdowns }>();
const { resolvedTheme } = useTheme();
const isDark = computed(() => resolvedTheme.value === 'dark');
const { t, locale } = useI18n();
const isCoarsePointer = useMediaQuery('(hover: none), (pointer: coarse)');
const isMobileLayout = useMediaQuery('(max-width: 767px)');
const allowDonutSelection = computed(() => isCoarsePointer.value && isMobileLayout.value);
const selectedIndexes = ref<Record<string, number | null>>({});
const blockDesktopInteraction = (event: Event) => {
  if (allowDonutSelection.value) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
};

const compactBreakdown = (rows: Array<{ label: string; value: number }>) => {
  const sorted = [...rows].sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
  const visible = sorted.slice(0, 4);
  const other = sorted.slice(4).reduce((sum, item) => sum + item.value, 0);
  return other > 0 ? [...visible, { label: 'Other', value: other }] : visible;
};
const displayLabel = (label: string) => {
  const normalized = label.toLocaleLowerCase();
  if (['desktop', 'mobile', 'tablet'].includes(normalized)) return t(`analytics.${normalized}`);
  if (normalized === 'other' || normalized === 'others') return t('common.other');
  if (normalized === 'unknown') return t('analytics.unknown');
  return label;
};
const deviceItems = computed(() => {
  const totals = new Map<string, number>();
  for (const item of props.breakdowns.devices) {
    const normalized = item.label.toLocaleLowerCase();
    const label = normalized === 'mobile'
      ? 'Mobile'
      : normalized === 'tablet'
        ? 'Tablet'
        : normalized === 'desktop'
          ? 'Desktop'
          : 'Other';
    totals.set(label, (totals.get(label) ?? 0) + item.value);
  }
  return ['Desktop', 'Mobile', 'Tablet', 'Other'].map((label) => ({ label, value: totals.get(label) ?? 0 }));
});
const cards = computed(() => [
  { key: 'devices', title: t('analytics.devices'), items: deviceItems.value },
  { key: 'browsers', title: t('analytics.browsers'), items: compactBreakdown(props.breakdowns.browsers) },
  { key: 'operating-systems', title: t('analytics.operatingSystems'), items: compactBreakdown(props.breakdowns.operatingSystems) },
  { key: 'languages', title: t('analytics.languages'), items: compactBreakdown(props.breakdowns.languages) }
]);
const colorsFor = (items: Array<{ label: string; value: number }>) => chartCategoryColors(
  items.map((item) => item.label),
  isDark.value,
  items.map((item) => item.value)
);
const toggleSelection = (key: string, index: number) => {
  if (!allowDonutSelection.value || index < 0) return;
  selectedIndexes.value = {
    ...selectedIndexes.value,
    [key]: selectedIndexes.value[key] === index ? null : index
  };
};
const selectedItem = (key: string, items: Array<{ label: string; value: number }>) => {
  const index = selectedIndexes.value[key];
  return index === null || index === undefined ? null : items[index] ?? null;
};
const options = (key: string, items: Array<{ label: string; value: number }>): ApexOptions => ({
  chart: {
    type: 'donut', foreColor: isDark.value ? '#9f9d96' : '#6f6e69',
    fontFamily: 'Segoe UI, ui-sans-serif, system-ui, sans-serif', background: 'transparent',
    animations: { enabled: true, speed: 450 },
    events: {
      dataPointSelection: (_event, _chart, config) => toggleSelection(key, config.dataPointIndex)
    }
  },
  theme: { mode: isDark.value ? 'dark' : 'light' },
  labels: items.map((item) => displayLabel(item.label)), colors: colorsFor(items),
  dataLabels: { enabled: false }, legend: { show: false },
  stroke: { width: 2, colors: [chartDonutDividerColor(isDark.value)] },
  plotOptions: { pie: { expandOnClick: false, donut: { size: '68%', labels: { show: false } } } },
  states: {
    normal: { filter: { type: 'none' } },
    hover: { filter: { type: 'lighten', value: 0.05 } },
    active: { filter: { type: 'none' } }
  },
  tooltip: {
    enabled: !allowDonutSelection.value,
    followCursor: true,
    custom: createDonutTooltip(
      items.map((item) => ({ ...item, label: displayLabel(item.label) })),
      colorsFor(items),
      locale.value
    )
  }
});
const total = (items: Array<{ label: string; value: number }>) => items.reduce((sum, item) => sum + item.value, 0);
const percentage = (value: number, items: Array<{ label: string; value: number }>) => {
  const sum = total(items);
  return sum > 0 ? (value / sum) * 100 : 0;
};
</script>

<template>
  <section class="breakdown-container">
    <div class="breakdown-grid grid min-w-0 items-stretch gap-4 md:grid-cols-2">
      <div v-for="card in cards" :key="card.key" class="panel flex min-w-0 flex-col p-5 sm:p-6">
        <h2 class="text-xl font-semibold">{{ card.title }}</h2>
        <div class="breakdown-content mt-5 grid flex-1 items-center gap-5 sm:grid-cols-[minmax(130px,0.85fr)_minmax(150px,1.15fr)]">
          <div
            class="breakdown-chart relative mx-auto w-full max-w-[220px]"
            :class="allowDonutSelection ? 'cursor-pointer' : 'ss-donut-desktop cursor-default'"
            @pointerdown.capture="blockDesktopInteraction"
            @mousedown.capture="blockDesktopInteraction"
            @mouseup.capture="blockDesktopInteraction"
            @touchstart.capture="blockDesktopInteraction"
            @click.capture="blockDesktopInteraction"
          >
            <VueApexCharts type="donut" height="200" :options="options(card.key, card.items)" :series="card.items.map((item) => item.value)" />
            <div class="pointer-events-none absolute inset-0 flex items-center justify-center text-center">
              <div v-if="allowDonutSelection && selectedItem(card.key, card.items)" class="grid max-w-[5.5rem] gap-0.5">
                <span class="truncate text-[10px] font-semibold leading-tight text-[var(--ui-text-muted)]">{{ displayLabel(selectedItem(card.key, card.items)?.label ?? '') }}</span>
                <strong class="text-2xl font-bold leading-none text-[var(--ui-text)]">{{ selectedItem(card.key, card.items)?.value }}</strong>
                <span class="text-[10px] font-bold leading-tight text-[var(--ui-accent)]">{{ percentage(selectedItem(card.key, card.items)?.value ?? 0, card.items).toFixed(1) }}%</span>
              </div>
              <strong v-else class="text-3xl font-bold leading-none text-[var(--ui-text)]">{{ total(card.items) }}</strong>
            </div>
          </div>
          <div class="divide-y divide-[var(--ui-border)]">
            <div v-for="(item, itemIndex) in card.items" :key="item.label" class="breakdown-row grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 px-1 py-3">
              <span class="flex h-7 w-7 shrink-0 items-center justify-center" :style="{ color: colorsFor(card.items)[itemIndex] }">
                <AnalyticsBreakdownIcon :category="card.key" :label="item.label" class="h-5 w-5" />
              </span>
              <span class="min-w-0 truncate font-medium" :title="displayLabel(item.label)">{{ displayLabel(item.label) }}</span>
              <strong class="min-w-7 text-right text-lg leading-none">{{ item.value }}</strong>
              <span class="min-w-10 text-right text-xs text-[var(--ui-text-muted)]">{{ percentage(item.value, card.items).toFixed(1) }}%</span>
            </div>
            <div v-if="!card.items.length" class="flex min-h-16 items-center justify-center px-4 py-3 text-sm text-[var(--ui-text-muted)]">{{ t('common.noData') }}</div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.breakdown-container { container-type: inline-size; }
@container (min-width: 1600px) {
  .breakdown-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .breakdown-content { grid-template-columns: minmax(78px, .72fr) minmax(112px, 1.28fr); gap: .5rem; }
  .breakdown-chart { max-width: 150px; }
  .breakdown-row { gap: .5rem; padding-block: .625rem; }
}
</style>
