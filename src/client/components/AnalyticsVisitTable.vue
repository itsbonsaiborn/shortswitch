<script setup lang="ts">
import type { AnalyticsVisitDetail } from '@/shared/types';
import { useI18n } from 'vue-i18n';

const { t, locale } = useI18n();

defineProps<{
  rows: AnalyticsVisitDetail[];
  limit: 10 | 20 | 50;
  title: string;
  description: string;
  contextLabel?: string;
}>();
const emit = defineEmits<{ 'update:limit': [value: 10 | 20 | 50] }>();

const buttonClass = (active: boolean) => active
  ? 'border-transparent bg-[var(--ui-accent-soft)] text-[var(--ui-accent)]'
  : 'border-[var(--ui-border)] bg-[var(--ui-panel)] text-[var(--ui-text-muted)]';
const formatTimestamp = (value: string) => {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
};
const trafficBadgeClass = (value?: 'human' | 'bot' | 'unknown') => {
  if (value === 'human') return 'border-transparent bg-[#E8F3E6] text-[#66800B] dark:bg-[#1B2B29] dark:text-[#BEC97E]';
  if (value === 'bot') return 'border-transparent bg-[var(--ui-pill-bg)] text-[#AD8301] dark:text-[#ECCB60]';
  return 'border-transparent bg-[var(--ui-pill-bg)] text-[var(--ui-text-muted)]';
};
const trafficLabel = (value?: 'human' | 'bot' | 'unknown') => t(value === 'human' ? 'analytics.human' : value === 'bot' ? 'analytics.bot' : 'analytics.unknown');
</script>

<template>
  <section class="panel p-5 sm:p-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div><h3 class="text-xl font-semibold">{{ title }}</h3><p class="mt-1 text-sm text-[var(--ui-text-muted)]">{{ description }}</p></div>
      <div class="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto">
        <button v-for="option in [10, 20, 50]" :key="option" class="rounded-2xl border px-4 py-2 text-sm font-medium transition-all duration-200" :class="buttonClass(limit === option)" @click="emit('update:limit', option as 10 | 20 | 50)">{{ t('analytics.last', { count: option }) }}</button>
      </div>
    </div>
    <div class="mt-5 overflow-x-auto">
      <table class="min-w-full text-sm">
        <thead class="text-left text-[var(--ui-text-muted)]"><tr>
          <th class="pb-3 pr-4">{{ t('analytics.timestamp') }}</th><th v-if="contextLabel" class="pb-3 pr-4">{{ contextLabel }}</th><th class="pb-3 pr-4">{{ t('analytics.ip') }}</th>
          <th class="pb-3 pr-4">{{ t('analytics.browser') }}</th><th class="pb-3 pr-4">{{ t('analytics.os') }}</th><th class="pb-3 pr-4">{{ t('analytics.device') }}</th>
          <th class="pb-3 pr-4">{{ t('analytics.referrer') }}</th><th class="pb-3 pr-4">{{ t('analytics.language') }}</th><th v-if="rows.some((row) => row.trafficType)" class="pb-3">{{ t('analytics.type') }}</th>
        </tr></thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id" class="border-t border-[var(--ui-border)]">
            <td class="whitespace-nowrap py-3 pr-4">{{ formatTimestamp(row.timestamp) }}</td><td v-if="contextLabel" class="max-w-56 truncate py-3 pr-4" :title="row.context">{{ row.context ?? t('analytics.unknown') }}</td>
            <td class="py-3 pr-4">{{ row.ipAddress ?? t('analytics.hidden') }}</td><td class="py-3 pr-4">{{ row.browser }}</td><td class="py-3 pr-4">{{ row.os }}</td>
            <td class="py-3 pr-4">{{ row.device }}</td><td class="py-3 pr-4">{{ row.referrer }}</td><td class="py-3 pr-4">{{ row.language ?? t('analytics.unknown') }}</td>
            <td v-if="rows.some((item) => item.trafficType)" class="py-3"><span class="inline-flex rounded-full border px-2.5 py-1 text-xs font-medium" :class="trafficBadgeClass(row.trafficType)">{{ trafficLabel(row.trafficType) }}</span></td>
          </tr>
          <tr v-if="!rows.length"><td :colspan="contextLabel ? 9 : 8" class="border-t border-[var(--ui-border)] py-10 text-center text-[var(--ui-text-muted)]">{{ t('analytics.noActivity') }}</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
