<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import type { BoardCard, BoardCardInput, BoardCardOwnershipResetResponse, BoardInput, BoardSummary, BoardThemeReference } from '@/shared/board-types';
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
const cardForm = reactive<BoardCardInput>({ title: '', body: '', imageUrl: null, authorDisplayName: null, layout: 'text' });
const toLocalDateTimeInput = (value: string) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
watch(() => cardForm.layout, (layout) => { if (layout !== 'image_text') cardForm.imageUrl = null; });
const form = reactive<BoardInput>({ title: '', description: '', slug: '', status: 'draft', expiresAt: null, settings: { themeId: 'board_theme_minimal_light', layout: 'grid', visualStyle: 'classic', backgroundPattern: 'none', patternIntensity: 35, readOnly: false, locked: false, submissionsExpiresAt: null, requireParticipantName: false, moderationMode: 'review_all', maxCardsTotal: 500, maxCardsPerParticipant: 10, maxTitleLength: 160, maxBodyLength: 5000, allowImageUrls: true, participantCanEdit: true, participantCanDelete: true, requireCardTitle: true } });
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
const runCardOperation = async (operation: () => Promise<void>) => { error.value = ''; try { await operation(); } catch (cause) { error.value = (cause as Error).message; } };
const saveCard = async () => runCardOperation(async () => { if (!editingCard.value) return; await api(`/api/boards/${boardId.value}/cards/${editingCard.value.id}`, { method: 'PATCH', body: JSON.stringify(cardForm) }); editingCard.value = null; await reloadCards(); pushToast({ tone: 'success', title: t('boards.cardSaved') }); });
const moderate = async (card: BoardCard, status: 'approved' | 'rejected' | 'pending') => runCardOperation(async () => { await api(`/api/boards/${boardId.value}/cards/${card.id}/moderation`, { method: 'POST', body: JSON.stringify({ status }) }); await reloadCards(); });
const setHidden = async (card: BoardCard, hidden: boolean) => runCardOperation(async () => { await api(`/api/boards/${boardId.value}/cards/${card.id}/visibility`, { method: 'POST', body: JSON.stringify({ hidden }) }); await reloadCards(); });
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
  <form v-else class="mx-auto max-w-7xl space-y-5" @submit.prevent="save">
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
    <section v-else-if="activeTab === 'cards' && boardId" class="panel p-5"><div class="flex items-center justify-between gap-3"><div><h2 class="font-semibold">{{ t('boards.manageCards') }}</h2><p class="mt-1 text-sm text-[var(--ui-text-muted)]">{{ t('boards.manageCardsDescription') }}</p></div><span class="badge">{{ cards.length }}</span></div>
      <p v-if="resetPin" class="mt-4 rounded-2xl border border-[var(--ui-accent)] p-4 text-sm" role="status">{{ t('boards.newRecoveryPin') }} <strong class="ml-2 font-mono text-lg tracking-[.2em]">{{ resetPin }}</strong> <button type="button" class="ml-2 underline" @click="copyResetPin">{{ t('common.copy') }}</button></p>
      <p v-if="cards.length === 0" class="mt-5 rounded-2xl bg-[var(--ui-panel-muted)] p-6 text-center text-sm text-[var(--ui-text-muted)]">{{ t('boards.publicEmpty') }}</p>
      <div v-else class="mt-5 grid gap-3 md:grid-cols-2">
        <article v-for="card in cards" :key="card.id" class="rounded-2xl border border-[var(--ui-border)] p-4 transition-colors hover:border-accent-300/80 dark:hover:border-accent-700/70">
          <div class="flex items-start justify-between gap-3"><div class="min-w-0"><h3 class="truncate font-semibold"><RichTextContent v-if="card.title" :value="card.title" inline /><template v-else>{{ t('boards.untitledCard') }}</template></h3><RichTextContent :value="card.body" class="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-[var(--ui-text-muted)]" /></div><div class="flex flex-wrap justify-end gap-1"><span class="badge">{{ t(`boards.${card.moderationStatus}`) }}</span><span v-if="card.hidden" class="badge">{{ t('boardRealtime.hidden') }}</span></div></div>
          <p v-if="card.authorDisplayName" class="mt-3 text-xs text-[var(--ui-text-muted)]">{{ card.authorDisplayName }}</p>
          <p v-if="card.moderationReason" class="mt-2 text-xs text-amber-700 dark:text-amber-300">{{ card.moderationReason }}</p>
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" class="icon-button" :aria-label="t('common.edit')" :title="t('common.edit')" @click="openCard(card)"><svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0h24v24H0z" fill="none"/><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m16.475 5.408l2.117 2.117m-.756-3.982L12.109 9.27a2.1 2.1 0 0 0-.58 1.082L11 13l2.648-.53c.41-.082.786-.283 1.082-.579l5.727-5.727a1.853 1.853 0 1 0-2.621-2.621"/><path d="M19 15v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3"/></g></svg></button>
            <button v-if="card.moderationStatus !== 'approved'" type="button" class="btn-secondary" @click="moderate(card, 'approved')">{{ t('boards.approve') }}</button>
            <button v-if="card.moderationStatus !== 'rejected'" type="button" class="btn-secondary" @click="moderate(card, 'rejected')">{{ t('boards.reject') }}</button>
            <button v-if="card.moderationStatus === 'approved'" type="button" class="btn-secondary" @click="setHidden(card, !card.hidden)">{{ card.hidden ? t('boardRealtime.restoreCard') : t('boardRealtime.hideCard') }}</button>
            <button type="button" class="btn-secondary" @click="resetOwnership(card)">{{ t('boards.resetOwnership') }}</button>
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
</style>
