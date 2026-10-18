<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../lib/api';
import { useToast } from '../composables/useToast';
import LiveActivityModal from '../components/LiveActivityModal.vue';
import QrCodePopover from '../components/QrCodePopover.vue';
import StatCard from '../components/StatCard.vue';
import type { LiveActivitySummary } from '@/shared/types';
import { useI18n } from 'vue-i18n';

const router = useRouter();
const { pushToast } = useToast();
const { t, locale } = useI18n();
const activities = ref<LiveActivitySummary[]>([]);
const loading = ref(true);
const modalOpen = ref(false);
const editing = ref<LiveActivitySummary | null>(null);
const copiedActivityId = ref<string | null>(null);
const activeMenuId = ref('');
const activeMenuAnchor = ref<HTMLElement | null>(null);
const activeMenuStyle = ref<Record<string, string>>({});
const search = ref('');
const sort = ref<'newest' | 'oldest' | 'title' | 'responses'>('newest');
let copiedTimer: number | undefined;

const totalResponses = computed(() => activities.value.reduce((sum, activity) => sum + activity.responseCount, 0));
const isExpired = (activity: LiveActivitySummary) => Boolean(activity.expiresAt && new Date(activity.expiresAt).getTime() <= Date.now());
const isActive = (activity: LiveActivitySummary) => activity.status === 'active' && !isExpired(activity);
const activeCount = computed(() => activities.value.filter(isActive).length);
const visibleActivities = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  const filtered = query
    ? activities.value.filter((activity) =>
        [activity.title, activity.slug, activity.question].some((value) =>
          value.toLocaleLowerCase().includes(query)
        )
      )
    : activities.value;

  return [...filtered].sort((left, right) => {
    if (sort.value === 'oldest') return Date.parse(left.createdAt) - Date.parse(right.createdAt);
    if (sort.value === 'title') return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
    if (sort.value === 'responses') return right.responseCount - left.responseCount || Date.parse(right.createdAt) - Date.parse(left.createdAt);
    return Date.parse(right.createdAt) - Date.parse(left.createdAt);
  });
});

const load = async () => {
  loading.value = true;
  try { activities.value = await api<LiveActivitySummary[]>('/api/live'); }
  finally { loading.value = false; }
};
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
  pushToast({ tone: 'success', title: t('notices.liveUrlCopied'), description: activity.publicUrl });
};
const toggleStatus = async (activity: LiveActivitySummary) => {
  activeMenuId.value = '';
  const status = isActive(activity) ? 'closed' : 'active';
  const updated = await api<LiveActivitySummary>(`/api/live/${activity.id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status, clearExpirationOnReopen: isExpired(activity) })
  });
  saved(updated);
};
const clearStatistics = async (activity: LiveActivitySummary) => {
  activeMenuId.value = '';
  try {
    const result = await api<{ activity: LiveActivitySummary }>(`/api/live/${activity.id}/analytics/clear`, {
      method: 'POST', body: '{}'
    });
    saved(result.activity);
    pushToast({ tone: 'error', title: t('notices.liveStatisticsCleared'), description: t('notices.liveStatisticsDescription', { name: activity.title }) });
  } catch (error) {
    pushToast({ tone: 'error', title: t('notices.liveClearFailed'), description: (error as Error).message });
  }
};
const remove = async (activity: LiveActivitySummary) => {
  activeMenuId.value = '';
  try {
    await api(`/api/live/${activity.id}`, { method: 'DELETE', body: JSON.stringify({}) });
    activities.value = activities.value.filter((item) => item.id !== activity.id);
    pushToast({ tone: 'error', title: t('notices.liveDeleted'), description: t('notices.linkRemoved', { name: activity.title }) });
  } catch (error) {
    pushToast({ tone: 'error', title: t('notices.liveDeleteFailed'), description: (error as Error).message });
  }
};
const openResults = (event: MouseEvent, activity: LiveActivitySummary) => {
  if ((event.target as HTMLElement | null)?.closest('[data-live-action]')) return;
  void router.push(`/app/live/${activity.id}`);
};
const typeLabel = (type: LiveActivitySummary['type']) => ({
  open_answer: t('live.openAnswer'), word_cloud: t('live.wordCloud'), multiple_choice: t('live.multipleChoice'), scale: t('live.scale')
})[type];
const identityLabel = (activity: LiveActivitySummary) => activity.identityMode === 'named' ? t('live.named') : t('live.anonymous');
const statusLabel = (activity: LiveActivitySummary) => isExpired(activity) ? t('live.expired') : activity.status === 'active' ? t('common.active') : t('common.closed');
const displayUrl = (url: string) => url.replace(/^https?:\/\//i, '');
const formatDate = (value: string) => {
  const date = new Date(value);
  return new Intl.DateTimeFormat(locale.value === 'lv' ? 'lv-LV' : 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
};
const remainingLifetime = (activity: LiveActivitySummary) => {
  if (!activity.expiresAt) return null;
  const diffMs = new Date(activity.expiresAt).getTime() - Date.now();
  if (diffMs <= 0) return t('live.expired');
  const totalMinutes = Math.max(Math.floor(diffMs / 60_000), 0);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = totalMinutes % 60;
  if (totalDays >= 1) return t('linkCard.daysLeft', { days: totalDays, hours, minutes });
  if (totalHours >= 1) return t('linkCard.hoursLeft', { hours: totalHours, minutes });
  return t('linkCard.minutesLeft', { minutes: Math.max(totalMinutes, 1) });
};
const remainingLifetimeClass = (activity: LiveActivitySummary) => {
  if (!activity.expiresAt) return '';
  const remainingHours = (new Date(activity.expiresAt).getTime() - Date.now()) / 3_600_000;
  if (remainingHours < 1) return 'border-transparent bg-[#FCE8DB] text-[#AF3029] dark:bg-[#321F1C] dark:text-[#F89A8A]';
  if (remainingHours < 24) return 'border-transparent bg-[var(--ui-pill-bg)] text-[#AD8301] dark:text-[#ECCB60]';
  return 'border-transparent bg-[#E8F3E6] text-[#66800B] dark:bg-[#1B2B29] dark:text-[#BEC97E]';
};
const buildMenuStyle = (anchor: HTMLElement | null) => {
  if (!anchor || typeof window === 'undefined') return {};
  const rect = anchor.getBoundingClientRect();
  const menuWidth = 220;
  const menuHeight = 168;
  const gap = 10;
  const centeredLeft = rect.left + rect.width / 2 - menuWidth / 2;
  const left = Math.min(
    Math.max(centeredLeft, gap),
    Math.max(window.innerWidth - menuWidth - gap, gap)
  );
  const hasSpaceBelow = rect.bottom + gap + menuHeight <= window.innerHeight - gap;
  const hasSpaceAbove = rect.top - gap - menuHeight >= gap;
  const top = hasSpaceBelow || !hasSpaceAbove ? rect.bottom + gap : rect.top - menuHeight - gap;

  return {
    position: 'fixed',
    left: `${left}px`,
    top: `${Math.max(top, gap)}px`,
    width: `${menuWidth}px`,
    maxWidth: `calc(100vw - ${gap * 2}px)`,
    zIndex: '60'
  };
};
const toggleMenu = (event: MouseEvent, activity: LiveActivitySummary) => {
  if (activeMenuId.value === activity.id) {
    activeMenuId.value = '';
    return;
  }
  activeMenuAnchor.value = event.currentTarget as HTMLElement;
  activeMenuStyle.value = buildMenuStyle(activeMenuAnchor.value);
  activeMenuId.value = activity.id;
};
const syncOpenMenu = () => {
  if (!activeMenuId.value) return;
  activeMenuStyle.value = buildMenuStyle(activeMenuAnchor.value);
};
const closeMenus = (event: MouseEvent) => {
  if ((event.target as HTMLElement | null)?.closest('[data-live-menu]')) return;
  activeMenuId.value = '';
};
const onLiveCreated = (event: Event) => saved((event as CustomEvent<LiveActivitySummary>).detail);

onMounted(() => {
  window.addEventListener('live-created', onLiveCreated);
  document.addEventListener('click', closeMenus);
  window.addEventListener('resize', syncOpenMenu);
  window.addEventListener('scroll', syncOpenMenu, true);
  void load();
});
onBeforeUnmount(() => {
  window.removeEventListener('live-created', onLiveCreated);
  document.removeEventListener('click', closeMenus);
  window.removeEventListener('resize', syncOpenMenu);
  window.removeEventListener('scroll', syncOpenMenu, true);
  if (copiedTimer) window.clearTimeout(copiedTimer);
});
</script>

<template>
  <div class="space-y-4 sm:space-y-6">
    <section class="grid gap-3 sm:grid-cols-3">
      <StatCard :label="t('live.activities')" :value="activities.length" icon="activities" />
      <StatCard :label="t('live.responses')" :value="totalResponses" icon="responses" />
      <StatCard :label="t('live.active')" :value="activeCount" icon="active-activities" />
    </section>

    <section class="flex justify-end">
      <div class="grid w-full gap-2 sm:w-auto sm:grid-cols-[minmax(220px,1fr)_170px]">
        <label class="sr-only" for="live-search">{{ t('live.search') }}</label>
        <input id="live-search" v-model="search" class="input" :placeholder="t('live.search')" />
        <label class="sr-only" for="live-sort">{{ t('common.actions') }}</label>
        <select id="live-sort" v-model="sort" class="input">
          <option value="newest">{{ t('common.newest') }}</option>
          <option value="oldest">{{ t('common.oldest') }}</option>
          <option value="title">{{ t('common.title') }}</option>
          <option value="responses">{{ t('live.mostResponses') }}</option>
        </select>
      </div>
    </section>

    <section v-if="loading" class="panel p-8 text-center text-[var(--ui-text-muted)]">{{ t('live.loading') }}</section>
    <section v-else-if="activities.length === 0" class="panel p-10 text-center">
      <h2 class="text-2xl font-semibold">{{ t('live.empty') }}</h2>
      <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">{{ t('live.emptyDescription') }}</p>
    </section>
    <section v-else-if="visibleActivities.length === 0" class="panel px-6 py-14 text-center">
      <p class="text-lg font-semibold">{{ t('live.noMatches') }}</p>
      <p class="mx-auto mt-2 max-w-md text-sm text-[var(--ui-text-muted)]">{{ t('live.noMatchesDescription') }}</p>
    </section>

    <section v-else class="grid min-w-0 gap-4 xl:grid-cols-2">
      <article
        v-for="activity in visibleActivities"
        :key="activity.id"
        class="panel group relative flex min-w-0 cursor-pointer flex-col gap-4 p-4 transition-all duration-300 hover:border-accent-300/80 dark:hover:border-accent-700/70"
        :class="activeMenuId === activity.id ? 'z-50' : 'hover:z-20'"
        tabindex="0"
        @click="openResults($event, activity)"
        @keydown.enter.self="router.push(`/app/live/${activity.id}`)"
      >
        <div class="flex min-w-0 items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <h3 class="truncate text-[15px] font-semibold">{{ activity.title }}</h3>
            <a :href="activity.publicUrl" target="_blank" rel="noopener noreferrer" class="mt-0.5 block truncate text-sm font-medium transition-colors hover:text-accent-600 dark:hover:text-accent-300" @click.stop>{{ displayUrl(activity.publicUrl) }}</a>
          </div>
          <div class="relative z-20 flex shrink-0 items-center gap-2" data-live-action>
            <a class="icon-button icon-button-primary" :href="`/present/${activity.slug}`" target="_blank" rel="noopener noreferrer" :aria-label="t('live.presentation')" :title="t('live.presentation')" @click.stop>
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0h24v24H0z" fill="none"/><g fill="none"><path fill="currentColor" d="M4.24 10.83c0-4.74 0-7.11 1.53-7.97s3.55.38 7.6 2.85l1.91 1.17c3.75 2.3 5.62 3.44 5.62 5.12s-1.87 2.83-5.62 5.12l-1.91 1.17C9.32 20.76 7.3 22 5.77 21.14s-1.53-3.23-1.53-7.97z" opacity=".2"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4.24 10.83c0-4.74 0-7.11 1.53-7.97s3.55.38 7.6 2.85l1.91 1.17c3.75 2.3 5.62 3.44 5.62 5.12s-1.87 2.83-5.62 5.12l-1.91 1.17C9.32 20.76 7.3 22 5.77 21.14s-1.53-3.23-1.53-7.97z"/></g></svg>
            </a>
            <button class="icon-button" :aria-label="copiedActivityId === activity.id ? t('common.copied') : t('common.copy')" :title="copiedActivityId === activity.id ? t('common.copied') : t('common.copy')" @click.stop="copy(activity)">
              <svg v-if="copiedActivityId !== activity.id" xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
            </button>
            <QrCodePopover :url="activity.publicUrl" :slug="activity.slug" :instance-id="activity.id" @open="activeMenuId = ''" />
            <button class="icon-button" :aria-label="t('liveForm.edit')" :title="t('liveForm.edit')" @click.stop="openEdit(activity)">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0h24v24H0z" fill="none"/><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m16.475 5.408l2.117 2.117m-.756-3.982L12.109 9.27a2.1 2.1 0 0 0-.58 1.082L11 13l2.648-.53c.41-.082.786-.283 1.082-.579l5.727-5.727a1.853 1.853 0 1 0-2.621-2.621"/><path d="M19 15v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3"/></g></svg>
            </button>
            <div class="relative" data-live-menu>
              <button class="icon-button" :aria-label="t('common.actions')" @click.stop="toggleMenu($event, activity)">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
              </button>
              <Transition enter-active-class="transition duration-300 ease-out" enter-from-class="opacity-0" enter-to-class="opacity-100" leave-active-class="transition duration-200 ease-in" leave-from-class="opacity-100" leave-to-class="opacity-0">
                <Teleport to="body">
                  <div v-if="activeMenuId === activity.id" data-live-menu class="cursor-default rounded-3xl border border-[var(--ui-border)] bg-[var(--ui-dropdown-bg)] p-3 ring-1 ring-black/5 backdrop-blur-xl dark:ring-white/5" :style="activeMenuStyle" @click.stop>
                    <button class="flex w-full items-center rounded-2xl border border-transparent px-4 py-3 text-left text-sm transition" :class="isActive(activity) ? 'text-[#AF3029] hover:border-[#AF3029]/20 hover:bg-[#FCE8DB] dark:text-[#F89A8A] dark:hover:bg-[#321F1C]' : 'text-[#66800B] hover:border-[#66800B]/20 hover:bg-[#E8F3E6] dark:text-[#BEC97E] dark:hover:bg-[#1B2B29]'" @click="toggleStatus(activity)">{{ isActive(activity) ? t('common.close') : t('live.reopen') }}</button>
                    <button class="mt-1 flex w-full items-center rounded-2xl border border-transparent px-4 py-3 text-left text-sm text-[#AF3029] transition hover:border-[#AF3029]/20 hover:bg-[#FCE8DB] dark:text-[#F89A8A] dark:hover:bg-[#321F1C]" @click="clearStatistics(activity)">{{ t('common.clear') }}</button>
                    <button class="mt-1 flex w-full items-center rounded-2xl border border-transparent px-4 py-3 text-left text-sm text-[#AF3029] transition hover:border-[#AF3029]/20 hover:bg-[#FCE8DB] dark:text-[#F89A8A] dark:hover:bg-[#321F1C]" @click="remove(activity)">{{ t('common.delete') }}</button>
                  </div>
                </Teleport>
              </Transition>
            </div>
          </div>
        </div>

        <div class="flex min-w-0 items-center text-left text-sm text-[var(--ui-text-muted)]">
          <span class="shrink-0">{{ formatDate(activity.createdAt) }}</span><span class="mx-2 shrink-0 opacity-50">|</span><span class="min-w-0 truncate">{{ activity.question }}</span>
        </div>

        <div class="flex flex-wrap gap-2">
          <span class="rounded-full border border-transparent bg-[var(--ui-pill-bg)] px-3 py-1.5 text-xs font-medium text-[var(--ui-text-muted)]">{{ typeLabel(activity.type) }}</span>
          <span class="rounded-full border border-transparent bg-[var(--ui-pill-bg)] px-3 py-1.5 text-xs font-medium text-[var(--ui-text-muted)]">{{ identityLabel(activity) }}</span>
          <span class="rounded-full border border-transparent bg-[var(--ui-pill-bg)] px-3 py-1.5 text-xs font-medium text-[var(--ui-text-muted)]">{{ t('live.responsesCount', { count: activity.responseCount }) }}</span>
          <span class="rounded-full border border-transparent bg-[var(--ui-pill-bg)] px-3 py-1.5 text-xs font-medium" :class="activity.pendingCount ? 'text-[#AD8301] dark:text-[#ECCB60]' : 'text-[var(--ui-text-muted)]'">{{ t('live.pendingCount', { count: activity.pendingCount }) }}</span>
          <span class="rounded-full border border-transparent bg-[var(--ui-pill-bg)] px-3 py-1.5 text-xs font-medium text-[var(--ui-text-muted)]">{{ t('live.participantsCount', { count: activity.uniqueParticipantCount }) }}</span>
          <span class="rounded-full border border-transparent px-3 py-1.5 text-xs font-medium transition-colors" :class="isActive(activity) ? 'bg-[#E8F3E6] text-[#66800B] dark:bg-[#1B2B29] dark:text-[#BEC97E]' : 'bg-[#FCE8DB] text-[#AF3029] dark:bg-[#321F1C] dark:text-[#F89A8A]'">{{ statusLabel(activity) }}</span>
          <span v-if="isActive(activity) && remainingLifetime(activity)" class="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors" :class="remainingLifetimeClass(activity)">{{ remainingLifetime(activity) }}</span>
        </div>
      </article>
    </section>

    <LiveActivityModal :open="modalOpen" :activity="editing" @close="modalOpen = false" @saved="saved" />
  </div>
</template>
