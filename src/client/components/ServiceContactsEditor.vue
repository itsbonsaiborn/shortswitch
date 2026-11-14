<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ServiceContactBlock, ServiceContactBlockType, ServiceContactConfig } from '@/shared/types';
import PageBlockIcon from './PageBlockIcon.vue';
import ServiceContactsRenderer from './ServiceContactsRenderer.vue';
import ActivityMoveArrow from './ActivityMoveArrow.vue';
import ActivityDeleteIcon from './ActivityDeleteIcon.vue';
import RichTextEditor from './RichTextEditor.vue';
import RichTextContent from './RichTextContent.vue';

const props = defineProps<{ modelValue: ServiceContactConfig }>();
const emit = defineEmits<{ 'update:modelValue': [value: ServiceContactConfig] }>();
const { t } = useI18n();
const editingId = ref<string | null>(null);
const draggedId = ref<string | null>(null);
const previewMode = ref<'desktop' | 'mobile'>('desktop');
const previewLocale = ref<'en' | 'lv'>('en');
const dialog = ref<HTMLElement | null>(null);
const blockList = ref<HTMLElement | null>(null);
const addMenuOpen = ref(false);
let dragGhost: HTMLElement | null = null;
let dragPointerId = -1;
let dragOffsetY = 0;

const blocks = computed(() => props.modelValue.blocks);
const editing = computed(() => blocks.value.find((block) => block.id === editingId.value) ?? null);
const addTypes = computed<ServiceContactBlockType[]>(() => [
  'heading', 'text', ...(blocks.value.some((block) => block.type === 'contact_email') ? [] : ['contact_email'] as const), 'social_card', 'divider'
]);

const cloneConfig = () => ({ blocks: props.modelValue.blocks.map((block) => ({ ...block })) }) as ServiceContactConfig;
const update = (mutator: (value: ServiceContactConfig) => void) => {
  const value = cloneConfig();
  mutator(value);
  emit('update:modelValue', value);
};
const id = () => `contact_${globalThis.crypto?.randomUUID?.().replaceAll('-', '') ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
const createBlock = (type: ServiceContactBlockType): ServiceContactBlock => {
  const base = { id: id(), type } as const;
  if (type === 'heading') return { ...base, type, titleEn: '', titleLv: '' };
  if (type === 'text') return { ...base, type, bodyEn: '', bodyLv: '' };
  if (type === 'contact_email') return { ...base, type, titleEn: 'Email', titleLv: 'E-pasts', email: '' };
  if (type === 'social_card') return { ...base, type, titleEn: '', titleLv: '', descriptionEn: '', descriptionLv: '', icon: 'website', url: '' };
  if (type === 'contact_form') return { ...base, type, titleEn: 'Contact form', titleLv: 'Saziņas forma', descriptionEn: '', descriptionLv: '' };
  return { ...base, type: 'divider' };
};
const add = (type: ServiceContactBlockType) => {
  const block = createBlock(type);
  update((value) => value.blocks.push(block));
  addMenuOpen.value = false;
  if (type !== 'divider') openEditor(block.id);
};
const openEditor = async (blockId: string) => {
  editingId.value = blockId;
  await nextTick();
  dialog.value?.focus();
};
const closeEditor = () => { editingId.value = null; };
const patchEditing = (field: string, value: string) => update((config) => {
  const block = config.blocks.find((candidate) => candidate.id === editingId.value);
  if (block) (block as unknown as Record<string, string>)[field] = value;
});
const remove = (blockId: string) => update((value) => {
  const block = value.blocks.find((candidate) => candidate.id === blockId);
  if (block?.type === 'contact_form') return;
  value.blocks = value.blocks.filter((candidate) => candidate.id !== blockId);
});
const captureBlockRects = () => new Map([...blockList.value?.querySelectorAll<HTMLElement>('[data-service-contact-block]') ?? []]
  .map((element) => [element.dataset.serviceContactBlock!, element.getBoundingClientRect()]));
const animateBlockPositions = async (before: Map<string, DOMRect>) => {
  await nextTick();
  blockList.value?.querySelectorAll<HTMLElement>('[data-service-contact-block]').forEach((element) => {
    const previous = before.get(element.dataset.serviceContactBlock!);
    if (!previous) return;
    const current = element.getBoundingClientRect();
    const x = previous.left - current.left;
    const y = previous.top - current.top;
    if (!x && !y) return;
    element.animate?.([{ transform: `translate(${x}px,${y}px)` }, { transform: 'translate(0,0)' }], {
      duration: 190, easing: 'cubic-bezier(.2,.8,.2,1)'
    });
  });
};
const move = (blockId: string, direction: -1 | 1) => {
  const before = captureBlockRects();
  update((value) => {
  const from = value.blocks.findIndex((block) => block.id === blockId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= value.blocks.length) return;
  const [block] = value.blocks.splice(from, 1);
  value.blocks.splice(to, 0, block!);
  });
  void animateBlockPositions(before);
};
const moveTo = (sourceId: string, targetId: string, after: boolean) => {
  if (sourceId === targetId) return;
  const before = captureBlockRects();
  update((value) => {
    const from = value.blocks.findIndex((block) => block.id === sourceId);
    let to = value.blocks.findIndex((block) => block.id === targetId);
    if (from < 0 || to < 0) return;
    const [block] = value.blocks.splice(from, 1);
    if (from < to) to -= 1;
    if (after) to += 1;
    value.blocks.splice(to, 0, block!);
  });
  void animateBlockPositions(before);
};
const finishDrag = () => {
  draggedId.value = null;
  dragGhost?.remove();
  dragGhost = null;
  dragPointerId = -1;
  document.body.classList.remove('service-contact-dragging');
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', finishDrag);
  window.removeEventListener('pointercancel', finishDrag);
};
const onDragMove = (event: PointerEvent) => {
  if (event.pointerId !== dragPointerId || !dragGhost || !draggedId.value) return;
  dragGhost.style.transform = `translate3d(0,${event.clientY - dragOffsetY}px,0) scale(1.015)`;
  const edge = 72;
  if (event.clientY < edge) window.scrollBy({ top: -12, behavior: 'auto' });
  else if (event.clientY > window.innerHeight - edge) window.scrollBy({ top: 12, behavior: 'auto' });
  const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-service-contact-block]');
  if (!hit || hit.dataset.serviceContactBlock === draggedId.value) return;
  const rect = hit.getBoundingClientRect();
  moveTo(draggedId.value, hit.dataset.serviceContactBlock!, event.clientY > rect.top + rect.height / 2);
};
const startDrag = (event: PointerEvent, blockId: string) => {
  if (event.button !== 0 || !event.isPrimary) return;
  const source = blockList.value?.querySelector<HTMLElement>(`[data-service-contact-block="${CSS.escape(blockId)}"]`);
  if (!source) return;
  event.preventDefault();
  draggedId.value = blockId;
  dragPointerId = event.pointerId;
  const rect = source.getBoundingClientRect();
  dragOffsetY = event.clientY;
  dragGhost = source.cloneNode(true) as HTMLElement;
  dragGhost.removeAttribute('data-service-contact-block');
  Object.assign(dragGhost.style, {
    position: 'fixed', zIndex: '500', pointerEvents: 'none', left: `${rect.left}px`, top: `${rect.top}px`,
    width: `${rect.width}px`, height: `${rect.height}px`, margin: '0', opacity: '1',
    transform: 'translate3d(0,0,0) scale(1.02)', boxShadow: '0 20px 50px rgba(0,0,0,.24)',
    borderColor: 'var(--ui-accent)', background: 'var(--ui-panel)'
  });
  document.body.appendChild(dragGhost);
  document.body.classList.add('service-contact-dragging');
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  window.addEventListener('pointermove', onDragMove, { passive: false });
  window.addEventListener('pointerup', finishDrag);
  window.addEventListener('pointercancel', finishDrag);
};
const blockIconType = (type: ServiceContactBlockType) => type === 'contact_email' ? 'email' : type === 'social_card' ? 'link' : type === 'contact_form' ? 'email' : type;
const blockAccentClass = (type: ServiceContactBlockType) => `service-contact-accent-${
  type === 'social_card' ? 'link' : type === 'contact_email' ? 'email' : type === 'contact_form' ? 'form' : type
}`;
const summary = (block: ServiceContactBlock) => {
  if (block.type === 'heading') return block.titleEn || block.titleLv;
  if (block.type === 'text') return block.bodyEn || block.bodyLv;
  if (block.type === 'contact_email') return block.email;
  if (block.type === 'social_card') return block.titleEn || block.titleLv || block.url;
  if (block.type === 'contact_form') return t('serviceContacts.formControlled');
  return t('serviceContacts.types.divider');
};
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    if (editingId.value) closeEditor();
    addMenuOpen.value = false;
  }
};
const closeAddMenuFromOutside = (event: MouseEvent) => {
  if (!(event.target instanceof Element) || !event.target.closest('[data-contact-add-menu]')) addMenuOpen.value = false;
};
onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  document.addEventListener('click', closeAddMenuFromOutside);
});
onBeforeUnmount(() => {
  finishDrag();
  window.removeEventListener('keydown', onKeydown);
  document.removeEventListener('click', closeAddMenuFromOutside);
});
</script>

<template>
  <div class="mt-6 grid min-w-0 gap-6 2xl:grid-cols-[minmax(0,1fr)_minmax(360px,.8fr)]">
    <section class="min-w-0">
      <div class="mb-3 flex items-end justify-between gap-3">
        <div><h3 class="font-semibold">{{ t('serviceContacts.blocks') }}</h3><p class="mt-1 text-sm text-[var(--ui-text-muted)]">{{ t('serviceContacts.blocksHelp') }}</p></div>
      </div>
      <div ref="blockList" class="space-y-2">
        <article
          v-for="(block, index) in blocks" :key="block.id"
          class="block-editor-card service-contact-block group flex min-w-0 items-center gap-2.5 rounded-2xl border px-2.5 py-2 transition"
          :class="[blockAccentClass(block.type), draggedId === block.id ? 'service-contact-placeholder' : '']"
          :data-service-contact-block="block.id"
        >
          <button class="drag-handle flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-[var(--ui-text-muted)] hover:bg-[var(--ui-panel-muted)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ui-accent)] active:cursor-grabbing" type="button" :aria-label="t('serviceContacts.reorder')" @pointerdown="startDrag($event, block.id)" @keydown.up.prevent="move(block.id, -1)" @keydown.down.prevent="move(block.id, 1)">
            <svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="8" cy="7" r="1.5"/><circle cx="16" cy="7" r="1.5"/><circle cx="8" cy="12" r="1.5"/><circle cx="16" cy="12" r="1.5"/><circle cx="8" cy="17" r="1.5"/><circle cx="16" cy="17" r="1.5"/></svg>
          </button>
          <span class="block-editor-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border"><PageBlockIcon :type="blockIconType(block.type)" /></span>
          <button class="min-w-0 flex-1 text-left" type="button" @click="block.type !== 'divider' && openEditor(block.id)">
            <span class="block text-sm font-semibold">{{ t(`serviceContacts.types.${block.type}`) }}</span>
            <RichTextContent v-if="summary(block)" :value="summary(block)" inline class="mt-0.5 block truncate text-xs text-[var(--ui-text-muted)]" />
            <span v-else class="mt-0.5 block truncate text-xs text-[var(--ui-text-muted)]">{{ t('serviceContacts.emptyBlock') }}</span>
          </button>
          <div class="flex shrink-0 items-center gap-1">
            <button class="icon-button h-9 w-9" type="button" :disabled="index === 0" :aria-label="t('serviceContacts.moveUp')" @click="move(block.id, -1)"><ActivityMoveArrow direction="up" /></button>
            <button class="icon-button h-9 w-9" type="button" :disabled="index === blocks.length - 1" :aria-label="t('serviceContacts.moveDown')" @click="move(block.id, 1)"><ActivityMoveArrow direction="down" /></button>
            <button v-if="block.type !== 'divider'" class="icon-button h-9 w-9" type="button" :aria-label="t('common.edit')" @click="openEditor(block.id)">
              <svg class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m16.5 5.4 2.1 2.1M11 13l.5-2.6c.1-.4.3-.8.6-1.1l5.7-5.7a1.85 1.85 0 1 1 2.6 2.6L14.7 12c-.3.3-.7.5-1.1.6zM19 15v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
            <button v-if="block.type !== 'contact_form'" class="icon-button h-9 w-9 text-rose-600" type="button" :aria-label="t('common.delete')" @click="remove(block.id)">
              <ActivityDeleteIcon class="h-4.5 w-4.5" />
            </button>
          </div>
        </article>
      </div>

      <div class="relative mt-4" data-contact-add-menu>
        <button class="btn-secondary w-full gap-2" type="button" :aria-expanded="addMenuOpen" @click="addMenuOpen = !addMenuOpen">
          <span class="text-lg leading-none" aria-hidden="true">+</span>{{ t('serviceContacts.addBlock') }}
        </button>
        <Transition name="contact-add-menu">
        <div v-if="addMenuOpen" class="panel absolute bottom-[calc(100%+.6rem)] left-0 z-30 w-full p-3 shadow-xl">
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <button v-for="type in addTypes" :key="type" class="contact-palette-button flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm" :class="blockAccentClass(type)" type="button" @click="add(type)">
            <span class="contact-palette-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-current/25"><PageBlockIcon :type="blockIconType(type)" /></span><span class="truncate">{{ t(`serviceContacts.types.${type}`) }}</span>
          </button>
          </div>
        </div>
        </Transition>
      </div>
    </section>

    <aside class="min-w-0">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 class="font-semibold">{{ t('serviceContacts.livePreview') }}</h3>
        <div class="flex gap-2">
          <div class="inline-flex rounded-xl border border-[var(--ui-border)] p-1">
            <button v-for="locale in (['en','lv'] as const)" :key="locale" class="rounded-lg px-2 py-1 text-xs" :class="previewLocale === locale ? 'bg-[var(--ui-accent-soft)] text-[var(--ui-accent)]' : ''" type="button" @click="previewLocale = locale">{{ locale.toUpperCase() }}</button>
          </div>
          <div class="inline-flex rounded-xl border border-[var(--ui-border)] p-1">
            <button v-for="mode in (['desktop','mobile'] as const)" :key="mode" class="rounded-lg px-2 py-1 text-xs" :class="previewMode === mode ? 'bg-[var(--ui-accent-soft)] text-[var(--ui-accent)]' : ''" type="button" @click="previewMode = mode">{{ t(`pages.${mode}`) }}</button>
          </div>
        </div>
      </div>
      <div class="rounded-3xl border border-[var(--ui-border)] bg-[var(--ui-bg-alt)] p-3">
        <div class="mx-auto min-h-96 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-panel)] p-5 transition-[max-width]" :class="previewMode === 'mobile' ? 'max-w-[390px]' : 'max-w-none'">
          <ServiceContactsRenderer :config="modelValue" :locale="previewLocale" compact />
        </div>
      </div>
    </aside>

    <Teleport to="body">
    <div v-if="editing" class="fixed inset-0 z-[500] grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm" role="presentation">
      <section ref="dialog" tabindex="-1" class="panel my-auto max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-y-auto p-6 outline-none sm:p-8" role="dialog" aria-modal="true" :aria-label="t('serviceContacts.editBlock')">
        <div class="flex items-start justify-between gap-4"><div><p class="text-xs font-semibold uppercase tracking-[.15em] text-[var(--ui-accent)]">{{ t(`serviceContacts.types.${editing.type}`) }}</p><h3 class="mt-1 text-xl font-semibold">{{ t('serviceContacts.editBlock') }}</h3></div><button class="btn-secondary" type="button" @click="closeEditor">{{ t('common.close') }}</button></div>
        <div class="mt-6 grid gap-5 sm:grid-cols-2">
          <template v-if="editing.type === 'heading' || editing.type === 'contact_email' || editing.type === 'social_card' || editing.type === 'contact_form'">
            <div><span class="mb-2 block text-sm font-medium">{{ t('serviceContacts.titleEn') }}</span><RichTextEditor :model-value="editing.titleEn" :max-length="160" min-height-class="min-h-20" :aria-label="t('serviceContacts.titleEn')" @update:model-value="patchEditing('titleEn', $event)" /></div>
            <div><span class="mb-2 block text-sm font-medium">{{ t('serviceContacts.titleLv') }}</span><RichTextEditor :model-value="editing.titleLv" :max-length="160" min-height-class="min-h-20" :aria-label="t('serviceContacts.titleLv')" @update:model-value="patchEditing('titleLv', $event)" /></div>
          </template>
          <template v-if="editing.type === 'text'">
            <div><span class="mb-2 block text-sm font-medium">{{ t('serviceContacts.bodyEn') }}</span><RichTextEditor :model-value="editing.bodyEn" :max-length="4000" min-height-class="min-h-48" :aria-label="t('serviceContacts.bodyEn')" @update:model-value="patchEditing('bodyEn', $event)" /></div>
            <div><span class="mb-2 block text-sm font-medium">{{ t('serviceContacts.bodyLv') }}</span><RichTextEditor :model-value="editing.bodyLv" :max-length="4000" min-height-class="min-h-48" :aria-label="t('serviceContacts.bodyLv')" @update:model-value="patchEditing('bodyLv', $event)" /></div>
          </template>
          <label v-if="editing.type === 'contact_email'" class="sm:col-span-2"><span class="mb-2 block text-sm font-medium">{{ t('serviceContacts.email') }}</span><input class="input" type="email" :value="editing.email" maxlength="254" autocomplete="email" @input="patchEditing('email', ($event.target as HTMLInputElement).value)" /></label>
          <template v-if="editing.type === 'social_card'">
            <div><span class="mb-2 block text-sm font-medium">{{ t('serviceContacts.descriptionEn') }}</span><RichTextEditor :model-value="editing.descriptionEn" :max-length="300" min-height-class="min-h-28" :aria-label="t('serviceContacts.descriptionEn')" @update:model-value="patchEditing('descriptionEn', $event)" /></div>
            <div><span class="mb-2 block text-sm font-medium">{{ t('serviceContacts.descriptionLv') }}</span><RichTextEditor :model-value="editing.descriptionLv" :max-length="300" min-height-class="min-h-28" :aria-label="t('serviceContacts.descriptionLv')" @update:model-value="patchEditing('descriptionLv', $event)" /></div>
            <label class="sm:col-span-2"><span class="mb-2 block text-sm font-medium">{{ t('serviceContacts.url') }}</span><input class="input" type="url" placeholder="https://" :value="editing.url" maxlength="2048" @input="patchEditing('url', ($event.target as HTMLInputElement).value)" /></label>
          </template>
          <template v-if="editing.type === 'contact_form'">
            <div><span class="mb-2 block text-sm font-medium">{{ t('serviceContacts.descriptionEn') }}</span><RichTextEditor :model-value="editing.descriptionEn" :max-length="300" min-height-class="min-h-28" :aria-label="t('serviceContacts.descriptionEn')" @update:model-value="patchEditing('descriptionEn', $event)" /></div>
            <div><span class="mb-2 block text-sm font-medium">{{ t('serviceContacts.descriptionLv') }}</span><RichTextEditor :model-value="editing.descriptionLv" :max-length="300" min-height-class="min-h-28" :aria-label="t('serviceContacts.descriptionLv')" @update:model-value="patchEditing('descriptionLv', $event)" /></div>
            <p class="panel-muted p-4 text-sm text-[var(--ui-text-muted)] sm:col-span-2">{{ t('serviceSubmissions.controlledHelp') }}</p>
          </template>
        </div>
      </section>
    </div>
    </Teleport>
  </div>
</template>

<style scoped>
.block-editor-card { border-color:color-mix(in srgb,var(--block-accent) 34%,var(--ui-border)); border-left-width:4px; border-left-color:var(--block-accent); background:color-mix(in srgb,var(--block-accent) 7%,var(--ui-panel)); }
.block-editor-card:hover { border-color:color-mix(in srgb,var(--block-accent) 62%,var(--ui-border)); background:color-mix(in srgb,var(--block-accent) 10%,var(--ui-panel)); }
.block-editor-card:active { background:color-mix(in srgb,var(--block-accent) 13%,var(--ui-panel)); }
.block-editor-icon { border-color:color-mix(in srgb,var(--block-accent) 28%,var(--ui-border)); background:color-mix(in srgb,var(--block-accent) 10%,transparent); color:var(--block-accent); }
.service-contact-placeholder { position:relative; opacity:1!important; border:2px dashed var(--ui-accent)!important; background:color-mix(in srgb,var(--ui-accent) 8%,var(--ui-panel))!important; box-shadow:none!important; transform:none!important; }
.service-contact-placeholder>* { visibility:hidden; }
.service-contact-accent-heading { --block-accent:#ad8301; --contact-block-accent:#ad8301; }
.service-contact-accent-text { --block-accent:#205ea6; --contact-block-accent:#205ea6; }
.service-contact-accent-link { --block-accent:#24837b; --contact-block-accent:#24837b; }
.service-contact-accent-email { --block-accent:#ce5d97; --contact-block-accent:#ce5d97; }
.service-contact-accent-divider { --block-accent:#878580; --contact-block-accent:#878580; }
.service-contact-accent-form { --block-accent:var(--ui-accent); --contact-block-accent:var(--ui-accent); }
.contact-palette-icon { color:var(--contact-block-accent); background:color-mix(in srgb,var(--contact-block-accent) 10%,transparent); }
.contact-palette-button { color:var(--ui-text); border-color:color-mix(in srgb,var(--contact-block-accent) 30%,var(--ui-border)); background:color-mix(in srgb,var(--contact-block-accent) 7%,var(--ui-panel)); transition:border-color .15s ease,background-color .15s ease,color .15s ease; }
.contact-palette-button:hover,.contact-palette-button:focus-visible { color:var(--contact-block-accent); border-color:var(--contact-block-accent); outline:2px solid color-mix(in srgb,var(--contact-block-accent) 35%,transparent); outline-offset:1px; }
.contact-add-menu-enter-active,.contact-add-menu-leave-active { transition:opacity .16s ease,transform .16s ease; transform-origin:bottom; }
.contact-add-menu-enter-from,.contact-add-menu-leave-to { opacity:0; transform:translateY(7px) scale(.985); }
.icon-button:disabled { cursor:not-allowed; opacity:.35; }
@media (prefers-reduced-motion:reduce) { .block-editor-card,.contact-palette-button { transition:none; } }
</style>
