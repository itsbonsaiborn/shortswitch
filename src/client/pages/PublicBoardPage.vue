<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import type { BoardCardCreateResponse, BoardCardInput, BoardCardReactionState, BoardReactionType, BoardRealtimeDelta, PublicBoard, PublicBoardCard } from '@/shared/board-types';
import { ApiError, api } from '../lib/api';
import { sortBoardCards, type BoardCardSortMode } from '../lib/board-card-sort';
import { boardSurfaceClasses, boardSurfaceStyle } from '../lib/board-theme';
import { applyBoardRealtimeDelta } from '../lib/board-realtime';
import BoardCardView from '../components/BoardCardView.vue';

const route = useRoute();
const { t, locale } = useI18n();
const board = ref<PublicBoard | null>(null);
const loading = ref(true);
const error = ref('');
const busy = ref(false);
const dialog = ref<'card' | 'recover' | 'pin' | 'delete' | null>(null);
const selectedCard = ref<PublicBoardCard | null>(null);
const recoveryPin = ref('');
const recoveryPinCopied = ref(false);
const recoveryInput = ref('');
const sortMode = ref<BoardCardSortMode>('newest');
const reactingCardIds = ref<string[]>([]);
const reactionErrors = reactive<Record<string, string>>({});
const isFullscreen = ref(false);
const realtimeMessage = ref('');
const activeCardMenuId = ref('');
const cardMenuAnchor = ref<HTMLElement | null>(null);
const cardMenuStyle = ref<Record<string, string>>({});
let eventSource: EventSource | null = null;
let recoveryPinCopiedTimer: number | undefined;
let boardClockTimer: number | undefined;
const boardClock = ref(Date.now());
const slug = computed(() => String(route.params.slug || window.location.pathname.split('/').filter(Boolean).at(-1) || ''));
const presentation = computed(() => route.path.startsWith('/boards/'));
const surfaceClasses = computed(() => boardSurfaceClasses(board.value?.theme, board.value?.settings ?? { visualStyle: 'classic', backgroundPattern: 'none' }));
const surfaceStyle = computed(() => boardSurfaceStyle(board.value?.settings.patternIntensity ?? 35));
const surfaceTokenClasses = computed(() => surfaceClasses.value.filter((name) =>
  name.startsWith('activity-theme-') || name.startsWith('activity-layout-')
));
const submissionsExpired = computed(() => Boolean(
  board.value?.settings.submissionsExpiresAt &&
  Date.parse(board.value.settings.submissionsExpiresAt) <= boardClock.value
));
const canCreate = computed(() => Boolean(
  board.value && !presentation.value && !board.value.settings.readOnly &&
  !board.value.settings.locked && !submissionsExpired.value
));
const sortedCards = computed(() => sortBoardCards(board.value?.cards ?? [], sortMode.value, locale.value));
const form = reactive<BoardCardInput>({ title: '', body: '', imageUrl: null, authorDisplayName: null, layout: 'text' });
const publicError = (cause: unknown) => cause instanceof ApiError && cause.status === 429
  ? t('boardSecurity.rateLimited')
  : (cause as Error).message;
watch(() => form.layout, (layout) => { if (layout !== 'image_text') form.imageUrl = null; });

const load = async () => {
  loading.value = true; error.value = '';
  try { board.value = await api<PublicBoard>(`/api/boards/public/${encodeURIComponent(slug.value)}${presentation.value ? '?presentation=1' : ''}`); }
  catch (cause) { error.value = publicError(cause); }
  finally { loading.value = false; }
};
const connectRealtime = () => {
  if (typeof EventSource === 'undefined') return;
  eventSource?.close();
  const suffix = presentation.value ? '?presentation=1' : '';
  const source = new EventSource(`/api/boards/public/${encodeURIComponent(slug.value)}/events${suffix}`, { withCredentials: true });
  eventSource = source;
  source.addEventListener('open', () => { realtimeMessage.value = ''; });
  source.addEventListener('snapshot', (event) => {
    try { board.value = JSON.parse((event as MessageEvent).data) as PublicBoard; realtimeMessage.value = ''; }
    catch { void load(); }
  });
  source.addEventListener('delta', (event) => {
    if (!board.value) return void load();
    try {
      const result = applyBoardRealtimeDelta(board.value, JSON.parse((event as MessageEvent).data) as BoardRealtimeDelta);
      if (result.state === 'refresh') void load();
      else board.value = result.board;
    } catch { void load(); }
  });
  source.addEventListener('gone', () => { source.close(); realtimeMessage.value = t('boardRealtime.unavailable'); void load(); });
  source.onerror = () => { realtimeMessage.value = t('boardRealtime.reconnecting'); };
};
const resetForm = () => Object.assign(form, { title: '', body: '', imageUrl: null, authorDisplayName: null, layout: 'text' });
const openCreate = () => { activeCardMenuId.value = ''; selectedCard.value = null; resetForm(); dialog.value = 'card'; };
const openEdit = (card: PublicBoardCard) => {
  activeCardMenuId.value = '';
  selectedCard.value = card;
  Object.assign(form, { title: card.title, body: card.body, imageUrl: card.imageUrl, authorDisplayName: card.authorDisplayName, layout: card.layout === 'compact' ? 'text' : card.layout });
  dialog.value = 'card';
};
const saveCard = async () => {
  busy.value = true; error.value = '';
  try {
    if (selectedCard.value) {
      await api(`/api/boards/public/${encodeURIComponent(slug.value)}/cards/${selectedCard.value.id}`, { method: 'PATCH', body: JSON.stringify(form) });
      dialog.value = null;
    } else {
      const result = await api<BoardCardCreateResponse>(`/api/boards/public/${encodeURIComponent(slug.value)}/cards`, { method: 'POST', body: JSON.stringify(form) });
      recoveryPin.value = result.recoveryPin; dialog.value = 'pin';
    }
    await load();
    connectRealtime();
  } catch (cause) { error.value = publicError(cause); }
  finally { busy.value = false; }
};
const openRecover = (card: PublicBoardCard) => { activeCardMenuId.value = ''; selectedCard.value = card; recoveryInput.value = ''; dialog.value = 'recover'; };
const recover = async () => {
  if (!selectedCard.value) return;
  busy.value = true;
  try {
    await api(`/api/boards/public/${encodeURIComponent(slug.value)}/cards/${selectedCard.value.id}/recover`, { method: 'POST', body: JSON.stringify({ pin: recoveryInput.value }) });
    dialog.value = null; await load(); connectRealtime();
  } catch { error.value = t('boardSecurity.recoveryFailed'); }
  finally { busy.value = false; }
};
const removeCard = async () => {
  if (!selectedCard.value) return;
  busy.value = true;
  try { await api(`/api/boards/public/${encodeURIComponent(slug.value)}/cards/${selectedCard.value.id}`, { method: 'DELETE' }); dialog.value = null; await load(); }
  catch (cause) { error.value = publicError(cause); }
  finally { busy.value = false; }
};
const copyRecoveryPin = async () => {
  await navigator.clipboard.writeText(recoveryPin.value);
  recoveryPinCopied.value = true;
  if (recoveryPinCopiedTimer) window.clearTimeout(recoveryPinCopiedTimer);
  recoveryPinCopiedTimer = window.setTimeout(() => {
    recoveryPinCopied.value = false;
    recoveryPinCopiedTimer = undefined;
  }, 1400);
};
const updateReaction = async (card: PublicBoardCard, reaction: BoardReactionType) => {
  if (reactingCardIds.value.includes(card.id)) return;
  reactingCardIds.value = [...reactingCardIds.value, card.id];
  delete reactionErrors[card.id];
  try {
    const removing = card.reactions.current === reaction;
    const state = await api<BoardCardReactionState>(
      `/api/boards/public/${encodeURIComponent(slug.value)}/cards/${card.id}/reaction`,
      removing
        ? { method: 'DELETE' }
        : { method: 'PUT', body: JSON.stringify({ reaction }) }
    );
    card.reactions = state;
  } catch (cause) {
    reactionErrors[card.id] = publicError(cause);
  } finally {
    reactingCardIds.value = reactingCardIds.value.filter((id) => id !== card.id);
  }
};
const closeDialog = () => { if (!busy.value) dialog.value = null; };
const onKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return;
  if (dialog.value) closeDialog();
  else activeCardMenuId.value = '';
};
const onFullscreenChange = () => { isFullscreen.value = Boolean(document.fullscreenElement); };
const toggleFullscreen = async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
};
const exitPresentation = () => window.location.assign(`/${encodeURIComponent(slug.value)}`);
const hasCardMenu = (card: PublicBoardCard) => !presentation.value && !board.value?.settings.readOnly && (
  (card.owned && (board.value?.settings.participantCanEdit || board.value?.settings.participantCanDelete)) ||
  (!card.owned && board.value?.settings.participantCanEdit)
);
const buildCardMenuStyle = (anchor: HTMLElement | null, card: PublicBoardCard | undefined) => {
  if (!anchor || typeof window === 'undefined') return {};
  const rect = anchor.getBoundingClientRect();
  const width = 208;
  const rows = card?.owned ? Number(Boolean(board.value?.settings.participantCanEdit)) + Number(Boolean(board.value?.settings.participantCanDelete)) : 1;
  const height = 24 + Math.max(rows, 1) * 52;
  const gap = 10;
  const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, gap), Math.max(window.innerWidth - width - gap, gap));
  const top = rect.bottom + gap + height <= window.innerHeight - gap ? rect.bottom + gap : Math.max(rect.top - height - gap, gap);
  return { position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${width}px`, maxWidth: `calc(100vw - ${gap * 2}px)`, zIndex: '80' };
};
const toggleCardMenu = (event: MouseEvent, card: PublicBoardCard) => {
  if (activeCardMenuId.value === card.id) { activeCardMenuId.value = ''; return; }
  cardMenuAnchor.value = event.currentTarget as HTMLElement;
  cardMenuStyle.value = buildCardMenuStyle(cardMenuAnchor.value, card);
  activeCardMenuId.value = card.id;
};
const syncCardMenu = () => {
  if (!activeCardMenuId.value) return;
  cardMenuStyle.value = buildCardMenuStyle(cardMenuAnchor.value, sortedCards.value.find((card) => card.id === activeCardMenuId.value));
};
const closeCardMenus = (event: MouseEvent) => {
  if ((event.target as HTMLElement | null)?.closest('[data-board-card-menu]')) return;
  activeCardMenuId.value = '';
};
watch(sortMode, (value) => {
  if (typeof window !== 'undefined') window.sessionStorage.setItem(`ss_board_sort_${slug.value}`, value);
});
onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('click', closeCardMenus);
  window.addEventListener('resize', syncCardMenu);
  window.addEventListener('scroll', syncCardMenu, true);
  const saved = window.sessionStorage.getItem(`ss_board_sort_${slug.value}`);
  if (saved === 'newest' || saved === 'oldest' || saved === 'title_asc' || saved === 'title_desc' || saved === 'popular') sortMode.value = saved;
  boardClockTimer = window.setInterval(() => { boardClock.value = Date.now(); }, 15_000);
  void load();
  connectRealtime();
});
onBeforeUnmount(() => {
  if (recoveryPinCopiedTimer) window.clearTimeout(recoveryPinCopiedTimer);
  if (boardClockTimer) window.clearInterval(boardClockTimer);
  eventSource?.close();
  eventSource = null;
  window.removeEventListener('keydown', onKeydown);
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  document.removeEventListener('click', closeCardMenus);
  window.removeEventListener('resize', syncCardMenu);
  window.removeEventListener('scroll', syncCardMenu, true);
});
</script>

<template>
  <main class="min-h-dvh px-4 py-6 sm:px-8" :class="[surfaceClasses, { 'board-presentation px-3 sm:px-5': presentation }]" :style="surfaceStyle">
    <div class="mx-auto" :class="presentation ? 'max-w-none' : 'max-w-7xl'">
      <header class="board-header border p-5 sm:p-7">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0">
            <p class="text-xs font-semibold uppercase tracking-[.2em] text-[var(--ui-accent)]">{{ presentation ? t('boards.presentation') : t('boards.publicBoard') }}</p>
            <h1 class="mt-2 break-words text-3xl font-bold sm:text-5xl">{{ board?.title || t('common.loading') }}</h1>
            <p v-if="board?.description" class="mt-3 max-w-3xl break-words text-[var(--ui-text-muted)]">{{ board.description }}</p>
          </div>
          <div v-if="presentation" class="flex shrink-0 flex-wrap gap-2">
            <button type="button" class="board-secondary" @click="toggleFullscreen"><svg aria-hidden="true" class="h-5 w-5" viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg><span>{{ isFullscreen ? t('boards.exitFullscreen') : t('boards.enterFullscreen') }}</span></button>
            <button type="button" class="board-secondary" @click="exitPresentation">{{ t('boards.exitPresentation') }}</button>
          </div>
        </div>
      </header>
      <p v-if="error" class="mt-5 rounded-2xl border border-red-400 bg-red-950/10 p-4 text-sm text-red-700 dark:text-red-300" role="alert">{{ error }}</p>
      <p v-if="realtimeMessage" class="mt-4 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-panel)] px-4 py-3 text-sm text-[var(--ui-text-muted)]" role="status">{{ realtimeMessage }}</p>
      <section v-if="loading" class="board-panel mt-6 border p-10 text-center" aria-busy="true">{{ t('common.loading') }}</section>
      <section v-else-if="board && board.cards.length === 0" class="board-panel mt-6 border p-10 text-center"><h2 class="text-xl font-semibold">{{ t('boards.publicEmpty') }}</h2><p class="mt-2 text-sm text-[var(--ui-text-muted)]">{{ t('boards.publicEmptyDescription') }}</p></section>
      <template v-else>
        <div class="mt-6 flex justify-end">
          <label class="board-sort-label text-sm font-medium">
            <span>{{ t('boards.sortBy') }}</span>
            <select v-model="sortMode" class="board-sort-select" :aria-label="t('boards.sortBy')">
              <option value="newest">{{ t('boards.sortNewest') }}</option>
              <option value="oldest">{{ t('boards.sortOldest') }}</option>
              <option value="title_asc">{{ t('boards.sortTitleAsc') }}</option>
              <option value="title_desc">{{ t('boards.sortTitleDesc') }}</option>
              <option value="popular">{{ t('boardEnhancements.sortPopular') }}</option>
            </select>
          </label>
        </div>
      <section class="board-grid mt-4" :aria-label="t('boards.cards')">
        <BoardCardView v-for="card in sortedCards" :key="card.id" :card="card" :image-fallback-label="t('boards.imageUnavailable')">
          <template #menu>
            <div v-if="hasCardMenu(card)" class="relative shrink-0" data-board-card-menu @click.stop>
              <button type="button" class="board-menu-button" :aria-label="t('boards.cardMenu')" :aria-expanded="activeCardMenuId === card.id" @click="toggleCardMenu($event, card)"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>
              <Transition enter-active-class="transition duration-300 ease-out" enter-from-class="opacity-0" enter-to-class="opacity-100" leave-active-class="transition duration-200 ease-in" leave-from-class="opacity-100" leave-to-class="opacity-0">
                <Teleport to="body">
                  <div v-if="activeCardMenuId === card.id" data-board-card-menu class="board-card-menu-surface max-h-[min(20rem,calc(100dvh-2rem))] cursor-default overflow-y-auto rounded-3xl border border-[var(--ui-border)] bg-[var(--ui-dropdown-bg)] p-3 ring-1 ring-black/5 backdrop-blur-xl dark:ring-white/5" :class="surfaceTokenClasses" :style="cardMenuStyle" role="menu" @click.stop>
                    <button v-if="card.owned && board?.settings.participantCanEdit" type="button" role="menuitem" class="flex w-full items-center rounded-2xl border border-transparent px-4 py-3 text-left text-sm transition hover:border-[var(--ui-border)] hover:bg-[#FFFBEF] dark:hover:bg-[#1C1A19]" @click="openEdit(card)">{{ t('common.edit') }}</button>
                    <button v-if="card.owned && board?.settings.participantCanDelete" type="button" role="menuitem" class="mt-1 flex w-full items-center rounded-2xl border border-transparent px-4 py-3 text-left text-sm text-[#AF3029] transition hover:border-[#AF3029]/20 hover:bg-[#FCE8DB] dark:text-[#F89A8A] dark:hover:bg-[#321F1C]" @click="activeCardMenuId = ''; selectedCard = card; dialog = 'delete'">{{ t('common.delete') }}</button>
                    <button v-if="!card.owned && board?.settings.participantCanEdit" type="button" role="menuitem" class="flex w-full items-center rounded-2xl border border-transparent px-4 py-3 text-left text-sm transition hover:border-[var(--ui-border)] hover:bg-[#FFFBEF] dark:hover:bg-[#1C1A19]" @click="openRecover(card)">{{ t('boards.recoverAccess') }}</button>
                  </div>
                </Teleport>
              </Transition>
            </div>
          </template>
          <template #meta>
            <div class="mt-4 flex flex-wrap items-center justify-between gap-2"><p v-if="card.authorDisplayName" class="text-xs font-medium text-[var(--ui-text-muted)]">{{ card.authorDisplayName }}</p><span v-if="card.owned && card.moderationStatus !== 'approved'" class="rounded-full border border-[var(--ui-border)] px-2 py-1 text-xs">{{ t(`boards.${card.moderationStatus}`) }}</span></div>
          </template>
          <template #footer>
            <div v-if="card.moderationStatus === 'approved'" class="flex items-center gap-2">
              <template v-if="presentation">
                <span class="board-reaction-count" :aria-label="t('boards.likeCard', { count: card.reactions.likes })"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 10v12H3V10h4Zm4.3 12H9V10.4l3.6-7.2c.2-.4.6-.7 1.1-.7 1.2 0 2.1 1 2 2.2l-.4 3.3H20c1.2 0 2.1 1.1 1.8 2.3l-2 9A3.5 3.5 0 0 1 16.4 22h-5.1Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg>{{ card.reactions.likes }}</span>
                <span class="board-reaction-count" :aria-label="t('boards.dislikeCard', { count: card.reactions.dislikes })"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 14V2H3v12h4Zm4.3-12H9v11.6l3.6 7.2c.2.4.6.7 1.1.7 1.2 0 2.1-1 2-2.2l-.4-3.3H20c1.2 0 2.1-1.1 1.8-2.3l-2-9A3.5 3.5 0 0 0 16.4 2h-5.1Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg>{{ card.reactions.dislikes }}</span>
              </template>
              <template v-else>
              <button type="button" class="board-reaction" :class="{ 'board-reaction-selected': card.reactions.current === 'like' }" :disabled="presentation || board?.settings.readOnly || reactingCardIds.includes(card.id)" :aria-busy="reactingCardIds.includes(card.id)" :aria-pressed="card.reactions.current === 'like'" :aria-label="t('boards.likeCard', { count: card.reactions.likes })" @click.stop="updateReaction(card, 'like')">
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 10v12H3V10h4Zm4.3 12H9V10.4l3.6-7.2c.2-.4.6-.7 1.1-.7 1.2 0 2.1 1 2 2.2l-.4 3.3H20c1.2 0 2.1 1.1 1.8 2.3l-2 9A3.5 3.5 0 0 1 16.4 22h-5.1Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg>
                <span>{{ card.reactions.likes }}</span>
              </button>
              <button type="button" class="board-reaction" :class="{ 'board-reaction-selected': card.reactions.current === 'dislike' }" :disabled="presentation || board?.settings.readOnly || reactingCardIds.includes(card.id)" :aria-busy="reactingCardIds.includes(card.id)" :aria-pressed="card.reactions.current === 'dislike'" :aria-label="t('boards.dislikeCard', { count: card.reactions.dislikes })" @click.stop="updateReaction(card, 'dislike')">
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 14V2H3v12h4Zm4.3-12H9v11.6l3.6 7.2c.2.4.6.7 1.1.7 1.2 0 2.1-1 2-2.2l-.4-3.3H20c1.2 0 2.1-1.1 1.8-2.3l-2-9A3.5 3.5 0 0 0 16.4 2h-5.1Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg>
                <span>{{ card.reactions.dislikes }}</span>
              </button>
              </template>
            </div>
            <p v-if="reactionErrors[card.id]" class="mt-2 text-xs text-red-600" role="alert">{{ reactionErrors[card.id] }}</p>
          </template>
        </BoardCardView>
      </section>
      </template>
    </div>
    <Teleport to="body">
      <button v-if="canCreate" type="button" class="board-add-card fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] right-[max(1.5rem,env(safe-area-inset-right))] z-[90] inline-flex min-h-12 items-center gap-2 rounded-full bg-[var(--ui-accent)] px-5 py-3 font-semibold text-[var(--ui-accent-contrast)] transition duration-300 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" :class="surfaceTokenClasses" :style="surfaceStyle" @click="openCreate"><span class="text-xl leading-none" aria-hidden="true">+</span><span>{{ t('boards.addCard') }}</span></button>
    </Teleport>

    <Teleport to="body">
      <Transition enter-active-class="transition duration-300 ease-out" enter-from-class="opacity-0" enter-to-class="opacity-100" leave-active-class="transition duration-200 ease-in" leave-from-class="opacity-100" leave-to-class="opacity-0">
      <div v-if="dialog" class="board-dialog-overlay fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/55 p-4" role="presentation">
      <section class="board-dialog my-auto max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-3xl border p-6" :class="surfaceTokenClasses" :style="surfaceStyle" role="dialog" aria-modal="true" :aria-label="t('boards.cardDialog')">
        <template v-if="dialog === 'card'">
          <h2 class="text-xl font-semibold">{{ selectedCard ? t('boards.editCard') : t('boards.addCard') }}</h2>
          <form class="mt-5 space-y-4" @submit.prevent="saveCard">
            <label class="block text-sm font-medium">{{ t('boards.cardLayout') }}<select v-model="form.layout" class="board-input mt-2"><option value="text">{{ t('boards.layoutText') }}</option><option value="image_text">{{ t('boards.layoutImageText') }}</option></select></label>
            <label class="block text-sm font-medium">{{ t('boards.cardTitle') }}<input v-model="form.title" class="board-input mt-2" :required="board?.settings.requireCardTitle" :maxlength="board?.settings.maxTitleLength" /></label>
            <label class="block text-sm font-medium">{{ t('boards.cardBody') }}<textarea v-model="form.body" class="board-input mt-2 min-h-36" required :maxlength="board?.settings.maxBodyLength"></textarea></label>
            <label v-if="board?.settings.allowImageUrls && form.layout === 'image_text'" class="block text-sm font-medium">{{ t('boards.imageUrl') }}<input v-model="form.imageUrl" type="url" inputmode="url" class="board-input mt-2" placeholder="https://…" required /></label>
            <label class="block text-sm font-medium">{{ t('boards.displayName') }}<input v-model="form.authorDisplayName" class="board-input mt-2" maxlength="120" :required="board?.settings.requireParticipantName" /></label>
            <div class="flex justify-end gap-2"><button type="button" class="board-secondary" @click="closeDialog">{{ t('common.close') }}</button><button class="board-primary" :disabled="busy">{{ busy ? t('common.saving') : t('common.save') }}</button></div>
          </form>
        </template>
        <template v-else-if="dialog === 'pin'"><h2 class="text-xl font-semibold">{{ t('boards.pinTitle') }}</h2><p class="mt-2 text-sm text-[var(--board-muted)]">{{ t('boards.pinDescription') }}</p><div class="mt-5 rounded-2xl border border-dashed border-[var(--board-border)] p-5 text-center"><strong class="font-mono text-3xl tracking-[.25em]">{{ recoveryPin }}</strong></div><div class="mt-5 flex justify-end gap-2"><button type="button" class="board-secondary min-w-[7.5rem] overflow-hidden" :aria-label="recoveryPinCopied ? t('common.copied') : t('common.copy')" @click="copyRecoveryPin"><Transition mode="out-in" enter-active-class="transition duration-200 ease-out" enter-from-class="scale-75 opacity-0" enter-to-class="scale-100 opacity-100" leave-active-class="transition duration-150 ease-in" leave-from-class="scale-100 opacity-100" leave-to-class="scale-75 opacity-0"><span :key="recoveryPinCopied ? 'copied' : 'copy'" class="inline-flex items-center gap-2"><svg v-if="!recoveryPinCopied" xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><span>{{ recoveryPinCopied ? t('common.copied') : t('common.copy') }}</span></span></Transition></button><button type="button" class="board-primary" @click="closeDialog">{{ t('common.close') }}</button></div></template>
        <template v-else-if="dialog === 'recover'"><h2 class="text-xl font-semibold">{{ t('boards.recoverAccess') }}</h2><p class="mt-2 text-sm text-[var(--board-muted)]">{{ t('boards.recoverDescription') }}</p><form class="mt-5" @submit.prevent="recover"><label class="block text-sm font-medium">{{ t('boards.recoveryPin') }}<input v-model="recoveryInput" class="board-input mt-2 font-mono tracking-[.2em]" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required /></label><div class="mt-5 flex justify-end gap-2"><button type="button" class="board-secondary" @click="closeDialog">{{ t('common.close') }}</button><button class="board-primary" :disabled="busy">{{ t('boards.restoreEditing') }}</button></div></form></template>
        <template v-else><h2 class="text-xl font-semibold">{{ t('boards.deleteCardTitle') }}</h2><p class="mt-2 text-sm text-[var(--board-muted)]">{{ t('boards.deleteCardDescription') }}</p><div class="mt-5 flex justify-end gap-2"><button type="button" class="board-secondary" @click="closeDialog">{{ t('common.cancel') }}</button><button type="button" class="rounded-xl bg-red-600 px-4 py-2 font-semibold text-white" :disabled="busy" @click="removeCard">{{ t('common.delete') }}</button></div></template>
      </section>
      </div>
      </Transition>
    </Teleport>
  </main>
</template>

<style scoped>
.board-surface{color:var(--ui-text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.board-header,.board-panel,.board-dialog{border-color:var(--ui-border);border-radius:var(--activity-radius,1.5rem);background:var(--ui-panel);box-shadow:var(--activity-shadow,none);color:var(--ui-text)}
.board-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,18rem),1fr));align-items:start;gap:1rem}
.board-presentation .board-grid{grid-template-columns:repeat(auto-fill,minmax(min(100%,20rem),1fr));gap:1.15rem}
.board-sort-label{display:flex;align-items:center;gap:.65rem}.board-sort-select{min-width:11rem;border:1px solid var(--ui-border);border-radius:.8rem;background:var(--ui-panel);color:var(--ui-text);padding:.55rem 2.1rem .55rem .75rem}
.board-reaction,.board-reaction-count{display:inline-flex;min-width:4rem;min-height:2.75rem;align-items:center;justify-content:center;gap:.45rem;border:1px solid var(--ui-border);border-radius:.8rem;color:var(--ui-text-muted);font-variant-numeric:tabular-nums}
.board-reaction{transition:border-color .15s ease,background-color .15s ease,color .15s ease}.board-reaction svg,.board-reaction-count svg{width:1.15rem;height:1.15rem}.board-reaction:hover:not(:disabled){border-color:var(--ui-accent);color:var(--ui-accent)}.board-reaction-selected{border-color:var(--ui-accent);background:var(--ui-accent-soft);color:var(--ui-accent)}.board-reaction:focus-visible,.board-menu-button:focus-visible,.board-secondary:focus-visible,.board-primary:focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}.board-reaction:disabled{cursor:default;opacity:.72}
.board-input{width:100%;border:1px solid var(--ui-border);border-radius:.9rem;background:var(--ui-input-bg);color:var(--ui-text);padding:.7rem .85rem}.board-input:focus{border-color:var(--ui-accent);outline:2px solid var(--ui-accent-soft);outline-offset:1px}
.board-primary,.board-secondary{display:inline-flex;min-height:2.75rem;align-items:center;justify-content:center;gap:.5rem;border-radius:.8rem;padding:.65rem 1rem;font-weight:600}.board-primary{border:1px solid var(--ui-accent);background:var(--ui-accent);color:var(--ui-accent-contrast)}.board-secondary{border:1px solid var(--ui-border);background:var(--ui-panel);color:var(--ui-text)}.board-secondary:hover{border-color:var(--ui-accent);color:var(--ui-accent)}
.board-menu-button{display:flex;height:2.5rem;width:2.5rem;cursor:pointer;align-items:center;justify-content:center;border:1px solid var(--ui-border);border-radius:.75rem;color:var(--ui-text-muted);transition:border-color .2s ease,color .2s ease,background-color .2s ease}.board-menu-button:hover{border-color:var(--ui-accent);color:var(--ui-accent);background:var(--ui-accent-soft)}
.board-card-menu-surface{background:var(--ui-dropdown-bg);color:var(--ui-text)}
.board-add-card{box-shadow:0 10px 30px color-mix(in srgb,var(--ui-accent) 28%,transparent)}
@media(max-width:480px){.board-sort-label{width:100%;align-items:flex-start;flex-direction:column}.board-sort-select{width:100%}}
@media(prefers-reduced-motion:reduce){.board-reaction,.board-secondary,.board-primary,.board-menu-button,.board-add-card{scroll-behavior:auto;transition:none}}
</style>
