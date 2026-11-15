<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ANALYTICS_TIME_ZONE, formatRigaDateKey, type AnalyticsDatePreset } from '../../shared/analytics-date-range';
import { useAnalyticsDateRange } from '../composables/useAnalyticsDateRange';

const { t, locale } = useI18n();
const { selection, resolved, selectPreset, selectCustomRange } = useAnalyticsDateRange();
const customStart = ref(selection.value.preset === 'custom' ? selection.value.startDate! : resolved.value.startDate);
const customEnd = ref(selection.value.preset === 'custom' ? selection.value.endDate! : resolved.value.endDate);
const validationError = ref('');
const today = computed(() => formatRigaDateKey(new Date()));

const selectedPreset = computed({
  get: () => selection.value.preset,
  set: (value: AnalyticsDatePreset) => {
    validationError.value = '';
    if (value === 'custom') {
      customStart.value = resolved.value.startDate;
      customEnd.value = resolved.value.endDate;
      applyCustomRange();
      return;
    }
    selectPreset(value);
  }
});

const options = computed(() => [
  { value: 'today', label: t('analytics.today') },
  { value: 'current_week', label: t('analytics.currentWeek') },
  { value: 'current_month', label: t('analytics.currentMonth') },
  { value: 'custom', label: t('analytics.customRange') }
] as const);

const displayFormatter = computed(() => new Intl.DateTimeFormat(locale.value === 'lv' ? 'lv-LV' : 'en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC'
}));
const formatDate = (value: string) => displayFormatter.value.format(new Date(`${value}T00:00:00.000Z`));
const selectedDates = computed(() => {
  const start = formatDate(resolved.value.startDate);
  const end = formatDate(resolved.value.endDate);
  return start === end ? start : `${start} – ${end}`;
});
const aggregationLabel = computed(() => t(`analytics.aggregation.${resolved.value.granularity}`));

function applyCustomRange() {
  validationError.value = '';
  if (!customStart.value || !customEnd.value) return;
  try {
    selectCustomRange(customStart.value, customEnd.value);
  } catch {
    validationError.value = t('analytics.invalidRange');
  }
}

watch(selection, (value) => {
  if (value.preset !== 'custom') return;
  customStart.value = value.startDate!;
  customEnd.value = value.endDate!;
}, { deep: true });
</script>

<template>
  <section class="panel p-4 sm:p-5" aria-labelledby="analytics-date-range-title">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h2 id="analytics-date-range-title" class="text-lg font-semibold text-[var(--ui-text)]">
          {{ t('analytics.dateRange') }}
        </h2>
        <p class="mt-1 text-sm text-[var(--ui-text-muted)]">
          {{ t('analytics.selectedPeriod') }}: <span class="font-medium text-[var(--ui-text)]">{{ selectedDates }}</span>
          <span class="ml-1">({{ ANALYTICS_TIME_ZONE }} · {{ t('analytics.aggregationLabel', { value: aggregationLabel }) }})</span>
        </p>
      </div>

      <div class="grid gap-3 sm:grid-cols-2 lg:flex lg:items-end">
        <label class="grid gap-1.5 text-sm font-medium text-[var(--ui-text-muted)]">
          <span>{{ t('analytics.dateRange') }}</span>
          <select v-model="selectedPreset" class="input min-w-56" :aria-label="t('analytics.dateRange')">
            <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>

        <template v-if="selection.preset === 'custom'">
          <label class="grid gap-1.5 text-sm font-medium text-[var(--ui-text-muted)]">
            <span>{{ t('analytics.customStart') }}</span>
            <input v-model="customStart" class="input" type="date" :max="today" @change="applyCustomRange" />
          </label>
          <label class="grid gap-1.5 text-sm font-medium text-[var(--ui-text-muted)]">
            <span>{{ t('analytics.customEnd') }}</span>
            <input v-model="customEnd" class="input" type="date" :max="today" @change="applyCustomRange" />
          </label>
        </template>
      </div>
    </div>
    <p v-if="validationError" class="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">{{ validationError }}</p>
  </section>
</template>
