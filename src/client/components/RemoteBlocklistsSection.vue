<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  RemoteModerationParsingMode,
  RemoteModerationSource,
  RemoteModerationSourceDetails
} from '@/shared/types';
import { api } from '../lib/api';
import { useToast } from '../composables/useToast';
import ActivityDeleteIcon from './ActivityDeleteIcon.vue';

const { t, locale } = useI18n();
const { pushToast } = useToast();
const sources = ref<RemoteModerationSource[]>([]);
const loading = ref(true);
const loadError = ref('');
const dialogOpen = ref(false);
const editingId = ref<string | null>(null);
const details = ref<RemoteModerationSourceDetails | null>(null);
const dialogError = ref('');
const saving = ref(false);
const inspecting = ref(false);
const refreshingIds = ref(new Set<string>());
const mutatingIds = ref(new Set<string>());
const deleteTarget = ref<RemoteModerationSource | null>(null);
const dialogRef = ref<HTMLElement | null>(null);

const form = reactive({
  url: '',
  parsingMode: 'contains' as RemoteModerationParsingMode,
  updateIntervalMinutes: ''
});

const frequencies = [
  { value: '', label: 'remoteBlocklists.frequencyManual' },
  { value: '15', label: 'remoteBlocklists.frequency15Minutes' },
  { value: '30', label: 'remoteBlocklists.frequency30Minutes' },
  { value: '60', label: 'remoteBlocklists.frequencyHourly' },
  { value: '360', label: 'remoteBlocklists.frequency6Hours' },
  { value: '720', label: 'remoteBlocklists.frequency12Hours' },
  { value: '1440', label: 'remoteBlocklists.frequencyDaily' },
  { value: '10080', label: 'remoteBlocklists.frequencyWeekly' }
] as const;

const dialogTitle = computed(() => editingId.value
  ? t('remoteBlocklists.editTitle')
  : t('remoteBlocklists.addTitle'));

const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat(locale.value === 'lv' ? 'lv-LV' : 'en-GB', {
      dateStyle: 'medium', timeStyle: 'short'
    }).format(new Date(value))
  : t('remoteBlocklists.never');

const modeLabel = (mode: RemoteModerationParsingMode | 'whole_word') => {
  if (mode === 'contains') return t('settings.contains');
  if (mode === 'smart') return t('remoteBlocklists.smart');
  return t('settings.wholeWord');
};

const frequencyLabel = (minutes: number | null) => {
  if (minutes === null) return t('remoteBlocklists.frequencyManual');
  const match = frequencies.find((frequency) => frequency.value === String(minutes));
  return match ? t(match.label) : t('remoteBlocklists.frequencyMinutes', { count: minutes });
};

const sourceName = (source: RemoteModerationSource) => {
  try {
    const segments = new URL(source.url).pathname.split('/').filter(Boolean).map(decodeURIComponent);
    return `${segments[0]}/${segments[1]} · ${segments.at(-1)}`;
  } catch {
    return source.url;
  }
};

const sourceIsBusy = (id: string) => refreshingIds.value.has(id) || mutatingIds.value.has(id);

const friendlyError = (error: unknown) => {
  const message = typeof error === 'string' ? error : (error as Error)?.message ?? '';
  if (/URL is invalid|HTTPS GitHub Raw URL|URL path is invalid/i.test(message)) return t('remoteBlocklists.errors.invalidUrl');
  if (/TXT file/i.test(message)) return t('remoteBlocklists.errors.unsupportedFormat');
  if (/does not contain any rules/i.test(message)) return t('remoteBlocklists.errors.emptyList');
  if (/Smart rule|Invalid remote rule/i.test(message)) return t('remoteBlocklists.errors.malformedSmart');
  if (/timed out|fetch failed|network|HTTP \d+|redirect|blocked network address/i.test(message)) return t('remoteBlocklists.errors.networkFailure');
  return message || t('errors.generic');
};

const statusInfo = (source: RemoteModerationSource) => {
  if (!source.enabled) return { label: t('remoteBlocklists.statusDisabled'), className: 'bg-slate-500/10 text-slate-700 dark:text-slate-300' };
  if (source.syncing || refreshingIds.value.has(source.id)) return { label: t('remoteBlocklists.statusSyncing'), className: 'bg-blue-500/10 text-blue-700 dark:text-blue-300' };
  if (source.syncStatus === 'success') return { label: t('remoteBlocklists.statusChanged'), className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' };
  if (source.syncStatus === 'unchanged') return { label: t('remoteBlocklists.statusUnchanged'), className: 'bg-teal-500/10 text-teal-700 dark:text-teal-300' };
  if (source.syncStatus === 'error') return { label: t('remoteBlocklists.statusFailed'), className: 'bg-red-500/10 text-red-700 dark:text-red-300' };
  if (source.lastSuccessfulUpdateAt) return { label: t('remoteBlocklists.statusPending'), className: 'bg-amber-500/10 text-amber-800 dark:text-amber-200' };
  return { label: t('remoteBlocklists.statusNever'), className: 'bg-amber-500/10 text-amber-800 dark:text-amber-200' };
};

const replaceSource = (source: RemoteModerationSource) => {
  const index = sources.value.findIndex((item) => item.id === source.id);
  if (index === -1) sources.value.unshift(source);
  else sources.value[index] = source;
};

const loadSources = async (showError = true, showLoading = true) => {
  if (showLoading) loading.value = true;
  try {
    sources.value = await api<RemoteModerationSource[]>('/api/moderation/remote-sources');
    loadError.value = '';
  } catch (error) {
    loadError.value = friendlyError(error);
    if (showError) pushToast({ tone: 'error', title: t('remoteBlocklists.loadFailed'), description: loadError.value });
  } finally {
    if (showLoading) loading.value = false;
  }
};

const focusDialog = async () => {
  await nextTick();
  dialogRef.value?.focus();
};

const openCreate = () => {
  editingId.value = null;
  details.value = null;
  dialogError.value = '';
  form.url = '';
  form.parsingMode = 'contains';
  form.updateIntervalMinutes = '';
  dialogOpen.value = true;
  void focusDialog();
};

const openEdit = async (source: RemoteModerationSource) => {
  inspecting.value = true;
  mutatingIds.value = new Set(mutatingIds.value).add(source.id);
  try {
    const nextDetails = await api<RemoteModerationSourceDetails>(`/api/moderation/remote-sources/${source.id}?previewLimit=500`);
    editingId.value = source.id;
    details.value = nextDetails;
    dialogError.value = '';
    form.url = nextDetails.source.url;
    form.parsingMode = nextDetails.source.parsingMode;
    form.updateIntervalMinutes = nextDetails.source.updateIntervalMinutes === null
      ? ''
      : String(nextDetails.source.updateIntervalMinutes);
    dialogOpen.value = true;
    void focusDialog();
  } catch (error) {
    pushToast({ tone: 'error', title: t('remoteBlocklists.inspectFailed'), description: friendlyError(error) });
  } finally {
    const next = new Set(mutatingIds.value);
    next.delete(source.id);
    mutatingIds.value = next;
    inspecting.value = false;
  }
};

const resetDialog = () => {
  dialogOpen.value = false;
  editingId.value = null;
  details.value = null;
  dialogError.value = '';
};

const closeDialog = () => {
  if (saving.value) return;
  resetDialog();
};

const saveSource = async () => {
  dialogError.value = '';
  saving.value = true;
  try {
    const isEditing = Boolean(editingId.value);
    const payload = {
      url: form.url.trim(),
      parsingMode: form.parsingMode,
      updateIntervalMinutes: form.updateIntervalMinutes ? Number(form.updateIntervalMinutes) : null
    };
    const source = await api<RemoteModerationSource>(
      editingId.value ? `/api/moderation/remote-sources/${editingId.value}` : '/api/moderation/remote-sources',
      { method: editingId.value ? 'PATCH' : 'POST', body: JSON.stringify(payload) }
    );
    replaceSource(source);
    resetDialog();
    pushToast({ tone: 'success', title: isEditing ? t('remoteBlocklists.updated') : t('remoteBlocklists.created') });
  } catch (error) {
    dialogError.value = friendlyError(error);
  } finally {
    saving.value = false;
  }
};

const refreshSource = async (source: RemoteModerationSource) => {
  if (sourceIsBusy(source.id)) return;
  refreshingIds.value = new Set(refreshingIds.value).add(source.id);
  try {
    await api<RemoteModerationSource>(`/api/moderation/remote-sources/${source.id}/sync`, {
      method: 'POST', body: JSON.stringify({})
    });
    await loadSources(false, false);
    if (dialogOpen.value && editingId.value === source.id) {
      details.value = await api<RemoteModerationSourceDetails>(`/api/moderation/remote-sources/${source.id}?previewLimit=500`);
    }
    pushToast({ tone: 'success', title: t('remoteBlocklists.refreshComplete') });
  } catch (error) {
    await loadSources(false, false);
    if (dialogOpen.value && editingId.value === source.id) {
      try {
        details.value = await api<RemoteModerationSourceDetails>(`/api/moderation/remote-sources/${source.id}?previewLimit=500`);
      } catch {
        // The card-level error remains visible if inspection also fails.
      }
    }
    pushToast({ tone: 'error', title: t('remoteBlocklists.refreshFailed'), description: friendlyError(error) });
  } finally {
    const next = new Set(refreshingIds.value);
    next.delete(source.id);
    refreshingIds.value = next;
  }
};

const toggleSource = async (source: RemoteModerationSource) => {
  if (sourceIsBusy(source.id)) return;
  mutatingIds.value = new Set(mutatingIds.value).add(source.id);
  try {
    replaceSource(await api<RemoteModerationSource>(`/api/moderation/remote-sources/${source.id}/enabled`, {
      method: 'POST', body: JSON.stringify({ enabled: !source.enabled })
    }));
  } catch (error) {
    pushToast({ tone: 'error', title: t('remoteBlocklists.statusChangeFailed'), description: friendlyError(error) });
  } finally {
    const next = new Set(mutatingIds.value);
    next.delete(source.id);
    mutatingIds.value = next;
  }
};

const confirmDelete = async () => {
  const source = deleteTarget.value;
  if (!source) return;
  mutatingIds.value = new Set(mutatingIds.value).add(source.id);
  try {
    await api(`/api/moderation/remote-sources/${source.id}`, { method: 'DELETE', body: JSON.stringify({}) });
    sources.value = sources.value.filter((item) => item.id !== source.id);
    deleteTarget.value = null;
    pushToast({ tone: 'success', title: t('remoteBlocklists.deleted') });
  } catch (error) {
    pushToast({ tone: 'error', title: t('remoteBlocklists.deleteFailed'), description: friendlyError(error) });
  } finally {
    const next = new Set(mutatingIds.value);
    next.delete(source.id);
    mutatingIds.value = next;
  }
};

const onKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return;
  if (deleteTarget.value) {
    deleteTarget.value = null;
    return;
  }
  if (dialogOpen.value) closeDialog();
};

onMounted(() => {
  document.addEventListener('keydown', onKeydown);
  void loadSources();
});

onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="panel p-5 sm:p-6">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div class="min-w-0">
        <h2 class="text-xl font-semibold">{{ t('remoteBlocklists.title') }}</h2>
        <p class="mt-2 max-w-3xl text-sm leading-6 text-[var(--ui-text-muted)]">{{ t('remoteBlocklists.description') }}</p>
      </div>
      <button type="button" class="btn-primary shrink-0" @click="openCreate">{{ t('remoteBlocklists.add') }}</button>
    </div>

    <div v-if="loading" class="mt-5 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-panel-muted)] p-5 text-sm text-[var(--ui-text-muted)]" aria-live="polite">
      {{ t('common.loading') }}
    </div>
    <div v-else-if="loadError" class="mt-5 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
      <p>{{ loadError }}</p>
      <button type="button" class="btn-secondary mt-3" @click="loadSources()">{{ t('common.retry') }}</button>
    </div>
    <div v-else-if="sources.length === 0" class="mt-5 rounded-2xl border border-dashed border-[var(--ui-border)] p-6 text-center">
      <p class="font-medium">{{ t('remoteBlocklists.empty') }}</p>
      <p class="mt-2 text-sm text-[var(--ui-text-muted)]">{{ t('remoteBlocklists.emptyDescription') }}</p>
    </div>

    <div v-else class="mt-5 grid gap-4 xl:grid-cols-2">
      <article v-for="source in sources" :key="source.id" class="panel-muted min-w-0 overflow-hidden p-4 sm:p-5">
        <div class="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0">
            <h3 class="truncate font-semibold" :title="sourceName(source)">{{ sourceName(source) }}</h3>
            <a :href="source.url" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" class="mt-1 block truncate text-xs text-[var(--ui-text-muted)] underline decoration-transparent transition-colors hover:text-[var(--ui-accent)] hover:decoration-current">
              {{ source.url }}
            </a>
          </div>
          <span class="w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold" :class="statusInfo(source).className">
            {{ statusInfo(source).label }}
          </span>
        </div>

        <dl class="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt class="text-xs text-[var(--ui-text-muted)]">{{ t('remoteBlocklists.matchingMode') }}</dt><dd class="mt-1 font-medium">{{ modeLabel(source.parsingMode) }}</dd></div>
          <div><dt class="text-xs text-[var(--ui-text-muted)]">{{ t('remoteBlocklists.updateFrequency') }}</dt><dd class="mt-1 font-medium">{{ frequencyLabel(source.updateIntervalMinutes) }}</dd></div>
          <div><dt class="text-xs text-[var(--ui-text-muted)]">{{ t('remoteBlocklists.ruleCount') }}</dt><dd class="mt-1 font-medium tabular-nums">{{ source.ruleCount }}</dd></div>
          <div><dt class="text-xs text-[var(--ui-text-muted)]">{{ t('remoteBlocklists.createdAt') }}</dt><dd class="mt-1 font-medium">{{ formatDate(source.createdAt) }}</dd></div>
          <div><dt class="text-xs text-[var(--ui-text-muted)]">{{ t('remoteBlocklists.lastSuccessfulUpdate') }}</dt><dd class="mt-1 font-medium">{{ formatDate(source.lastSuccessfulUpdateAt) }}</dd></div>
          <div><dt class="text-xs text-[var(--ui-text-muted)]">{{ t('remoteBlocklists.lastChecked') }}</dt><dd class="mt-1 font-medium">{{ formatDate(source.lastCheckedAt) }}</dd></div>
        </dl>

        <p v-if="source.lastError" class="mt-4 break-words rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs leading-5 text-red-700 dark:text-red-300">
          {{ friendlyError(source.lastError) }} <span class="font-semibold">{{ t('remoteBlocklists.cachedRetained') }}</span>
        </p>

        <div class="mt-4 flex flex-wrap gap-2 border-t border-[var(--ui-border)] pt-4">
          <button type="button" class="icon-button" :aria-label="t('common.edit')" :title="t('common.edit')" :disabled="sourceIsBusy(source.id)" @click="openEdit(source)">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0h24v24H0z" fill="none"/><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m16.475 5.408l2.117 2.117m-.756-3.982L12.109 9.27a2.1 2.1 0 0 0-.58 1.082L11 13l2.648-.53c.41-.082.786-.283 1.082-.579l5.727-5.727a1.853 1.853 0 1 0-2.621-2.621"/><path d="M19 15v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3"/></g></svg>
          </button>
          <button type="button" class="icon-button" :aria-label="refreshingIds.has(source.id) ? t('remoteBlocklists.refreshing') : t('remoteBlocklists.refreshNow')" :title="refreshingIds.has(source.id) ? t('remoteBlocklists.refreshing') : t('remoteBlocklists.refreshNow')" :disabled="sourceIsBusy(source.id)" @click="refreshSource(source)">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" :class="{ 'animate-spin': refreshingIds.has(source.id) }" viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0h24v24H0z" fill="none"/><path fill="currentColor" d="M6.545 8.163a.75.75 0 0 1-.487-1.044l1.66-3.535a.75.75 0 0 1 1.36.002l.732 1.569l.08-.027a8.15 8.15 0 1 1-5.8 5.903a.75.75 0 1 1 1.456.364a6.65 6.65 0 1 0 4.907-4.862l.74 1.583a.75.75 0 0 1-.872 1.043z"/></svg>
          </button>
          <button type="button" class="icon-button" :aria-label="source.enabled ? t('common.disable') : t('remoteBlocklists.enable')" :title="source.enabled ? t('common.disable') : t('remoteBlocklists.enable')" :disabled="sourceIsBusy(source.id)" @click="toggleSource(source)">
            <svg v-if="source.enabled" xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 14 14" aria-hidden="true"><path d="M0 0h14v14H0z" fill="none"/><path fill="currentColor" fill-rule="evenodd" d="M3.489 2.605A5.6 5.6 0 0 1 7 1.375a.625.625 0 1 0 0-1.25a6.85 6.85 0 0 0-4.4 1.592L1.193.308a.625.625 0 0 0-.884.884l1.83 1.83l8.84 8.84l1.83 1.83a.625.625 0 1 0 .884-.884l-1.41-1.408A6.85 6.85 0 0 0 13.875 7a6.85 6.85 0 0 0-1.823-4.662h.717a.625.625 0 1 0 0-1.25h-2.403a.625.625 0 0 0-.625.625v2.403a.625.625 0 0 0 1.25 0v-1.08A5.6 5.6 0 0 1 12.625 7c0 1.328-.46 2.548-1.23 3.511zm6.305 10.022a.625.625 0 0 1-.363.806A6.9 6.9 0 0 1 7 13.875a.625.625 0 1 1 0-1.25c.701 0 1.371-.128 1.989-.362a.625.625 0 0 1 .805.364m-5.534-.339V9.885a.625.625 0 0 0-1.25 0v1.08A5.6 5.6 0 0 1 1.375 7c0-.715.133-1.397.375-2.025a.625.625 0 0 0-1.166-.45A6.9 6.9 0 0 0 .125 7c0 1.8.692 3.438 1.824 4.664H1.23a.625.625 0 1 0 0 1.25h2.404c.345 0 .625-.28.625-.626" clip-rule="evenodd"/></svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0h24v24H0z" fill="none"/><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M3 12a9 9 0 0 1 16-5.658"/><path d="M19.5 3v4h-4m5.5 5a9 9 0 0 1-16 5.657"/><path d="M4.5 21v-4h4"/></g></svg>
          </button>
          <button type="button" class="btn-secondary ml-auto inline-flex items-center gap-2 px-3 py-2 text-sm text-[#AF3029] dark:text-[#F89A8A]" :disabled="sourceIsBusy(source.id)" @click="deleteTarget = source">
            <ActivityDeleteIcon class="h-4 w-4" />
            {{ t('common.delete') }}
          </button>
        </div>
      </article>
    </div>
  </div>

  <Teleport to="body">
    <Transition enter-active-class="transition duration-200 ease-out" enter-from-class="opacity-0" enter-to-class="opacity-100" leave-active-class="transition duration-150 ease-in" leave-from-class="opacity-100" leave-to-class="opacity-0">
      <div v-if="dialogOpen" class="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-6" role="presentation">
        <section
          ref="dialogRef"
          tabindex="-1"
          class="remote-blocklist-dialog panel app-scrollbar w-full max-w-4xl p-5 outline-none sm:p-7"
          :class="{ 'remote-blocklist-dialog--editing': editingId }"
          role="dialog"
          aria-modal="true"
          aria-labelledby="remote-blocklist-dialog-title"
          @click.stop
        >
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-sm font-semibold uppercase tracking-[0.18em] text-accent-600 dark:text-accent-300">{{ t('remoteBlocklists.title') }}</p>
              <h2 id="remote-blocklist-dialog-title" class="mt-1 text-2xl font-semibold">{{ dialogTitle }}</h2>
            </div>
            <button type="button" class="btn-secondary shrink-0" :disabled="saving" @click="closeDialog">{{ t('common.close') }}</button>
          </div>

          <form class="remote-blocklist-form mt-6 space-y-5" @submit.prevent="saveSource">
            <label class="block">
              <span class="field-label">{{ t('remoteBlocklists.url') }}</span>
              <input v-model="form.url" class="input mt-2" type="url" required maxlength="2048" placeholder="https://raw.githubusercontent.com/owner/repository/main/blocklist.txt" autocomplete="off" />
              <span class="mt-2 block text-xs leading-5 text-[var(--ui-text-muted)]">{{ t('remoteBlocklists.urlHelp') }}</span>
            </label>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="block">
                <span class="field-label">{{ t('remoteBlocklists.matchingMode') }}</span>
                <select v-model="form.parsingMode" class="input mt-2">
                  <option value="contains">{{ t('settings.contains') }}</option>
                  <option value="whole">{{ t('settings.wholeWord') }}</option>
                  <option value="smart">{{ t('remoteBlocklists.smart') }}</option>
                </select>
              </label>
              <label class="block">
                <span class="field-label">{{ t('remoteBlocklists.updateFrequency') }}</span>
                <select v-model="form.updateIntervalMinutes" class="input mt-2">
                  <option v-for="frequency in frequencies" :key="frequency.value" :value="frequency.value">{{ t(frequency.label) }}</option>
                </select>
              </label>
            </div>
            <p v-if="form.parsingMode === 'smart'" class="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-panel-muted)] p-4 text-sm leading-6 text-[var(--ui-text-muted)]">
              {{ t('remoteBlocklists.smartHelp') }}
            </p>
            <p v-if="editingId" class="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm leading-6 text-amber-800 dark:text-amber-200">
              {{ t('remoteBlocklists.cacheSafetyHelp') }}
            </p>
            <p v-if="dialogError" class="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300" role="alert">{{ dialogError }}</p>

            <div v-if="editingId" class="remote-blocklist-preview min-h-0 border-t border-[var(--ui-border)] pt-5">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <h3 class="font-semibold">{{ t('remoteBlocklists.rulePreview') }}</h3>
                  <p class="mt-1 text-xs text-[var(--ui-text-muted)]">{{ t('remoteBlocklists.previewDescription', { count: details?.source.ruleCount ?? 0 }) }}</p>
                </div>
                <button v-if="details" type="button" class="icon-button shrink-0" :aria-label="refreshingIds.has(editingId) ? t('remoteBlocklists.refreshing') : t('remoteBlocklists.refreshNow')" :title="refreshingIds.has(editingId) ? t('remoteBlocklists.refreshing') : t('remoteBlocklists.refreshNow')" :disabled="refreshingIds.has(editingId)" @click="refreshSource(details.source)"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" :class="{ 'animate-spin': refreshingIds.has(editingId) }" viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0h24v24H0z" fill="none"/><path fill="currentColor" d="M6.545 8.163a.75.75 0 0 1-.487-1.044l1.66-3.535a.75.75 0 0 1 1.36.002l.732 1.569l.08-.027a8.15 8.15 0 1 1-5.8 5.903a.75.75 0 1 1 1.456.364a6.65 6.65 0 1 0 4.907-4.862l.74 1.583a.75.75 0 0 1-.872 1.043z"/></svg></button>
              </div>
              <div v-if="inspecting" class="mt-4 text-sm text-[var(--ui-text-muted)]">{{ t('common.loading') }}</div>
              <div
                v-else-if="details?.rules.length"
                data-remote-rule-preview
                class="remote-blocklist-preview-scroll app-scrollbar mt-4 grid max-h-[min(22rem,40dvh)] min-h-0 grid-cols-1 gap-2 overflow-y-auto overflow-x-hidden pr-2 md:grid-cols-2"
              >
                <div v-for="(rule, index) in details.rules" :key="rule.id" class="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-panel-muted)] px-3 py-2.5 text-sm">
                  <span class="remote-blocklist-rule min-w-0 flex-1 whitespace-pre-wrap">{{ rule.pattern }}</span>
                  <span v-if="form.parsingMode === 'smart'" class="shrink-0 rounded-full bg-[var(--ui-pill-bg)] px-2 py-1 text-xs font-medium text-[var(--ui-text-muted)]">{{ modeLabel(rule.matchMode) }}</span>
                  <span class="sr-only">{{ index + 1 }}</span>
                </div>
              </div>
              <p v-else class="mt-4 rounded-xl border border-dashed border-[var(--ui-border)] p-4 text-sm text-[var(--ui-text-muted)]">{{ t('remoteBlocklists.noCachedRules') }}</p>
              <p v-if="details && details.source.ruleCount > details.rules.length" class="mt-3 text-xs text-[var(--ui-text-muted)]">{{ t('remoteBlocklists.previewLimited', { shown: details.rules.length, total: details.source.ruleCount }) }}</p>
            </div>

            <div class="remote-blocklist-actions flex flex-col-reverse gap-3 border-t border-[var(--ui-border)] pt-5 sm:flex-row sm:justify-end">
              <button type="button" class="btn-secondary" :disabled="saving" @click="closeDialog">{{ t('common.cancel') }}</button>
              <button class="btn-primary" :disabled="saving || !form.url.trim()">{{ saving ? t('common.saving') : t('common.save') }}</button>
            </div>
          </form>
        </section>
      </div>
    </Transition>

    <Transition enter-active-class="transition duration-200 ease-out" enter-from-class="opacity-0" enter-to-class="opacity-100" leave-active-class="transition duration-150 ease-in" leave-from-class="opacity-100" leave-to-class="opacity-0">
      <div v-if="deleteTarget" class="fixed inset-0 z-[190] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" role="presentation">
        <section class="panel w-full max-w-lg p-6" role="alertdialog" aria-modal="true" aria-labelledby="remote-delete-title" aria-describedby="remote-delete-description" @click.stop>
          <h2 id="remote-delete-title" class="text-xl font-semibold">{{ t('remoteBlocklists.deleteTitle') }}</h2>
          <p id="remote-delete-description" class="mt-3 text-sm leading-6 text-[var(--ui-text-muted)]">{{ t('remoteBlocklists.deleteDescription') }}</p>
          <p class="mt-3 break-all rounded-xl bg-[var(--ui-panel-muted)] p-3 text-xs">{{ deleteTarget.url }}</p>
          <div class="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" class="btn-secondary" @click="deleteTarget = null">{{ t('common.cancel') }}</button>
            <button type="button" class="btn-primary !bg-[#AF3029] hover:!bg-[#942922]" :disabled="sourceIsBusy(deleteTarget.id)" @click="confirmDelete">{{ t('common.delete') }}</button>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.remote-blocklist-dialog {
  max-height: calc(100dvh - 2rem);
  overflow-y: auto;
}

.remote-blocklist-dialog--editing {
  display: flex;
  height: min(50rem, calc(100dvh - 1.5rem));
  flex-direction: column;
  overflow: hidden;
}

.remote-blocklist-dialog--editing .remote-blocklist-form {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.remote-blocklist-dialog--editing .remote-blocklist-preview {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.remote-blocklist-dialog--editing .remote-blocklist-preview-scroll {
  min-height: 0;
  max-height: none;
  flex: 1;
}

.remote-blocklist-dialog--editing .remote-blocklist-actions {
  flex: none;
}

.remote-blocklist-rule {
  overflow-wrap: anywhere;
  word-break: break-word;
}

@media (max-height: 35rem) {
  .remote-blocklist-dialog--editing {
    display: block;
    height: auto;
    overflow-y: auto;
  }
}
</style>
