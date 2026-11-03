<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ActivityChoiceOption, ActivityImageMarker } from '@/shared/activity-types';

interface Assignment { markerId: string; labelId: string }
const props = defineProps<{
  imageUrl: string;
  imageAlt: string;
  markers: ActivityImageMarker[];
  labels: ActivityChoiceOption[];
  assignments: Assignment[];
  oneToOne: boolean;
}>();
const emit = defineEmits<{ 'update:assignments': [value: Assignment[]] }>();
const { t } = useI18n();

const numberedMarkers = computed(() => props.markers.map((marker, index) => ({ ...marker, number: index + 1 })));
const markerColumns = computed(() => {
  const ordered = [...numberedMarkers.value].sort((a, b) => a.number - b.number);
  const leftCount = Math.ceil(ordered.length / 2);
  return {
    left: ordered.slice(0, leftCount),
    right: ordered.slice(leftCount)
  };
});
const assignmentForMarker = (markerId: string) => props.assignments.find((item) => item.markerId === markerId);
const labelUsedElsewhere = (labelId: string, markerId: string) => props.oneToOne
  && props.assignments.some((item) => item.labelId === labelId && item.markerId !== markerId);
const updateMarker = (markerId: string, labelId: string) => {
  const withoutMarker = props.assignments.filter((item) => item.markerId !== markerId);
  if (!labelId) {
    emit('update:assignments', withoutMarker);
    return;
  }
  const next = props.oneToOne ? withoutMarker.filter((item) => item.labelId !== labelId) : withoutMarker;
  emit('update:assignments', [...next, { markerId, labelId }]);
};
</script>

<template>
  <div>
    <p class="mb-3 text-xs text-[var(--ui-text-muted)]">{{ t('activityImage.studentHint') }}</p>
    <div class="grid grid-cols-2 items-stretch gap-3 md:grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)_minmax(10rem,14rem)] md:gap-4">
      <div class="order-2 flex min-w-0 flex-col justify-around gap-3 md:order-1">
        <label v-for="marker in markerColumns.left" :key="marker.id" class="image-label-slot flex min-w-0 items-center gap-2 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-panel)] p-2.5">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--ui-accent)] text-sm font-semibold text-[var(--ui-accent-contrast)]">{{ marker.number }}</span>
          <select class="input min-w-0 flex-1 py-2 text-sm" :aria-label="t('activityImage.selectMarker', { number: marker.number })" :value="assignmentForMarker(marker.id)?.labelId ?? ''" @change="updateMarker(marker.id, ($event.target as HTMLSelectElement).value)">
            <option value="">{{ t('activityImage.chooseLabel') }}</option>
            <option v-for="label in labels" :key="label.id" :value="label.id" :disabled="labelUsedElsewhere(label.id, marker.id)">{{ label.label }}</option>
          </select>
        </label>
      </div>

      <div class="order-1 col-span-2 overflow-auto text-center md:order-2 md:col-span-1">
        <div class="relative inline-block max-w-full">
          <img :src="imageUrl" :alt="imageAlt" class="block max-h-[34rem] max-w-full rounded-2xl object-contain" draggable="false" />
          <span v-for="marker in numberedMarkers" :key="marker.id" :data-image-marker="marker.id" class="absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-[var(--ui-accent)] text-xs font-bold text-[var(--ui-accent-contrast)] shadow" :style="{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }" :aria-label="t('activityImage.selectMarker', { number: marker.number })">{{ marker.number }}</span>
        </div>
      </div>

      <div class="order-3 flex min-w-0 flex-col justify-around gap-3">
        <label v-for="marker in markerColumns.right" :key="marker.id" class="image-label-slot flex min-w-0 items-center gap-2 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-panel)] p-2.5">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--ui-accent)] text-sm font-semibold text-[var(--ui-accent-contrast)]">{{ marker.number }}</span>
          <select class="input min-w-0 flex-1 py-2 text-sm" :aria-label="t('activityImage.selectMarker', { number: marker.number })" :value="assignmentForMarker(marker.id)?.labelId ?? ''" @change="updateMarker(marker.id, ($event.target as HTMLSelectElement).value)">
            <option value="">{{ t('activityImage.chooseLabel') }}</option>
            <option v-for="label in labels" :key="label.id" :value="label.id" :disabled="labelUsedElsewhere(label.id, marker.id)">{{ label.label }}</option>
          </select>
        </label>
      </div>
    </div>
  </div>
</template>

<style scoped>
.image-label-slot { transition: border-color 160ms ease, background-color 160ms ease; }
.image-label-slot:focus-within { border-color: var(--ui-accent); background: var(--ui-accent-soft); }
</style>
