<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { PageBlock, PageDetail, PublicPage } from '@/shared/types';
import PageBlockRenderer from './PageBlockRenderer.vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  page: PublicPage | PageDetail;
  preview?: boolean;
  editorInteractive?: boolean;
  activeBlockId?: string | null;
}>();
const emit = defineEmits<{
  blockClick: [block: PageBlock];
  previewBlockEnter: [blockId: string];
  previewBlockLeave: [blockId: string];
  previewBlockActivate: [blockId: string];
}>();
const avatarFailed = ref(false);
const { t } = useI18n();

watch(() => props.page.avatarUrl, () => { avatarFailed.value = false; });
const visibleBlocks = computed(() => props.page.blocks.filter((block) => block.visible));
const rootClasses = computed(() => [`page-theme-${props.page.theme}`, `page-layout-${props.page.layout}`, `page-pattern-${props.page.backgroundPattern ?? 'none'}`]);
const rootStyle = computed(() => ({ '--page-pattern-opacity': String((props.page.patternIntensity ?? 35) / 100) }));

const eventBlockId = (target: EventTarget | null) => {
  if (!props.editorInteractive || !(target instanceof Element)) return null;
  return target.closest<HTMLElement>('[data-page-block-id]')?.dataset.pageBlockId ?? null;
};
const onBlockPointerOver = (event: PointerEvent) => {
  const blockId = eventBlockId(event.target);
  if (!blockId || blockId === eventBlockId(event.relatedTarget)) return;
  emit('previewBlockEnter', blockId);
};
const onBlockPointerOut = (event: PointerEvent) => {
  const blockId = eventBlockId(event.target);
  if (!blockId || blockId === eventBlockId(event.relatedTarget)) return;
  emit('previewBlockLeave', blockId);
};
const onBlockFocusIn = (event: FocusEvent) => {
  const blockId = eventBlockId(event.target);
  if (blockId) emit('previewBlockEnter', blockId);
};
const onBlockFocusOut = (event: FocusEvent) => {
  const blockId = eventBlockId(event.target);
  if (!blockId || blockId === eventBlockId(event.relatedTarget)) return;
  emit('previewBlockLeave', blockId);
};
const onBlockActivate = (event: MouseEvent) => {
  const blockId = eventBlockId(event.target);
  if (blockId) emit('previewBlockActivate', blockId);
};
</script>

<template>
  <div class="page-surface relative isolate min-h-dvh w-full overflow-x-hidden" :class="rootClasses" :style="rootStyle">
    <main class="relative z-[1] mx-auto flex w-full max-w-[480px] flex-col px-4 py-10 sm:px-6 sm:py-14">
      <header class="mb-8 text-center">
        <div class="mx-auto flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-[var(--page-border)] bg-[var(--page-card)] text-4xl shadow-sm">
          <img
            v-if="page.avatarUrl && !avatarFailed"
            :src="page.avatarUrl"
            alt=""
            class="h-full w-full object-cover"
            referrerpolicy="no-referrer"
            @error="avatarFailed = true"
          />
          <span v-else aria-hidden="true">{{ page.emoji || '✦' }}</span>
        </div>
        <h1 class="mt-5 break-words text-3xl font-bold tracking-tight">{{ page.title }}</h1>
        <p v-if="page.description" class="mt-3 whitespace-pre-line break-words text-sm leading-6 text-[var(--page-muted)]">{{ page.description }}</p>
      </header>

      <section
        class="space-y-3"
        :aria-label="t('pages.pageContent')"
        @pointerover="onBlockPointerOver"
        @pointerout="onBlockPointerOut"
        @focusin="onBlockFocusIn"
        @focusout="onBlockFocusOut"
        @click="onBlockActivate"
      >
        <PageBlockRenderer
          v-for="block in visibleBlocks"
          :key="block.id"
          :block="block"
          :preview="preview"
          :editor-interactive="editorInteractive"
          :active-block-id="activeBlockId"
          @block-click="emit('blockClick', $event)"
        />
      </section>

      <footer class="flex items-center justify-center gap-2 pt-12 text-center text-sm text-[var(--page-muted)]">
        <img :src="'/icons/favicon-32.png'" alt="" class="h-5 w-5 rounded-sm" />
        <span>{{ t('pages.poweredBy', { app: '' }).trim() }} <strong class="font-semibold text-[var(--page-text)]">ShortSwitch</strong></span>
      </footer>
    </main>
  </div>
</template>

<style scoped>
.page-surface {
  color: var(--page-text);
  background: var(--page-background);
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
}
.page-surface::before { content:""; position:absolute; inset:0; z-index:0; pointer-events:none; opacity:var(--page-pattern-opacity, .35); color:var(--page-accent); }
.page-pattern-none::before { display:none; }
.page-pattern-dots::before { background-image:radial-gradient(currentColor 1.35px, transparent 1.35px); background-size:20px 20px; }
.page-pattern-grid::before { background-image:linear-gradient(currentColor 1px, transparent 1px),linear-gradient(90deg,currentColor 1px,transparent 1px); background-size:28px 28px; }
.page-pattern-waves::before { background-image:repeating-radial-gradient(ellipse at 0 50%,transparent 0 18px,currentColor 19px 20px,transparent 21px 39px); background-size:120px 82px; }
.page-pattern-soft_glow::before { background-image:radial-gradient(circle at 12% 18%,currentColor 0,transparent 35%),radial-gradient(circle at 88% 72%,currentColor 0,transparent 38%); filter:blur(18px); }
.page-pattern-contours::before { background-image:repeating-radial-gradient(ellipse at 25% 38%,transparent 0 15px,currentColor 16px 17px,transparent 18px 34px); background-size:190px 150px; }
.page-pattern-crosses::before { background-image:linear-gradient(90deg,transparent 7px,currentColor 7px 13px,transparent 13px),linear-gradient(transparent 7px,currentColor 7px 13px,transparent 13px); background-size:24px 24px; background-position:0 10px,10px 0; }
.page-theme-classic_cream { --page-background:#f7f0df; --page-text:#28211b; --page-muted:#75685c; --page-accent:#c7662e; --page-card:#fffaf0; --page-border:#dfd1bd; }
.page-theme-forest_dark { --page-background:#14211b; --page-text:#f0f4e8; --page-muted:#a9b8a9; --page-accent:#9db55f; --page-card:#1d3027; --page-border:#365044; }
.page-theme-soft_lavender { --page-background:#f1edfa; --page-text:#302842; --page-muted:#746987; --page-accent:#8067b1; --page-card:#faf8ff; --page-border:#d7cee8; }
.page-theme-ocean_blue { --page-background:#eaf5f8; --page-text:#18333c; --page-muted:#5d7780; --page-accent:#287d91; --page-card:#f7fdff; --page-border:#c5dfe5; }
.page-theme-minimal_light { --page-background:#f8f8f6; --page-text:#1f1f1d; --page-muted:#6f6f69; --page-accent:#2f6f62; --page-card:#fff; --page-border:#deded8; }
.page-layout-classic { --page-radius:1rem; --page-shadow:0 5px 16px rgba(0,0,0,.045); }
.page-layout-minimal { --page-radius:.45rem; --page-shadow:none; }
.page-layout-soft { --page-radius:1.6rem; --page-shadow:0 8px 24px rgba(58,42,75,.08); }
.page-layout-bold { --page-radius:.8rem; --page-shadow:4px 4px 0 var(--page-border); }
</style>
