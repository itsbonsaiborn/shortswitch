<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ServiceContactConfig, ServiceSectionAdmin, ServiceSectionType, ServiceSectionUpdate, ServiceSubmissionAdmin, ServiceSubmissionListResponse, ServiceSubmissionSettings, ServiceSubmissionStatus, ServiceSubmissionType } from '@/shared/types';
import { serviceSubmissionStatuses } from '@/shared/types';
import { api } from '../lib/api';
import { useToast } from '../composables/useToast';
import ServiceContactsEditor from '../components/ServiceContactsEditor.vue';
import RichTextContent from '../components/RichTextContent.vue';
import RichTextEditor from '../components/RichTextEditor.vue';

const { t, locale } = useI18n();
const { pushToast } = useToast();
const sections = ref<ServiceSectionAdmin[]>([]);
const workspace = ref<'sections' | 'inbox' | 'settings'>('sections');
const selectedType = ref<ServiceSectionType>('about');
const loading = ref(true);
const saving = ref(false);
const publishing = ref(false);
const error = ref('');
const previewOpen = ref(false);
const previewLocale = ref<'en' | 'lv'>('en');
const submissions = ref<ServiceSubmissionAdmin[]>([]);
const submissionsLoading = ref(false);
const submissionsError = ref('');
const newSubmissionCount = ref(0);
const submissionTotal = ref(0);
const submissionType = ref<'all' | ServiceSubmissionType>('all');
const submissionStatus = ref<'all' | ServiceSubmissionStatus>('all');
const submissionSearch = ref('');
const selectedSubmission = ref<ServiceSubmissionAdmin | null>(null);
const deleteTarget = ref<ServiceSubmissionAdmin | null>(null);
const deletingSubmission = ref(false);
const submissionSettings = ref<ServiceSubmissionSettings | null>(null);
const settingsSaving = ref(false);
const restrictDomains = ref(false);
const domainsText = ref('');
const selected = computed(() => sections.value.find((section) => section.type === selectedType.value));
const previewTitle = computed(() => previewLocale.value === 'lv' ? selected.value?.titleLv : selected.value?.titleEn);
const previewBody = computed(() => previewLocale.value === 'lv' ? selected.value?.bodyLv : selected.value?.bodyEn);

const replaceSection = (updated: ServiceSectionAdmin) => {
  sections.value = sections.value.map((section) => section.type === updated.type ? updated : section);
};

const loadSubmissions = async () => {
  submissionsLoading.value = true;
  submissionsError.value = '';
  try {
    const query = new URLSearchParams({ limit: '100' });
    if (submissionType.value !== 'all') query.set('type', submissionType.value);
    if (submissionStatus.value !== 'all') query.set('status', submissionStatus.value);
    if (submissionSearch.value.trim()) query.set('search', submissionSearch.value.trim());
    const response = await api<ServiceSubmissionListResponse>(`/api/service-submissions?${query}`);
    submissions.value = response.submissions;
    submissionTotal.value = response.total;
    newSubmissionCount.value = response.newCount;
  } catch (cause) {
    submissionsError.value = (cause as Error).message;
  } finally {
    submissionsLoading.value = false;
  }
};

const updateSubmissionStatus = async (submission: ServiceSubmissionAdmin, status: ServiceSubmissionStatus) => {
  try {
    const updated = await api<ServiceSubmissionAdmin>(`/api/service-submissions/${submission.id}/status`, {
      method: 'PATCH', body: JSON.stringify({ status })
    });
    submissions.value = submissions.value.map((item) => item.id === updated.id ? updated : item);
    if (submission.status === 'new' && updated.status !== 'new') newSubmissionCount.value = Math.max(0, newSubmissionCount.value - 1);
    if (submission.status !== 'new' && updated.status === 'new') newSubmissionCount.value += 1;
    if (selectedSubmission.value?.id === updated.id) selectedSubmission.value = updated;
    pushToast({ tone: 'success', title: t('serviceSubmissions.statusUpdated') });
  } catch (cause) {
    pushToast({ tone: 'error', title: t('errors.save'), description: (cause as Error).message });
  }
};

const loadSubmissionSettings = async () => {
  const settings = await api<ServiceSubmissionSettings>('/api/service-submission-settings');
  submissionSettings.value = settings;
  restrictDomains.value = settings.allowedEmailDomains.length > 0;
  domainsText.value = settings.allowedEmailDomains.join('\n');
};

const saveSubmissionSettings = async () => {
  if (!submissionSettings.value) return;
  settingsSaving.value = true;
  try {
    const allowedEmailDomains = restrictDomains.value
      ? domainsText.value.split(/[\n,]/).map((value) => value.trim()).filter(Boolean)
      : [];
    submissionSettings.value = await api<ServiceSubmissionSettings>('/api/service-submission-settings', {
      method: 'PATCH',
      body: JSON.stringify({
        allowedEmailDomains,
        publicContactEmail: submissionSettings.value.publicContactEmail || null,
        retentionDays: submissionSettings.value.retentionDays
      })
    });
    domainsText.value = submissionSettings.value.allowedEmailDomains.join('\n');
    restrictDomains.value = submissionSettings.value.allowedEmailDomains.length > 0;
    pushToast({ tone: 'success', title: t('serviceSubmissions.settingsSaved') });
  } catch (cause) {
    pushToast({ tone: 'error', title: t('errors.save'), description: (cause as Error).message });
  } finally {
    settingsSaving.value = false;
  }
};

const deleteSubmission = async () => {
  if (!deleteTarget.value) return;
  deletingSubmission.value = true;
  try {
    const deleted = deleteTarget.value;
    await api(`/api/service-submissions/${deleted.id}`, { method: 'DELETE' });
    submissions.value = submissions.value.filter((item) => item.id !== deleted.id);
    submissionTotal.value = Math.max(0, submissionTotal.value - 1);
    if (deleted.status === 'new') newSubmissionCount.value = Math.max(0, newSubmissionCount.value - 1);
    if (selectedSubmission.value?.id === deleted.id) selectedSubmission.value = null;
    deleteTarget.value = null;
    pushToast({ tone: 'success', title: t('serviceSubmissions.deleted') });
  } catch (cause) {
    pushToast({ tone: 'error', title: t('serviceSubmissions.deleteFailed'), description: (cause as Error).message });
  } finally {
    deletingSubmission.value = false;
  }
};

const formatSubmissionDate = (value: string) => new Intl.DateTimeFormat(locale.value, {
  dateStyle: 'medium', timeStyle: 'short'
}).format(new Date(value));
const submissionStatusClass = (status: ServiceSubmissionStatus) => ({
  new: 'border-[#205EA6]/25 bg-[#E6F0F9] text-[#205EA6] dark:bg-[#163047] dark:text-[#A2C7F3]',
  in_progress: 'border-[#AD8301]/25 bg-[#FCEEB8] text-[#8A6500] dark:bg-[#3A2D04] dark:text-[#ECCB60]',
  resolved: 'border-[#24837B]/25 bg-[#E1F5F1] text-[#14756D] dark:bg-[#153A36] dark:text-[#87D3C3]',
  rejected: 'border-[#AF3029]/25 bg-[#FCE8E2] text-[#AF3029] dark:bg-[#3B211E] dark:text-[#F89A8A]'
}[status]);

const load = async () => {
  loading.value = true;
  error.value = '';
  try {
    const response = await api<{ sections: ServiceSectionAdmin[] }>('/api/service-sections');
    sections.value = response.sections;
    if (!sections.value.some((section) => section.type === selectedType.value)) {
      selectedType.value = sections.value[0]?.type ?? 'about';
    }
    await loadSubmissions();
    await loadSubmissionSettings();
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    loading.value = false;
  }
};

const input = (): ServiceSectionUpdate => {
  if (!selected.value) throw new Error('Service section is unavailable.');
  return {
    titleEn: selected.value.titleEn,
    bodyEn: selected.value.bodyEn,
    titleLv: selected.value.titleLv,
    bodyLv: selected.value.bodyLv,
    enabled: selected.value.enabled,
    showInFooter: selected.value.showInFooter,
    contactConfig: selected.value.contactConfig
  };
};

const updateContactConfig = (value: ServiceContactConfig) => {
  if (selected.value?.type === 'contacts') selected.value.contactConfig = value;
};

const save = async () => {
  if (!selected.value) return;
  saving.value = true;
  try {
    const updated = await api<ServiceSectionAdmin>(`/api/service-sections/${selected.value.type}`, {
      method: 'PATCH', body: JSON.stringify(input())
    });
    replaceSection(updated);
    pushToast({ tone: 'success', title: t('serviceSections.draftSaved') });
  } catch (cause) {
    pushToast({ tone: 'error', title: t('errors.save'), description: (cause as Error).message });
  } finally {
    saving.value = false;
  }
};

const publish = async () => {
  if (!selected.value) return;
  publishing.value = true;
  try {
    const updated = await api<ServiceSectionAdmin>(`/api/service-sections/${selected.value.type}/publish`, {
      method: 'POST', body: JSON.stringify(input())
    });
    replaceSection(updated);
    pushToast({ tone: 'success', title: t('serviceSections.publishedNotice') });
  } catch (cause) {
    pushToast({ tone: 'error', title: t('serviceSections.publishFailed'), description: (cause as Error).message });
  } finally {
    publishing.value = false;
  }
};

const keydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    previewOpen.value = false;
    selectedSubmission.value = null;
    deleteTarget.value = null;
  }
};

onMounted(() => {
  void load();
  window.addEventListener('keydown', keydown);
});
onBeforeUnmount(() => window.removeEventListener('keydown', keydown));
</script>

<template>
  <section class="space-y-6">
    <header>
      <h1 class="text-3xl font-semibold">{{ t('serviceSections.title') }}</h1>
      <p class="mt-2 text-sm text-[var(--ui-text-muted)]">{{ t('serviceSections.description') }}</p>
    </header>

    <div v-if="loading" class="panel p-6 text-sm text-[var(--ui-text-muted)]">{{ t('common.loading') }}</div>
    <div v-else-if="error" class="panel border-rose-500/30 p-6 text-sm text-rose-600 dark:text-rose-300">
      {{ error }}
      <button class="btn-secondary ml-3" type="button" @click="load">{{ t('common.retry') }}</button>
    </div>

    <div v-else-if="selected" class="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
      <nav class="panel h-fit space-y-2 p-3" :aria-label="t('serviceSections.pages')">
        <button type="button" class="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left text-sm transition-colors" :class="workspace === 'inbox' ? 'bg-[var(--ui-accent-soft)] text-[var(--ui-accent)]' : 'hover:bg-[var(--ui-panel-muted)]'" @click="workspace = 'inbox'">
          <span class="font-semibold">{{ t('serviceSubmissions.inbox') }}</span>
          <span v-if="newSubmissionCount" class="pill min-w-7 justify-center">{{ newSubmissionCount }}</span>
        </button>
        <button type="button" class="flex w-full items-center rounded-2xl px-4 py-3 text-left text-sm font-semibold transition-colors" :class="workspace === 'settings' ? 'bg-[var(--ui-accent-soft)] text-[var(--ui-accent)]' : 'hover:bg-[var(--ui-panel-muted)]'" @click="workspace = 'settings'">
          {{ t('serviceSubmissions.settings') }}
        </button>
        <div class="my-2 border-t border-[var(--ui-border)]" />
        <button
          v-for="section in sections"
          :key="section.type"
          type="button"
          class="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left text-sm transition-colors"
          :class="workspace === 'sections' && section.type === selectedType ? 'bg-[var(--ui-accent-soft)] text-[var(--ui-accent)]' : 'hover:bg-[var(--ui-panel-muted)]'"
          @click="selectedType = section.type; workspace = 'sections'"
        >
          <span class="font-semibold">{{ t(`serviceSections.types.${section.type}`) }}</span>
          <span v-if="section.hasUnpublishedChanges" class="h-2 w-2 rounded-full bg-amber-500" :title="t('serviceSections.unsavedDraft')" />
        </button>
      </nav>

      <div v-if="workspace === 'sections'" class="panel min-w-0 p-5 sm:p-7">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-xl font-semibold">{{ t(`serviceSections.types.${selected.type}`) }}</h2>
              <span v-if="selected.required" class="pill">{{ t('serviceSections.essential') }}</span>
              <span v-if="selected.needsReview" class="pill text-amber-700 dark:text-amber-300">{{ t('serviceSections.reviewRequired') }}</span>
            </div>
            <a :href="selected.publicPath" target="_blank" rel="noopener" class="mt-2 inline-block text-sm text-[var(--ui-accent)] hover:underline">{{ selected.publicPath }}</a>
          </div>
          <div class="flex flex-wrap gap-2">
            <button v-if="selected.type !== 'contacts'" class="btn-secondary" type="button" @click="previewOpen = true">{{ t('serviceSections.preview') }}</button>
            <button class="btn-secondary" type="button" :disabled="saving" @click="save">{{ saving ? t('common.saving') : t('serviceSections.saveDraft') }}</button>
            <button class="btn-primary" type="button" :disabled="publishing" @click="publish">{{ publishing ? t('serviceSections.publishing') : t('common.publish') }}</button>
          </div>
        </div>

        <div class="mt-6 grid gap-6 lg:grid-cols-2">
          <fieldset class="space-y-4">
            <legend class="text-sm font-semibold uppercase tracking-[.14em] text-[var(--ui-text-muted)]">English</legend>
            <label class="block"><span class="mb-2 block text-sm font-medium">{{ t('common.title') }}</span><input v-model="selected.titleEn" class="input" maxlength="120" /></label>
            <div v-if="selected.type !== 'contacts'" class="block"><span class="mb-2 block text-sm font-medium">{{ t('serviceSections.content') }}</span><RichTextEditor v-model="selected.bodyEn" :max-length="20000" min-height-class="min-h-72" :aria-label="`${t('serviceSections.content')} · English`" /></div>
          </fieldset>
          <fieldset class="space-y-4">
            <legend class="text-sm font-semibold uppercase tracking-[.14em] text-[var(--ui-text-muted)]">Latviešu</legend>
            <label class="block"><span class="mb-2 block text-sm font-medium">{{ t('common.title') }}</span><input v-model="selected.titleLv" class="input" maxlength="120" /></label>
            <div v-if="selected.type !== 'contacts'" class="block"><span class="mb-2 block text-sm font-medium">{{ t('serviceSections.content') }}</span><RichTextEditor v-model="selected.bodyLv" :max-length="20000" min-height-class="min-h-72" :aria-label="`${t('serviceSections.content')} · Latviešu`" /></div>
          </fieldset>
        </div>

        <ServiceContactsEditor
          v-if="selected.type === 'contacts' && selected.contactConfig"
          :model-value="selected.contactConfig"
          @update:model-value="updateContactConfig"
        />

        <div class="panel-muted mt-6 grid gap-4 p-4 sm:grid-cols-2">
          <label class="flex items-start gap-3" :class="selected.required ? 'opacity-60' : ''">
            <input v-model="selected.enabled" type="checkbox" class="mt-1 rounded" :disabled="selected.required" />
            <span><span class="block text-sm font-semibold">{{ t('serviceSections.publicEnabled') }}</span><span class="text-xs text-[var(--ui-text-muted)]">{{ selected.required ? t('serviceSections.essentialHelp') : t('serviceSections.publicEnabledHelp') }}</span></span>
          </label>
          <label class="flex items-start gap-3">
            <input v-model="selected.showInFooter" type="checkbox" class="mt-1 rounded" />
            <span><span class="block text-sm font-semibold">{{ t('serviceSections.showInFooter') }}</span><span class="text-xs text-[var(--ui-text-muted)]">{{ t('serviceSections.showInFooterHelp') }}</span></span>
          </label>
        </div>

      </div>

      <section v-else-if="workspace === 'inbox'" class="panel min-w-0 p-5 sm:p-7">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div class="flex items-center gap-2"><h2 class="text-xl font-semibold">{{ t('serviceSubmissions.inbox') }}</h2><span v-if="newSubmissionCount" class="pill">{{ t('serviceSubmissions.newCount', { count: newSubmissionCount }) }}</span></div>
            <p class="mt-2 text-sm text-[var(--ui-text-muted)]">{{ t('serviceSubmissions.description') }}</p>
          </div>
          <button class="btn-secondary" type="button" :disabled="submissionsLoading" @click="loadSubmissions">{{ t('common.refresh') }}</button>
        </div>

        <form class="panel-muted mt-6 grid gap-3 p-4 md:grid-cols-[1fr_180px_180px_auto]" @submit.prevent="loadSubmissions">
          <label class="grid gap-1 text-sm"><span class="font-medium">{{ t('common.search') }}</span><input v-model="submissionSearch" class="input" maxlength="100" :placeholder="t('serviceSubmissions.searchPlaceholder')" /></label>
          <label class="grid gap-1 text-sm"><span class="font-medium">{{ t('serviceSubmissions.type') }}</span><select v-model="submissionType" class="input"><option value="all">{{ t('filters.all') }}</option><option value="contact">{{ t('serviceSubmissions.types.contact') }}</option><option value="report_abuse">{{ t('serviceSubmissions.types.report_abuse') }}</option></select></label>
          <label class="grid gap-1 text-sm"><span class="font-medium">{{ t('serviceSubmissions.status') }}</span><select v-model="submissionStatus" class="input"><option value="all">{{ t('filters.all') }}</option><option v-for="status in serviceSubmissionStatuses" :key="status" :value="status">{{ t(`serviceSubmissions.statuses.${status}`) }}</option></select></label>
          <button class="btn-primary self-end" type="submit">{{ t('serviceSubmissions.applyFilters') }}</button>
        </form>

        <p class="mt-4 text-xs text-[var(--ui-text-muted)]">{{ t('serviceSubmissions.filteredCount', { count: submissionTotal }) }}</p>
        <div v-if="submissionsLoading" class="mt-5 text-sm text-[var(--ui-text-muted)]">{{ t('common.loading') }}</div>
        <div v-else-if="submissionsError" class="mt-5 rounded-2xl border border-rose-500/30 p-4 text-sm text-rose-600 dark:text-rose-300">{{ submissionsError }}</div>
        <div v-else-if="!submissions.length" class="panel-muted mt-5 p-5 text-sm text-[var(--ui-text-muted)]">{{ t('serviceSubmissions.empty') }}</div>
        <div v-else class="mt-5 space-y-3">
          <article v-for="submission in submissions" :key="submission.id" class="panel-muted p-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <button class="min-w-0 flex-1 text-left" type="button" @click="selectedSubmission = submission">
                <div class="flex flex-wrap items-center gap-2"><span class="pill">{{ t(`serviceSubmissions.types.${submission.type}`) }}</span><span class="rounded-full border px-2.5 py-1 text-xs font-semibold" :class="submissionStatusClass(submission.status)">{{ t(`serviceSubmissions.statuses.${submission.status}`) }}</span><span class="text-xs text-[var(--ui-text-muted)]">{{ formatSubmissionDate(submission.createdAt) }}</span></div>
                <p class="mt-3 truncate font-semibold">{{ submission.subject || submission.linkIdentifier || t(`serviceSubmissions.types.${submission.type}`) }}</p>
                <p class="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-sm text-[var(--ui-text-muted)]">{{ submission.message || submission.description }}</p>
              </button>
              <div class="flex flex-wrap items-end gap-2">
                <label class="grid gap-1 text-xs font-semibold text-[var(--ui-text-muted)]"><span>{{ t('serviceSubmissions.status') }}</span><select class="input py-2" :value="submission.status" @change="updateSubmissionStatus(submission, ($event.target as HTMLSelectElement).value as ServiceSubmissionStatus)"><option v-for="status in serviceSubmissionStatuses" :key="status" :value="status">{{ t(`serviceSubmissions.statuses.${status}`) }}</option></select></label>
                <button class="btn-secondary" type="button" @click="selectedSubmission = submission">{{ t('serviceSubmissions.view') }}</button>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section v-else class="panel min-w-0 p-5 sm:p-7">
        <h2 class="text-xl font-semibold">{{ t('serviceSubmissions.settings') }}</h2>
        <p class="mt-2 text-sm text-[var(--ui-text-muted)]">{{ t('serviceSubmissions.settingsDescription') }}</p>
        <div v-if="submissionSettings" class="mt-6 space-y-6">
          <label class="block"><span class="mb-2 block text-sm font-semibold">{{ t('serviceSubmissions.publicContactEmail') }}</span><input v-model="submissionSettings.publicContactEmail" class="input" type="email" maxlength="254" :placeholder="t('serviceSubmissions.optional')" /><span class="mt-2 block text-xs text-[var(--ui-text-muted)]">{{ t('serviceSubmissions.publicContactEmailHelp') }}</span></label>
          <div class="panel-muted p-4">
            <label class="flex items-start gap-3"><input v-model="restrictDomains" class="mt-1 rounded" type="checkbox" /><span><span class="block text-sm font-semibold">{{ t('serviceSubmissions.restrictDomains') }}</span><span class="text-xs text-[var(--ui-text-muted)]">{{ t('serviceSubmissions.restrictDomainsHelp') }}</span></span></label>
            <label v-if="restrictDomains" class="mt-4 block"><span class="mb-2 block text-sm font-medium">{{ t('serviceSubmissions.allowedDomains') }}</span><textarea v-model="domainsText" class="input min-h-32 resize-y" maxlength="13000" :placeholder="t('serviceSubmissions.domainsPlaceholder')" /><span class="mt-2 block text-xs text-amber-700 dark:text-amber-300">{{ t('serviceSubmissions.domainWarning') }}</span></label>
          </div>
          <label class="block max-w-sm"><span class="mb-2 block text-sm font-semibold">{{ t('serviceSubmissions.retentionDays') }}</span><input v-model.number="submissionSettings.retentionDays" class="input" type="number" min="1" max="3650" /><span class="mt-2 block text-xs text-[var(--ui-text-muted)]">{{ t('serviceSubmissions.retentionHelp') }}</span></label>
          <div class="panel-muted p-4 text-sm text-[var(--ui-text-muted)]">{{ t('serviceSubmissions.antiSpamHelp') }}</div>
          <button class="btn-primary" type="button" :disabled="settingsSaving" @click="saveSubmissionSettings">{{ settingsSaving ? t('common.saving') : t('common.save') }}</button>
        </div>
      </section>
    </div>

    <div v-if="previewOpen && selected" class="fixed inset-0 z-[90] grid place-items-center bg-black/45 p-4" role="presentation">
      <section class="panel max-h-[88dvh] w-full max-w-2xl overflow-y-auto p-6 sm:p-8" role="dialog" aria-modal="true" :aria-label="t('serviceSections.preview')">
        <div class="flex items-start justify-between gap-4">
          <div><p class="text-xs font-semibold uppercase tracking-[.16em] text-[var(--ui-accent)]">{{ t('serviceSections.draftPreview') }}</p><h2 class="mt-2 text-2xl font-semibold">{{ previewTitle || t('serviceSections.untitled') }}</h2></div>
          <button class="btn-secondary" type="button" @click="previewOpen = false">{{ t('common.close') }}</button>
        </div>
        <div class="mt-5 inline-flex rounded-xl border border-[var(--ui-border)] p-1" role="group" :aria-label="t('locale.label')">
          <button type="button" class="rounded-lg px-3 py-1.5 text-sm" :class="previewLocale === 'en' ? 'bg-[var(--ui-accent-soft)] text-[var(--ui-accent)]' : ''" @click="previewLocale = 'en'">English</button>
          <button type="button" class="rounded-lg px-3 py-1.5 text-sm" :class="previewLocale === 'lv' ? 'bg-[var(--ui-accent-soft)] text-[var(--ui-accent)]' : ''" @click="previewLocale = 'lv'">Latviešu</button>
        </div>
        <RichTextContent :value="previewBody || ''" class="mt-6 whitespace-pre-wrap break-words text-sm leading-7 text-[var(--ui-text-muted)]" />
      </section>
    </div>

    <div v-if="selectedSubmission" class="fixed inset-0 z-[90] grid place-items-center bg-black/45 p-4" role="presentation">
      <section class="panel max-h-[88dvh] w-full max-w-2xl overflow-y-auto p-6" role="dialog" aria-modal="true" :aria-label="t('serviceSubmissions.details')">
        <div class="flex items-start justify-between gap-3"><div><div class="flex flex-wrap gap-2"><span class="pill">{{ t(`serviceSubmissions.types.${selectedSubmission.type}`) }}</span><span class="rounded-full border px-2.5 py-1 text-xs font-semibold" :class="submissionStatusClass(selectedSubmission.status)">{{ t(`serviceSubmissions.statuses.${selectedSubmission.status}`) }}</span></div><h2 class="mt-3 text-xl font-semibold">{{ selectedSubmission.subject || selectedSubmission.linkIdentifier || t('serviceSubmissions.details') }}</h2><p class="mt-1 text-xs text-[var(--ui-text-muted)]">{{ formatSubmissionDate(selectedSubmission.createdAt) }}</p></div><button class="btn-secondary" type="button" @click="selectedSubmission = null">{{ t('common.close') }}</button></div>
        <dl class="mt-6 space-y-4 text-sm">
          <div v-if="selectedSubmission.email"><dt class="font-semibold">{{ t('serviceSubmissions.email') }}</dt><dd class="mt-1 break-all text-[var(--ui-text-muted)]">{{ selectedSubmission.email }}</dd></div>
          <div v-if="selectedSubmission.reporterEmail"><dt class="font-semibold">{{ t('serviceSubmissions.reporterEmail') }}</dt><dd class="mt-1 break-all text-[var(--ui-text-muted)]">{{ selectedSubmission.reporterEmail }}</dd></div>
          <div v-if="selectedSubmission.reason"><dt class="font-semibold">{{ t('serviceSubmissions.reason') }}</dt><dd class="mt-1 text-[var(--ui-text-muted)]">{{ t(`serviceSubmissions.reasons.${selectedSubmission.reason}`) }}</dd></div>
          <div v-if="selectedSubmission.message || selectedSubmission.description"><dt class="font-semibold">{{ t('serviceSubmissions.content') }}</dt><dd class="mt-2 whitespace-pre-wrap break-words rounded-2xl bg-[var(--ui-panel-muted)] p-4 leading-6">{{ selectedSubmission.message || selectedSubmission.description }}</dd></div>
        </dl>
        <div class="mt-6 flex flex-wrap items-end gap-2">
          <label class="grid gap-1 text-xs font-semibold text-[var(--ui-text-muted)]"><span>{{ t('serviceSubmissions.status') }}</span><select class="input py-2" :value="selectedSubmission.status" @change="updateSubmissionStatus(selectedSubmission, ($event.target as HTMLSelectElement).value as ServiceSubmissionStatus)"><option v-for="status in serviceSubmissionStatuses" :key="status" :value="status">{{ t(`serviceSubmissions.statuses.${status}`) }}</option></select></label>
          <RouterLink v-if="selectedSubmission.associatedLinkSlug" class="btn-secondary" :to="{ path: '/app/links', query: { search: selectedSubmission.associatedLinkSlug } }">{{ t('serviceSubmissions.openLink') }}</RouterLink>
          <button class="btn-secondary text-rose-600 dark:text-rose-300" type="button" @click="deleteTarget = selectedSubmission">{{ t('common.delete') }}</button>
        </div>
      </section>
    </div>

    <div v-if="deleteTarget" class="fixed inset-0 z-[100] grid place-items-center bg-black/45 p-4" role="presentation">
      <section class="panel w-full max-w-md p-6" role="alertdialog" aria-modal="true" :aria-label="t('serviceSubmissions.deleteTitle')"><h2 class="text-xl font-semibold">{{ t('serviceSubmissions.deleteTitle') }}</h2><p class="mt-3 text-sm text-[var(--ui-text-muted)]">{{ t('serviceSubmissions.deleteDescription') }}</p><div class="mt-6 flex justify-end gap-2"><button class="btn-secondary" type="button" @click="deleteTarget = null">{{ t('common.cancel') }}</button><button class="btn-primary bg-rose-600" type="button" :disabled="deletingSubmission" @click="deleteSubmission">{{ t('common.delete') }}</button></div></section>
    </div>
  </section>
</template>
