<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import type { Activity, ActivityDraft } from '@/shared/activity-types';
import { api } from '../lib/api';
import ActivityStudentPreview from '../components/ActivityStudentPreview.vue';
import { publicPreviewSlides, type AdminSlide } from '../lib/activity-editor';

interface ActivityDetailResponse { activity: Activity; draft: ActivityDraft; }
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const loading = ref(true);
const error = ref('');
const activity = ref<Activity | null>(null);
const slides = ref<AdminSlide[]>([]);
const slideIndex = ref(0);
const mode = ref<'desktop' | 'mobile'>('desktop');
const previewSlides = computed(() => publicPreviewSlides(slides.value));
const slide = computed(() => previewSlides.value[slideIndex.value] ?? null);
const closePreview = () => {
  window.close();
  window.setTimeout(() => {
    if (!window.closed && activity.value) void router.push(`/app/activities/${activity.value.id}/edit`);
  }, 50);
};

onMounted(async () => {
  try {
    const detail = await api<ActivityDetailResponse>(`/api/activities/${String(route.params.id)}`);
    activity.value = detail.activity;
    slides.value = structuredClone(detail.draft.slides) as AdminSlide[];
  } catch (reason) { error.value = (reason as Error).message; }
  finally { loading.value = false; }
});
</script>

<template>
  <main class="min-h-dvh bg-[var(--ui-page)] p-2 sm:p-4">
    <div class="w-full">
      <header class="panel mb-4 flex flex-wrap items-center justify-between gap-3 p-4"><div><h1 class="text-lg font-semibold">{{ activity?.settings.title || t('activitiesEditor.preview') }}</h1><p class="text-xs text-[var(--ui-text-muted)]">{{ t('activityResults.previewSavedDraft') }}</p></div><div class="flex gap-2"><button class="btn-secondary" :class="mode === 'desktop' ? 'ring-2 ring-[var(--ui-accent)]' : ''" @click="mode = 'desktop'">{{ t('pages.desktop') }}</button><button class="btn-secondary" :class="mode === 'mobile' ? 'ring-2 ring-[var(--ui-accent)]' : ''" @click="mode = 'mobile'">{{ t('pages.mobile') }}</button><button class="btn-secondary" @click="closePreview">{{ t('common.close') }}</button></div></header>
      <div v-if="loading" class="panel p-10 text-center">{{ t('common.loading') }}</div>
      <div v-else-if="error" class="panel p-10 text-center text-red-500">{{ error }}</div>
      <template v-else><nav class="mx-auto mb-3 flex max-w-xl items-center justify-between"><button class="btn-secondary disabled:cursor-not-allowed disabled:opacity-40" :disabled="slideIndex === 0" @click="slideIndex--">{{ t('common.previous') }}</button><span class="text-sm text-[var(--ui-text-muted)]">{{ slideIndex + 1 }} / {{ previewSlides.length }}</span><button class="btn-secondary disabled:cursor-not-allowed disabled:opacity-40" :disabled="slideIndex >= previewSlides.length - 1" @click="slideIndex++">{{ t('common.next') }}</button></nav><ActivityStudentPreview standalone :slide="slide" :activity-title="activity?.settings.title || ''" :mode="mode" :theme="activity?.settings.theme" :layout="activity?.settings.layout" :background-pattern="activity?.settings.backgroundPattern" :pattern-intensity="activity?.settings.patternIntensity" /></template>
    </div>
  </main>
</template>
