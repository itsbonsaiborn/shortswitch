<script setup lang="ts">
import { computed } from 'vue';
import type { BoardSettings, BoardThemeReference, PublicBoardCard } from '@/shared/board-types';
import { boardSurfaceClasses, boardSurfaceStyle } from '../lib/board-theme';
import BoardCardView from './BoardCardView.vue';

const props = defineProps<{
  theme: BoardThemeReference | null;
  settings: Pick<BoardSettings, 'visualStyle' | 'backgroundPattern' | 'patternIntensity'>;
  title: string;
  description: string;
  sampleTitle: string;
  sampleBody: string;
  imageFallbackLabel: string;
}>();

const classes = computed(() => boardSurfaceClasses(props.theme, props.settings));
const style = computed(() => boardSurfaceStyle(props.settings.patternIntensity));
const sampleCard = computed<PublicBoardCard>(() => ({
  id: 'board-theme-preview',
  title: props.sampleTitle,
  body: props.sampleBody,
  imageUrl: null,
  authorDisplayName: null,
  layout: 'text',
  moderationStatus: 'approved',
  publishedAt: null,
  createdAt: '',
  updatedAt: '',
  position: { x: 0, y: 0, width: 280, height: 180, zIndex: 0, revision: 0, updatedAt: '' },
  owned: false,
  reactions: { likes: 12, dislikes: 2, current: 'like' }
}));
</script>

<template>
  <div :class="classes" :style="style" class="board-theme-preview overflow-hidden border border-[var(--ui-border)] p-5 sm:p-6">
    <header>
      <p class="text-xs font-semibold uppercase tracking-[.18em] text-[var(--ui-accent)]">{{ title }}</p>
      <p class="mt-1 text-sm text-[var(--ui-text-muted)]">{{ description }}</p>
    </header>
    <div class="mt-4 grid max-w-sm gap-3">
      <BoardCardView :card="sampleCard" :image-fallback-label="imageFallbackLabel">
        <template #footer>
          <div class="flex items-center gap-2 text-sm text-[var(--ui-text-muted)]">
            <span class="preview-reaction"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 10v12H3V10h4Zm4.3 12H9V10.4l3.6-7.2c.2-.4.6-.7 1.1-.7 1.2 0 2.1 1 2 2.2l-.4 3.3H20c1.2 0 2.1 1.1 1.8 2.3l-2 9A3.5 3.5 0 0 1 16.4 22h-5.1Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg>12</span>
            <span class="preview-reaction"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 14V2H3v12h4Zm4.3-12H9v11.6l3.6 7.2c.2.4.6.7 1.1.7 1.2 0 2.1-1 2-2.2l-.4-3.3H20c1.2 0 2.1-1.1 1.8-2.3l-2-9A3.5 3.5 0 0 0 16.4 2h-5.1Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg>2</span>
          </div>
        </template>
      </BoardCardView>
    </div>
  </div>
</template>

<style scoped>
.board-theme-preview{min-height:19rem;border-radius:var(--activity-radius,1.5rem);background:linear-gradient(180deg,var(--ui-bg),var(--ui-bg-alt));color:var(--ui-text)}
.preview-reaction{display:inline-flex;min-width:3.7rem;min-height:2.5rem;align-items:center;justify-content:center;gap:.4rem;border:1px solid var(--ui-border);border-radius:.8rem;font-variant-numeric:tabular-nums}.preview-reaction:first-child{border-color:var(--ui-accent);background:var(--ui-accent-soft);color:var(--ui-accent)}.preview-reaction svg{height:1.1rem;width:1.1rem}
</style>
