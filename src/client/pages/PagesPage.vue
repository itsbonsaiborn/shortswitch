<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { PageListResponse, PageStatus, PageSummary } from '@/shared/types';
import { api } from '../lib/api';
import { useToast } from '../composables/useToast';
import QrCodePopover from '../components/QrCodePopover.vue';
import StatCard from '../components/StatCard.vue';

const router = useRouter();
const { pushToast } = useToast();
const result = ref<PageListResponse>({ items: [], total: 0, page: 1, pageSize: 12, stats: { totalPages: 0, totalViews: 0, uniqueVisitors: 0 } });
const loading = ref(true);
const search = ref('');
const sort = ref<'newest' | 'oldest' | 'title' | 'views'>('newest');
const copiedId = ref('');
const activeMenuId = ref('');
const activeMenuAnchor = ref<HTMLElement | null>(null);
const activeMenuHeight = ref(0);
const activeMenuStyle = ref<Record<string, string>>({});
let searchTimer: number | undefined;
let copiedTimer: number | undefined;

const load = async (page = result.value.page) => {
  loading.value = true;
  try {
    const query = new URLSearchParams({ search: search.value, sort: sort.value, page: String(page), pageSize: '12' });
    result.value = await api<PageListResponse>(`/api/pages?${query}`);
  } catch (error) {
    pushToast({ tone: 'error', title: 'Could not load Pages', description: (error as Error).message });
  } finally { loading.value = false; }
};

const runAction = async (action: () => Promise<void>, title: string) => {
  activeMenuId.value = '';
  try { await action(); }
  catch (error) { pushToast({ tone: 'error', title, description: (error as Error).message }); }
};
const copy = async (page: PageSummary) => {
  try {
    await navigator.clipboard.writeText(page.publicUrl);
    copiedId.value = page.id;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(() => { copiedId.value = ''; }, 1400);
    pushToast({ tone: 'success', title: 'Page URL copied', description: page.publicUrl });
  } catch (error) { pushToast({ tone: 'error', title: 'Could not copy URL', description: (error as Error).message }); }
};
const setStatus = (page: PageSummary, status: PageStatus) => runAction(async () => {
  await api(`/api/pages/${page.id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
  await load();
}, 'Could not update Page');
const duplicate = (page: PageSummary) => runAction(async () => {
  const copyPage = await api<PageSummary>(`/api/pages/${page.id}/duplicate`, { method: 'POST', body: '{}' });
  pushToast({ tone: 'success', title: 'Page duplicated', description: copyPage.title });
  await load(1);
}, 'Could not duplicate Page');
const clearAnalytics = async (page: PageSummary) => {
  activeMenuId.value = '';
  await runAction(async () => {
    await api(`/api/pages/${page.id}/analytics/clear`, { method: 'POST', body: '{}' });
    pushToast({ tone: 'error', title: 'Page statistics cleared', description: `${page.title} analytics history was removed.` });
    await load();
  }, 'Could not clear Page statistics');
};
const remove = async (page: PageSummary) => {
  activeMenuId.value = '';
  await runAction(async () => {
    await api(`/api/pages/${page.id}`, { method: 'DELETE', body: '{}' });
    pushToast({ tone: 'error', title: 'Page deleted', description: `${page.title} was removed.` });
    await load(result.value.items.length === 1 && result.value.page > 1 ? result.value.page - 1 : result.value.page);
  }, 'Could not delete Page');
};
const openAnalytics = (event: MouseEvent, page: PageSummary) => {
  if ((event.target as HTMLElement | null)?.closest('[data-page-action]')) return;
  void router.push(`/app/pages/${page.id}/analytics`);
};
const statusLabel = (status: PageStatus) => status === 'published' ? 'Active' : status === 'disabled' ? 'Disabled' : 'Draft';
const statusClass = (status: PageStatus) => status === 'published'
  ? 'bg-[#E8F3E6] text-[#66800B] dark:bg-[#1B2B29] dark:text-[#BEC97E]'
  : status === 'disabled'
    ? 'bg-[#FCE8DB] text-[#AF3029] dark:bg-[#321F1C] dark:text-[#F89A8A]'
    : 'bg-[var(--ui-pill-bg)] text-[var(--ui-text-muted)]';
const displayUrl = (url: string) => url.replace(/^https?:\/\//i, '');
const formatDate = (value: string) => {
  const date = new Date(value);
  return `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`;
};
const buildMenuStyle = (anchor: HTMLElement | null, menuHeight: number) => {
  if (!anchor || typeof window === 'undefined') return {};
  const rect = anchor.getBoundingClientRect();
  const menuWidth = 220;
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
const toggleMenu = (event: MouseEvent, page: PageSummary) => {
  if (activeMenuId.value === page.id) {
    activeMenuId.value = '';
    return;
  }
  activeMenuAnchor.value = event.currentTarget as HTMLElement;
  activeMenuHeight.value = page.status === 'disabled' ? 260 : 216;
  activeMenuStyle.value = buildMenuStyle(activeMenuAnchor.value, activeMenuHeight.value);
  activeMenuId.value = page.id;
};
const syncOpenMenu = () => {
  if (!activeMenuId.value) return;
  activeMenuStyle.value = buildMenuStyle(activeMenuAnchor.value, activeMenuHeight.value);
};
const closeMenus = (event: MouseEvent) => {
  if ((event.target as HTMLElement | null)?.closest('[data-page-menu]')) return;
  activeMenuId.value = '';
};

watch(sort, () => void load(1));
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => void load(1), 250);
});
onMounted(() => {
  document.addEventListener('click', closeMenus);
  window.addEventListener('resize', syncOpenMenu);
  window.addEventListener('scroll', syncOpenMenu, true);
  void load(1);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', closeMenus);
  window.removeEventListener('resize', syncOpenMenu);
  window.removeEventListener('scroll', syncOpenMenu, true);
  if (searchTimer) clearTimeout(searchTimer);
  if (copiedTimer) clearTimeout(copiedTimer);
});
</script>

<template>
  <div class="space-y-4 sm:space-y-6">
    <section class="grid gap-3 sm:grid-cols-3">
      <StatCard label="Total Pages" :value="result.stats.totalPages" icon="pages" />
      <StatCard label="Total Views" :value="result.stats.totalViews" icon="views" />
      <StatCard label="Unique Visitors" :value="result.stats.uniqueVisitors" icon="visitors" />
    </section>

    <section class="flex justify-end">
      <div class="grid w-full gap-2 sm:w-auto sm:grid-cols-[minmax(220px,1fr)_170px]">
        <label class="sr-only" for="page-search">Search Pages</label>
        <input id="page-search" v-model="search" class="input" placeholder="Search title or slug" />
        <label class="sr-only" for="page-sort">Sort Pages</label>
        <select id="page-sort" v-model="sort" class="input">
          <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
          <option value="title">Title</option><option value="views">Most viewed</option>
        </select>
      </div>
    </section>

    <section v-if="loading" class="panel p-8 text-center text-[var(--ui-text-muted)]">Loading Pages…</section>
    <section v-else-if="result.items.length === 0" class="panel p-10 text-center">
        <h2 class="text-2xl font-semibold">{{ search ? 'No matching Pages' : 'No Pages yet' }}</h2>
        <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">Create a public hub from the Create menu in the navigation bar.</p>
    </section>

    <section v-else class="grid min-w-0 gap-4 xl:grid-cols-2">
        <article v-for="page in result.items" :key="page.id" class="panel group relative flex min-w-0 cursor-pointer flex-col gap-4 p-4 transition-all duration-300 hover:border-accent-300/80 dark:hover:border-accent-700/70" :class="activeMenuId === page.id ? 'z-50' : 'hover:z-20'" tabindex="0" @click="openAnalytics($event, page)" @keydown.enter.self="router.push(`/app/pages/${page.id}/analytics`)">
          <div class="flex min-w-0 items-center justify-between gap-3">
            <div class="flex min-w-0 flex-1 items-center gap-3">
              <div class="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[var(--ui-border)] bg-white text-lg">
                <img v-if="page.avatarUrl" :src="page.avatarUrl" alt="" class="h-full w-full object-cover" referrerpolicy="no-referrer" />
                <span v-else>{{ page.emoji || '✦' }}</span>
              </div>
              <div class="min-w-0 flex-1">
                <h3 class="truncate text-[15px] font-semibold">{{ page.title }}</h3>
                <a :href="page.publicUrl" target="_blank" rel="noopener noreferrer" class="mt-0.5 block truncate text-sm font-medium transition-colors hover:text-accent-600 dark:hover:text-accent-300" @click.stop>{{ displayUrl(page.publicUrl) }}</a>
              </div>
            </div>
            <div class="relative z-20 flex shrink-0 items-center gap-2" data-page-action>
              <button class="icon-button" :aria-label="copiedId === page.id ? 'Copied' : 'Copy Page link'" title="Copy Page link" @click.stop="copy(page)">
                <svg v-if="copiedId !== page.id" xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>
              </button>
              <QrCodePopover :url="page.publicUrl" :slug="page.slug" :instance-id="`page-${page.id}`" @open="activeMenuId = ''" />
              <button class="icon-button" aria-label="Edit Page" title="Edit Page" @click.stop="router.push(`/app/pages/${page.id}`)">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m16.475 5.408l2.117 2.117m-.756-3.982L12.109 9.27a2.1 2.1 0 0 0-.58 1.082L11 13l2.648-.53c.41-.082.786-.283 1.082-.579l5.727-5.727a1.853 1.853 0 1 0-2.621-2.621"/><path d="M19 15v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3"/></g></svg>
              </button>
              <div class="relative" data-page-menu>
                <button class="icon-button" aria-label="More Page actions" @click.stop="toggleMenu($event, page)">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
                </button>
                <Transition enter-active-class="transition duration-300 ease-out" enter-from-class="opacity-0" enter-to-class="opacity-100" leave-active-class="transition duration-200 ease-in" leave-from-class="opacity-100" leave-to-class="opacity-0">
                  <Teleport to="body">
                    <div v-if="activeMenuId === page.id" data-page-menu class="cursor-default rounded-3xl border border-[var(--ui-border)] bg-[var(--ui-dropdown-bg)] p-3 ring-1 ring-black/5 backdrop-blur-xl dark:ring-white/5" :style="activeMenuStyle" @click.stop>
                      <button class="flex w-full items-center rounded-2xl border border-transparent px-4 py-3 text-left text-sm transition hover:border-[var(--ui-border)] hover:bg-[#FFFBEF] dark:hover:bg-[#1C1A19]" @click="duplicate(page)">Duplicate</button>
                      <button class="mt-1 flex w-full items-center rounded-2xl border border-transparent px-4 py-3 text-left text-sm text-[#AF3029] transition hover:border-[#AF3029]/20 hover:bg-[#FCE8DB] dark:text-[#F89A8A] dark:hover:bg-[#321F1C]" @click="clearAnalytics(page)">Clear statistics</button>
                      <button v-if="page.status !== 'published'" class="mt-1 flex w-full items-center rounded-2xl border border-transparent px-4 py-3 text-left text-sm transition hover:border-[var(--ui-border)] hover:bg-[#FFFBEF] dark:hover:bg-[#1C1A19]" @click="setStatus(page, 'published')">Publish</button>
                      <button v-if="page.status === 'published'" class="mt-1 flex w-full items-center rounded-2xl border border-transparent px-4 py-3 text-left text-sm text-[#AF3029] transition hover:border-[#AF3029]/20 hover:bg-[#FCE8DB] dark:text-[#F89A8A] dark:hover:bg-[#321F1C]" @click="setStatus(page, 'disabled')">Disable</button>
                      <button v-if="page.status === 'disabled'" class="mt-1 flex w-full items-center rounded-2xl border border-transparent px-4 py-3 text-left text-sm transition hover:border-[var(--ui-border)] hover:bg-[#FFFBEF] dark:hover:bg-[#1C1A19]" @click="setStatus(page, 'draft')">Move to draft</button>
                      <button class="mt-1 flex w-full items-center rounded-2xl border border-transparent px-4 py-3 text-left text-sm text-[#AF3029] transition hover:border-[#AF3029]/20 hover:bg-[#FCE8DB] dark:text-[#F89A8A] dark:hover:bg-[#321F1C]" @click="remove(page)">Delete</button>
                    </div>
                  </Teleport>
                </Transition>
              </div>
            </div>
          </div>

          <div class="flex min-w-0 items-center text-left text-sm text-[var(--ui-text-muted)]">
            <span class="shrink-0">{{ formatDate(page.createdAt) }}</span>
            <span class="mx-2 shrink-0 opacity-50">|</span>
            <span class="min-w-0 truncate">{{ page.description || 'No description' }}</span>
          </div>

          <div class="flex flex-wrap gap-2">
            <span class="rounded-full border border-transparent bg-[var(--ui-pill-bg)] px-3 py-1.5 text-xs font-medium text-[var(--ui-text-muted)]">Blocks: {{ page.blockCount }}</span>
            <span class="rounded-full border border-transparent bg-[var(--ui-pill-bg)] px-3 py-1.5 text-xs font-medium text-[var(--ui-text-muted)]">Views: {{ page.totalViews }}</span>
            <span class="rounded-full border border-transparent bg-[var(--ui-pill-bg)] px-3 py-1.5 text-xs font-medium text-[var(--ui-text-muted)]">Unique: {{ page.uniqueVisitors }}</span>
            <span class="rounded-full border border-transparent px-3 py-1.5 text-xs font-medium" :class="statusClass(page.status)">{{ statusLabel(page.status) }}</span>
          </div>
        </article>
    </section>

      <section v-if="result.total > result.pageSize" class="flex items-center justify-between gap-3">
        <button class="btn-secondary" :disabled="result.page <= 1" @click="load(result.page - 1)">Previous</button>
        <p class="text-sm text-[var(--ui-text-muted)]">Page {{ result.page }} of {{ Math.ceil(result.total / result.pageSize) }}</p>
        <button class="btn-secondary" :disabled="result.page >= Math.ceil(result.total / result.pageSize)" @click="load(result.page + 1)">Next</button>
      </section>
  </div>
</template>
