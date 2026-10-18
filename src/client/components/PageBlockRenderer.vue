<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { PageBlock, PageNestedBlock } from '@/shared/types';

defineOptions({ name: 'PageBlockRenderer' });
const props = defineProps<{
  block: PageBlock;
  preview?: boolean;
  editorInteractive?: boolean;
  activeBlockId?: string | null;
}>();
const emit = defineEmits<{ blockClick: [block: PageBlock] }>();
const { t } = useI18n();
const imageFailed = ref(false);
const faviconFailed = ref(false);

const headingClass = computed(() => ({ small: 'text-lg', medium: 'text-xl', large: 'text-2xl' })[props.block.config.size ?? 'medium']);
const alignmentClass = computed(() => ({ left: 'text-left', center: 'text-center', right: 'text-right' })[props.block.config.alignment ?? 'left']);
const spacerClass = computed(() => ({ small: 'h-3', medium: 'h-7', large: 'h-12' })[props.block.config.spacing ?? 'medium']);
const href = computed(() => {
  if (props.block.type === 'link') return props.block.config.url ?? null;
  if (props.block.type === 'existing_link' || props.block.type === 'live_activity') return props.block.href ?? null;
  if (props.block.type === 'email') return props.block.config.email ? `mailto:${props.block.config.email}` : null;
  return null;
});
const favicon = computed(() => {
  if (!href.value || props.block.type === 'email' || faviconFailed.value) return null;
  const baseUrl = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  try { return `${new URL(href.value, baseUrl).origin}/favicon.ico`; }
  catch { return null; }
});
const target = computed(() => props.block.config.openInNewTab ? '_blank' : undefined);
const children = computed(() => (props.block.config.children ?? []).filter((child) => child.visible).map(asPageBlock));
const editorInteractionClasses = computed(() => props.editorInteractive
  ? ['page-preview-editor-block', props.activeBlockId === props.block.id ? 'page-preview-editor-block-active' : '']
  : []);

function asPageBlock(child: PageNestedBlock, index: number): PageBlock {
  return {
    id: child.id, type: child.type, config: child.config, visible: child.visible, position: index,
    createdAt: '', updatedAt: '', href: child.href, available: child.available
  };
}
const activate = (event: MouseEvent) => {
  if (props.preview || !href.value) event.preventDefault();
  if (!props.preview && href.value) emit('blockClick', props.block);
};
watch([() => props.block.config.url, () => props.block.href], () => { faviconFailed.value = false; imageFailed.value = false; });
</script>

<template>
  <h2 v-if="block.type === 'heading'" class="break-words pt-4 font-semibold" :class="[headingClass, alignmentClass, editorInteractionClasses]" :data-page-block-id="editorInteractive ? block.id : undefined">{{ block.config.text }}</h2>
  <p v-else-if="block.type === 'text'" class="whitespace-pre-line break-words text-sm leading-6 text-[var(--page-text)]" :class="[alignmentClass, editorInteractionClasses]" :data-page-block-id="editorInteractive ? block.id : undefined">{{ block.config.text }}</p>

  <a
    v-else-if="['link', 'existing_link', 'live_activity'].includes(block.type)"
    class="page-action group flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left"
    :class="[!href || block.available === false ? 'cursor-not-allowed opacity-55' : '', editorInteractionClasses]"
    :data-page-block-id="editorInteractive ? block.id : undefined"
    :href="href || undefined" :target="target" :rel="target ? 'noopener noreferrer' : undefined" @click="activate"
  >
    <span class="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--page-border)] bg-white/85">
      <img v-if="favicon" :src="favicon" alt="" data-page-favicon class="h-5 w-5 object-contain" referrerpolicy="no-referrer" @error="faviconFailed = true" />
      <span v-else-if="block.config.emoji" class="text-lg" aria-hidden="true">{{ block.config.emoji }}</span>
      <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M13.544 10.456a4.37 4.37 0 0 0-6.176 0l-3.089 3.088a4.367 4.367 0 1 0 6.177 6.177L12 18.177"/><path d="M10.456 13.544a4.37 4.37 0 0 0 6.176 0l3.089-3.088a4.367 4.367 0 1 0-6.177-6.177L12 5.823"/></g></svg>
    </span>
    <span class="min-w-0 flex-1"><span class="block break-words font-semibold">{{ block.config.title || t('pages.untitledLink') }}</span><span v-if="block.config.subtitle" class="mt-0.5 block break-words text-xs text-[var(--page-muted)]">{{ block.config.subtitle }}</span><span v-if="block.available === false" class="mt-0.5 block text-xs text-[var(--page-muted)]">{{ t('pages.contentUnavailable') }}</span></span>
    <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="h-5 w-5 shrink-0 opacity-55 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 6L6 18M8 6h10v10"/></svg>
  </a>

  <a
    v-else-if="block.type === 'email'" :href="href || undefined"
    :class="[block.config.style === 'text' ? 'group inline-flex items-center gap-2 break-all text-sm font-medium underline underline-offset-4' : 'page-action group flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 font-semibold', editorInteractionClasses]"
    :data-page-block-id="editorInteractive ? block.id : undefined"
    @click="activate"
  >
    <span class="flex min-w-0 items-center gap-3"><span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--page-border)] bg-white/85"><svg xmlns="http://www.w3.org/2000/svg" data-page-email-icon class="h-5 w-5" viewBox="0 0 32 32"><path d="M0 0h32v32H0z" fill="none"/><path fill="currentColor" d="M28 6H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2m-2.2 2L16 14.78L6.2 8ZM4 24V8.91l11.43 7.91a1 1 0 0 0 1.14 0L28 8.91V24Z"/></svg></span><span class="truncate">{{ block.config.label || block.config.email }}</span></span>
    <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="h-5 w-5 shrink-0 opacity-55 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 6L6 18M8 6h10v10"/></svg>
  </a>

  <div v-else-if="block.type === 'divider'" :class="[spacerClass, editorInteractionClasses]" :data-page-block-id="editorInteractive ? block.id : undefined" :aria-hidden="editorInteractive ? undefined : true" class="flex items-center"><div class="w-full border-t border-[var(--page-border)]" :style="{ borderTopStyle: block.config.style || 'solid' }" /></div>
  <div v-else-if="block.type === 'spacer'" :class="[spacerClass, editorInteractionClasses]" :data-page-block-id="editorInteractive ? block.id : undefined" :aria-hidden="editorInteractive ? undefined : true" />
  <figure v-else-if="block.type === 'image' && !imageFailed" :class="[alignmentClass, editorInteractionClasses]" :data-page-block-id="editorInteractive ? block.id : undefined" class="overflow-hidden">
    <img :src="block.config.url" :alt="block.config.alt || ''" loading="lazy" decoding="async" referrerpolicy="no-referrer" class="inline-block h-auto max-w-full rounded-[var(--page-radius)] border border-[var(--page-border)] object-contain" @error="imageFailed = true" />
    <figcaption v-if="block.config.caption" class="mt-2 text-xs text-[var(--page-muted)]">{{ block.config.caption }}</figcaption>
  </figure>

  <div v-else-if="block.type === 'double'" data-page-double :data-page-block-id="editorInteractive ? block.id : undefined" class="grid items-stretch gap-3" :class="[children.length === 1 ? 'grid-cols-1' : 'grid-cols-2', editorInteractionClasses]">
    <PageBlockRenderer v-for="child in children" :key="child.id" :block="child" :preview="preview" :editor-interactive="editorInteractive" :active-block-id="activeBlockId" @block-click="emit('blockClick', $event)" />
  </div>
</template>

<style>
.page-action { border:1px solid var(--page-border); border-radius:var(--page-radius); background:var(--page-card); color:var(--page-text); box-shadow:var(--page-shadow); transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease; }
.page-action:hover { transform:translateY(-1px); border-color:var(--page-accent); }
.page-action:focus-visible { outline:3px solid color-mix(in srgb,var(--page-accent) 42%,transparent); outline-offset:2px; }
.page-layout-bold .page-action { border-width:2px; font-size:1.05rem; }
.page-preview-editor-block { cursor:pointer; outline:2px solid transparent; outline-offset:-2px; transition:outline-color .15s ease,transform .18s ease,border-color .18s ease,box-shadow .18s ease; }
.page-preview-editor-block-active { outline-color:color-mix(in srgb,var(--page-accent) 78%,transparent); }
</style>
