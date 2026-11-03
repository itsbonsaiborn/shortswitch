<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ActivityMatchItem } from '@/shared/activity-types';
import ActivityDeleteIcon from './ActivityDeleteIcon.vue';

interface MatchPair { leftId: string; rightId: string }
const props = defineProps<{ leftItems: ActivityMatchItem[]; rightItems: ActivityMatchItem[]; pairs: MatchPair[] }>();
const emit = defineEmits<{ 'update:pairs': [value: MatchPair[]] }>();
const { t } = useI18n();
const selectedLeftId = ref('');
const selectedRightId = ref('');
const pointerOrigin = ref<{ side: 'left' | 'right'; id: string } | null>(null);
const pointerTarget = ref<{ side: 'left' | 'right'; id: string } | null>(null);
const leftById = computed(() => new Map(props.leftItems.map((item) => [item.id, item])));
const rightById = computed(() => new Map(props.rightItems.map((item) => [item.id, item])));
const pairForLeft = (id: string) => props.pairs.find((pair) => pair.leftId === id);
const pairForRight = (id: string) => props.pairs.find((pair) => pair.rightId === id);
const pairNumber = (leftId: string) => props.pairs.findIndex((pair) => pair.leftId === leftId) + 1;

const connect = (leftId: string, rightId: string) => {
  if (!leftById.value.has(leftId) || !rightById.value.has(rightId)) return;
  emit('update:pairs', [...props.pairs.filter((pair) => pair.leftId !== leftId && pair.rightId !== rightId), { leftId, rightId }]);
  selectedLeftId.value = '';
  selectedRightId.value = '';
  pointerOrigin.value = null;
  pointerTarget.value = null;
};
const chooseLeft = (leftId: string) => {
  if (selectedRightId.value) connect(leftId, selectedRightId.value);
  else selectedLeftId.value = selectedLeftId.value === leftId ? '' : leftId;
};
const chooseRight = (rightId: string) => {
  if (selectedLeftId.value) connect(selectedLeftId.value, rightId);
  else selectedRightId.value = selectedRightId.value === rightId ? '' : rightId;
};
const remove = (leftId: string) => emit('update:pairs', props.pairs.filter((pair) => pair.leftId !== leftId));
const startPointer = (event: PointerEvent, side: 'left' | 'right', id: string) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  pointerOrigin.value = { side, id };
  pointerTarget.value = null;
};
const targetAtPointer = (event: PointerEvent) => {
  const element = typeof document.elementFromPoint === 'function'
    ? document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-match-left], [data-match-right]')
    : null;
  if (element?.dataset.matchLeft) return { side: 'left' as const, id: element.dataset.matchLeft };
  if (element?.dataset.matchRight) return { side: 'right' as const, id: element.dataset.matchRight };
  return null;
};
const movePointer = (event: PointerEvent) => {
  if (!pointerOrigin.value) return;
  const target = targetAtPointer(event);
  pointerTarget.value = target && target.side !== pointerOrigin.value.side ? target : null;
};
const endPointer = (event: PointerEvent, fallbackSide?: 'left' | 'right', fallbackId?: string) => {
  const origin = pointerOrigin.value;
  const target = targetAtPointer(event) ?? (fallbackSide && fallbackId ? { side: fallbackSide, id: fallbackId } : null);
  pointerOrigin.value = null;
  pointerTarget.value = null;
  if (!origin || !target || origin.side === target.side) return;
  if (origin.side === 'left') connect(origin.id, target.id);
  else connect(target.id, origin.id);
};
const cancelPointer = () => { pointerOrigin.value = null; pointerTarget.value = null; };
</script>

<template>
  <div>
    <p class="mb-3 text-xs text-[var(--ui-text-muted)]">{{ t('activityMatching.studentHint') }}</p>
    <div class="grid grid-cols-2 gap-3">
      <div class="space-y-2">
        <button v-for="item in leftItems" :key="item.id" type="button" :data-match-left="item.id" class="flex min-h-12 w-full touch-none items-center gap-2 rounded-2xl border p-3 text-left transition-colors" :class="selectedLeftId === item.id || pointerOrigin?.side === 'left' && pointerOrigin.id === item.id || pointerTarget?.side === 'left' && pointerTarget.id === item.id ? 'border-[var(--ui-accent)] bg-[var(--ui-accent-soft)]' : 'border-[var(--ui-border)]'" :aria-pressed="selectedLeftId === item.id" @click="chooseLeft(item.id)" @pointerdown="startPointer($event, 'left', item.id)" @pointermove.prevent="movePointer" @pointerup="endPointer($event, 'left', item.id)" @pointercancel="cancelPointer"><span v-if="pairForLeft(item.id)" class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--ui-accent)] text-xs font-semibold text-white">{{ pairNumber(item.id) }}</span><span class="min-w-0 flex-1">{{ item.label }}</span></button>
      </div>
      <div class="space-y-2">
        <button v-for="item in rightItems" :key="item.id" type="button" :data-match-right="item.id" class="flex min-h-12 w-full touch-none items-center gap-2 rounded-2xl border p-3 text-left transition-colors" :class="pairForRight(item.id) || selectedRightId === item.id || pointerOrigin?.side === 'right' && pointerOrigin.id === item.id || pointerTarget?.side === 'right' && pointerTarget.id === item.id ? 'border-[var(--ui-accent)] bg-[var(--ui-accent-soft)]' : 'border-[var(--ui-border)]'" :aria-label="t('activityMatching.connectTo', { item: item.label })" :aria-pressed="selectedRightId === item.id" @click="chooseRight(item.id)" @pointerdown="startPointer($event, 'right', item.id)" @pointermove.prevent="movePointer" @pointerup="endPointer($event, 'right', item.id)" @pointercancel="cancelPointer"><span v-if="pairForRight(item.id)" class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--ui-accent)] text-xs font-semibold text-white">{{ pairNumber(pairForRight(item.id)!.leftId) }}</span><span class="min-w-0 flex-1">{{ item.label }}</span></button>
      </div>
    </div>
    <div v-if="pairs.length" class="mt-4 space-y-2" aria-live="polite"><div v-for="pair in pairs" :key="pair.leftId" class="flex items-center gap-2 rounded-xl bg-[var(--ui-panel-muted)] px-3 py-2 text-sm"><span class="min-w-0 flex-1 truncate">{{ leftById.get(pair.leftId)?.label }}</span><span class="text-[var(--ui-accent)]">→</span><span class="min-w-0 flex-1 truncate">{{ rightById.get(pair.rightId)?.label }}</span><button type="button" class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-500 transition hover:bg-red-500/10" :aria-label="t('activityMatching.removeConnection', { item: leftById.get(pair.leftId)?.label })" @click="remove(pair.leftId)"><ActivityDeleteIcon class="h-4 w-4" /></button></div></div>
  </div>
</template>
