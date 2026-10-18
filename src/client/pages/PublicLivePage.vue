<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../lib/api';
import { applyLiveResultsDelta } from '../lib/live-results';
import { useTheme } from '../composables/useTheme';
import LiveResultsBoard from '../components/LiveResultsBoard.vue';
import type { LiveResultsDelta, LiveResultsPage, LiveResultsSnapshot, PublicLiveActivity } from '@/shared/types';
import { useI18n } from 'vue-i18n';
import { localizePublicError } from '../lib/public-error';

useTheme();
const route = useRoute();
const { t } = useI18n();
const activity = ref<PublicLiveActivity | null>(null);
const loading = ref(true);
const error = ref('');
const submittedMessage = ref('');
const participantToken = ref('');
const olderOpenAnswers = ref<LiveResultsSnapshot['openAnswers']>([]);
const answerCursor = ref<string | null>(null);
const loadingMoreAnswers = ref(false);
const wordBrowserOpen = ref(false);
const wordSearch = ref('');
const wordItems = ref<LiveResultsSnapshot['wordCloud']>([]);
const wordCursor = ref<string | null>(null);
const wordTotal = ref(0);
const loadingWords = ref(false);
const resultsError = ref('');
const form = reactive({ participantName: '', text: '', optionIds: [] as string[], scaleValue: null as number | null });
let events: EventSource | null = null;

const responseLimit = computed(() => activity.value?.allowMultipleResponses ? activity.value.maxResponsesPerParticipant : 1);
const canSubmit = computed(() => Boolean(activity.value && activity.value.status === 'active' && activity.value.participantResponseCount < responseLimit.value));
const displayedResults = computed(() => {
  const current = activity.value?.results;
  if (!current || current.type !== 'open_answer' || olderOpenAnswers.value.length === 0) return current;
  const merged = new Map(current.openAnswers.map((answer) => [answer.id, answer]));
  for (const answer of olderOpenAnswers.value) if (!merged.has(answer.id)) merged.set(answer.id, answer);
  return { ...current, openAnswers: [...merged.values()] };
});
const rememberName = () => { if (form.participantName.trim()) localStorage.setItem('shortswitch-live-name', form.participantName.trim()); };
const participantKey = () => `shortswitch-live-participant:${String(route.params.slug)}`;
const getParticipantToken = () => {
  let token = localStorage.getItem(participantKey());
  if (!token) { token = crypto.randomUUID(); localStorage.setItem(participantKey(), token); }
  return token;
};
const load = async () => {
  loading.value = true;
  try {
    participantToken.value = getParticipantToken();
    activity.value = await api<PublicLiveActivity>(`/api/live/public/${encodeURIComponent(String(route.params.slug))}?deferResults=1`, {
      headers: { 'x-live-participant': participantToken.value }
    });
    answerCursor.value = activity.value.results?.openAnswerNextCursor ?? null;
    form.participantName = localStorage.getItem('shortswitch-live-name') ?? '';
    connect();
  } catch (err) { error.value = localizePublicError(err, t, 'live'); }
  finally { loading.value = false; }
};
const connect = () => {
  events?.close();
  if (!activity.value?.publicResults) return;
  events = new EventSource(`/api/live/public/${encodeURIComponent(activity.value.slug)}/events?protocol=2`);
  events.addEventListener('snapshot', (event) => {
    if (!activity.value) return;
    const snapshot = JSON.parse((event as MessageEvent).data) as LiveResultsSnapshot;
    activity.value.results = snapshot;
    activity.value.publicResults = snapshot.publicResults;
    olderOpenAnswers.value = [];
    answerCursor.value = snapshot.openAnswerNextCursor;
  });
  events.addEventListener('delta', (event) => {
    if (!activity.value?.results) return;
    const delta = JSON.parse((event as MessageEvent).data) as LiveResultsDelta;
    if (delta.openAnswers?.removeIds.length) {
      const removed = activity.value.results.openAnswers.filter((answer) => delta.openAnswers!.removeIds.includes(answer.id));
      olderOpenAnswers.value = [...removed, ...olderOpenAnswers.value];
    }
    const next = applyLiveResultsDelta(activity.value.results, delta);
    if (!next) {
      events?.close();
      void refreshResults();
      return;
    }
    activity.value.results = next;
    activity.value.publicResults = next.publicResults;
  });
  events.addEventListener('visibility', (event) => {
    if (!activity.value) return;
    const payload = JSON.parse((event as MessageEvent).data) as { publicResults: boolean };
    activity.value.publicResults = payload.publicResults;
    if (!payload.publicResults) activity.value.results = null;
  });
};
const refreshResults = async () => {
  if (!activity.value) return;
  try {
    const snapshot = await api<LiveResultsSnapshot>(`/api/live/public/${encodeURIComponent(activity.value.slug)}/results`);
    activity.value.results = snapshot;
    olderOpenAnswers.value = [];
    answerCursor.value = snapshot.openAnswerNextCursor;
    resultsError.value = '';
    connect();
  } catch (err) {
    resultsError.value = localizePublicError(err, t, 'live');
  }
};
const loadMoreAnswers = async () => {
  if (!activity.value || !answerCursor.value || loadingMoreAnswers.value) return;
  loadingMoreAnswers.value = true;
  resultsError.value = '';
  try {
    const page = await api<LiveResultsPage<LiveResultsSnapshot['openAnswers'][number]>>(
      `/api/live/public/${encodeURIComponent(activity.value.slug)}/answers?limit=50&cursor=${encodeURIComponent(answerCursor.value)}`
    );
    const known = new Set(olderOpenAnswers.value.map((answer) => answer.id));
    olderOpenAnswers.value.push(...page.items.filter((answer) => !known.has(answer.id)));
    answerCursor.value = page.nextCursor;
  } catch (err) {
    resultsError.value = localizePublicError(err, t, 'live');
  } finally {
    loadingMoreAnswers.value = false;
  }
};
const loadWords = async (reset = false) => {
  if (!activity.value || loadingWords.value) return;
  loadingWords.value = true;
  resultsError.value = '';
  try {
    const cursor = reset ? null : wordCursor.value;
    const query = new URLSearchParams({ limit: '50' });
    if (cursor) query.set('cursor', cursor);
    if (wordSearch.value.trim()) query.set('search', wordSearch.value.trim());
    const page = await api<LiveResultsPage<LiveResultsSnapshot['wordCloud'][number]>>(
      `/api/live/public/${encodeURIComponent(activity.value.slug)}/words?${query}`
    );
    wordItems.value = reset ? page.items : [...wordItems.value, ...page.items];
    wordCursor.value = page.nextCursor;
    wordTotal.value = page.total;
  } catch (err) {
    resultsError.value = localizePublicError(err, t, 'live');
  } finally {
    loadingWords.value = false;
  }
};
const openWordBrowser = () => {
  wordBrowserOpen.value = !wordBrowserOpen.value;
  if (wordBrowserOpen.value && wordItems.value.length === 0) void loadWords(true);
};
const toggleOption = (id: string) => {
  if (!activity.value) return;
  if (!activity.value.allowMultipleChoices) { form.optionIds = [id]; return; }
  form.optionIds = form.optionIds.includes(id) ? form.optionIds.filter((item) => item !== id) : [...form.optionIds, id];
};
const submit = async () => {
  error.value = '';
  if (!activity.value) return;
  if (activity.value.type === 'multiple_choice' && form.optionIds.length === 0) {
    error.value = t('live.chooseAtLeastOne');
    return;
  }
  if (activity.value.type === 'scale' && form.scaleValue === null) {
    error.value = t('live.chooseScale');
    return;
  }
  try {
    rememberName();
    const result = await api<{ status: string; participantResponseCount: number }>(`/api/live/public/${encodeURIComponent(String(route.params.slug))}/responses`, {
      method: 'POST',
      body: JSON.stringify({ participantToken: participantToken.value, ...form })
    });
    if (activity.value) activity.value.participantResponseCount = result.participantResponseCount;
    submittedMessage.value = result.status === 'pending' ? t('live.pendingModeration') : t('live.submitted');
    form.text = ''; form.optionIds = []; form.scaleValue = null;
  } catch (err) { error.value = localizePublicError(err, t, 'live'); }
};
const submitAnother = () => { submittedMessage.value = ''; error.value = ''; };

onMounted(load);
onBeforeUnmount(() => events?.close());
</script>

<template>
  <main class="min-h-dvh px-4 py-8 sm:px-6 sm:py-12">
    <div class="mx-auto max-w-4xl">
      <div v-if="loading" class="panel p-12 text-center text-[var(--ui-text-muted)]">{{ t('live.loading') }}</div>
      <div v-else-if="error && !activity" class="panel p-8 text-center"><h1 class="text-2xl font-semibold">{{ t('live.unavailable') }}</h1><p class="mt-3 text-[var(--ui-text-muted)]">{{ error }}</p></div>
      <template v-else-if="activity">
        <header class="mb-6 text-center"><p class="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--ui-accent)]">ShortSwitch Live</p><p class="mt-3 text-lg font-medium text-[var(--ui-text-muted)] sm:text-xl">{{ activity.title }}</p><div class="panel mt-5 w-full px-5 py-6 sm:px-8 sm:py-8"><h1 class="text-3xl font-semibold leading-tight sm:text-5xl">{{ activity.question }}</h1></div></header>
        <section v-if="activity.status === 'closed'" class="panel p-6 text-center sm:p-8"><h2 class="text-2xl font-semibold">{{ t('live.closedMessage') }}</h2><p class="mt-2 text-[var(--ui-text-muted)]">{{ t('live.closedDescription') }}</p></section>
        <section v-else-if="canSubmit && !submittedMessage" class="panel p-5 sm:p-8">
          <form class="space-y-5" @submit.prevent="submit">
            <label v-if="activity.identityMode === 'named'" class="block"><span class="mb-2 block text-sm font-medium">{{ t('live.yourName') }}</span><input v-model="form.participantName" class="input px-4 py-3" maxlength="80" autocomplete="name" required /></label>
            <label v-if="activity.type === 'open_answer' || activity.type === 'word_cloud'" class="block"><span class="mb-2 block text-sm font-medium">{{ t('live.yourAnswer') }}</span><textarea v-model="form.text" class="input min-h-32 px-4 py-3 text-lg" :maxlength="activity.maxAnswerLength" required /><span class="mt-1 block text-right text-xs text-[var(--ui-text-muted)]">{{ form.text.length }}/{{ activity.maxAnswerLength }}</span></label>
            <fieldset v-if="activity.type === 'multiple_choice'" class="space-y-3"><legend class="text-sm font-medium">{{ t('live.chooseAnswer') }}</legend><p v-if="activity.allowMultipleChoices" class="text-xs text-[var(--ui-text-muted)]">{{ t('live.multipleAllowed') }}</p><div class="grid gap-3"><button v-for="option in activity.options" :key="option.id" type="button" class="rounded-2xl border p-4 text-left transition" :class="form.optionIds.includes(option.id) ? 'border-[var(--ui-accent)] bg-[var(--ui-accent-soft)]' : 'border-[var(--ui-border)] bg-[var(--ui-panel-muted)]'" @click="toggleOption(option.id)">{{ option.label }}</button></div></fieldset>
            <div v-if="activity.type === 'scale'" data-scale-options class="grid grid-cols-[repeat(auto-fit,minmax(3rem,1fr))] gap-2"><button v-for="value in Array.from({ length: (activity.scaleMax ?? 1) - (activity.scaleMin ?? 1) + 1 }, (_, index) => (activity.scaleMin ?? 1) + index)" :key="value" type="button" class="min-h-12 min-w-0 rounded-2xl border px-1 py-3 text-sm font-semibold tabular-nums transition sm:px-2 sm:py-4 sm:text-base" :class="form.scaleValue === value ? 'border-[var(--ui-accent)] bg-[var(--ui-accent)] text-[var(--ui-accent-contrast)]' : 'border-[var(--ui-border)] bg-[var(--ui-panel-muted)]'" @click="form.scaleValue = value">{{ value }}</button></div>
            <p v-if="error" class="rounded-2xl bg-[#FCE8DB] px-4 py-3 text-sm text-[#AF3029] dark:bg-[#321F1C] dark:text-[#F89A8A]">{{ error }}</p>
            <button class="btn-primary w-full py-3 text-base">{{ t('live.submit') }}</button>
          </form>
        </section>
        <section v-else-if="submittedMessage || activity.participantResponseCount > 0" class="panel p-6 text-center"><h2 class="text-2xl font-semibold">{{ t('live.thankYou') }}</h2><p class="mt-2 text-[var(--ui-text-muted)]">{{ submittedMessage || t('live.alreadyRecorded') }}</p><button v-if="activity.allowMultipleResponses && activity.participantResponseCount < responseLimit" class="btn-primary mt-5" @click="submitAnother">{{ t('live.another') }}</button></section>
        <section v-if="activity.publicResults && displayedResults" class="panel mt-6 p-5 sm:p-8">
          <div class="mb-5 flex items-center justify-between gap-4"><h2 class="text-xl font-semibold">{{ t('live.results') }}</h2><span class="text-sm text-[var(--ui-text-muted)]">{{ t('live.publishedCount', { count: displayedResults.responseCount }) }}</span></div>
          <p v-if="resultsError" class="mb-5 rounded-2xl bg-[#FCE8DB] px-4 py-3 text-sm text-[#AF3029] dark:bg-[#321F1C] dark:text-[#F89A8A]">{{ resultsError }}</p>
          <LiveResultsBoard :activity="activity" :results="displayedResults" />
          <div v-if="activity.type === 'open_answer' && answerCursor" class="mt-6 text-center">
            <button class="btn-secondary" :disabled="loadingMoreAnswers" @click="loadMoreAnswers">{{ loadingMoreAnswers ? t('common.loading') : t('pagination.loadMoreResponses') }}</button>
          </div>
          <div v-if="activity.type === 'word_cloud' && displayedResults.wordCloudTotal > 0" class="mt-6 border-t border-[var(--ui-border)] pt-5">
            <button class="btn-secondary" @click="openWordBrowser">{{ wordBrowserOpen ? t('live.hideAllPhrases') : t('live.browseAllPhrases', { count: displayedResults.wordCloudTotal }) }}</button>
            <div v-if="wordBrowserOpen" class="mt-4 space-y-3">
              <form class="flex gap-2" @submit.prevent="loadWords(true)"><input v-model="wordSearch" class="input px-4 py-2" :placeholder="t('common.search')" /><button class="btn-secondary" :disabled="loadingWords">{{ t('common.search') }}</button></form>
              <div class="panel-muted divide-y divide-[var(--ui-border)] px-4"><div v-for="word in wordItems" :key="word.text.toLocaleLowerCase()" class="flex justify-between gap-4 py-3"><span class="min-w-0 break-words">{{ word.text }}</span><span class="shrink-0 text-[var(--ui-text-muted)]">{{ word.count }}</span></div></div>
              <button v-if="wordCursor" class="btn-secondary" :disabled="loadingWords" @click="loadWords(false)">{{ loadingWords ? t('common.loading') : t('pagination.loadMore') }}</button>
              <p v-else-if="wordItems.length" class="text-sm text-[var(--ui-text-muted)]">{{ t('live.showingPhrases', { shown: wordItems.length, total: wordTotal }) }}</p>
            </div>
          </div>
        </section>
      </template>
    </div>
  </main>
</template>
