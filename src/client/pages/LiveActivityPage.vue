<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../lib/api';
import { useToast } from '../composables/useToast';
import LiveActivityModal from '../components/LiveActivityModal.vue';
import LiveResultsBoard from '../components/LiveResultsBoard.vue';
import StatCard from '../components/StatCard.vue';
import type { LiveActivitySummary, LiveResponseRecord, LiveResponseStatus, LiveResultsSnapshot } from '@/shared/types';

interface Details { activity: LiveActivitySummary; responses: LiveResponseRecord[]; results: LiveResultsSnapshot }
const route = useRoute();
const { pushToast } = useToast();
const details = ref<Details | null>(null);
const loading = ref(true);
const editOpen = ref(false);
const editingResponseId = ref<string | null>(null);
const editedText = ref('');
const editedParticipantName = ref('');
let events: EventSource | null = null;

const pending = computed(() => details.value?.responses.filter((response) => response.status === 'pending') ?? []);
const published = computed(() => details.value?.responses.filter((response) => response.status === 'approved') ?? []);
const optionLabels = computed(() => new Map(details.value?.activity.options.map((option) => [option.id, option.label]) ?? []));

const load = async (showLoading = true) => {
  if (showLoading) loading.value = true;
  try { details.value = await api<Details>(`/api/live/${route.params.id}`); }
  finally { loading.value = false; }
};
const connect = () => {
  events?.close();
  if (!details.value) return;
  events = new EventSource(`/api/live/public/${encodeURIComponent(details.value.activity.slug)}/presentation/events`);
  events.addEventListener('results', (event) => {
    if (details.value) details.value.results = JSON.parse((event as MessageEvent).data) as LiveResultsSnapshot;
    void load(false);
  });
};
const saveActivity = (activity: LiveActivitySummary) => {
  if (details.value) details.value.activity = activity;
  connect();
};
const startEdit = (response: LiveResponseRecord) => {
  editingResponseId.value = response.id;
  editedText.value = response.publishedText ?? response.originalText ?? '';
  editedParticipantName.value = response.participantName ?? response.originalParticipantName ?? '';
};
const moderate = async (response: LiveResponseRecord, status: LiveResponseStatus, confirmRuleMatch = false) => {
  const publishedText = editingResponseId.value === response.id ? editedText.value : response.publishedText;
  const participantName = editingResponseId.value === response.id ? editedParticipantName.value : response.participantName;
  try {
    await api(`/api/live/${route.params.id}/responses/${response.id}`, {
      method: 'PATCH', body: JSON.stringify({ status, publishedText, participantName, confirmRuleMatch })
    });
    editingResponseId.value = null;
    editedParticipantName.value = '';
    await load(false);
  } catch (error) {
    const message = (error as Error).message;
    if (status === 'approved' && message.includes('Confirm to approve') && window.confirm(`${message}\n\nApprove anyway?`)) {
      await moderate(response, status, true);
      return;
    }
    pushToast({ tone: 'error', title: 'Moderation failed', description: message });
  }
};
const responseValue = (response: LiveResponseRecord) => {
  if (response.originalText !== null) return response.originalText;
  if (response.scaleValue !== null) return String(response.scaleValue);
  return response.selectedOptionIds.map((id) => optionLabels.value.get(id) ?? 'Unavailable option').join(', ');
};
const editLabel = (response: LiveResponseRecord) => {
  if (details.value?.activity.identityMode === 'named') {
    return response.originalText !== null ? 'Edit name & answer' : 'Edit name';
  }
  return 'Edit answer';
};

onMounted(async () => { await load(); connect(); });
onBeforeUnmount(() => events?.close());
</script>

<template>
  <div v-if="loading" class="panel p-12 text-center text-[var(--ui-text-muted)]">Loading activity…</div>
  <div v-else-if="details" class="space-y-4 sm:space-y-6">
    <section class="panel p-5 sm:p-6">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div><p class="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--ui-accent)]">{{ details.activity.status }}</p><h2 class="mt-2 text-2xl font-semibold">{{ details.activity.title }}</h2><p class="mt-2 text-[var(--ui-text-muted)]">{{ details.activity.question }}</p><a :href="details.activity.publicUrl" target="_blank" class="mt-3 inline-block text-sm text-[var(--ui-accent)]">{{ details.activity.publicUrl }}</a></div>
        <div class="flex flex-wrap gap-2"><button class="btn-secondary" @click="editOpen = true">Edit</button><a class="btn-primary" :href="`/present/${details.activity.slug}`" target="_blank">Presentation Mode</a></div>
      </div>
    </section>
    <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <StatCard label="Total Responses" :value="details.activity.responseCount" /><StatCard label="Unique Participants" :value="details.activity.uniqueParticipantCount" /><StatCard label="Approved" :value="details.activity.approvedCount" /><StatCard label="Pending" :value="details.activity.pendingCount" /><StatCard label="Rejected" :value="details.activity.rejectedCount" /><StatCard label="Last response" :value="details.activity.lastResponseAt ? new Date(details.activity.lastResponseAt).toLocaleTimeString() : '—'" />
    </section>
    <section class="panel p-5 sm:p-6"><h2 class="text-xl font-semibold">Live results</h2><div class="mt-5"><LiveResultsBoard :activity="details.activity" :results="details.results" /></div></section>
    <section class="panel p-5 sm:p-6">
      <div class="flex items-center justify-between"><div><h2 class="text-xl font-semibold">Moderation Queue</h2><p class="mt-1 text-sm text-[var(--ui-text-muted)]">Pending responses require a decision before publication.</p></div><span class="rounded-full bg-[var(--ui-pill-bg)] px-3 py-1 text-sm">{{ pending.length }}</span></div>
      <div v-if="pending.length === 0" class="panel-muted mt-5 p-8 text-center text-sm text-[var(--ui-text-muted)]">Nothing is waiting for review.</div>
      <div v-else class="mt-5 space-y-3">
        <article v-for="response in pending" :key="response.id" class="panel-muted p-4">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div class="min-w-0 flex-1">
              <p v-if="editingResponseId !== response.id" class="font-medium">{{ response.participantName ?? 'Anonymous' }}</p>
              <div v-else class="space-y-3">
                <label v-if="details.activity.identityMode === 'named'" class="block">
                  <span class="mb-2 block text-sm font-medium">Participant name</span>
                  <input v-model="editedParticipantName" class="input px-4 py-3" maxlength="80" required />
                </label>
                <label v-if="response.originalText !== null" class="block">
                  <span class="mb-2 block text-sm font-medium">Answer</span>
                  <textarea v-model="editedText" class="input min-h-24 px-4 py-3" :maxlength="details.activity.maxAnswerLength" />
                </label>
              </div>
              <p class="mt-1 text-xs text-[var(--ui-text-muted)]">{{ new Date(response.createdAt).toLocaleString() }} · {{ response.moderationReason }}</p>
              <p v-if="editingResponseId !== response.id || response.originalText === null" class="mt-3 whitespace-pre-wrap">{{ responseValue(response) }}</p>
            </div>
            <div class="flex shrink-0 flex-wrap gap-2">
              <button v-if="response.originalText !== null || details.activity.identityMode === 'named'" class="btn-secondary text-sm" @click="startEdit(response)">{{ editLabel(response) }}</button>
              <button class="btn-primary text-sm" @click="moderate(response, 'approved')">Approve</button>
              <button class="btn-secondary text-sm text-[#AF3029] dark:text-[#F89A8A]" @click="moderate(response, 'rejected')">Reject</button>
            </div>
          </div>
        </article>
      </div>
    </section>
    <section class="panel p-5 sm:p-6"><h2 class="text-xl font-semibold">Published responses</h2><div class="mt-5 space-y-3"><article v-for="response in published" :key="response.id" class="panel-muted flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p>{{ response.publishedText ?? responseValue(response) }}</p><p class="mt-1 text-xs text-[var(--ui-text-muted)]">{{ response.participantName ?? 'Anonymous' }}<span v-if="response.editedByModerator"> · Answer edited by moderator</span><span v-if="response.nameEditedByModerator"> · Name edited by moderator (original: {{ response.originalParticipantName }})</span></p></div><button class="btn-secondary shrink-0 text-sm text-[#AF3029] dark:text-[#F89A8A]" @click="moderate(response, 'rejected')">Hide</button></article><p v-if="published.length === 0" class="text-sm text-[var(--ui-text-muted)]">No published responses.</p></div></section>
    <LiveActivityModal :open="editOpen" :activity="details.activity" @close="editOpen = false" @saved="saveActivity" />
  </div>
</template>
