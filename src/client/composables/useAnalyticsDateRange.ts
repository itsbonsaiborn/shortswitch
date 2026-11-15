import { computed, ref, watch } from 'vue';
import {
  analyticsDateRangeQuery,
  DEFAULT_ANALYTICS_DATE_PRESET,
  normalizeAnalyticsDateRangeSelection,
  resolveAnalyticsDateRange,
  type AnalyticsDatePreset,
  type AnalyticsDateRangeSelection
} from '../../shared/analytics-date-range';

const STORAGE_KEY = 'shortswitch.analyticsDateRange.v1';

const readStoredSelection = (): AnalyticsDateRangeSelection => {
  if (typeof sessionStorage === 'undefined') return { preset: DEFAULT_ANALYTICS_DATE_PRESET };
  try {
    const value = sessionStorage.getItem(STORAGE_KEY);
    const selection = value
      ? normalizeAnalyticsDateRangeSelection(JSON.parse(value))
      : { preset: DEFAULT_ANALYTICS_DATE_PRESET } as AnalyticsDateRangeSelection;
    resolveAnalyticsDateRange(selection);
    return selection;
  } catch {
    return { preset: DEFAULT_ANALYTICS_DATE_PRESET };
  }
};

const selection = ref<AnalyticsDateRangeSelection>(readStoredSelection());

watch(
  selection,
  (value) => {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeAnalyticsDateRangeSelection(value)));
  },
  { deep: true }
);

export const useAnalyticsDateRange = () => {
  const resolved = computed(() => resolveAnalyticsDateRange(selection.value));
  const query = computed(() => analyticsDateRangeQuery(selection.value));

  const selectPreset = (preset: Exclude<AnalyticsDatePreset, 'custom'>) => {
    selection.value = { preset };
  };

  const selectCustomRange = (startDate: string, endDate: string) => {
    const next = normalizeAnalyticsDateRangeSelection({ preset: 'custom', startDate, endDate });
    if (next.preset !== 'custom') throw new Error('Invalid custom analytics range.');
    resolveAnalyticsDateRange(next);
    selection.value = next;
  };

  return {
    selection,
    resolved,
    query,
    selectPreset,
    selectCustomRange
  };
};

export const resetAnalyticsDateRangeForTests = () => {
  selection.value = { preset: DEFAULT_ANALYTICS_DATE_PRESET };
  if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(STORAGE_KEY);
};
