<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import type { ActivitySlide, ActivitySupportedAnswer, PublicActivityAttempt, PublicActivityLanding } from '@/shared/activity-types';
import { useActivityAutosave } from '../composables/useActivityAutosave';
import ActivityOrderingInput from '../components/ActivityOrderingInput.vue';
import ActivityMatchingInput from '../components/ActivityMatchingInput.vue';
import ActivityImageLabelingInput from '../components/ActivityImageLabelingInput.vue';
import ActivityDeleteIcon from '../components/ActivityDeleteIcon.vue';
import { activityCorrectAnswerRows, formatActivityNumber } from '../lib/activity-results';

const route = useRoute();
const { t } = useI18n();
const slug = computed(() => String(route.params.slug));
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const landing = ref<PublicActivityLanding | null>(null);
const attempt = ref<PublicActivityAttempt | null>(null);
const participantName = ref('');
const attemptToken = ref('');
const confirmSubmit = ref(false);
const remainingSeconds = ref<number | null>(null);
const serverOffsetMs = ref(0);
const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine);
const connectionRestored = ref(false);
const clockTick = ref(Date.now());
const answers = reactive<Record<string, ActivitySupportedAnswer | undefined>>({});
const wordDrafts = reactive<Record<string, string>>({});
let deadlineTimer: ReturnType<typeof setInterval> | null = null;
let clockTimer: ReturnType<typeof setInterval> | null = null;

const credentialKey = computed(() => `shortswitch-activity-attempt:${slug.value}`);
const participantKeyName = computed(() => `shortswitch-activity-participant:${slug.value}`);
const browserParticipantKey = () => {
  let value = localStorage.getItem(participantKeyName.value);
  if (!value) { value = crypto.randomUUID(); localStorage.setItem(participantKeyName.value, value); }
  return value;
};
const publicFetch = async <T>(url: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  const response = await fetch(url, { ...init, headers, credentials: 'omit' });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: t('errors.generic') })) as { message?: string };
    throw new Error(payload.message || t('errors.generic'));
  }
  return response.json() as Promise<T>;
};
const authorized = (url: string, init: RequestInit = {}) => publicFetch<any>(url, {
  ...init,
  headers: { ...Object.fromEntries(new Headers(init.headers).entries()), authorization: `Bearer ${attemptToken.value}` }
});
const saveResponse = (questionBlockId: string, answer: ActivitySupportedAnswer, clientRevision: number) => authorized(
  `/api/activities/public/${encodeURIComponent(slug.value)}/attempts/${attempt.value!.id}/responses/${questionBlockId}`,
  { method: 'PATCH', body: JSON.stringify({ answer, clientRevision }) }
);
const autosave = useActivityAutosave(saveResponse);

const currentIndex = computed(() => Math.max(0, attempt.value?.slides.findIndex((slide) => slide.id === attempt.value?.currentSlideId) ?? 0));
const currentSlide = computed<ActivitySlide | null>(() => attempt.value?.slides[currentIndex.value] ?? null);
const progress = computed(() => attempt.value ? Math.round(((currentIndex.value + 1) / Math.max(1, attempt.value.slides.length)) * 100) : 0);
const isFinal = computed(() => Boolean(attempt.value && currentIndex.value === attempt.value.slides.length - 1));
const finalized = computed(() => attempt.value?.status !== 'in_progress');
const visualTheme = computed(() => attempt.value?.settings.theme ?? landing.value?.theme ?? 'minimal_light');
const visualLayout = computed(() => attempt.value?.settings.layout ?? landing.value?.layout ?? 'classic');
const visualPattern = computed(() => attempt.value?.settings.backgroundPattern ?? landing.value?.backgroundPattern ?? 'none');
const visualPatternIntensity = computed(() => attempt.value?.settings.patternIntensity ?? landing.value?.patternIntensity ?? 35);
const lowTime = computed(() => remainingSeconds.value !== null && attempt.value?.lowTimeWarningSeconds !== null && remainingSeconds.value <= (attempt.value?.lowTimeWarningSeconds ?? 0));
const deadlineLabel = computed(() => attempt.value?.deadlineAt
  ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(attempt.value.deadlineAt))
  : '');
const landingDeadlineLabel = computed(() => landing.value?.submissionDeadlineAt
  ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: landing.value.submissionDeadlineTimezone }).format(new Date(landing.value.submissionDeadlineAt))
  : '');
const landingAvailabilityLabel = computed(() => landing.value?.availabilityStartAt
  ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: landing.value.submissionDeadlineTimezone }).format(new Date(landing.value.availabilityStartAt))
  : '');
const isAvailableNow = computed(() => !landing.value?.availabilityStartAt || Date.parse(landing.value.availabilityStartAt) <= clockTick.value + serverOffsetMs.value);
const questionBlocks = (slide: ActivitySlide | null) => slide?.blocks.filter((block) => block.type === 'question') ?? [];
const resultQuestion = (questionBlockId: string) => {
  for (const slide of attempt.value?.slides ?? []) {
    const block = slide.blocks.find((candidate) => candidate.type === 'question' && candidate.id === questionBlockId);
    if (block?.type === 'question') return { slide, block };
  }
  return null;
};
const correctAnswerRows = (questionBlockId: string, correctAnswer: unknown) => {
  const question = resultQuestion(questionBlockId);
  return question
    ? activityCorrectAnswerRows(question.block.questionType, correctAnswer, question.block.config)
    : [];
};

const storeCredential = () => localStorage.setItem(credentialKey.value, JSON.stringify({ attemptId: attempt.value?.id, attemptToken: attemptToken.value }));
const stopDeadlineTimer = () => { if (deadlineTimer) clearInterval(deadlineTimer); deadlineTimer = null; };
const updateDeadline = () => {
  if (!attempt.value?.deadlineAt || attempt.value.status !== 'in_progress') { remainingSeconds.value = null; stopDeadlineTimer(); return; }
  remainingSeconds.value = Math.max(0, Math.ceil((Date.parse(attempt.value.deadlineAt) - (Date.now() + serverOffsetMs.value)) / 1000));
  if (remainingSeconds.value === 0) {
    stopDeadlineTimer();
    void authorized(`/api/activities/public/${encodeURIComponent(slug.value)}/attempts/${attempt.value.id}`)
      .then((value) => hydrate(value))
      .catch((reason) => { error.value = reason instanceof Error ? reason.message : t('errors.generic'); });
  }
};
const startDeadlineTimer = () => { stopDeadlineTimer(); updateDeadline(); if (remainingSeconds.value && remainingSeconds.value > 0) deadlineTimer = setInterval(updateDeadline, 1_000); };
const hydrate = (value: PublicActivityAttempt) => {
  serverOffsetMs.value = Date.parse(value.serverNow) - Date.now();
  attempt.value = value;
  for (const response of value.responses) {
    answers[response.questionBlockId] = response.answer;
    autosave.seed(response.questionBlockId, response.clientRevision);
  }
  startDeadlineTimer();
};
const reconcileAttempt = async () => {
  if (!attempt.value || !attemptToken.value) return;
  try { hydrate(await authorized(`/api/activities/public/${encodeURIComponent(slug.value)}/attempts/${attempt.value.id}`)); }
  catch (reason) { error.value = reason instanceof Error ? reason.message : t('errors.generic'); }
};
const onVisibilityChange = () => { if (document.visibilityState === 'visible') void reconcileAttempt(); };
const load = async () => {
  loading.value = true; error.value = '';
  try {
    landing.value = await publicFetch(`/api/activities/public/${encodeURIComponent(slug.value)}`);
    serverOffsetMs.value = Date.parse(landing.value.serverNow) - Date.now();
    const stored = JSON.parse(localStorage.getItem(credentialKey.value) ?? 'null') as { attemptId?: string; attemptToken?: string } | null;
    if (stored?.attemptId && stored.attemptToken) {
      attemptToken.value = stored.attemptToken;
      try {
        hydrate(await authorized(`/api/activities/public/${encodeURIComponent(slug.value)}/attempts/${stored.attemptId}`));
      } catch {
        localStorage.removeItem(credentialKey.value);
        attemptToken.value = '';
      }
    }
  } catch (reason) { error.value = reason instanceof Error ? reason.message : t('errors.generic'); }
  finally { loading.value = false; }
};
const start = async () => {
  busy.value = true; error.value = '';
  try {
    const credential = await publicFetch<{ attemptId: string; attemptToken: string; attempt: PublicActivityAttempt }>(
      `/api/activities/public/${encodeURIComponent(slug.value)}/attempts`,
      { method: 'POST', body: JSON.stringify({ participantKey: browserParticipantKey(), participantName: participantName.value }) }
    );
    attemptToken.value = credential.attemptToken;
    hydrate(credential.attempt);
    storeCredential();
  } catch (reason) { error.value = reason instanceof Error ? reason.message : t('errors.generic'); }
  finally { busy.value = false; }
};
const answerFor = (id: string) => answers[id];
const setAnswer = (id: string, answer: ActivitySupportedAnswer) => {
  answers[id] = answer;
  autosave.schedule(id, answer);
};
const textValue = (id: string) => {
  const answer = answerFor(id);
  return answer?.questionType === 'open_answer' ? answer.text : '';
};
const wordResponses = (id: string) => {
  const answer = answerFor(id);
  if (answer?.questionType !== 'word_cloud') return [];
  return 'responses' in answer ? answer.responses : [answer.text];
};
const addWordResponse = (id: string, maximum: number) => {
  const value = (wordDrafts[id] ?? '').trim().replace(/\s+/gu, ' ');
  if (!value || wordResponses(id).length >= maximum) return;
  setAnswer(id, { questionType: 'word_cloud', responses: [...wordResponses(id), value] });
  wordDrafts[id] = '';
};
const removeWordResponse = (id: string, index: number) => setAnswer(id, {
  questionType: 'word_cloud',
  responses: wordResponses(id).filter((_value, responseIndex) => responseIndex !== index)
});
const orderingValue = (block: Extract<ActivitySlide['blocks'][number], { type: 'question' }>) => {
  const answer = answerFor(block.id);
  if (answer?.questionType === 'ordering') return answer.orderedItemIds;
  return block.config.questionType === 'ordering' ? block.config.items.map((item) => item.id) : [];
};
const matchingValue = (id: string) => {
  const answer = answerFor(id);
  return answer?.questionType === 'matching' ? answer.pairs : [];
};
const imageAssignments = (id: string) => {
  const answer = answerFor(id);
  return answer?.questionType === 'image_labeling' ? answer.assignments : [];
};
const selectedOption = (id: string) => answerFor(id)?.questionType === 'single_choice' ? answerFor(id)!.optionId : null;
const selectedOptions = (id: string) => answerFor(id)?.questionType === 'multiple_choice' ? answerFor(id)!.optionIds : [];
const updateMultiple = (id: string, optionId: string, checked: boolean, maximumSelections: number) => {
  const selected = new Set(selectedOptions(id));
  if (checked && selected.size >= maximumSelections) return;
  checked ? selected.add(optionId) : selected.delete(optionId);
  setAnswer(id, { questionType: 'multiple_choice', optionIds: [...selected] });
};
const blockAnswered = (block: Extract<ActivitySlide['blocks'][number], { type: 'question' }>) => {
  const answer = answers[block.id];
  if (!answer) return false;
  if (answer.questionType === 'single_choice') return Boolean(answer.optionId);
  if (answer.questionType === 'multiple_choice') return answer.optionIds.length >= (block.config.questionType === 'multiple_choice' ? block.config.minimumSelections : 1);
  if (answer.questionType === 'open_answer') return Boolean(answer.text.trim());
  if (answer.questionType === 'word_cloud') return wordResponses(block.id).length > 0;
  if (answer.questionType === 'ordering') return block.config.questionType === 'ordering' && answer.orderedItemIds.length === block.config.items.length;
  if (answer.questionType === 'matching') return block.config.questionType === 'matching' && answer.pairs.length === block.config.leftItems.length;
  if (answer.questionType === 'image_labeling') return block.config.questionType === 'image_labeling' && answer.assignments.length === block.config.markers.length;
  return false;
};
const requiredAnswered = (slide: ActivitySlide | null) => questionBlocks(slide).every((block) => !block.required || blockAnswered(block));
const navigate = async (direction: -1 | 1) => {
  if (!attempt.value || !currentSlide.value) return;
  error.value = '';
  if (direction > 0 && attempt.value.settings.requiredAnswerBehavior === 'require_all' && !requiredAnswered(currentSlide.value)) {
    error.value = t('activityPlayer.required'); return;
  }
  const ids = questionBlocks(currentSlide.value).map((block) => block.id);
  if (!await autosave.flushAll(ids)) { error.value = t('activityPlayer.saveBeforeNavigation'); return; }
  const target = attempt.value.slides[currentIndex.value + direction];
  if (!target) return;
  busy.value = true;
  try {
    hydrate(await authorized(`/api/activities/public/${encodeURIComponent(slug.value)}/attempts/${attempt.value.id}/navigate`, { method: 'POST', body: JSON.stringify({ targetSlideId: target.id }) }));
  } catch (reason) { error.value = reason instanceof Error ? reason.message : t('errors.generic'); }
  finally { busy.value = false; }
};
const submit = async () => {
  if (!attempt.value) return;
  error.value = '';
  if (!await autosave.flushAll()) { error.value = t('activityPlayer.saveBeforeNavigation'); return; }
  busy.value = true;
  try {
    hydrate(await authorized(`/api/activities/public/${encodeURIComponent(slug.value)}/attempts/${attempt.value.id}/submit`, { method: 'POST', body: '{}' }));
    confirmSubmit.value = false;
  } catch (reason) { error.value = reason instanceof Error ? reason.message : t('errors.generic'); }
  finally { busy.value = false; }
};
const openSubmitConfirmation = () => {
  error.value = '';
  if (attempt.value?.settings.requiredAnswerBehavior === 'require_all' && attempt.value.slides.some((slide) => !requiredAnswered(slide))) {
    error.value = t('activityConnectivity.requiredAll');
    return;
  }
  confirmSubmit.value = true;
};
const onKeydown = (event: KeyboardEvent) => { if (event.key === 'Escape') confirmSubmit.value = false; };
const onOffline = () => { online.value = false; connectionRestored.value = false; };
const onOnline = () => {
  online.value = true;
  connectionRestored.value = true;
  for (const [id, state] of Object.entries(autosave.states)) if (state === 'error') void autosave.retry(id);
  window.setTimeout(() => { connectionRestored.value = false; }, 4_000);
};

onMounted(() => { clockTimer = setInterval(() => { clockTick.value = Date.now(); }, 1_000); window.addEventListener('keydown', onKeydown); window.addEventListener('offline', onOffline); window.addEventListener('online', onOnline); document.addEventListener('visibilitychange', onVisibilityChange); void load(); });
onBeforeUnmount(() => { stopDeadlineTimer(); if (clockTimer) clearInterval(clockTimer); window.removeEventListener('keydown', onKeydown); window.removeEventListener('offline', onOffline); window.removeEventListener('online', onOnline); document.removeEventListener('visibilitychange', onVisibilityChange); });
</script>

<template>
  <main class="activity-surface min-h-dvh px-4 py-8 sm:px-6 sm:py-12" :class="[`activity-theme-${visualTheme}`, `activity-layout-${visualLayout}`, `activity-pattern-${visualPattern}`]" :style="{ '--activity-pattern-opacity': String(visualPatternIntensity / 100) }">
    <div class="mx-auto w-full max-w-5xl">
      <div v-if="loading" class="panel p-8 text-center text-[var(--ui-text-muted)]">{{ t('common.loading') }}</div>
      <div v-else-if="error && !landing" class="panel p-8 text-center"><h1 class="text-2xl font-semibold">{{ t('activityPlayer.unavailable') }}</h1><p class="mt-3 text-[var(--ui-text-muted)]">{{ error }}</p></div>
      <section v-else-if="landing && !attempt" class="panel mx-auto max-w-xl p-7 sm:p-10">
        <span class="text-xs font-semibold uppercase tracking-[.2em] text-[var(--ui-accent)]">{{ t('activityPlayer.selfPaced') }}</span>
        <h1 class="mt-3 text-3xl font-semibold">{{ landing.title }}</h1>
        <p v-if="landing.description" class="mt-3 leading-7 text-[var(--ui-text-muted)]">{{ landing.description }}</p>
        <div class="mt-6 rounded-2xl bg-[var(--ui-panel-muted)] p-4 text-sm text-[var(--ui-text-muted)]">{{ t('activityPlayer.slides', { count: landing.slideCount }) }}</div>
        <div v-if="landing.attemptTimeLimitSeconds || landingDeadlineLabel || landingAvailabilityLabel" class="mt-3 space-y-1 rounded-2xl border border-[var(--ui-border)] p-4 text-sm text-[var(--ui-text-muted)]"><p v-if="landingAvailabilityLabel">{{ t('activityConnectivity.availableFrom', { date: landingAvailabilityLabel }) }}</p><p v-if="landing.attemptTimeLimitSeconds">{{ t('activityPlayer.individualLimit', { minutes: Math.ceil(landing.attemptTimeLimitSeconds / 60) }) }}</p><p v-if="landingDeadlineLabel">{{ t('activityPlayer.globalDeadline', { deadline: landingDeadlineLabel, timezone: landing.submissionDeadlineTimezone }) }}</p><p v-if="landing.attemptTimeLimitSeconds && landingDeadlineLabel" class="text-xs">{{ t('activityPlayer.earlierDeadline') }}</p></div>
        <p v-if="landing.status !== 'active'" class="mt-5 rounded-2xl border border-[var(--ui-border)] p-4">{{ t('activityPlayer.closed') }}</p>
        <p v-else-if="!isAvailableNow" class="mt-5 rounded-2xl border border-[var(--ui-border)] p-4">{{ t('activityConnectivity.notAvailableYet') }}</p>
        <form v-else class="mt-6" @submit.prevent="start">
          <label v-if="landing.identityMode === 'named'" class="block text-sm font-medium">{{ t('activityPlayer.name') }}<input v-model="participantName" class="input mt-2" maxlength="80" required autocomplete="name" /></label>
          <p class="mt-4 text-xs leading-5 text-[var(--ui-text-muted)]">{{ t('activityPlayer.browserIdentity') }}</p>
          <button class="btn btn-primary mt-6 w-full" :disabled="busy">{{ busy ? t('common.loading') : t('activityPlayer.start') }}</button>
        </form>
        <p v-if="error" class="mt-4 text-sm text-[var(--flexoki-red-600)]" role="alert">{{ error }}</p>
      </section>
      <section v-else-if="attempt && finalized" class="panel mx-auto max-w-xl p-8 text-center sm:p-12">
        <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--ui-accent-soft)] text-2xl text-[var(--ui-accent)]">✓</div>
        <h1 class="mt-5 text-3xl font-semibold">{{ t('activityPlayer.complete') }}</h1>
        <p class="mt-3 text-[var(--ui-text-muted)]">{{ attempt.status === 'auto_submitted' || attempt.status === 'expired' ? t('activityConnectivity.expiredComplete') : t('activityPlayer.completeDescription') }}</p>
        <p v-if="attempt.gradingState === 'awaiting_manual_grading'" class="mt-4 rounded-2xl bg-[var(--ui-panel-muted)] p-3 text-sm text-[var(--ui-text-muted)]">{{ t('activityResults.awaitingManual') }}</p>
        <p v-else-if="!attempt.result && attempt.settings.feedbackPolicy === 'manual_release'" class="mt-4 rounded-2xl bg-[var(--ui-panel-muted)] p-3 text-sm text-[var(--ui-text-muted)]">{{ t('activityResults.notReleased') }}</p>
        <div v-if="attempt.result" class="mt-6 text-left">
          <p v-if="attempt.result.score !== null" class="rounded-2xl bg-[var(--ui-accent-soft)] p-4 text-center text-lg font-semibold text-[var(--ui-accent)]">{{ t('activityResults.score', { score: formatActivityNumber(attempt.result.score), maximum: formatActivityNumber(attempt.result.maximumScore) }) }}</p>
          <div v-for="result in attempt.result.questions" :key="result.questionBlockId" class="mt-3 rounded-2xl border border-[var(--ui-border)] p-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="text-xs font-semibold uppercase tracking-[.14em] text-[var(--ui-accent)]">{{ t('activityPlayer.progress', { current: (resultQuestion(result.questionBlockId)?.slide.position ?? 0) + 1, total: attempt.slides.length }) }}</p>
                <h2 class="mt-1 break-words font-semibold">{{ resultQuestion(result.questionBlockId)?.block.config.prompt ?? t('activityResults.question') }}</h2>
              </div>
              <p class="shrink-0 rounded-full bg-[var(--ui-panel-muted)] px-3 py-1.5 text-sm font-semibold">{{ formatActivityNumber(result.awardedPoints) }} / {{ formatActivityNumber(result.maximumPoints) }}</p>
            </div>
            <template v-if="result.feedback"><p class="mt-3 text-sm font-semibold">{{ t('activityResults.feedback') }}</p><p class="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--ui-text-muted)]">{{ result.feedback }}</p></template>
            <template v-if="result.correctAnswer !== undefined">
              <p class="mt-4 text-sm font-semibold">{{ t('activityResults.correctAnswer') }}</p>
              <div v-if="correctAnswerRows(result.questionBlockId, result.correctAnswer).length" class="mt-2 grid gap-2">
                <div v-for="(row, rowIndex) in correctAnswerRows(result.questionBlockId, result.correctAnswer)" :key="`${row.label}-${row.value}-${rowIndex}`" class="flex items-start gap-3 rounded-xl bg-[var(--ui-panel-muted)] px-3 py-2.5 text-sm">
                  <span v-if="row.label" class="shrink-0 font-semibold text-[var(--ui-accent)]">{{ row.label }}</span>
                  <span class="min-w-0 whitespace-pre-wrap break-words">{{ row.value }}</span>
                </div>
              </div>
            </template>
          </div>
          <div v-for="cloud in attempt.result.wordClouds" :key="cloud.questionBlockId" class="mt-4 rounded-2xl border border-[var(--ui-border)] p-4"><div class="flex items-center justify-between gap-3"><p class="font-semibold">{{ t('activityQuestionTypes.word_cloud') }}</p><span class="text-xs text-[var(--ui-text-muted)]">{{ cloud.totalResponses }} / {{ cloud.uniqueResponses }}</span></div><div class="mt-3 flex flex-wrap gap-2"><span v-for="item in cloud.items" :key="item.text" class="rounded-full bg-[var(--ui-accent-soft)] px-3 py-1.5 text-sm text-[var(--ui-accent)]"><strong>{{ item.text }}</strong> × {{ item.count }}<small v-if="item.participantNames?.length" class="ml-1 opacity-70">· {{ item.participantNames.join(', ') }}</small></span></div></div>
        </div>
      </section>
      <section v-else-if="attempt && currentSlide" class="space-y-5">
        <p v-if="!online" class="panel border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200" role="alert">{{ t('activityConnectivity.offline') }}</p>
        <p v-else-if="connectionRestored" class="panel p-3 text-sm text-[var(--ui-accent)]" role="status">{{ t('activityConnectivity.backOnline') }}</p>
        <header class="panel p-5 sm:p-6">
          <div class="flex items-center justify-between gap-4"><div><p class="text-xs font-semibold uppercase tracking-[.18em] text-[var(--ui-accent)]">{{ attempt.settings.title }}</p><p class="mt-1 text-sm text-[var(--ui-text-muted)]">{{ t('activityPlayer.progress', { current: currentIndex + 1, total: attempt.slides.length }) }}</p><p v-if="remainingSeconds !== null" class="mt-1 text-xs font-semibold" :class="lowTime ? 'text-[var(--flexoki-red-600)]' : 'text-[var(--ui-accent)]'" role="timer" aria-live="off">{{ t('activityPlayer.timeRemaining', { minutes: Math.floor(remainingSeconds / 60), seconds: String(remainingSeconds % 60).padStart(2, '0') }) }}</p><p v-if="deadlineLabel" class="mt-1 text-xs text-[var(--ui-text-muted)]">{{ t('activityPlayer.deadlineInformation', { deadline: deadlineLabel }) }}</p></div><strong>{{ progress }}%</strong></div>
          <p v-if="lowTime" class="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-[var(--flexoki-red-600)]" role="status">{{ t('activityPlayer.lowTime') }}</p>
          <div class="mt-4 h-2 overflow-hidden rounded-full bg-[var(--ui-panel-muted)]" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100" :aria-label="t('activityPlayer.progress', { current: currentIndex + 1, total: attempt.slides.length })"><div class="h-full rounded-full bg-[var(--ui-accent)] transition-[width] motion-reduce:transition-none" :style="{ width: `${progress}%` }"></div></div>
        </header>
        <article class="panel min-w-0 space-y-5 p-4 sm:p-8">
          <div><h1 class="text-2xl font-semibold">{{ currentSlide.title || t('activityPlayer.untitledSlide') }}</h1><p v-if="currentSlide.description" class="mt-2 leading-7 text-[var(--ui-text-muted)]">{{ currentSlide.description }}</p></div>
          <template v-for="block in currentSlide.blocks" :key="block.id">
            <h2 v-if="block.type === 'heading'" class="font-semibold" :class="block.config.level === 1 ? 'text-3xl' : block.config.level === 2 ? 'text-2xl' : 'text-xl'">{{ block.config.text }}</h2>
            <p v-else-if="block.type === 'text'" class="whitespace-pre-wrap leading-7">{{ block.config.text }}</p>
            <figure v-else-if="block.type === 'image'" class="overflow-hidden rounded-2xl border border-[var(--ui-border)]"><img :src="block.config.url" :alt="block.config.alt" class="max-h-[28rem] w-full object-contain" /><figcaption v-if="block.config.caption" class="p-3 text-sm text-[var(--ui-text-muted)]">{{ block.config.caption }}</figcaption></figure>
            <hr v-else-if="block.type === 'divider'" class="border-[var(--ui-border)]" />
            <fieldset v-else class="min-w-0 max-w-full rounded-2xl border border-[var(--ui-border)] p-3 sm:p-5">
              <legend class="max-w-full break-words px-2 text-lg font-semibold [overflow-wrap:anywhere]">{{ block.config.prompt }} <span v-if="block.required" class="text-[var(--ui-accent)]">*</span></legend>
              <p v-if="(block.questionType === 'single_choice' || block.questionType === 'multiple_choice') && block.config.description" class="mb-4 text-sm leading-6 text-[var(--ui-text-muted)]">{{ block.config.description }}</p>
              <p v-if="(block.questionType === 'open_answer' || block.questionType === 'word_cloud') && block.config.instructions" class="mb-4 text-sm leading-6 text-[var(--ui-text-muted)]">{{ block.config.instructions }}</p>
              <div v-if="block.questionType === 'single_choice'" class="space-y-2">
                <label v-for="option in block.config.options" :key="option.id" class="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors focus-within:ring-2 focus-within:ring-[var(--ui-accent)]" :class="selectedOption(block.id) === option.id ? 'border-[var(--ui-accent)] bg-[var(--ui-accent-soft)]' : 'border-[var(--ui-border)] hover:border-[var(--ui-border-strong)]'"><input type="radio" :name="block.id" :checked="selectedOption(block.id) === option.id" @change="setAnswer(block.id, { questionType: 'single_choice', optionId: option.id })" /><span>{{ option.label }}</span></label>
                <button v-if="!block.required && selectedOption(block.id)" type="button" class="text-sm text-[var(--ui-accent)] underline-offset-4 hover:underline" @click="setAnswer(block.id, { questionType: 'single_choice', optionId: null })">{{ t('activityChoices.clear') }}</button>
              </div>
              <div v-else-if="block.questionType === 'multiple_choice'" class="space-y-2">
                <label v-for="option in block.config.options" :key="option.id" class="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors focus-within:ring-2 focus-within:ring-[var(--ui-accent)]" :class="selectedOptions(block.id).includes(option.id) ? 'border-[var(--ui-accent)] bg-[var(--ui-accent-soft)]' : 'border-[var(--ui-border)] hover:border-[var(--ui-border-strong)]'"><input type="checkbox" :checked="selectedOptions(block.id).includes(option.id)" :disabled="!selectedOptions(block.id).includes(option.id) && selectedOptions(block.id).length >= block.config.maximumSelections" @change="updateMultiple(block.id, option.id, ($event.target as HTMLInputElement).checked, block.config.maximumSelections)" /><span>{{ option.label }}</span></label>
                <div class="flex items-center justify-between gap-3"><p class="text-xs text-[var(--ui-text-muted)]">{{ t('activityPlayer.selectionRange', { min: block.config.minimumSelections, max: block.config.maximumSelections }) }}</p><button v-if="!block.required && selectedOptions(block.id).length" type="button" class="text-sm text-[var(--ui-accent)] underline-offset-4 hover:underline" @click="setAnswer(block.id, { questionType: 'multiple_choice', optionIds: [] })">{{ t('activityChoices.clear') }}</button></div>
              </div>
              <div v-else-if="block.questionType === 'open_answer'">
                <input v-if="block.config.responseMode === 'single_line'" class="input" :minlength="block.config.minimumLength" :maxlength="block.config.maximumLength" :value="textValue(block.id)" @input="setAnswer(block.id, { questionType: 'open_answer', text: ($event.target as HTMLInputElement).value })" />
                <textarea v-else class="input min-h-28" :minlength="block.config.minimumLength" :maxlength="block.config.maximumLength" :value="textValue(block.id)" @input="setAnswer(block.id, { questionType: 'open_answer', text: ($event.target as HTMLTextAreaElement).value })"></textarea>
                <p class="mt-1 text-right text-xs text-[var(--ui-text-muted)]">{{ textValue(block.id).length }} / {{ block.config.maximumLength }}</p>
              </div>
              <div v-else-if="block.questionType === 'word_cloud'" class="space-y-3">
                <input v-if="!block.config.allowMultipleResponses" class="input" :maxlength="block.config.maximumLength" :value="wordResponses(block.id)[0] ?? ''" @input="setAnswer(block.id, { questionType: 'word_cloud', responses: [($event.target as HTMLInputElement).value] })" />
                <template v-else><div class="flex gap-2"><input v-model="wordDrafts[block.id]" class="input" :maxlength="block.config.maximumLength" @keydown.enter.prevent="addWordResponse(block.id, block.config.maximumResponses)" /><button type="button" class="btn btn-secondary" :disabled="wordResponses(block.id).length >= block.config.maximumResponses" @click="addWordResponse(block.id, block.config.maximumResponses)">+</button></div><div class="flex flex-wrap gap-2"><span v-for="(response, responseIndex) in wordResponses(block.id)" :key="`${response}-${responseIndex}`" class="inline-flex items-center gap-1 rounded-full bg-[var(--ui-accent-soft)] py-1 pl-3 pr-1.5 text-sm text-[var(--ui-accent)]"><span>{{ response }}</span><button type="button" class="flex h-7 w-7 items-center justify-center rounded-full text-red-500 transition hover:bg-red-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-500" :aria-label="t('common.delete')" @click="removeWordResponse(block.id, responseIndex)"><ActivityDeleteIcon class="h-3.5 w-3.5" /></button></span></div><p class="text-xs text-[var(--ui-text-muted)]">{{ wordResponses(block.id).length }} / {{ block.config.maximumResponses }}</p></template>
              </div>
              <ActivityOrderingInput v-else-if="block.questionType === 'ordering'" :items="block.config.items" :model-value="orderingValue(block)" @update:model-value="setAnswer(block.id, { questionType: 'ordering', orderedItemIds: $event })" />
              <ActivityMatchingInput v-else-if="block.questionType === 'matching'" :left-items="block.config.leftItems" :right-items="block.config.rightItems" :pairs="matchingValue(block.id)" @update:pairs="setAnswer(block.id, { questionType: 'matching', pairs: $event })" />
              <ActivityImageLabelingInput v-else-if="block.questionType === 'image_labeling'" :image-url="block.config.imageUrl" :image-alt="block.config.imageAlt" :markers="block.config.markers" :labels="block.config.labels" :one-to-one="block.config.oneToOne" :assignments="imageAssignments(block.id)" @update:assignments="setAnswer(block.id, { questionType: 'image_labeling', assignments: $event })" />
              <p v-else class="rounded-xl bg-[var(--ui-panel-muted)] p-4 text-sm text-[var(--ui-text-muted)]">{{ t('activityPlayer.unsupportedQuestion') }}</p>
              <div class="mt-3 min-h-5 text-xs text-[var(--ui-text-muted)]" role="status" aria-live="polite"><span v-if="autosave.states[block.id] === 'saving'">{{ t('common.saving') }}</span><span v-else-if="autosave.states[block.id] === 'saved'">{{ t('common.saved') }}</span><span v-else-if="autosave.states[block.id] === 'idle'">{{ t('activityPlayer.unsaved') }}</span><button v-else-if="autosave.states[block.id] === 'error'" class="text-[var(--flexoki-red-600)] underline" type="button" @click="autosave.retry(block.id)">{{ t('activityPlayer.saveError') }}</button></div>
            </fieldset>
          </template>
          <p v-if="error" class="rounded-xl bg-[var(--ui-panel-muted)] p-3 text-sm text-[var(--flexoki-red-600)]" role="alert">{{ error }}</p>
        </article>
        <footer class="flex items-center justify-between gap-3"><button v-if="attempt.settings.allowBackNavigation" class="btn btn-secondary disabled:cursor-not-allowed disabled:opacity-40" :disabled="busy || currentIndex === 0" @click="navigate(-1)">{{ t('common.previous') }}</button><span v-else></span><button v-if="!isFinal" class="btn btn-primary disabled:cursor-not-allowed disabled:opacity-40" :disabled="busy || currentIndex >= attempt.slides.length - 1" @click="navigate(1)">{{ t('common.next') }}</button><button v-else class="btn btn-primary disabled:cursor-not-allowed disabled:opacity-40" :disabled="busy" @click="openSubmitConfirmation">{{ t('activityPlayer.submit') }}</button></footer>
      </section>
    </div>
    <Teleport to="body">
      <div v-if="confirmSubmit" class="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/50 p-4 text-[var(--ui-text)]" :class="[`activity-theme-${visualTheme}`, `activity-layout-${visualLayout}`]">
        <div class="panel my-auto w-full max-w-md p-6" role="dialog" aria-modal="true" :aria-label="t('activityPlayer.confirmTitle')"><h2 class="text-xl font-semibold">{{ t('activityPlayer.confirmTitle') }}</h2><p class="mt-3 text-sm leading-6 text-[var(--ui-text-muted)]">{{ t('activityPlayer.confirmDescription') }}</p><p v-if="error" class="mt-3 text-sm text-[var(--flexoki-red-600)]" role="alert">{{ error }}</p><div class="mt-6 flex justify-end gap-3"><button class="btn btn-secondary" @click="confirmSubmit = false">{{ t('common.cancel') }}</button><button class="btn btn-primary" :disabled="busy" @click="submit">{{ t('activityPlayer.submit') }}</button></div></div>
      </div>
    </Teleport>
  </main>
</template>
