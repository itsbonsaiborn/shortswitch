<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import type { BoardCard, BoardCardInput, BoardCardOwnershipResetResponse, BoardInput, BoardReactionMode, BoardSummary, BoardThemeReference } from '@/shared/board-types';
import { api } from '../lib/api';
import { useToast } from '../composables/useToast';
import RichTextContent from '../components/RichTextContent.vue';
import RichTextEditor from '../components/RichTextEditor.vue';
import BoardThemePreview from '../components/BoardThemePreview.vue';
import ActivityDeleteIcon from '../components/ActivityDeleteIcon.vue';
import { boardPatterns, boardThemeCatalog, boardVisualStyles, resolveBoardThemeSurface } from '../lib/board-theme';

const { t } = useI18n(); const route = useRoute(); const router = useRouter(); const { pushToast } = useToast();
const boardId = ref(typeof route.params.id === 'string' ? route.params.id : '');
const activeTab = ref<'general' | 'design' | 'cards'>('general');
const loading = ref(Boolean(boardId.value)); const saving = ref(false); const error = ref(''); const themes = ref<BoardThemeReference[]>([]);
const expiresLocal = ref('');
const submissionsExpiresLocal = ref('');
const editorClock = ref(Date.now());
let editorClockTimer: number | undefined;
const cards = ref<BoardCard[]>([]); const editingCard = ref<BoardCard | null>(null); const resetPin = ref('');
const refreshingCards = ref(false);
const pendingImageBlurCardIds = ref<Set<string>>(new Set());
const failedAdminImagePreviews = ref<Set<string>>(new Set());
const cardForm = reactive<BoardCardInput>({ title: '', body: '', imageUrl: null, authorDisplayName: null, layout: 'text' });
const toLocalDateTimeInput = (value: string) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
watch(() => cardForm.layout, (layout) => { if (layout !== 'image_text') cardForm.imageUrl = null; });
const form = reactive<BoardInput>({ title: '', description: '', slug: '', status: 'draft', expiresAt: null, settings: { themeId: 'board_theme_minimal_light', layout: 'grid', visualStyle: 'classic', backgroundPattern: 'none', patternIntensity: 35, reactionMode: 'both', readOnly: false, locked: false, submissionsExpiresAt: null, requireParticipantName: false, moderationMode: 'review_all', maxCardsTotal: 500, maxCardsPerParticipant: 10, maxTitleLength: 160, maxBodyLength: 5000, allowImageUrls: true, blurImagesByDefault: false, participantCanEdit: true, participantCanDelete: true, requireCardTitle: true } });
const acceptsSubmissions = computed({
  get: () => !form.settings.locked && (!submissionsExpiresLocal.value || Date.parse(submissionsExpiresLocal.value) > editorClock.value),
  set: (value: boolean) => {
    form.settings.locked = !value;
    if (value && submissionsExpiresLocal.value && Date.parse(submissionsExpiresLocal.value) <= Date.now()) {
      submissionsExpiresLocal.value = '';
      form.settings.submissionsExpiresAt = null;
    }
  }
});
watch(() => form.settings.readOnly, (readOnly) => {
  if (!readOnly) return;
  form.settings.participantCanEdit = false;
  form.settings.participantCanDelete = false;
});
const effectiveReactionMode = computed<BoardReactionMode>({
  get: () => form.settings.readOnly ? 'disabled' : form.settings.reactionMode,
  set: (mode) => {
    if (!form.settings.readOnly) form.settings.reactionMode = mode;
  }
});
const selectedTheme = computed(() => themes.value.find((theme) => theme.id === form.settings.themeId) ?? null);
const themeBySurface = (surface: string) => themes.value.find((theme) => resolveBoardThemeSurface(theme) === surface);
const selectTheme = (surface: string) => {
  const theme = themeBySurface(surface);
  if (theme) form.settings.themeId = theme.id;
};
const load = async () => {
  try {
    themes.value = await api<BoardThemeReference[]>('/api/boards/themes');
    if (boardId.value) {
      const board = await api<BoardSummary>(`/api/boards/${boardId.value}`);
      Object.assign(form, { title: board.title, description: board.description, slug: board.slug, status: board.status, expiresAt: board.expiresAt, settings: { ...board.settings } });
      expiresLocal.value = board.expiresAt ? toLocalDateTimeInput(board.expiresAt) : '';
      submissionsExpiresLocal.value = board.settings.submissionsExpiresAt
        ? toLocalDateTimeInput(board.settings.submissionsExpiresAt)
        : '';
      cards.value = await api<BoardCard[]>(`/api/boards/${boardId.value}/cards`);
    }
  } catch (cause) { error.value = (cause as Error).message; }
  finally { loading.value = false; }
};
const save = async () => {
  saving.value = true; error.value = '';
  try {
    form.expiresAt = expiresLocal.value ? new Date(expiresLocal.value).toISOString() : null;
    form.settings.submissionsExpiresAt = submissionsExpiresLocal.value
      ? new Date(submissionsExpiresLocal.value).toISOString()
      : null;
    const editing = Boolean(boardId.value);
    const board = await api<BoardSummary>(editing ? `/api/boards/${boardId.value}` : '/api/boards', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(form) });
    pushToast({ tone: 'success', title: editing ? t('boards.saved') : t('boards.created') });
    if (!editing) { boardId.value = board.id; form.slug = board.slug; await router.replace(`/app/boards/${board.id}`); }
  } catch (cause) { error.value = (cause as Error).message; }
  finally { saving.value = false; }
};
const openCard = (card: BoardCard) => { editingCard.value = card; Object.assign(cardForm, { title: card.title, body: card.body, imageUrl: card.imageUrl, authorDisplayName: card.authorDisplayName, layout: card.layout === 'compact' ? 'text' : card.layout }); };
const reloadCards = async () => { if (boardId.value) cards.value = await api<BoardCard[]>(`/api/boards/${boardId.value}/cards`); };
const adminImagePreviewKey = (card: BoardCard) => `${card.id}:${card.imageUrl ?? ''}`;
const adminImagePreviewFailed = (card: BoardCard) => failedAdminImagePreviews.value.has(adminImagePreviewKey(card));
const markAdminImagePreviewFailed = (card: BoardCard) => {
  failedAdminImagePreviews.value = new Set(failedAdminImagePreviews.value).add(adminImagePreviewKey(card));
};
const imageBlurPending = (cardId: string) => pendingImageBlurCardIds.value.has(cardId);
const moderationStatusClass = (status: BoardCard['moderationStatus']) => {
  if (status === 'approved') return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/45 dark:text-emerald-200';
  if (status === 'rejected') return 'bg-red-100 text-red-800 dark:bg-red-950/45 dark:text-red-200';
  return 'bg-amber-100 text-amber-800 dark:bg-amber-950/45 dark:text-amber-200';
};
const refreshCards = async () => {
  if (!boardId.value || refreshingCards.value) return;
  refreshingCards.value = true;
  try {
    const latestCards = await api<BoardCard[]>(`/api/boards/${boardId.value}/cards`);
    cards.value = latestCards;
    failedAdminImagePreviews.value = new Set();
  } catch (cause) {
    pushToast({
      tone: 'error',
      title: t('boardCards.refreshFailed'),
      description: (cause as Error).message
    });
  } finally {
    refreshingCards.value = false;
  }
};
const runCardOperation = async (operation: () => Promise<void>) => { error.value = ''; try { await operation(); } catch (cause) { error.value = (cause as Error).message; } };
const saveCard = async () => runCardOperation(async () => { if (!editingCard.value) return; await api(`/api/boards/${boardId.value}/cards/${editingCard.value.id}`, { method: 'PATCH', body: JSON.stringify(cardForm) }); editingCard.value = null; await reloadCards(); pushToast({ tone: 'success', title: t('boards.cardSaved') }); });
const moderate = async (card: BoardCard, status: 'approved' | 'rejected' | 'pending') => runCardOperation(async () => { await api(`/api/boards/${boardId.value}/cards/${card.id}/moderation`, { method: 'POST', body: JSON.stringify({ status }) }); await reloadCards(); });
const setHidden = async (card: BoardCard, hidden: boolean) => runCardOperation(async () => { await api(`/api/boards/${boardId.value}/cards/${card.id}/visibility`, { method: 'POST', body: JSON.stringify({ hidden }) }); await reloadCards(); });
const setImageBlurred = async (card: BoardCard, blurred: boolean) => {
  if (imageBlurPending(card.id)) return;
  pendingImageBlurCardIds.value = new Set(pendingImageBlurCardIds.value).add(card.id);
  try {
    const updated = await api<BoardCard>(`/api/boards/${boardId.value}/cards/${card.id}/image-blur`, {
      method: 'POST', body: JSON.stringify({ blurred })
    });
    cards.value = cards.value.map((existing) => existing.id === updated.id ? updated : existing);
  } catch (cause) {
    pushToast({
      tone: 'error',
      title: t('boardImageBlur.updateFailed'),
      description: (cause as Error).message
    });
  } finally {
    const pending = new Set(pendingImageBlurCardIds.value);
    pending.delete(card.id);
    pendingImageBlurCardIds.value = pending;
  }
};
const removeCard = async (card: BoardCard) => { if (!window.confirm(t('boards.deleteCardDescription'))) return; await runCardOperation(async () => { await api(`/api/boards/${boardId.value}/cards/${card.id}`, { method: 'DELETE' }); await reloadCards(); }); };
const resetOwnership = async (card: BoardCard) => { if (!window.confirm(t('boards.resetOwnershipConfirm'))) return; await runCardOperation(async () => { const result = await api<BoardCardOwnershipResetResponse>(`/api/boards/${boardId.value}/cards/${card.id}/ownership/reset`, { method: 'POST', body: JSON.stringify({}) }); resetPin.value = result.recoveryPin; }); };
const copyResetPin = () => navigator.clipboard.writeText(resetPin.value);
const onKeydown = (event: KeyboardEvent) => { if (event.key === 'Escape') editingCard.value = null; };
onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  editorClockTimer = window.setInterval(() => { editorClock.value = Date.now(); }, 15_000);
  void load();
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  if (editorClockTimer) window.clearInterval(editorClockTimer);
});
</script>

<template>
  <section v-if="loading" class="panel p-8 text-center" aria-busy="true">{{ t('common.loading') }}</section>
  <form v-else class="mx-auto w-full max-w-none space-y-5" @submit.prevent="save">
    <header class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><button type="button" class="inline-flex items-center gap-2 text-sm text-[var(--ui-text-muted)] transition-colors hover:text-[var(--ui-accent)]" @click="router.push('/app/boards')"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0h24v24H0z" fill="none"/><path fill="currentColor" d="M21 11H6.414l5.293-5.293l-1.414-1.414L2.586 12l7.707 7.707l1.414-1.414L6.414 13H21z"/></svg><span>{{ t('navigation.boards') }}</span></button><h1 class="mt-2 text-2xl font-semibold">{{ boardId ? t('boards.edit') : t('boards.create') }}</h1><p class="mt-1 text-sm text-[var(--ui-text-muted)]">{{ t('boards.editorDescription') }}</p></div><div class="flex gap-2"><a v-if="boardId && form.status === 'published'" class="btn-secondary" :href="`/boards/${encodeURIComponent(form.slug || '')}/presentation`" target="_blank" rel="noopener">{{ t('boards.openPresentation') }}</a><button class="btn-primary" :disabled="saving">{{ saving ? t('boards.saving') : t('boards.save') }}</button></div></header>
    <p v-if="error" class="rounded-2xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300" role="alert">{{ error }}</p>
    <nav class="flex min-w-0 gap-1 overflow-x-auto border-b border-[var(--ui-border)]" role="tablist" :aria-label="t('boards.edit')">
      <button type="button" class="shrink-0 rounded-t-xl px-4 py-3 text-sm font-medium" :class="activeTab === 'general' ? 'bg-[var(--ui-accent-soft)] text-[var(--ui-accent)]' : 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'" role="tab" :aria-selected="activeTab === 'general'" @click="activeTab = 'general'">{{ t('boards.general') }}</button>
      <button type="button" class="shrink-0 rounded-t-xl px-4 py-3 text-sm font-medium" :class="activeTab === 'design' ? 'bg-[var(--ui-accent-soft)] text-[var(--ui-accent)]' : 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'" role="tab" :aria-selected="activeTab === 'design'" @click="activeTab = 'design'">{{ t('boards.appearance') }}</button>
      <button v-if="boardId" type="button" class="shrink-0 rounded-t-xl px-4 py-3 text-sm font-medium" :class="activeTab === 'cards' ? 'bg-[var(--ui-accent-soft)] text-[var(--ui-accent)]' : 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'" role="tab" :aria-selected="activeTab === 'cards'" @click="activeTab = 'cards'">{{ t('boards.manageCards') }}</button>
    </nav>
    <div v-if="activeTab === 'general'" class="grid gap-5 lg:grid-cols-2">
      <fieldset class="panel space-y-4 p-5"><legend class="px-1 font-semibold">{{ t('boards.general') }}</legend>
        <label class="block text-sm font-medium">{{ t('boards.titleField') }}<input v-model="form.title" class="input mt-2" required maxlength="160" /></label>
        <label class="block text-sm font-medium">{{ t('boards.description') }}<textarea v-model="form.description" class="input mt-2 min-h-28" maxlength="2000"></textarea></label>
        <label class="block text-sm font-medium">{{ t('boards.slug') }}<input v-model="form.slug" class="input mt-2" maxlength="128" /><span class="mt-1 block text-xs text-[var(--ui-text-muted)]">{{ t('boards.randomSlug') }}</span></label>
        <div class="grid gap-3 sm:grid-cols-2"><label class="text-sm font-medium">{{ t('boards.status') }}<select v-model="form.status" class="input mt-2"><option value="draft">{{ t('common.draft') }}</option><option value="published">{{ t('common.published') }}</option><option value="disabled">{{ t('common.disabled') }}</option></select></label><label class="text-sm font-medium">{{ t('boards.expiration') }}<input v-model="expiresLocal" type="datetime-local" class="input mt-2" /><span class="mt-1 block text-xs text-[var(--ui-text-muted)]">{{ t('boardEnhancements.globalExpirationHelp') }}</span></label></div>
      </fieldset>
      <fieldset class="panel space-y-4 p-5"><legend class="px-1 font-semibold">{{ t('boards.permissions') }}</legend>
        <label class="flex gap-3"><input v-model="acceptsSubmissions" type="checkbox" class="mt-1" /><span><strong class="block text-sm">{{ t('boards.submissions') }}</strong><span class="text-xs text-[var(--ui-text-muted)]">{{ t('boards.submissionsHelp') }}</span></span></label>
        <label class="block text-sm font-medium">{{ t('boardEnhancements.submissionsExpiration') }}<input v-model="submissionsExpiresLocal" type="datetime-local" class="input mt-2" /><span class="mt-1 block text-xs text-[var(--ui-text-muted)]">{{ t('boardEnhancements.submissionsExpirationHelp') }}</span></label>
        <label class="flex items-center gap-3 text-sm transition-opacity" :class="form.settings.readOnly ? 'opacity-45' : ''"><input v-model="form.settings.participantCanEdit" type="checkbox" :disabled="form.settings.readOnly" />{{ t('boards.participantEditing') }}</label>
        <label class="flex items-center gap-3 text-sm transition-opacity" :class="form.settings.readOnly ? 'opacity-45' : ''"><input v-model="form.settings.participantCanDelete" type="checkbox" :disabled="form.settings.readOnly" />{{ t('boards.participantDeleting') }}</label>
        <label class="flex items-center gap-3 text-sm"><input v-model="form.settings.requireParticipantName" type="checkbox" />{{ t('boards.requireName') }}</label>
        <label class="flex items-center gap-3 text-sm"><input v-model="form.settings.requireCardTitle" type="checkbox" />{{ t('boards.requireCardTitle') }}</label>
        <label class="flex gap-3"><input v-model="form.settings.blurImagesByDefault" type="checkbox" class="mt-1" /><span><strong class="block text-sm">{{ t('boardImageBlur.defaultTitle') }}</strong><span class="text-xs text-[var(--ui-text-muted)]">{{ t('boardImageBlur.defaultDescription') }}</span></span></label>
        <label class="block text-sm font-medium" :class="form.settings.readOnly ? 'opacity-55' : ''">
          {{ t('boards.reactionMode') }}
          <select v-model="effectiveReactionMode" class="input mt-2" :disabled="form.settings.readOnly">
            <option value="both">{{ t('boards.reactionModeBoth') }}</option>
            <option value="likes_only">{{ t('boards.reactionModeLikesOnly') }}</option>
            <option value="dislikes_only">{{ t('boards.reactionModeDislikesOnly') }}</option>
            <option value="disabled">{{ t('boards.reactionModeDisabled') }}</option>
          </select>
          <span v-if="form.settings.readOnly" class="mt-1 block text-xs text-[var(--ui-text-muted)]">{{ t('boards.reactionModeReadOnlyHelp') }}</span>
        </label>
        <label class="flex gap-3"><input v-model="form.settings.readOnly" type="checkbox" class="mt-1" /><span><strong class="block text-sm">{{ t('boards.readOnly') }}</strong><span class="text-xs text-[var(--ui-text-muted)]">{{ t('boards.readOnlyHelp') }}</span></span></label>
        <div class="grid gap-3 sm:grid-cols-2"><label class="text-sm font-medium">{{ t('boards.maxPerParticipant') }}<input v-model.number="form.settings.maxCardsPerParticipant" type="number" min="1" max="100" class="input mt-2" /></label><label class="text-sm font-medium">{{ t('boards.maxTotal') }}<input v-model.number="form.settings.maxCardsTotal" type="number" min="1" max="5000" class="input mt-2" /></label></div>
        <label class="block text-sm font-medium">{{ t('boards.moderation') }}<select v-model="form.settings.moderationMode" class="input mt-2"><option value="auto_approve">{{ t('boards.autoApprove') }}</option><option value="review_all">{{ t('boards.reviewAll') }}</option></select></label>
      </fieldset>
    </div>
    <fieldset v-else-if="activeTab === 'design'" class="panel p-5 sm:p-6">
      <legend class="px-1 font-semibold">{{ t('boards.appearance') }}</legend>
      <p class="mt-1 text-sm text-[var(--ui-text-muted)]">{{ t('boards.appearanceDescription') }}</p>
      <div class="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(300px,.8fr)]">
        <div class="space-y-6">
          <section>
            <h3 class="text-sm font-semibold">{{ t('boards.theme') }}</h3>
            <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <button v-for="theme in boardThemeCatalog" :key="theme.surface" type="button" class="rounded-2xl border p-3 text-left transition-colors" :class="resolveBoardThemeSurface(selectedTheme) === theme.surface ? 'border-[var(--ui-accent)] ring-2 ring-[var(--ui-accent)]/20' : 'border-[var(--ui-border)] hover:border-[var(--ui-accent)]'" :aria-pressed="resolveBoardThemeSurface(selectedTheme) === theme.surface" @click="selectTheme(theme.surface)">
                <span class="flex gap-1"><span v-for="color in theme.colors" :key="color" class="h-8 flex-1 rounded-lg" :style="{ backgroundColor: color }"></span></span>
                <span class="mt-2 block text-sm font-semibold">{{ t(theme.labelKey) }}</span>
              </button>
            </div>
          </section>
          <section>
            <h3 class="text-sm font-semibold">{{ t('activityDesign.layout') }}</h3>
            <p class="mt-1 text-xs text-[var(--ui-text-muted)]">{{ t('activityDesign.layoutHint') }}</p>
            <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <button v-for="style in boardVisualStyles" :key="style.value" type="button" class="rounded-xl border px-3 py-2 text-sm font-medium transition-colors" :class="form.settings.visualStyle === style.value ? 'border-[var(--ui-accent)] bg-[var(--ui-accent-soft)] text-[var(--ui-accent)]' : 'border-[var(--ui-border)] hover:border-[var(--ui-accent)]'" :aria-pressed="form.settings.visualStyle === style.value" @click="form.settings.visualStyle = style.value">{{ t(style.labelKey) }}</button>
            </div>
          </section>
          <section>
            <h3 class="text-sm font-semibold">{{ t('pages.backgroundPattern') }}</h3>
            <p class="mt-1 text-xs text-[var(--ui-text-muted)]">{{ t('pages.backgroundPatternDescription') }}</p>
            <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <button v-for="pattern in boardPatterns" :key="pattern.value" type="button" class="rounded-2xl border p-3 text-left transition-colors" :class="form.settings.backgroundPattern === pattern.value ? 'border-[var(--ui-accent)] ring-2 ring-[var(--ui-accent)]/20' : 'border-[var(--ui-border)] hover:border-[var(--ui-accent)]'" :aria-pressed="form.settings.backgroundPattern === pattern.value" @click="form.settings.backgroundPattern = pattern.value">
                <span class="pattern-swatch block h-12 rounded-xl bg-[var(--ui-panel-muted)]" :class="`pattern-swatch-${pattern.value}`"></span>
                <span class="mt-2 block text-sm font-semibold">{{ t(pattern.labelKey) }}</span>
              </button>
            </div>
            <label class="mt-4 block"><span class="flex items-center justify-between text-sm font-medium"><span>{{ t('pages.patternIntensity') }}</span><span>{{ form.settings.patternIntensity }}%</span></span><input v-model.number="form.settings.patternIntensity" class="mt-3 w-full accent-[var(--ui-accent)]" type="range" min="0" max="100" step="5" :disabled="form.settings.backgroundPattern === 'none'" /></label>
          </section>
        </div>
        <div class="xl:sticky xl:top-5 xl:self-start">
          <h3 class="mb-3 text-sm font-semibold">{{ t('pages.livePreview') }}</h3>
          <BoardThemePreview :theme="selectedTheme" :settings="form.settings" :title="form.title || t('boards.previewTitle')" :description="form.description || t('boards.previewDescription')" :sample-title="t('boards.previewCardTitle')" :sample-body="t('boards.previewCardBody')" :image-fallback-label="t('boards.imageUnavailable')" />
        </div>
      </div>
    </fieldset>
    <section v-else-if="activeTab === 'cards' && boardId" class="panel p-5 sm:p-6">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="min-w-0"><h2 class="font-semibold">{{ t('boards.manageCards') }}</h2><p class="mt-1 text-sm text-[var(--ui-text-muted)]">{{ t('boards.manageCardsDescription') }}</p></div>
        <div class="flex shrink-0 items-center gap-2">
          <button type="button" class="btn-secondary inline-flex items-center gap-2 whitespace-nowrap" :disabled="refreshingCards" :aria-busy="refreshingCards" @click="refreshCards">
            <svg class="h-4 w-4" :class="refreshingCards ? 'animate-spin' : ''" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5m-5 4a8.1 8.1 0 0 0 15.5 2m.5 5v-5h-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>{{ refreshingCards ? t('boardCards.refreshing') : t('common.refresh') }}</span>
          </button>
        </div>
      </div>
      <p v-if="resetPin" class="mt-4 rounded-2xl border border-[var(--ui-accent)] p-4 text-sm" role="status">{{ t('boards.newRecoveryPin') }} <strong class="ml-2 font-mono text-lg tracking-[.2em]">{{ resetPin }}</strong> <button type="button" class="ml-2 underline" @click="copyResetPin">{{ t('common.copy') }}</button></p>
      <p v-if="cards.length === 0" class="mt-5 rounded-2xl bg-[var(--ui-panel-muted)] p-6 text-center text-sm text-[var(--ui-text-muted)]">{{ t('boards.publicEmpty') }}</p>
      <div v-else class="board-moderation-grid mt-5 grid gap-4">
        <article v-for="card in cards" :key="card.id" class="flex h-full min-w-0 flex-col rounded-2xl border border-[var(--ui-border)] p-4 transition-colors hover:border-accent-300/80 dark:hover:border-accent-700/70">
          <div v-if="card.imageUrl" class="mb-4 aspect-video max-h-56 w-full overflow-hidden rounded-xl border border-[var(--ui-border)] bg-[var(--ui-panel-muted)]">
            <img
              v-if="!adminImagePreviewFailed(card)"
              :src="card.imageUrl"
              :alt="t('boardImageBlur.previewAlt', { title: card.title || t('boards.untitledCard') })"
              class="h-full w-full object-contain"
              loading="lazy"
              decoding="async"
              referrerpolicy="no-referrer"
              data-admin-image-preview="true"
              @error="markAdminImagePreviewFailed(card)"
            />
            <div v-else class="grid h-full min-h-32 place-items-center p-4 text-center text-sm text-[var(--ui-text-muted)]" role="status">{{ t('boards.imageUnavailable') }}</div>
          </div>
          <div class="flex min-w-0 items-start justify-between gap-3"><div class="min-w-0 flex-1"><h3 class="break-words font-semibold [overflow-wrap:anywhere]"><RichTextContent v-if="card.title" :value="card.title" inline /><template v-else>{{ t('boards.untitledCard') }}</template></h3><RichTextContent :value="card.body" class="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-sm text-[var(--ui-text-muted)] [overflow-wrap:anywhere]" /></div><div class="flex shrink-0 flex-wrap justify-end gap-1"><span data-moderation-status class="inline-flex items-center whitespace-nowrap rounded-full border border-transparent px-3 py-1.5 text-xs font-medium leading-none" :class="moderationStatusClass(card.moderationStatus)">{{ t(`boardCards.${card.moderationStatus}`) }}</span><span v-if="card.hidden" class="inline-flex items-center whitespace-nowrap rounded-full border border-transparent bg-violet-100 px-3 py-1.5 text-xs font-medium leading-none text-violet-800 dark:bg-violet-950/45 dark:text-violet-200">{{ t('boardRealtime.hidden') }}</span><span v-if="card.imageUrl" data-image-visibility-status class="inline-flex items-center whitespace-nowrap rounded-full border border-transparent px-3 py-1.5 text-xs font-medium leading-none" :class="card.imageBlurred ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/45 dark:text-blue-200' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/45 dark:text-emerald-200'">{{ card.imageBlurred ? t('boardImageBlur.statusBlurred') : t('boardImageBlur.statusVisible') }}</span></div></div>
          <p v-if="card.authorDisplayName" class="mt-3 break-words text-xs text-[var(--ui-text-muted)] [overflow-wrap:anywhere]">{{ card.authorDisplayName }}</p>
          <p v-if="card.moderationReason" class="mt-2 break-words text-xs text-amber-700 [overflow-wrap:anywhere] dark:text-amber-300">{{ card.moderationReason }}</p>
          <div class="mt-auto flex flex-wrap items-center gap-2 pt-4">
            <button type="button" class="icon-button" :aria-label="t('common.edit')" :title="t('common.edit')" @click="openCard(card)"><svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0h24v24H0z" fill="none"/><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m16.475 5.408l2.117 2.117m-.756-3.982L12.109 9.27a2.1 2.1 0 0 0-.58 1.082L11 13l2.648-.53c.41-.082.786-.283 1.082-.579l5.727-5.727a1.853 1.853 0 1 0-2.621-2.621"/><path d="M19 15v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3"/></g></svg></button>
            <button v-if="card.moderationStatus !== 'approved'" type="button" class="icon-button" :aria-label="t('boards.approve')" :title="t('boards.approve')" @click="moderate(card, 'approved')"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0h24v24H0z" fill="none"/><defs><mask :id="`board-approve-${card.id}`"><g stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path fill="#fff" fill-opacity="0" stroke="#fff" stroke-dasharray="60" d="M3 12c0-4.97 4.03-9 9-9s9 4.03 9 9s-4.03 9-9 9s-9-4.03-9-9Z"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.6s" values="60;0"/><animate fill="freeze" attributeName="fill-opacity" begin="0.6s" dur="0.4s" to="1"/></path><path fill="none" stroke="#000" stroke-dasharray="14" stroke-dashoffset="14" d="m8 12l3 3l5-5"><animate fill="freeze" attributeName="stroke-dashoffset" begin="1.1s" dur="0.2s" to="0"/></path></g></mask></defs><path fill="currentColor" d="M0 0h24v24H0z" :mask="`url(#board-approve-${card.id})`"/></svg></button>
            <button v-if="card.moderationStatus !== 'rejected'" type="button" class="icon-button" :aria-label="t('boards.reject')" :title="t('boards.reject')" @click="moderate(card, 'rejected')"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" aria-hidden="true"><path d="M0 0h20v20H0z" fill="none"/><path fill="currentColor" d="M10 2c4.42 0 8 3.58 8 8s-3.58 8-8 8s-8-3.58-8-8s3.58-8 8-8m5 11l-3-3l3-3l-2-2l-3 3l-3-3l-2 2l3 3l-3 3l2 2l3-3l3 3z"/></svg></button>
            <button v-if="card.moderationStatus === 'approved'" type="button" class="icon-button" :aria-label="card.hidden ? t('boardRealtime.restoreCard') : t('boardRealtime.hideCard')" :title="card.hidden ? t('boardRealtime.restoreCard') : t('boardRealtime.hideCard')" @click="setHidden(card, !card.hidden)">
              <svg v-if="card.hidden" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0h24v24H0z" fill="none"/><path fill="currentColor" d="M12 5c-7.633 0-9.927 6.617-9.948 6.684L1.946 12l.105.316C2.073 12.383 4.367 19 12 19s9.927-6.617 9.948-6.684l.106-.316l-.105-.316C21.927 11.617 19.633 5 12 5m0 11c-2.206 0-4-1.794-4-4s1.794-4 4-4s4 1.794 4 4s-1.794 4-4 4"/><path fill="currentColor" d="M12 10c-1.084 0-2 .916-2 2s.916 2 2 2s2-.916 2-2s-.916-2-2-2"/></svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0h24v24H0z" fill="none"/><path fill="currentColor" d="M8.073 12.194L4.212 8.333c-1.52 1.657-2.096 3.317-2.106 3.351L2 12l.105.316C2.127 12.383 4.421 19 12.054 19c.929 0 1.775-.102 2.552-.273l-2.746-2.746a3.987 3.987 0 0 1-3.787-3.787M12.054 5c-1.855 0-3.375.404-4.642.998L3.707 2.293L2.293 3.707l18 18l1.414-1.414l-3.298-3.298c2.638-1.953 3.579-4.637 3.593-4.679l.105-.316l-.105-.316C21.98 11.617 19.687 5 12.054 5m1.906 7.546c.187-.677.028-1.439-.492-1.96s-1.283-.679-1.96-.492L10 8.586A3.96 3.96 0 0 1 12.054 8c2.206 0 4 1.794 4 4a3.94 3.94 0 0 1-.587 2.053z"/></svg>
            </button>
            <button v-if="card.imageUrl" type="button" class="icon-button" :disabled="imageBlurPending(card.id)" :aria-busy="imageBlurPending(card.id)" :aria-label="imageBlurPending(card.id) ? t('boardImageBlur.updating') : card.imageBlurred ? t('boardImageBlur.unblur') : t('boardImageBlur.blur')" :title="imageBlurPending(card.id) ? t('boardImageBlur.updating') : card.imageBlurred ? t('boardImageBlur.unblur') : t('boardImageBlur.blur')" @click="setImageBlurred(card, !card.imageBlurred)">
              <svg v-if="card.imageBlurred" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true" :class="{ 'animate-pulse': imageBlurPending(card.id) }"><path d="M0 0h24v24H0z" fill="none"/><circle cx="14" cy="6" r="1" fill="currentColor"/><path fill="currentColor" d="m13.8 11.48l.2.02c.83 0 1.5-.67 1.5-1.5s-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5l.02.2c.09.67.61 1.19 1.28 1.28M14 3.5c.28 0 .5-.22.5-.5s-.22-.5-.5-.5s-.5.22-.5.5s.22.5.5.5m-4 0c.28 0 .5-.22.5-.5s-.22-.5-.5-.5s-.5.22-.5.5s.22.5.5.5"/><circle cx="18" cy="10" r="1" fill="currentColor"/><circle cx="18" cy="6" r="1" fill="currentColor"/><path fill="currentColor" d="M21 10.5c.28 0 .5-.22.5-.5s-.22-.5-.5-.5s-.5.22-.5.5s.22.5.5.5"/><circle cx="10" cy="6" r="1" fill="currentColor"/><circle cx="18" cy="14" r="1" fill="currentColor"/><circle cx="6" cy="18" r="1" fill="currentColor"/><path fill="currentColor" d="M14 20.5c-.28 0-.5.22-.5.5s.22.5.5.5s.5-.22.5-.5s-.22-.5-.5-.5m7-7c-.28 0-.5.22-.5.5s.22.5.5.5s.5-.22.5-.5s-.22-.5-.5-.5m-18 0c-.28 0-.5.22-.5.5s.22.5.5.5s.5-.22.5-.5s-.22-.5-.5-.5"/><circle cx="10" cy="18" r="1" fill="currentColor"/><path fill="currentColor" d="M3 9.5c-.28 0-.5.22-.5.5s.22.5.5.5s.5-.22.5-.5s-.22-.5-.5-.5m7 11c-.28 0-.5.22-.5.5s.22.5.5.5s.5-.22.5-.5s-.22-.5-.5-.5"/><circle cx="6" cy="14" r="1" fill="currentColor"/><path fill="currentColor" d="M3.21 4.56a.996.996 0 0 0 0 1.41l3.07 3.07L6 9c-.55 0-1 .45-1 1s.45 1 1 1s1-.45 1-1c0-.1-.03-.19-.06-.28l2.81 2.81c-.71.11-1.25.73-1.25 1.47c0 .83.67 1.5 1.5 1.5c.74 0 1.36-.54 1.47-1.25l2.81 2.81A.9.9 0 0 0 14 17c-.55 0-1 .45-1 1s.45 1 1 1s1-.45 1-1c0-.1-.03-.19-.06-.28l3.08 3.07c.39.39 1.02.39 1.41 0s.39-1.02 0-1.42L4.62 4.56a.996.996 0 0 0-1.41 0"/></svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true" :class="{ 'animate-pulse': imageBlurPending(card.id) }"><path d="M0 0h24v24H0z" fill="none"/><g fill="currentColor"><circle cx="3" cy="10" r=".5"/><circle cx="3" cy="14" r=".5"/><circle cx="6" cy="6" r="1"/><circle cx="6" cy="10" r="1"/><circle cx="6" cy="14" r="1"/><circle cx="6" cy="18" r="1"/><circle cx="10" cy="3" r=".5"/><circle cx="10" cy="6" r="1"/><circle cx="10" cy="10" r="1.5"/><circle cx="10" cy="14" r="1.5"/><circle cx="10" cy="18" r="1"/><circle cx="10" cy="21" r=".5"/><circle cx="14" cy="3" r=".5"/><circle cx="14" cy="6" r="1"/><circle cx="14" cy="10" r="1.5"/><circle cx="14" cy="14" r="1.5"/><circle cx="14" cy="18" r="1"/><circle cx="14" cy="21" r=".5"/><circle cx="18" cy="6" r="1"/><circle cx="18" cy="10" r="1"/><circle cx="18" cy="14" r="1"/><circle cx="18" cy="18" r="1"/><circle cx="21" cy="10" r=".5"/><circle cx="21" cy="14" r=".5"/></g></svg>
            </button>
            <button type="button" class="icon-button" :aria-label="t('boards.resetOwnership')" :title="t('boards.resetOwnership')" @click="resetOwnership(card)"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0h24v24H0z" fill="none"/><path fill="currentColor" d="M12 16c1.671 0 3-1.331 3-3s-1.329-3-3-3s-3 1.331-3 3s1.329 3 3 3"/><path fill="currentColor" d="M20.817 11.186a8.9 8.9 0 0 0-1.355-3.219a9 9 0 0 0-2.43-2.43a9 9 0 0 0-3.219-1.355a9 9 0 0 0-1.838-.18V2L8 5l3.975 3V6.002c.484-.002.968.044 1.435.14a7 7 0 0 1 2.502 1.053a7 7 0 0 1 1.892 1.892A6.97 6.97 0 0 1 19 13a7 7 0 0 1-.55 2.725a7 7 0 0 1-.644 1.188a7 7 0 0 1-.858 1.039a7.03 7.03 0 0 1-3.536 1.907a7.1 7.1 0 0 1-2.822 0a7 7 0 0 1-2.503-1.054a7 7 0 0 1-1.89-1.89A7 7 0 0 1 5 13H3a9 9 0 0 0 1.539 5.034a9.1 9.1 0 0 0 2.428 2.428A8.95 8.95 0 0 0 12 22a9 9 0 0 0 1.814-.183a9 9 0 0 0 3.218-1.355a9 9 0 0 0 1.331-1.099a9 9 0 0 0 1.1-1.332A8.95 8.95 0 0 0 21 13a9 9 0 0 0-.183-1.814"/></svg></button>
            <button type="button" class="icon-button ml-auto text-red-500 hover:bg-red-500/10" :aria-label="t('common.delete')" :title="t('common.delete')" @click="removeCard(card)"><ActivityDeleteIcon class="h-4.5 w-4.5" /></button>
          </div>
        </article>
      </div>
    </section>
  </form>
  <Teleport to="body">
    <Transition enter-active-class="transition duration-300 ease-out" enter-from-class="opacity-0" enter-to-class="opacity-100" leave-active-class="transition duration-200 ease-in" leave-from-class="opacity-100" leave-to-class="opacity-0">
      <div v-if="editingCard" class="fixed inset-0 z-[220] grid place-items-center overflow-y-auto bg-black/55 p-4 backdrop-blur-sm"><section class="panel my-auto max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto p-6" role="dialog" aria-modal="true" :aria-label="t('boards.editCard')"><h2 class="text-xl font-semibold">{{ t('boards.editCard') }}</h2><form class="mt-5 space-y-4" @submit.prevent="saveCard"><label class="block text-sm font-medium">{{ t('boards.cardLayout') }}<select v-model="cardForm.layout" class="input mt-2"><option value="text">{{ t('boards.layoutText') }}</option><option value="image_text">{{ t('boards.layoutImageText') }}</option></select></label><div class="block text-sm font-medium"><span>{{ t('boards.cardTitle') }}</span><RichTextEditor v-model="cardForm.title" class="mt-2" :max-length="form.settings.maxTitleLength" min-height-class="min-h-20" :aria-label="t('boards.cardTitle')" /></div><div class="block text-sm font-medium"><span>{{ t('boards.cardBody') }}</span><RichTextEditor v-model="cardForm.body" class="mt-2" :max-length="form.settings.maxBodyLength" min-height-class="min-h-36" :aria-label="t('boards.cardBody')" /></div><label v-if="cardForm.layout === 'image_text'" class="block text-sm font-medium">{{ t('boards.imageUrl') }}<input v-model="cardForm.imageUrl" class="input mt-2" type="url" /></label><label class="block text-sm font-medium">{{ t('boards.displayName') }}<input v-model="cardForm.authorDisplayName" class="input mt-2" /></label><div class="flex justify-end gap-2"><button type="button" class="btn-secondary" @click="editingCard = null">{{ t('common.close') }}</button><button class="btn-primary">{{ t('common.save') }}</button></div></form></section></div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.pattern-swatch{color:var(--ui-accent);background-color:var(--ui-panel-muted)}
.pattern-swatch-dots{background-image:radial-gradient(currentColor 1.3px,transparent 1.3px);background-size:12px 12px}
.pattern-swatch-grid{background-image:linear-gradient(currentColor 1px,transparent 1px),linear-gradient(90deg,currentColor 1px,transparent 1px);background-size:14px 14px}
.pattern-swatch-soft_glow{background-image:radial-gradient(circle at 25% 30%,currentColor 0,transparent 42%),radial-gradient(circle at 85% 75%,currentColor 0,transparent 38%);opacity:.65}
.pattern-swatch-crosses{background-image:linear-gradient(90deg,transparent 5px,currentColor 5px 9px,transparent 9px),linear-gradient(transparent 5px,currentColor 5px 9px,transparent 9px);background-position:0 7px,7px 0;background-size:18px 18px;opacity:.65}
.board-moderation-grid{grid-template-columns:repeat(auto-fit,minmax(min(100%,22rem),1fr))}
</style>
