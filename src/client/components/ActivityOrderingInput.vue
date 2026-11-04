<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ActivityChoiceOption } from '@/shared/activity-types';
import ActivityMoveArrow from './ActivityMoveArrow.vue';

const props = defineProps<{ items: ActivityChoiceOption[]; modelValue: string[] }>();
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>();
const { t } = useI18n();
const list = ref<HTMLElement | null>(null);
const draggingId = ref('');
const dragOrderIds = ref<string[] | null>(null);

const normalizedIds = computed(() => {
  const known = new Set(props.items.map((item) => item.id));
  return props.modelValue.length === props.items.length && props.modelValue.every((id) => known.has(id))
    ? props.modelValue
    : props.items.map((item) => item.id);
});
const orderedItems = computed(() => {
  const byId = new Map(props.items.map((item) => [item.id, item]));
  return (dragOrderIds.value ?? normalizedIds.value).map((id) => byId.get(id)!).filter(Boolean);
});

const move = (id: string, targetIndex: number) => {
  const ids = orderedItems.value.map((item) => item.id);
  const sourceIndex = ids.indexOf(id);
  if (sourceIndex < 0) return;
  const [moved] = ids.splice(sourceIndex, 1);
  ids.splice(Math.max(0, Math.min(targetIndex, ids.length)), 0, moved);
  emit('update:modelValue', ids);
};

type DragSession = {
  pointerId: number;
  itemId: string;
  ghost: HTMLElement;
  handle: HTMLElement;
  offsetX: number;
  offsetY: number;
  width: number;
  lastClientY: number;
  scrollContainer: HTMLElement | null;
  bodyCursor: string;
  bodyUserSelect: string;
};
let dragSession: DragSession | null = null;
let autoScrollFrame: number | null = null;

const findScrollContainer = (element: HTMLElement) => {
  let parent = element.parentElement;
  while (parent && parent !== document.body) {
    const overflow = window.getComputedStyle(parent).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && parent.scrollHeight > parent.clientHeight) return parent;
    parent = parent.parentElement;
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
};
const captureRects = () => {
  const rects = new Map<string, DOMRect>();
  list.value?.querySelectorAll<HTMLElement>('[data-order-id]').forEach((element) => {
    if (element.dataset.orderId) rects.set(element.dataset.orderId, element.getBoundingClientRect());
  });
  return rects;
};
const animatePositions = async (before: Map<string, DOMRect>) => {
  await nextTick();
  list.value?.querySelectorAll<HTMLElement>('[data-order-id]').forEach((element) => {
    const id = element.dataset.orderId;
    const previous = id ? before.get(id) : undefined;
    if (!previous || id === draggingId.value) return;
    const current = element.getBoundingClientRect();
    const deltaY = previous.top - current.top;
    if (Math.abs(deltaY) < 1 || typeof element.animate !== 'function') return;
    element.getAnimations?.().forEach((animation) => animation.cancel());
    element.animate(
      [{ transform: `translateY(${deltaY}px)` }, { transform: 'translateY(0)' }],
      { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' }
    );
  });
};
const setDraggedPosition = (targetIndex: number) => {
  if (!dragSession || !dragOrderIds.value) return;
  const currentIndex = dragOrderIds.value.indexOf(dragSession.itemId);
  const nextIndex = Math.max(0, Math.min(targetIndex, dragOrderIds.value.length - 1));
  if (currentIndex < 0 || currentIndex === nextIndex) return;
  const before = captureRects();
  const next = [...dragOrderIds.value];
  next.splice(currentIndex, 1);
  next.splice(nextIndex, 0, dragSession.itemId);
  dragOrderIds.value = next;
  void animatePositions(before);
};
const updateDraggedPosition = (clientY: number) => {
  if (!dragSession || !list.value) return;
  const cards = [...list.value.querySelectorAll<HTMLElement>('[data-order-id]')]
    .filter((element) => element.dataset.orderId !== dragSession?.itemId);
  let targetIndex = cards.length;
  for (let index = 0; index < cards.length; index += 1) {
    const rect = cards[index].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) { targetIndex = index; break; }
  }
  setDraggedPosition(targetIndex);
};
const positionGhost = (clientX: number, clientY: number) => {
  if (!dragSession) return;
  const left = Math.min(Math.max(clientX - dragSession.offsetX, 8), Math.max(window.innerWidth - dragSession.width - 8, 8));
  dragSession.ghost.style.left = `${left}px`;
  dragSession.ghost.style.top = `${clientY - dragSession.offsetY}px`;
};
const runAutoScroll = () => {
  if (!dragSession) return;
  const container = dragSession.scrollContainer;
  const rect = container && container !== document.scrollingElement
    ? container.getBoundingClientRect()
    : { top: 0, bottom: window.innerHeight, height: window.innerHeight };
  const edge = Math.min(72, rect.height / 4);
  let speed = 0;
  if (dragSession.lastClientY < rect.top + edge) speed = -Math.ceil(((rect.top + edge - dragSession.lastClientY) / edge) * 14);
  else if (dragSession.lastClientY > rect.bottom - edge) speed = Math.ceil(((dragSession.lastClientY - (rect.bottom - edge)) / edge) * 14);
  if (speed && container) {
    const previous = container.scrollTop;
    container.scrollTop += speed;
    if (previous !== container.scrollTop) updateDraggedPosition(dragSession.lastClientY);
  }
  autoScrollFrame = window.requestAnimationFrame(runAutoScroll);
};
const onDragMove = (event: PointerEvent) => {
  if (!dragSession || event.pointerId !== dragSession.pointerId) return;
  event.preventDefault();
  dragSession.lastClientY = event.clientY;
  positionGhost(event.clientX, event.clientY);
  updateDraggedPosition(event.clientY);
};
const finishDrag = (commit: boolean) => {
  const session = dragSession;
  if (!session) return;
  const finalOrder = dragOrderIds.value ? [...dragOrderIds.value] : null;
  session.ghost.remove();
  if (session.handle.hasPointerCapture?.(session.pointerId)) session.handle.releasePointerCapture(session.pointerId);
  document.body.style.cursor = session.bodyCursor;
  document.body.style.userSelect = session.bodyUserSelect;
  document.removeEventListener('pointermove', onDragMove);
  document.removeEventListener('pointerup', onDragEnd);
  document.removeEventListener('pointercancel', onDragCancel);
  document.removeEventListener('keydown', onDragKeydown);
  if (autoScrollFrame !== null) window.cancelAnimationFrame(autoScrollFrame);
  autoScrollFrame = null;
  dragSession = null;
  dragOrderIds.value = null;
  draggingId.value = '';
  if (commit && finalOrder && finalOrder.join('\u0000') !== normalizedIds.value.join('\u0000')) emit('update:modelValue', finalOrder);
  void nextTick(() => list.value?.querySelector<HTMLElement>(`[data-order-handle="${session.itemId}"]`)?.focus());
};
function onDragEnd(event: PointerEvent) { if (dragSession?.pointerId === event.pointerId) finishDrag(true); }
function onDragCancel(event: PointerEvent) { if (dragSession?.pointerId === event.pointerId) finishDrag(false); }
function onDragKeydown(event: KeyboardEvent) { if (event.key === 'Escape' && dragSession) { event.preventDefault(); finishDrag(false); } }
const startDrag = (event: PointerEvent, itemId: string) => {
  if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0) || dragSession) return;
  const handle = event.currentTarget as HTMLElement;
  const card = handle.closest<HTMLElement>('[data-order-id]');
  if (!card) return;
  event.preventDefault();
  event.stopPropagation();
  const rect = card.getBoundingClientRect();
  const ghost = card.cloneNode(true) as HTMLElement;
  ghost.classList.remove('ordering-placeholder');
  ghost.classList.add('ordering-drag-ghost');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]').forEach((element) => { element.tabIndex = -1; });
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  document.body.appendChild(ghost);
  dragOrderIds.value = [...normalizedIds.value];
  draggingId.value = itemId;
  dragSession = {
    pointerId: event.pointerId,
    itemId,
    ghost,
    handle,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    width: rect.width,
    lastClientY: event.clientY,
    scrollContainer: findScrollContainer(card),
    bodyCursor: document.body.style.cursor,
    bodyUserSelect: document.body.style.userSelect
  };
  document.body.style.cursor = 'grabbing';
  document.body.style.userSelect = 'none';
  handle.setPointerCapture?.(event.pointerId);
  positionGhost(event.clientX, event.clientY);
  document.addEventListener('pointermove', onDragMove, { passive: false });
  document.addEventListener('pointerup', onDragEnd);
  document.addEventListener('pointercancel', onDragCancel);
  document.addEventListener('keydown', onDragKeydown);
  autoScrollFrame = window.requestAnimationFrame(runAutoScroll);
};

onBeforeUnmount(() => finishDrag(false));
</script>

<template>
  <div ref="list" class="w-full min-w-0 max-w-full space-y-2" role="list" :aria-label="t('activityOrdering.studentLabel')">
    <article
      v-for="(item, index) in orderedItems"
      :key="item.id"
      :data-order-id="item.id"
      role="listitem"
      class="ordering-card flex min-w-0 max-w-full items-start gap-2 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-panel)] p-3 sm:items-center sm:gap-3"
      :class="draggingId === item.id ? 'ordering-placeholder' : ''"
    >
      <button type="button" class="ordering-handle shrink-0 cursor-grab touch-none rounded-lg px-2 py-1 text-[var(--ui-text-muted)] active:cursor-grabbing" :data-order-handle="item.id" :aria-label="t('activityOrdering.moveHandle', { item: item.label })" @pointerdown="startDrag($event, item.id)">⠿</button>
      <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ui-accent-soft)] text-sm font-semibold text-[var(--ui-accent)]">{{ index + 1 }}</span>
      <span class="min-w-0 flex-1 break-words text-sm leading-5 [overflow-wrap:anywhere] sm:text-base">{{ item.label }}</span>
      <div class="flex shrink-0"><button type="button" class="flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-30" :disabled="index === 0" :aria-label="t('activityOrdering.moveUp', { item: item.label })" @click="move(item.id, index - 1)"><ActivityMoveArrow direction="up" /></button><button type="button" class="flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-30" :disabled="index === orderedItems.length - 1" :aria-label="t('activityOrdering.moveDown', { item: item.label })" @click="move(item.id, index + 1)"><ActivityMoveArrow direction="down" /></button></div>
    </article>
    <button v-if="!modelValue.length" type="button" class="btn-secondary mt-2 w-full" @click="emit('update:modelValue', orderedItems.map((item) => item.id))">{{ t('activityOrdering.confirm') }}</button>
  </div>
</template>

<style scoped>
.ordering-card { transition: border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease; }
.ordering-placeholder { border-style: dashed; border-color: var(--ui-accent); background: var(--ui-accent-soft); color: transparent; box-shadow: none; }
.ordering-placeholder * { visibility: hidden; }
:global(.ordering-drag-ghost) { position: fixed !important; z-index: 200 !important; margin: 0 !important; opacity: 1 !important; pointer-events: none !important; transform: scale(1.015) rotate(.25deg); border-radius: 1rem; border: 1px solid var(--ui-accent); background: var(--ui-panel); box-shadow: 0 22px 52px rgb(0 0 0 / .24); }
@media (prefers-reduced-motion: reduce) { .ordering-card { transition: none; } :global(.ordering-drag-ghost) { transform: none; } }
</style>
