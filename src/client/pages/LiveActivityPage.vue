<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useWindowSize } from '@vueuse/core';
import type { ApexOptions } from 'apexcharts';
import VueApexCharts from 'vue3-apexcharts';
import { api } from '../lib/api';
import { useToast } from '../composables/useToast';
import { useTheme } from '../composables/useTheme';
import AnalyticsBreakdownGrid from '../components/AnalyticsBreakdownGrid.vue';
import AnalyticsVisitTable from '../components/AnalyticsVisitTable.vue';
import LiveActivityModal from '../components/LiveActivityModal.vue';
import LiveResultsBoard from '../components/LiveResultsBoard.vue';
import StatCard from '../components/StatCard.vue';
import type { LiveActivitySummary, LiveAnalytics, LiveResponseRecord, LiveResponseStatus, LiveResultsSnapshot } from '@/shared/types';

interface Details { activity: LiveActivitySummary; responses: LiveResponseRecord[]; results: LiveResultsSnapshot; analytics: LiveAnalytics }
const route = useRoute();
const { pushToast } = useToast();
const { width } = useWindowSize();
const { resolvedTheme } = useTheme();
const details = ref<Details | null>(null);
const loading = ref(true);
const editOpen = ref(false);
const editingResponseId = ref<string | null>(null);
const editedText = ref('');
const editedParticipantName = ref('');
const readCookie = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
  const value = document.cookie.split('; ').find((item) => item.startsWith(`${name}=`))?.split('=')[1];
  return value && allowed.includes(value as T) ? value as T : fallback;
};
const range = ref<'day' | 'week' | 'month'>(readCookie('ss_live_analytics_range', ['day', 'week', 'month'] as const, 'day'));
const limit = ref<10 | 20 | 50>(Number(readCookie('ss_live_analytics_limit', ['10', '20', '50'] as const, '10')) as 10 | 20 | 50);
let events: EventSource | null = null;

const pending = computed(() => details.value?.responses.filter((response) => response.status === 'pending') ?? []);
const published = computed(() => details.value?.responses.filter((response) => response.status === 'approved') ?? []);
const optionLabels = computed(() => new Map(details.value?.activity.options.map((option) => [option.id, option.label]) ?? []));
const rangeLabel = computed(() => range.value === 'month' ? 'Month trend' : range.value === 'week' ? 'Weekly trend' : 'Daily trend');
const isDark = computed(() => resolvedTheme.value === 'dark');
const isMobileChart = computed(() => width.value < 640);
const chartCategories = computed(() => details.value?.analytics.viewsOverTime.map((point) => point.label) ?? []);
const chartSeries = computed(() => [
  { name: 'Views', data: details.value?.analytics.viewsOverTime.map((point) => point.views) ?? [] },
  { name: 'Unique visitors', data: details.value?.analytics.viewsOverTime.map((point) => point.uniqueVisitors) ?? [] }
]);
const chartOptions = computed<ApexOptions>(() => ({
  chart: { type: 'area', toolbar: { show: false }, zoom: { enabled: false }, background: 'transparent',
    foreColor: isDark.value ? '#9f9d96' : '#6f6e69', fontFamily: 'Segoe UI, ui-sans-serif, system-ui, sans-serif',
    animations: { enabled: true, speed: 500, dynamicAnimation: { enabled: true, speed: 500 }, animateGradually: { enabled: true, delay: 60 } } },
  theme: { mode: isDark.value ? 'dark' : 'light' },
  colors: isDark.value ? ['#87d3c3', '#bec97e'] : ['#24837b', '#66800b'],
  stroke: { curve: 'smooth', width: [3, 3] },
  fill: { type: 'gradient', gradient: { opacityFrom: 0.42, opacityTo: 0.08, stops: [0, 90, 100] } },
  markers: { size: 0, hover: { size: 5 } }, dataLabels: { enabled: false },
  legend: { position: 'top', horizontalAlign: 'left', labels: { colors: isDark.value ? '#9f9d96' : '#6f6e69' } },
  xaxis: { categories: chartCategories.value, axisBorder: { show: false }, axisTicks: { show: false }, labels: {
    rotate: 0, hideOverlappingLabels: true, trim: false,
    formatter: (value) => {
      if (range.value === 'week') return String(value);
      const index = chartCategories.value.indexOf(String(value));
      return index === -1 || index % 2 === 0 ? String(value) : '';
    }
  } },
  yaxis: { min: 0, forceNiceScale: true, labels: { formatter: (value) => `${Math.round(value)}` } },
  grid: { borderColor: isDark.value ? 'rgba(52, 51, 49, 0.9)' : 'rgba(218, 216, 206, 0.92)', strokeDashArray: 4 },
  tooltip: { theme: isDark.value ? 'dark' : 'light', x: { formatter: (_value, context) => chartCategories.value[context.dataPointIndex] ?? String(_value ?? '') } }
}));
const buttonClass = (active: boolean) => active
  ? 'border-transparent bg-[var(--ui-accent-soft)] text-[var(--ui-accent)]'
  : 'border-[var(--ui-border)] bg-[var(--ui-panel)] text-[var(--ui-text-muted)]';
const setRange = (next: 'day' | 'week' | 'month') => {
  range.value = next;
  document.cookie = `ss_live_analytics_range=${next}; path=/; SameSite=Lax`;
};
const setLimit = (next: 10 | 20 | 50) => {
  limit.value = next;
  document.cookie = `ss_live_analytics_limit=${next}; path=/; SameSite=Lax`;
};

const load = async (showLoading = true) => {
  if (showLoading) loading.value = true;
  try {
    const timezoneOffsetMinutes = -new Date().getTimezoneOffset();
    details.value = await api<Details>(`/api/live/${route.params.id}?range=${range.value}&limit=${limit.value}&timezoneOffsetMinutes=${timezoneOffsetMinutes}`);
  }
  finally { loading.value = false; }
};
const connect = () => {
  events?.close();
  if (!details.value) return;
  events = new EventSource(`/api/live/public/${encodeURIComponent(details.value.activity.slug)}/presentation/events`);
  events.addEventListener('results', (event) => {
    if (details.value) details.value.results = JSON.parse((event as MessageEvent).data) as LiveResultsSnapshot;
    void load(false);
  });
};
const saveActivity = (activity: LiveActivitySummary) => {
  if (details.value) details.value.activity = activity;
  connect();
};
const startEdit = (response: LiveResponseRecord) => {
  editingResponseId.value = response.id;
  editedText.value = response.publishedText ?? response.originalText ?? '';
  editedParticipantName.value = response.participantName ?? response.originalParticipantName ?? '';
};
const moderate = async (response: LiveResponseRecord, status: LiveResponseStatus, confirmRuleMatch = false) => {
  const publishedText = editingResponseId.value === response.id ? editedText.value : response.publishedText;
  const participantName = editingResponseId.value === response.id ? editedParticipantName.value : response.participantName;
  try {
    await api(`/api/live/${route.params.id}/responses/${response.id}`, {
      method: 'PATCH', body: JSON.stringify({ status, publishedText, participantName, confirmRuleMatch })
    });
    editingResponseId.value = null;
    editedParticipantName.value = '';
    await load(false);
  } catch (error) {
    const message = (error as Error).message;
    if (status === 'approved' && message.includes('Confirm to approve') && window.confirm(`${message}\n\nApprove anyway?`)) {
      await moderate(response, status, true);
      return;
    }
    pushToast({ tone: 'error', title: 'Moderation failed', description: message });
  }
};
const responseValue = (response: LiveResponseRecord) => {
  if (response.originalText !== null) return response.originalText;
  if (response.scaleValue !== null) return String(response.scaleValue);
  return response.selectedOptionIds.map((id) => optionLabels.value.get(id) ?? 'Unavailable option').join(', ');
};
const editLabel = (response: LiveResponseRecord) => {
  if (details.value?.activity.identityMode === 'named') {
    return response.originalText !== null ? 'Edit name & answer' : 'Edit name';
  }
  return 'Edit answer';
};

onMounted(async () => { await load(); connect(); });
onBeforeUnmount(() => events?.close());
watch([range, limit], () => void load(false));
</script>

<template>
  <div v-if="loading" class="panel p-12 text-center text-[var(--ui-text-muted)]">Loading activity…</div>
  <div v-else-if="details" class="space-y-4 sm:space-y-6">
    <section class="panel p-5 sm:p-6">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div><p class="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--ui-accent)]">{{ details.activity.status }}</p><h2 class="mt-2 text-2xl font-semibold">{{ details.activity.title }}</h2><p class="mt-2 text-[var(--ui-text-muted)]">{{ details.activity.question }}</p><a :href="details.activity.publicUrl" target="_blank" class="mt-3 inline-block text-sm text-[var(--ui-accent)]">{{ details.activity.publicUrl }}</a></div>
        <div class="flex flex-wrap gap-2"><button class="btn-secondary" @click="editOpen = true">Edit</button><a class="btn-primary" :href="`/present/${details.activity.slug}`" target="_blank">Presentation Mode</a></div>
      </div>
    </section>
    <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <StatCard label="Total Responses" :value="details.activity.responseCount" icon="responses" />
      <StatCard label="Unique Participants" :value="details.activity.uniqueParticipantCount" icon="participants" />
      <StatCard label="Approved" :value="details.activity.approvedCount" icon="approved" />
      <StatCard label="Pending" :value="details.activity.pendingCount" icon="pending" />
      <StatCard label="Rejected" :value="details.activity.rejectedCount" icon="rejected" />
      <StatCard label="Last response" :value="details.activity.lastResponseAt ? new Date(details.activity.lastResponseAt).toLocaleTimeString() : '—'" icon="last-response" />
    </section>
    <section class="panel p-5 sm:p-6"><h2 class="text-xl font-semibold">Live results</h2><div class="mt-5"><LiveResultsBoard :activity="details.activity" :results="details.results" /></div></section>
    <section class="panel p-5 sm:p-6">
      <div class="flex items-center justify-between"><div><h2 class="text-xl font-semibold">Moderation Queue</h2><p class="mt-1 text-sm text-[var(--ui-text-muted)]">Pending responses require a decision before publication.</p></div><span class="rounded-full bg-[var(--ui-pill-bg)] px-3 py-1 text-sm">{{ pending.length }}</span></div>
      <div v-if="pending.length === 0" class="panel-muted mt-5 p-8 text-center text-sm text-[var(--ui-text-muted)]">Nothing is waiting for review.</div>
      <div v-else class="mt-5 space-y-3">
        <article v-for="response in pending" :key="response.id" class="panel-muted p-4">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div class="min-w-0 flex-1">
              <p v-if="editingResponseId !== response.id" class="font-medium">{{ response.participantName ?? 'Anonymous' }}</p>
              <div v-else class="space-y-3">
                <label v-if="details.activity.identityMode === 'named'" class="block">
                  <span class="mb-2 block text-sm font-medium">Participant name</span>
                  <input v-model="editedParticipantName" class="input px-4 py-3" maxlength="80" required />
                </label>
                <label v-if="response.originalText !== null" class="block">
                  <span class="mb-2 block text-sm font-medium">Answer</span>
                  <textarea v-model="editedText" class="input min-h-24 px-4 py-3" :maxlength="details.activity.maxAnswerLength" />
                </label>
              </div>
              <p class="mt-1 text-xs text-[var(--ui-text-muted)]">{{ new Date(response.createdAt).toLocaleString() }} · {{ response.moderationReason }}</p>
              <p v-if="editingResponseId !== response.id || response.originalText === null" class="mt-3 whitespace-pre-wrap">{{ responseValue(response) }}</p>
            </div>
            <div class="flex shrink-0 flex-wrap gap-2">
              <button v-if="response.originalText !== null || details.activity.identityMode === 'named'" class="btn-secondary text-sm" @click="startEdit(response)">{{ editLabel(response) }}</button>
              <button class="btn-primary text-sm" @click="moderate(response, 'approved')">Approve</button>
              <button class="btn-secondary text-sm text-[#AF3029] dark:text-[#F89A8A]" @click="moderate(response, 'rejected')">Reject</button>
            </div>
          </div>
        </article>
      </div>
    </section>
    <section class="panel p-5 sm:p-6"><h2 class="text-xl font-semibold">Published responses</h2><div class="mt-5 space-y-3"><article v-for="response in published" :key="response.id" class="panel-muted flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p>{{ response.publishedText ?? responseValue(response) }}</p><p class="mt-1 text-xs text-[var(--ui-text-muted)]">{{ response.participantName ?? 'Anonymous' }}<span v-if="response.editedByModerator"> · Answer edited by moderator</span><span v-if="response.nameEditedByModerator"> · Name edited by moderator (original: {{ response.originalParticipantName }})</span></p></div><button class="btn-secondary shrink-0 text-sm text-[#AF3029] dark:text-[#F89A8A]" @click="moderate(response, 'rejected')">Hide</button></article><p v-if="published.length === 0" class="text-sm text-[var(--ui-text-muted)]">No published responses.</p></div></section>
    <section class="panel p-5 sm:p-6">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h3 class="text-xl font-semibold">{{ rangeLabel }}</h3><p class="mt-1 text-sm text-[var(--ui-text-muted)]">Views and unique visitors for this Live Activity.</p></div>
        <div class="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto">
          <button v-for="option in [{ label: 'Month trend', value: 'month' }, { label: 'Weekly trend', value: 'week' }, { label: 'Daily trend', value: 'day' }]" :key="option.value" class="rounded-2xl border px-4 py-2 text-sm font-medium transition-all duration-200" :class="buttonClass(range === option.value)" @click="setRange(option.value as 'day' | 'week' | 'month')">{{ option.label }}</button>
        </div>
      </div>
      <div class="app-scrollbar mt-6 rounded-[2rem] border border-[var(--ui-border)] bg-[var(--ui-panel-muted)] p-3 sm:p-4" :class="isMobileChart ? 'overflow-x-auto overflow-y-hidden' : 'overflow-hidden'">
        <div :class="isMobileChart ? 'min-w-[720px]' : 'min-w-0'"><VueApexCharts type="area" height="330" width="100%" :options="chartOptions" :series="chartSeries" /></div>
      </div>
    </section>
    <AnalyticsBreakdownGrid :breakdowns="details.analytics.breakdowns" />
    <AnalyticsVisitTable :rows="details.analytics.recentViews" :limit="limit" title="Recent visit details" description="Latest participant-page visits for this Live Activity." @update:limit="setLimit" />
    <LiveActivityModal :open="editOpen" :activity="details.activity" @close="editOpen = false" @saved="saveActivity" />
  </div>
</template>
