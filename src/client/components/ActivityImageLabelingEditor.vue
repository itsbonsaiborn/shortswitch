<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ActivityQuestionPublicConfig } from '@/shared/activity-types';
import { editorId } from '../lib/activity-editor';

type ImageConfig = Extract<ActivityQuestionPublicConfig, { questionType: 'image_labeling' }>;
interface ImageAnswerKey { assignments: Array<{ markerId: string; labelId: string }>; feedback: string }
const props = defineProps<{ config: ImageConfig; answerKey: ImageAnswerKey }>();
const { t } = useI18n();
const image = ref<HTMLImageElement | null>(null);
const activeMarkerId = ref('');
const point = (event: PointerEvent | MouseEvent) => {
  const rect = image.value?.getBoundingClientRect();
  if (!rect?.width || !rect.height) return null;
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
  };
};
const addMarker = (event: MouseEvent) => {
  if (props.config.markers.length >= 30 || activeMarkerId.value) return;
  const coordinates = point(event);
  if (!coordinates) return;
  const marker = { id: editorId('marker'), ...coordinates };
  const label = { id: editorId('label'), label: '' };
  props.config.markers.push(marker);
  props.config.labels.push(label);
  props.answerKey.assignments.push({ markerId: marker.id, labelId: label.id });
};
const startMove = (event: PointerEvent, markerId: string) => {
  activeMarkerId.value = markerId;
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
};
const moveMarker = (event: PointerEvent) => {
  if (!activeMarkerId.value) return;
  const coordinates = point(event);
  const marker = props.config.markers.find((item) => item.id === activeMarkerId.value);
  if (coordinates && marker) Object.assign(marker, coordinates);
};
const finishMove = () => { activeMarkerId.value = ''; };
const removeMarker = (markerId: string) => {
  const labelId = props.answerKey.assignments.find((assignment) => assignment.markerId === markerId)?.labelId;
  props.config.markers = props.config.markers.filter((marker) => marker.id !== markerId);
  props.answerKey.assignments = props.answerKey.assignments.filter((assignment) => assignment.markerId !== markerId);
  if (labelId) props.config.labels = props.config.labels.filter((label) => label.id !== labelId);
};
const labelForMarker = (markerId: string) => {
  const labelId = props.answerKey.assignments.find((assignment) => assignment.markerId === markerId)?.labelId;
  return props.config.labels.find((label) => label.id === labelId);
};

</script>

<template>
  <div class="mt-4 space-y-4">
    <div class="grid gap-3 sm:grid-cols-2">
      <label><span class="label">{{ t('activityImage.imageUrl') }}</span><input v-model="config.imageUrl" class="input mt-2" type="url" inputmode="url" placeholder="https://…" /></label>
      <label><span class="label">{{ t('activityImage.imageAlt') }}</span><input v-model="config.imageAlt" class="input mt-2" maxlength="300" /></label>
    </div>
    <p class="rounded-2xl bg-[var(--ui-panel-muted)] px-4 py-3 text-xs leading-5 text-[var(--ui-text-muted)]">{{ t('activityMedia.externalUrlOnly') }}</p>
    <div class="grid items-start gap-4 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-panel)] p-3 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,22rem)]">
      <div><p class="mb-3 text-xs text-[var(--ui-text-muted)]">{{ t('activityImage.markerHint') }}</p><div class="overflow-auto text-center">
        <div data-marker-surface class="relative inline-block max-w-full touch-none" @click="addMarker" @pointermove.prevent="moveMarker" @pointerup="finishMove" @pointercancel="finishMove">
          <img ref="image" :src="config.imageUrl" :alt="config.imageAlt" class="block max-h-[34rem] max-w-full rounded-xl object-contain" draggable="false" />
          <button v-for="(marker, index) in config.markers" :key="marker.id" type="button" class="absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full border-2 border-white bg-[var(--ui-accent)] text-xs font-bold text-white shadow" :style="{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }" :aria-label="t('activityImage.moveMarker', { number: index + 1 })" @click.stop @pointerdown.stop="startMove($event, marker.id)">{{ index + 1 }}</button>
        </div>
      </div></div>
      <div class="app-scrollbar max-h-[34rem] space-y-2 overflow-y-auto pr-1">
        <div v-if="!config.markers.length" class="rounded-2xl border border-dashed border-[var(--ui-border)] p-5 text-center text-sm text-[var(--ui-text-muted)]">{{ t('activityImage.markerHint') }}</div>
        <div v-for="(marker, index) in config.markers" :key="marker.id" class="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 rounded-2xl border border-[var(--ui-border)] p-3">
          <strong class="text-center text-[var(--ui-accent)]">{{ index + 1 }}</strong>
          <label><span class="sr-only">{{ t('activityImage.correctLabel') }}</span><input v-if="labelForMarker(marker.id)" :value="labelForMarker(marker.id)!.label" class="input" maxlength="160" :placeholder="t('activityImage.correctLabel')" @input="labelForMarker(marker.id)!.label = ($event.target as HTMLInputElement).value" /></label>
          <button type="button" class="rounded-lg px-2 py-1 text-red-500" :aria-label="t('activityImage.deleteMarker')" @click="removeMarker(marker.id)">×</button>
        </div>
      </div>
    </div>
    <div class="grid gap-3 sm:grid-cols-2"><label class="flex items-center gap-2 text-sm"><input v-model="config.oneToOne" type="checkbox" />{{ t('activityImage.oneToOne') }}</label><label><span class="label">{{ t('activityImage.gradingMode') }}</span><select v-model="config.gradingMode" class="input mt-2"><option value="all_or_nothing">{{ t('activityChoices.allOrNothing') }}</option><option value="partial">{{ t('activityChoices.partialCredit') }}</option></select></label></div>
    <label class="block"><span class="label">{{ t('activityChoices.feedback') }}</span><textarea v-model="answerKey.feedback" class="input mt-2 min-h-20" maxlength="2000"></textarea></label>
  </div>
</template>
