<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import type { BoardListResponse, BoardSummary } from '@/shared/board-types';
import { api } from '../lib/api';
import { useToast } from '../composables/useToast';
import StatCard from '../components/StatCard.vue';
import QrCodePopover from '../components/QrCodePopover.vue';
import { formatCardDate } from '../lib/date-format';

const { t } = useI18n();
const router = useRouter();
const { pushToast } = useToast();
const data = ref<BoardListResponse>({ items: [], stats: { totalBoards: 0, publishedBoards: 0, totalCards: 0, pendingCards: 0 } });
const loading = ref(true);
const error = ref('');
const search = ref('');
const sort = ref<'newest' | 'oldest' | 'title'>('newest');
const menuId = ref('');
const menuAnchor = ref<HTMLElement | null>(null);
const menuStyle = ref<Record<string, string>>({});
const confirmDelete = ref<BoardSummary | null>(null);
const copiedId = ref('');

const visible = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  const items = data.value.items.filter((board) => !query || `${board.title} ${board.slug}`.toLocaleLowerCase().includes(query));
  return [...items].sort((a, b) => sort.value === 'title'
    ? a.title.localeCompare(b.title)
    : sort.value === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt));
});
const load = async () => {
  loading.value = true; error.value = '';
  try { data.value = await api<BoardListResponse>('/api/boards'); }
  catch (cause) { error.value = (cause as Error).message; }
  finally { loading.value = false; }
};
const action = async (operation: () => Promise<unknown>, success: string) => {
  menuId.value = '';
  try { await operation(); pushToast({ tone: 'success', title: success }); await load(); }
  catch (cause) { pushToast({ tone: 'error', title: t('errors.save'), description: (cause as Error).message }); }
};
const copy = async (board: BoardSummary) => {
  try {
    await navigator.clipboard.writeText(board.publicUrl); copiedId.value = board.id;
    window.setTimeout(() => { copiedId.value = ''; }, 1400);
    pushToast({ tone: 'success', title: t('common.copied'), description: board.publicUrl });
  } catch (cause) {
    pushToast({ tone: 'error', title: t('notices.copyFailed'), description: (cause as Error).message });
  }
};
const remove = async () => {
  const board = confirmDelete.value; if (!board) return;
  confirmDelete.value = null;
  await action(() => api(`/api/boards/${board.id}`, { method: 'DELETE' }), t('boards.deleted'));
};
const globallyExpired = (board: BoardSummary) => Boolean(board.expiresAt && Date.parse(board.expiresAt) <= Date.now());
const statusClass = (board: BoardSummary) => board.archivedAt
  ? 'bg-[var(--ui-pill-bg)] text-[var(--ui-text-muted)]'
  : board.status === 'published' && !globallyExpired(board) ? 'bg-[#E8F3E6] text-[#66800B] dark:bg-[#1B2B29] dark:text-[#BEC97E]'
    : board.status === 'disabled' || globallyExpired(board) ? 'bg-[#FCE8DB] text-[#AF3029] dark:bg-[#321F1C] dark:text-[#F89A8A]'
      : 'bg-[var(--ui-pill-bg)] text-[var(--ui-text-muted)]';
const statusLabel = (board: BoardSummary) => board.archivedAt
  ? t('boards.archivedBadge')
  : globallyExpired(board) ? t('common.disabled') : t(`common.${board.status}`);
const submissionsOpen = (board: BoardSummary) => board.status === 'published' && !board.archivedAt &&
  !board.settings.readOnly && !board.settings.locked &&
  (!board.settings.submissionsExpiresAt || Date.parse(board.settings.submissionsExpiresAt) > Date.now());
const submissionsLabel = (board: BoardSummary) => board.settings.readOnly
  ? t('boardEnhancements.readOnlyBadge')
  : submissionsOpen(board) ? t('boardEnhancements.submissionsOpen') : t('boardEnhancements.submissionsClosed');
const submissionsClass = (board: BoardSummary) => submissionsOpen(board)
  ? 'bg-[#E8F3E6] text-[#66800B] dark:bg-[#1B2B29] dark:text-[#BEC97E]'
  : 'bg-[var(--ui-pill-bg)] text-[var(--ui-text-muted)]';
const displayUrl = (url: string) => url.replace(/^https?:\/\//i, '');
const buildMenuStyle = (anchor: HTMLElement | null) => {
  if (!anchor || typeof window === 'undefined') return {};
  const rect = anchor.getBoundingClientRect();
  const width = 220;
  const height = 236;
  const gap = 10;
  const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, gap), Math.max(window.innerWidth - width - gap, gap));
  const opensBelow = rect.bottom + gap + height <= window.innerHeight - gap;
  const top = opensBelow ? rect.bottom + gap : Math.max(rect.top - height - gap, gap);
  return { position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${width}px`, maxWidth: `calc(100vw - ${gap * 2}px)`, zIndex: '60' };
};
const toggleMenu = (event: MouseEvent, boardId: string) => {
  if (menuId.value === boardId) { menuId.value = ''; return; }
  menuAnchor.value = event.currentTarget as HTMLElement;
  menuStyle.value = buildMenuStyle(menuAnchor.value);
  menuId.value = boardId;
};
const syncMenu = () => { if (menuId.value) menuStyle.value = buildMenuStyle(menuAnchor.value); };
const closeMenus = (event: MouseEvent) => {
  if ((event.target as HTMLElement | null)?.closest('[data-board-menu]')) return;
  menuId.value = '';
};
const openEditor = (event: MouseEvent, board: BoardSummary) => {
  if ((event.target as HTMLElement | null)?.closest('[data-board-action]')) return;
  void router.push(`/app/boards/${board.id}`);
};
onMounted(() => {
  document.addEventListener('click', closeMenus);
  window.addEventListener('resize', syncMenu);
  window.addEventListener('scroll', syncMenu, true);
  void load();
});
onBeforeUnmount(() => {
  document.removeEventListener('click', closeMenus);
  window.removeEventListener('resize', syncMenu);
  window.removeEventListener('scroll', syncMenu, true);
});
</script>

<template>
  <div class="space-y-4 sm:space-y-6">
    <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard :label="t('boards.total')" :value="data.stats.totalBoards" icon="activities" />
      <StatCard :label="t('boards.published')" :value="data.stats.publishedBoards" icon="active-activities" />
      <StatCard :label="t('boards.cards')" :value="data.stats.totalCards" icon="responses" />
      <StatCard :label="t('boards.pending')" :value="data.stats.pendingCards" icon="pending" />
    </section>
    <section class="flex justify-end"><div class="grid w-full gap-2 sm:w-auto sm:grid-cols-[minmax(220px,1fr)_170px]">
      <label class="sr-only" for="board-search">{{ t('boards.search') }}</label><input id="board-search" v-model="search" class="input" :placeholder="t('boards.search')" />
      <label class="sr-only" for="board-sort">{{ t('common.actions') }}</label><select id="board-sort" v-model="sort" class="input"><option value="newest">{{ t('common.newest') }}</option><option value="oldest">{{ t('common.oldest') }}</option><option value="title">{{ t('common.title') }}</option></select>
    </div></section>
    <section v-if="loading" class="panel p-8 text-center text-[var(--ui-text-muted)]" aria-busy="true">{{ t('boards.loading') }}</section>
    <section v-else-if="error" class="panel p-8 text-center"><p class="text-red-600" role="alert">{{ error }}</p><button class="btn-secondary mt-4" @click="load">{{ t('common.retry') }}</button></section>
    <section v-else-if="visible.length === 0" class="panel p-10 text-center"><h2 class="text-2xl font-semibold">{{ search ? t('common.noMatches') : t('boards.empty') }}</h2><p class="mt-2 text-sm text-[var(--ui-text-muted)]">{{ t('boards.emptyDescription') }}</p></section>
    <section v-else class="grid min-w-0 gap-4 xl:grid-cols-2">
      <article v-for="board in visible" :key="board.id" class="panel group relative flex min-w-0 cursor-pointer flex-col gap-4 p-4 transition-all duration-300 hover:border-accent-300/80 dark:hover:border-accent-700/70" :class="menuId === board.id ? 'z-50' : 'hover:z-20'" tabindex="0" @click="openEditor($event, board)" @keydown.enter.self="router.push(`/app/boards/${board.id}`)">
        <div class="flex min-w-0 items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <h2 class="truncate text-[15px] font-semibold">{{ board.title }}</h2>
            <a class="mt-0.5 block truncate text-sm font-medium transition-colors hover:text-accent-600 dark:hover:text-accent-300" :href="board.publicUrl" target="_blank" rel="noopener noreferrer" @click.stop>{{ displayUrl(board.publicUrl) }}</a>
          </div>
          <div class="relative z-20 flex shrink-0 items-center gap-2" data-board-action>
            <button class="icon-button" :aria-label="copiedId === board.id ? t('common.copied') : t('common.copy')" :title="t('common.copy')" @click.stop="copy(board)">
              <svg v-if="copiedId !== board.id" xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
            </button>
            <QrCodePopover :url="board.publicUrl" :slug="board.slug" :instance-id="`board-${board.id}`" @open="menuId = ''" />
            <button class="icon-button" :aria-label="t('boards.edit')" :title="t('boards.edit')" @click.stop="router.push(`/app/boards/${board.id}`)">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0h24v24H0z" fill="none"/><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m16.475 5.408l2.117 2.117m-.756-3.982L12.109 9.27a2.1 2.1 0 0 0-.58 1.082L11 13l2.648-.53c.41-.082.786-.283 1.082-.579l5.727-5.727a1.853 1.853 0 1 0-2.621-2.621"/><path d="M19 15v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3"/></g></svg>
            </button>
            <div class="relative" data-board-menu>
              <button class="icon-button" :aria-label="t('common.actions')" :aria-expanded="menuId === board.id" @click.stop="toggleMenu($event, board.id)"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>
              <Transition enter-active-class="transition duration-300 ease-out" enter-from-class="opacity-0" enter-to-class="opacity-100" leave-active-class="transition duration-200 ease-in" leave-from-class="opacity-100" leave-to-class="opacity-0">
                <Teleport to="body">
                  <div v-if="menuId === board.id" data-board-menu class="cursor-default rounded-3xl border border-[var(--ui-border)] bg-[var(--ui-dropdown-bg)] p-3 ring-1 ring-black/5 backdrop-blur-xl dark:ring-white/5" :style="menuStyle" role="menu" @click.stop>
                    <a class="flex w-full items-center rounded-2xl border border-transparent px-4 py-3 text-left text-sm transition hover:border-[var(--ui-border)] hover:bg-[#FFFBEF] dark:hover:bg-[#1C1A19]" :href="board.presentationUrl" target="_blank" rel="noopener noreferrer">{{ t('boards.openPresentation') }}</a>
                    <button class="mt-1 flex w-full items-center rounded-2xl border border-transparent px-4 py-3 text-left text-sm transition hover:border-[var(--ui-border)] hover:bg-[#FFFBEF] dark:hover:bg-[#1C1A19]" @click="action(() => api(`/api/boards/${board.id}/duplicate`, { method: 'POST', body: '{}' }), t('boards.duplicated'))">{{ t('common.duplicate') }}</button>
                    <button class="mt-1 flex w-full items-center rounded-2xl border border-transparent px-4 py-3 text-left text-sm transition hover:border-[var(--ui-border)] hover:bg-[#FFFBEF] dark:hover:bg-[#1C1A19]" @click="action(() => api(`/api/boards/${board.id}/archive`, { method: 'POST', body: JSON.stringify({ archived: !board.archivedAt }) }), board.archivedAt ? t('boards.restored') : t('boards.archived'))">{{ board.archivedAt ? t('boards.restore') : t('boards.archive') }}</button>
                    <button class="mt-1 flex w-full items-center rounded-2xl border border-transparent px-4 py-3 text-left text-sm text-[#AF3029] transition hover:border-[#AF3029]/20 hover:bg-[#FCE8DB] dark:text-[#F89A8A] dark:hover:bg-[#321F1C]" @click="confirmDelete = board; menuId = ''">{{ t('common.delete') }}</button>
                  </div>
                </Teleport>
              </Transition>
            </div>
          </div>
        </div>
        <div class="flex min-w-0 items-center text-left text-sm text-[var(--ui-text-muted)]"><span class="shrink-0">{{ formatCardDate(board.createdAt) }}</span><span class="mx-2 shrink-0 opacity-50">|</span><span class="min-w-0 truncate">{{ board.description || t('common.noDescription') }}</span></div>
        <div class="flex flex-wrap gap-2"><span class="rounded-full border border-transparent bg-[var(--ui-pill-bg)] px-3 py-1.5 text-xs font-medium text-[var(--ui-text-muted)]">{{ t('boards.cardsCount', { count: board.cardCount }) }}</span><span class="rounded-full border border-transparent bg-[var(--ui-pill-bg)] px-3 py-1.5 text-xs font-medium text-[var(--ui-text-muted)]">{{ t('boards.pendingCount', { count: board.pendingCardCount }) }}</span><span class="rounded-full border border-transparent px-3 py-1.5 text-xs font-medium" :class="statusClass(board)">{{ statusLabel(board) }}</span><span v-if="board.status === 'published' && !board.archivedAt" class="rounded-full border border-transparent px-3 py-1.5 text-xs font-medium" :class="submissionsClass(board)">{{ submissionsLabel(board) }}</span></div>
      </article>
    </section>
    <div v-if="confirmDelete" class="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="delete-board-title" @keydown.esc="confirmDelete = null">
      <div class="panel w-full max-w-md p-6"><h2 id="delete-board-title" class="text-xl font-semibold">{{ t('boards.deleteTitle') }}</h2><p class="mt-2 text-sm text-[var(--ui-text-muted)]">{{ t('boards.deleteDescription') }}</p><div class="mt-6 flex justify-end gap-2"><button class="btn-secondary" @click="confirmDelete = null">{{ t('common.cancel') }}</button><button class="rounded-xl bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700" @click="remove">{{ t('common.delete') }}</button></div></div>
    </div>
  </div>
</template>
