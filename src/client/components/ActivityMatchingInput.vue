<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ActivityMatchItem } from '@/shared/activity-types';

interface MatchPair { leftId: string; rightId: string }
const props = defineProps<{ leftItems: ActivityMatchItem[]; rightItems: ActivityMatchItem[]; pairs: MatchPair[] }>();
const emit = defineEmits<{ 'update:pairs': [value: MatchPair[]] }>();
const { t } = useI18n();
const selectedLeftId = ref('');
const selectedRightId = ref('');
const suppressClick = ref(false);
const pointerOrigin = ref<{ side: 'left' | 'right'; id: string } | null>(null);
const pointerTarget = ref<{ side: 'left' | 'right'; id: string } | null>(null);
const leftById = computed(() => new Map(props.leftItems.map((item) => [item.id, item])));
const rightById = computed(() => new Map(props.rightItems.map((item) => [item.id, item])));
const pairForLeft = (id: string) => props.pairs.find((pair) => pair.leftId === id);
const pairForRight = (id: string) => props.pairs.find((pair) => pair.rightId === id);
const pairNumber = (leftId: string) => props.leftItems.findIndex((item) => item.id === leftId) + 1;
const optionLetter = (index: number) => {
  let value = index + 1;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
};
const connect = (leftId: string, rightId: string) => {
  if (!leftById.value.has(leftId) || !rightById.value.has(rightId)) return;
  emit('update:pairs', [...props.pairs.filter((pair) => pair.leftId !== leftId && pair.rightId !== rightId), { leftId, rightId }]);
  selectedLeftId.value = '';
  selectedRightId.value = '';
  pointerOrigin.value = null;
  pointerTarget.value = null;
};
const chooseLeft = (leftId: string) => {
  if (suppressClick.value) return;
  if (selectedRightId.value) connect(leftId, selectedRightId.value);
  else if (pairForLeft(leftId)) remove(leftId);
  else selectedLeftId.value = selectedLeftId.value === leftId ? '' : leftId;
};
const chooseRight = (rightId: string) => {
  if (suppressClick.value) return;
  if (selectedLeftId.value) connect(selectedLeftId.value, rightId);
  else if (pairForRight(rightId)) remove(pairForRight(rightId)!.leftId);
  else selectedRightId.value = selectedRightId.value === rightId ? '' : rightId;
};
function remove(leftId: string) {
  emit('update:pairs', props.pairs.filter((pair) => pair.leftId !== leftId));
  selectedLeftId.value = '';
  selectedRightId.value = '';
}
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
  suppressClick.value = true;
  window.setTimeout(() => { suppressClick.value = false; }, 0);
  if (origin.side === 'left') connect(origin.id, target.id);
  else connect(target.id, origin.id);
};
const cancelPointer = () => { pointerOrigin.value = null; pointerTarget.value = null; };
</script>

<template>
  <div class="w-full min-w-0 max-w-full">
    <p class="mb-3 break-words text-xs text-[var(--ui-text-muted)] [overflow-wrap:anywhere]">{{ t('activityMatching.studentHint') }}</p>
    <div class="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      <div class="min-w-0 space-y-2">
        <div class="mb-2 flex items-center gap-2 rounded-xl bg-[var(--ui-panel-muted)] px-3 py-2 text-sm font-semibold"><span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--ui-accent)] text-xs text-white">1</span><span>{{ t('activityMatching.chooseItem') }}</span></div>
        <button v-for="(item, itemIndex) in leftItems" :key="item.id" type="button" :data-match-left="item.id" class="flex min-h-12 w-full min-w-0 max-w-full touch-none items-center gap-2 rounded-2xl border p-3 text-left transition-colors" :class="pairForLeft(item.id) || selectedLeftId === item.id || pointerOrigin?.side === 'left' && pointerOrigin.id === item.id || pointerTarget?.side === 'left' && pointerTarget.id === item.id ? 'border-[var(--ui-accent)] bg-[var(--ui-accent-soft)]' : 'border-[var(--ui-border)]'" :aria-label="pairForLeft(item.id) ? t('activityMatching.removeConnection', { item: item.label }) : item.label" :aria-pressed="Boolean(pairForLeft(item.id) || selectedLeftId === item.id)" @click="chooseLeft(item.id)" @pointerdown="startPointer($event, 'left', item.id)" @pointermove.prevent="movePointer" @pointerup="endPointer($event, 'left', item.id)" @pointercancel="cancelPointer"><span data-match-index class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold" :class="pairForLeft(item.id) ? 'bg-[var(--ui-accent)] text-white' : 'bg-[var(--ui-accent-soft)] text-[var(--ui-accent)]'">{{ itemIndex + 1 }}</span><span class="min-w-0 flex-1 break-words text-sm leading-5 [overflow-wrap:anywhere] sm:text-base">{{ item.label }}</span></button>
      </div>
      <div class="min-w-0 space-y-2">
        <div class="mb-2 flex items-center gap-2 rounded-xl bg-[var(--ui-panel-muted)] px-3 py-2 text-sm font-semibold"><span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--ui-accent)] text-xs text-white">2</span><span>{{ t('activityMatching.chooseMatch') }}</span></div>
        <button v-for="(item, itemIndex) in rightItems" :key="item.id" type="button" :data-match-right="item.id" class="flex min-h-12 w-full min-w-0 max-w-full touch-none items-center gap-2 rounded-2xl border p-3 text-left transition-colors" :class="pairForRight(item.id) || selectedRightId === item.id || pointerOrigin?.side === 'right' && pointerOrigin.id === item.id || pointerTarget?.side === 'right' && pointerTarget.id === item.id ? 'border-[var(--ui-accent)] bg-[var(--ui-accent-soft)]' : 'border-[var(--ui-border)]'" :aria-label="pairForRight(item.id) ? t('activityMatching.removeConnection', { item: item.label }) : t('activityMatching.connectTo', { item: item.label })" :aria-pressed="Boolean(pairForRight(item.id) || selectedRightId === item.id)" @click="chooseRight(item.id)" @pointerdown="startPointer($event, 'right', item.id)" @pointermove.prevent="movePointer" @pointerup="endPointer($event, 'right', item.id)" @pointercancel="cancelPointer"><span data-match-index class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold" :class="pairForRight(item.id) ? 'bg-[var(--ui-accent)] text-white' : 'bg-[var(--ui-panel)] text-[var(--ui-text-muted)] ring-1 ring-inset ring-[var(--ui-border)]'">{{ pairForRight(item.id) ? pairNumber(pairForRight(item.id)!.leftId) : optionLetter(itemIndex) }}</span><span class="min-w-0 flex-1 break-words text-sm leading-5 [overflow-wrap:anywhere] sm:text-base">{{ item.label }}</span></button>
      </div>
    </div>
  </div>
</template>
