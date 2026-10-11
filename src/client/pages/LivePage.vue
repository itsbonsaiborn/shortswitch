<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../lib/api';
import { useToast } from '../composables/useToast';
import LiveActivityModal from '../components/LiveActivityModal.vue';
import QrCodePopover from '../components/QrCodePopover.vue';
import StatCard from '../components/StatCard.vue';
import type { LiveActivitySummary } from '@/shared/types';

const router = useRouter();
const { pushToast } = useToast();
const activities = ref<LiveActivitySummary[]>([]);
const loading = ref(true);
const modalOpen = ref(false);
const editing = ref<LiveActivitySummary | null>(null);
const copiedActivityId = ref<string | null>(null);
let copiedTimer: number | undefined;
const totalResponses = computed(() => activities.value.reduce((sum, activity) => sum + activity.responseCount, 0));
const isExpired = (activity: LiveActivitySummary) => Boolean(activity.expiresAt && new Date(activity.expiresAt).getTime() <= Date.now());
const isActive = (activity: LiveActivitySummary) => activity.status === 'active' && !isExpired(activity);
const activeCount = computed(() => activities.value.filter(isActive).length);

const load = async () => {
  loading.value = true;
  try { activities.value = await api<LiveActivitySummary[]>('/api/live'); }
  finally { loading.value = false; }
};
const openCreate = () => { editing.value = null; modalOpen.value = true; };
const openEdit = (activity: LiveActivitySummary) => { editing.value = activity; modalOpen.value = true; };
const saved = (activity: LiveActivitySummary) => {
  const index = activities.value.findIndex((item) => item.id === activity.id);
  if (index === -1) activities.value.unshift(activity);
  else activities.value[index] = activity;
};
const copy = async (activity: LiveActivitySummary) => {
  await navigator.clipboard.writeText(activity.publicUrl);
  copiedActivityId.value = activity.id;
  if (copiedTimer) window.clearTimeout(copiedTimer);
  copiedTimer = window.setTimeout(() => { copiedActivityId.value = null; }, 1_400);
  pushToast({ tone: 'success', title: 'Live URL copied', description: activity.publicUrl });
};
const toggleStatus = async (activity: LiveActivitySummary) => {
  const status = isActive(activity) ? 'closed' : 'active';
  const updated = await api<LiveActivitySummary>(`/api/live/${activity.id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status, clearExpirationOnReopen: isExpired(activity) })
  });
  saved(updated);
};
const remove = async (activity: LiveActivitySummary) => {
  if (!window.confirm(`Delete “${activity.title}” and all of its responses?`)) return;
  await api(`/api/live/${activity.id}`, { method: 'DELETE', body: JSON.stringify({}) });
  activities.value = activities.value.filter((item) => item.id !== activity.id);
};
const typeLabel = (type: LiveActivitySummary['type']) => ({
  open_answer: 'Open Answer', word_cloud: 'Word Cloud', multiple_choice: 'Multiple Choice', scale: 'Scale'
})[type];
const identityLabel = (activity: LiveActivitySummary) => activity.identityMode === 'named' ? 'Named' : 'Anonymous';
const statusLabel = (activity: LiveActivitySummary) => isExpired(activity) ? 'Expired' : activity.status === 'active' ? 'Active' : 'Closed';
const remainingLifetime = (activity: LiveActivitySummary) => {
  if (!activity.expiresAt) return null;
  const diffMs = new Date(activity.expiresAt).getTime() - Date.now();
  if (diffMs <= 0) return 'Expired';
  const totalMinutes = Math.max(Math.floor(diffMs / 60_000), 0);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = totalMinutes % 60;
  if (totalDays >= 1) return `${totalDays}d ${hours}h ${minutes}m left`;
  if (totalHours >= 1) return `${totalHours}h ${minutes}m left`;
  return `${Math.max(totalMinutes, 1)}m left`;
};
const remainingLifetimeClass = (activity: LiveActivitySummary) => {
  if (!activity.expiresAt) return '';
  const remainingHours = (new Date(activity.expiresAt).getTime() - Date.now()) / 3_600_000;
  if (remainingHours < 1) return 'border-transparent bg-[#FCE8DB] text-[#AF3029] dark:bg-[#321F1C] dark:text-[#F89A8A]';
  if (remainingHours < 24) return 'border-transparent bg-[var(--ui-pill-bg)] text-[#AD8301] dark:text-[#ECCB60]';
  return 'border-transparent bg-[#E8F3E6] text-[#66800B] dark:bg-[#1B2B29] dark:text-[#BEC97E]';
};

const onLiveCreated = (event: Event) => saved((event as CustomEvent<LiveActivitySummary>).detail);

onMounted(() => {
  window.addEventListener('live-created', onLiveCreated);
  void load();
});
onBeforeUnmount(() => {
  window.removeEventListener('live-created', onLiveCreated);
  if (copiedTimer) window.clearTimeout(copiedTimer);
});
</script>

<template>
  <div class="space-y-4 sm:space-y-6">
    <section class="grid gap-3 sm:grid-cols-3">
      <StatCard label="Total Activities" :value="activities.length" />
      <StatCard label="Total Responses" :value="totalResponses" />
      <StatCard label="Active Activities" :value="activeCount" />
    </section>

    <section class="panel p-5 sm:p-6">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 class="text-xl font-semibold">Live activities</h2><p class="mt-1 text-sm text-[var(--ui-text-muted)]">One question, one short URL, live results.</p></div>
        <button class="btn-primary" @click="openCreate">Create Live</button>
      </div>

      <div v-if="loading" class="py-16 text-center text-[var(--ui-text-muted)]">Loading activities…</div>
      <div v-else-if="activities.length === 0" class="panel-muted mt-6 px-6 py-14 text-center">
        <p class="text-lg font-semibold">No Live activities yet</p>
        <p class="mx-auto mt-2 max-w-md text-sm text-[var(--ui-text-muted)]">Create a question and share its short URL or QR code with participants.</p>
        <button class="btn-primary mt-5" @click="openCreate">Create Live</button>
      </div>
      <div v-else class="mt-6 grid gap-4 xl:grid-cols-2">
        <article v-for="activity in activities" :key="activity.id" class="panel-muted min-w-0 p-5">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0"><h3 class="truncate text-lg font-semibold">{{ activity.title }}</h3><p class="mt-1 truncate text-sm text-[var(--ui-accent)]">{{ activity.publicUrl }}</p></div>
            <div class="flex shrink-0 flex-wrap justify-end gap-2">
              <span class="rounded-full border border-transparent px-3 py-1.5 text-xs font-medium transition-colors" :class="isActive(activity) ? 'bg-[#E8F3E6] text-[#66800B] dark:bg-[#1B2B29] dark:text-[#BEC97E]' : 'bg-[#FCE8DB] text-[#AF3029] dark:bg-[#321F1C] dark:text-[#F89A8A]'">{{ statusLabel(activity) }}</span>
              <span v-if="isActive(activity) && remainingLifetime(activity)" class="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors" :class="remainingLifetimeClass(activity)">{{ remainingLifetime(activity) }}</span>
            </div>
          </div>
          <p class="mt-4 line-clamp-2 text-sm">{{ activity.question }}</p>
          <div class="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div><p class="text-xs text-[var(--ui-text-muted)]">Type</p><p class="mt-1 font-medium">{{ typeLabel(activity.type) }}</p></div>
            <div><p class="text-xs text-[var(--ui-text-muted)]">Identity</p><p class="mt-1 font-medium">{{ identityLabel(activity) }}</p></div>
            <div><p class="text-xs text-[var(--ui-text-muted)]">Responses</p><p class="mt-1 font-medium">{{ activity.responseCount }}</p></div>
            <div><p class="text-xs text-[var(--ui-text-muted)]">Pending</p><p class="mt-1 font-medium" :class="activity.pendingCount ? 'text-[#AD8301] dark:text-[#ECCB60]' : ''">{{ activity.pendingCount }}</p></div>
            <div><p class="text-xs text-[var(--ui-text-muted)]">Participants</p><p class="mt-1 font-medium">{{ activity.uniqueParticipantCount }}</p></div>
            <div><p class="text-xs text-[var(--ui-text-muted)]">Created</p><p class="mt-1 font-medium">{{ new Date(activity.createdAt).toLocaleDateString() }}</p></div>
          </div>
          <div class="mt-5 flex flex-wrap items-center gap-2">
            <button class="btn-primary text-sm" @click="router.push(`/app/live/${activity.id}`)">Results</button>
            <button class="icon-button" aria-label="Edit Live" title="Edit Live" @click="openEdit(activity)">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M0 0h24v24H0z" fill="none" />
                <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
                  <path d="m16.475 5.408 2.117 2.117m-.756-3.982L12.109 9.27a2.1 2.1 0 0 0-.58 1.082L11 13l2.648-.53c.41-.082.786-.283 1.082-.579l5.727-5.727a1.853 1.853 0 1 0-2.621-2.621" />
                  <path d="M19 15v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3" />
                </g>
              </svg>
            </button>
            <button class="icon-button" :aria-label="copiedActivityId === activity.id ? 'Copied' : 'Copy link'" :title="copiedActivityId === activity.id ? 'Copied' : 'Copy link'" @click="copy(activity)">
              <svg v-if="copiedActivityId !== activity.id" xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </button>
            <QrCodePopover :url="activity.publicUrl" :slug="activity.slug" :instance-id="activity.id" />
            <button class="icon-button" :aria-label="isActive(activity) ? 'Close Live' : 'Reopen Live'" :title="isActive(activity) ? 'Close Live' : 'Reopen Live'" @click="toggleStatus(activity)">
              <svg v-if="isActive(activity)" xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 1024 1024" aria-hidden="true">
                <path d="M0 0h1024v1024H0z" fill="none" />
                <path fill="currentColor" fill-rule="evenodd" d="M512 64c247.4 0 448 200.6 448 448S759.4 960 512 960S64 759.4 64 512S264.6 64 512 64m0 76c-205.4 0-372 166.6-372 372s166.6 372 372 372s372-166.6 372-372s-166.6-372-372-372m128.013 198.826c.023.007.042.018.083.059l45.02 45.019c.04.04.05.06.058.083a.12.12 0 0 1 0 .07c-.007.022-.018.041-.059.082L557.254 512l127.861 127.862a.3.3 0 0 1 .05.06l.009.023a.12.12 0 0 1 0 .07c-.007.022-.018.041-.059.082l-45.019 45.02c-.04.04-.06.05-.083.058a.12.12 0 0 1-.07 0c-.022-.007-.041-.018-.082-.059L512 557.254L384.14 685.115c-.042.041-.06.052-.084.059a.12.12 0 0 1-.07 0c-.022-.007-.041-.018-.082-.059l-45.02-45.019a.2.2 0 0 1-.058-.083a.12.12 0 0 1 0-.07c.007-.022.018-.041.059-.082L466.745 512l-127.86-127.86a.3.3 0 0 1-.05-.061l-.009-.023a.12.12 0 0 1 0-.07c.007-.022.018-.041.059-.082l45.019-45.02c.04-.04.06-.05.083-.058a.12.12 0 0 1 .07 0c.022.007.041.018.082.059L512 466.745l127.862-127.86c.04-.041.06-.052.083-.059a.12.12 0 0 1 .07 0Z" />
              </svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M0 0h24v24H0z" fill="none" />
                <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
                  <path d="M21.257 10.962c.474.62.474 1.457 0 2.076C19.764 14.987 16.182 19 12 19s-7.764-4.013-9.257-5.962a1.69 1.69 0 0 1 0-2.076C4.236 9.013 7.818 5 12 5s7.764 4.013 9.257 5.962" />
                  <circle cx="12" cy="12" r="3" />
                </g>
              </svg>
            </button>
            <button class="icon-button text-[#AF3029] dark:text-[#F89A8A]" aria-label="Delete Live" title="Delete Live" @click="remove(activity)">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 1024 1024" aria-hidden="true">
                <path d="M0 0h1024v1024H0z" fill="none" />
                <path fill="currentColor" fill-opacity=".15" d="M292.7 840h438.6l24.2-512h-487z" />
                <path fill="currentColor" d="M864 256H736v-80c0-35.3-28.7-64-64-64H352c-35.3 0-64 28.7-64 64v80H160c-17.7 0-32 14.3-32 32v32c0 4.4 3.6 8 8 8h60.4l24.7 523c1.6 34.1 29.8 61 63.9 61h454c34.2 0 62.3-26.8 63.9-61l24.7-523H888c4.4 0 8-3.6 8-8v-32c0-17.7-14.3-32-32-32m-504-72h304v72H360zm371.3 656H292.7l-24.2-512h487z" />
              </svg>
            </button>
          </div>
        </article>
      </div>
    </section>

    <LiveActivityModal :open="modalOpen" :activity="editing" @close="modalOpen = false" @saved="saved" />
  </div>
</template>
