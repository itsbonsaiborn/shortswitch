<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { api } from '../lib/api';
import { useToast } from '../composables/useToast';
import type { LiveActivityInput, LiveActivitySummary } from '@/shared/types';

const props = defineProps<{ open: boolean; activity?: LiveActivitySummary | null }>();
const emit = defineEmits<{ close: []; saved: [activity: LiveActivitySummary] }>();
const { pushToast } = useToast();
const loading = ref(false);
const error = ref('');
const optionsText = ref('Option 1\nOption 2');
const expirationTouched = ref(false);
const expirationInput = ref('');
const form = reactive<LiveActivityInput>({
  title: '',
  question: '',
  type: 'open_answer',
  slug: '',
  status: 'active',
  identityMode: 'anonymous',
  allowMultipleResponses: false,
  maxResponsesPerParticipant: 1,
  moderationMode: 'off',
  maxAnswerLength: 280,
  allowMultipleChoices: false,
  options: [],
  scaleMin: 1,
  scaleMax: 5,
  publicResults: true
});
const isEditing = computed(() => Boolean(props.activity));
const isTextType = computed(() => form.type === 'open_answer' || form.type === 'word_cloud');
const supportsModeration = computed(() => isTextType.value || form.identityMode === 'named');
const moderationLabel = computed(() => isTextType.value ? 'Answer and name moderation' : 'Name moderation');

const parseExpirationInput = (value: string) => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  const match = normalized.match(/^(\d+)\s*(minute|minutes|hour|hours|day|days)$/);
  if (!match) throw new Error('Expiration must look like "2 minutes", "2 hours", or "2 days".');
  const rawUnit = match[2];
  return {
    expirationValue: Number(match[1]),
    expirationUnit: (rawUnit.startsWith('minute') ? 'minutes' : rawUnit.startsWith('hour') ? 'hours' : 'days') as 'minutes' | 'hours' | 'days'
  };
};

const formatExpiration = (value: string | null | undefined) => {
  if (!value) return '';
  const diffMs = new Date(value).getTime() - Date.now();
  if (diffMs <= 0) return '';
  const minutes = Math.round(diffMs / 60_000);
  if (minutes % 1_440 === 0) return `${minutes / 1_440} days`;
  if (minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} minutes`;
};

const reset = () => {
  const activity = props.activity;
  Object.assign(form, {
    title: activity?.title ?? '',
    question: activity?.question ?? '',
    type: activity?.type ?? 'open_answer',
    slug: activity?.slug ?? '',
    status: activity?.status ?? 'active',
    identityMode: activity?.identityMode ?? 'anonymous',
    allowMultipleResponses: activity?.allowMultipleResponses ?? false,
    maxResponsesPerParticipant: activity?.maxResponsesPerParticipant ?? 1,
    moderationMode: activity?.moderationMode ?? 'off',
    maxAnswerLength: activity?.maxAnswerLength ?? 280,
    allowMultipleChoices: activity?.allowMultipleChoices ?? false,
    scaleMin: activity?.scaleMin ?? 1,
    scaleMax: activity?.scaleMax ?? 5,
    publicResults: activity?.publicResults ?? true
  });
  optionsText.value = activity?.options.map((option) => option.label).join('\n') || 'Option 1\nOption 2';
  expirationTouched.value = false;
  expirationInput.value = formatExpiration(activity?.expiresAt);
  error.value = '';
};

watch(() => [props.open, props.activity] as const, ([open]) => open && reset(), { immediate: true });
watch(() => [form.type, form.identityMode] as const, ([type, identityMode]) => {
  const textType = type === 'open_answer' || type === 'word_cloud';
  if (!textType && identityMode === 'anonymous') form.moderationMode = 'off';
  if (!textType && form.moderationMode === 'review_all') form.moderationMode = 'filter_only';
});

const closeOnEscape = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || !props.open) return;
  event.preventDefault();
  emit('close');
};

onMounted(() => document.addEventListener('keydown', closeOnEscape));
onBeforeUnmount(() => document.removeEventListener('keydown', closeOnEscape));

const submit = async () => {
  loading.value = true;
  error.value = '';
  try {
    const parsedExpiration = expirationTouched.value && expirationInput.value.trim()
      ? parseExpirationInput(expirationInput.value)
      : null;
    const payload: LiveActivityInput = {
      ...form,
      options: form.type === 'multiple_choice' ? optionsText.value.split('\n').map((item) => item.trim()).filter(Boolean) : [],
      maxResponsesPerParticipant: form.allowMultipleResponses ? Number(form.maxResponsesPerParticipant) : 1,
      maxAnswerLength: Number(form.maxAnswerLength),
      scaleMin: Number(form.scaleMin),
      scaleMax: Number(form.scaleMax),
      expirationValue: expirationTouched.value ? parsedExpiration?.expirationValue ?? null : undefined,
      expirationUnit: expirationTouched.value ? parsedExpiration?.expirationUnit : undefined
    };
    const activity = await api<LiveActivitySummary>(isEditing.value ? `/api/live/${props.activity!.id}` : '/api/live', {
      method: isEditing.value ? 'PATCH' : 'POST',
      body: JSON.stringify(payload)
    });
    emit('saved', activity);
    emit('close');
    pushToast({ tone: 'success', title: isEditing.value ? 'Live updated' : 'Live created', description: activity.publicUrl });
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <Transition
    enter-active-class="transition duration-300 ease-out"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition duration-200 ease-in"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
  <div v-if="open" class="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-slate-950/65 p-4 backdrop-blur-sm">
    <form class="panel my-6 w-full max-w-3xl p-5 sm:p-7" @submit.prevent="submit">
      <div class="flex items-start justify-between gap-4">
        <div><p class="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--ui-accent)]">Live</p><h2 class="mt-2 text-2xl font-semibold">{{ isEditing ? 'Edit Live' : 'Create Live' }}</h2></div>
        <button type="button" class="btn-secondary" @click="emit('close')">Close</button>
      </div>
      <div class="mt-6 grid gap-4 sm:grid-cols-2">
        <label class="sm:col-span-2"><span class="mb-2 block text-sm font-medium">Activity title</span><input v-model="form.title" class="input px-4 py-3" maxlength="120" required /></label>
        <label class="sm:col-span-2"><span class="mb-2 block text-sm font-medium">Question</span><textarea v-model="form.question" class="input min-h-24 px-4 py-3" maxlength="500" required /></label>
        <label><span class="mb-2 block text-sm font-medium">Activity type</span><select v-model="form.type" class="input px-4 py-3"><option value="open_answer">Open Answer</option><option value="word_cloud">Word Cloud</option><option value="multiple_choice">Multiple Choice</option><option value="scale">Scale</option></select></label>
        <label><span class="mb-2 block text-sm font-medium">Custom slug <span class="font-normal text-[var(--ui-text-muted)]">(optional)</span></span><input v-model="form.slug" class="input px-4 py-3" placeholder="Leave blank for a random slug" /></label>
        <label><span class="mb-2 block text-sm font-medium">Status</span><select v-model="form.status" class="input px-4 py-3"><option value="active">Active</option><option value="closed">Closed</option></select></label>
        <label><span class="mb-2 block text-sm font-medium">Participant identity</span><select v-model="form.identityMode" class="input px-4 py-3"><option value="anonymous">Anonymous</option><option value="named">Named</option></select></label>
        <label class="panel-muted flex items-center gap-3 p-4"><input v-model="form.allowMultipleResponses" type="checkbox" class="rounded" /><span class="text-sm font-medium">Allow multiple responses</span></label>
        <label v-if="form.allowMultipleResponses"><span class="mb-2 block text-sm font-medium">Maximum responses per participant</span><input v-model.number="form.maxResponsesPerParticipant" class="input px-4 py-3" type="number" min="1" max="100" /></label>
        <label class="panel-muted flex items-center gap-3 p-4"><input v-model="form.publicResults" type="checkbox" class="rounded" /><span class="text-sm font-medium">Show result preview to participants</span></label>
        <label><span class="mb-2 block text-sm font-medium">Expiration</span><input v-model="expirationInput" class="input px-4 py-3" type="text" placeholder="Enter expiration like 2 minutes, 2 hours, or 2 days" @input="expirationTouched = true" /></label>
        <label v-if="supportsModeration"><span class="mb-2 block text-sm font-medium">{{ moderationLabel }}</span><select v-model="form.moderationMode" class="input px-4 py-3"><option value="off">Off</option><option value="filter_only">Filter only</option><option v-if="isTextType" value="review_all">Review all</option></select></label>
        <label v-if="isTextType"><span class="mb-2 block text-sm font-medium">Maximum answer length</span><input v-model.number="form.maxAnswerLength" class="input px-4 py-3" type="number" min="1" max="2000" /></label>
        <template v-if="form.type === 'multiple_choice'">
          <label class="sm:col-span-2"><span class="mb-2 block text-sm font-medium">Options · one per line</span><textarea v-model="optionsText" class="input min-h-32 px-4 py-3" /></label>
          <label class="panel-muted flex items-center gap-3 p-4 sm:col-span-2"><input v-model="form.allowMultipleChoices" type="checkbox" class="rounded" /><span class="text-sm font-medium">Allow multiple choices in one response</span></label>
        </template>
        <template v-if="form.type === 'scale'">
          <label><span class="mb-2 block text-sm font-medium">Scale minimum</span><input v-model.number="form.scaleMin" class="input px-4 py-3" type="number" min="-10" max="99" /></label>
          <label><span class="mb-2 block text-sm font-medium">Scale maximum</span><input v-model.number="form.scaleMax" class="input px-4 py-3" type="number" min="-9" max="100" /></label>
        </template>
      </div>
      <p v-if="error" class="mt-4 rounded-2xl bg-[#FCE8DB] px-4 py-3 text-sm text-[#AF3029] dark:bg-[#321F1C] dark:text-[#F89A8A]">{{ error }}</p>
      <div class="mt-6 flex justify-end"><button class="btn-primary w-full sm:w-auto" :disabled="loading">{{ loading ? 'Saving…' : isEditing ? 'Save changes' : 'Create Live' }}</button></div>
    </form>
  </div>
  </Transition>
</template>
