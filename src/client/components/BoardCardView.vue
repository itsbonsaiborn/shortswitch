<script setup lang="ts">
import { ref, watch } from 'vue';
import type { PublicBoardCard } from '@/shared/board-types';

const props = defineProps<{
  card: PublicBoardCard;
  imageFallbackLabel: string;
}>();

const imageFailed = ref(false);
watch(() => props.card.imageUrl, () => { imageFailed.value = false; });
</script>

<template>
  <article
    class="board-card-view flex min-w-0 flex-col overflow-hidden border"
    :class="[`board-card-layout-${card.layout}`]"
  >
    <slot name="top" />
    <div v-if="card.imageUrl" class="board-card-image aspect-video w-full overflow-hidden">
      <img
        v-if="!imageFailed"
        :src="card.imageUrl"
        :alt="card.title || imageFallbackLabel"
        class="h-full w-full object-cover"
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        @error="imageFailed = true"
      />
      <div v-else class="flex h-full items-center justify-center gap-2 px-4 text-center text-sm" role="status">
        <svg aria-hidden="true" class="h-5 w-5 shrink-0" viewBox="0 0 24 24"><path d="M3 5.75A2.75 2.75 0 0 1 5.75 3h12.5A2.75 2.75 0 0 1 21 5.75v12.5A2.75 2.75 0 0 1 18.25 21H5.75A2.75 2.75 0 0 1 3 18.25V5.75Zm1.5 0v9.69l3.43-3.43a2.25 2.25 0 0 1 3.18 0l1.31 1.31 2.47-2.47a2.25 2.25 0 0 1 3.18 0l1.43 1.43V5.75c0-.69-.56-1.25-1.25-1.25H5.75c-.69 0-1.25.56-1.25 1.25Zm15 8.65-2.49-2.49a.75.75 0 0 0-1.06 0l-2.47 2.47 2.12 2.12a.75.75 0 0 1-1.06 1.06l-4.49-4.49a.75.75 0 0 0-1.06 0L4.5 17.56v.69c0 .69.56 1.25 1.25 1.25h12.5c.69 0 1.25-.56 1.25-1.25V14.4ZM8.25 6.5a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5Z" fill="currentColor"/></svg>
        <span>{{ imageFallbackLabel }}</span>
      </div>
    </div>
    <div class="board-card-content min-w-0">
      <div class="flex min-w-0 items-start justify-between gap-3">
        <h2 v-if="card.title" class="min-w-0 font-semibold">{{ card.title }}</h2>
        <slot name="menu" />
      </div>
      <p class="board-card-body whitespace-pre-wrap text-[var(--ui-text-muted)]">{{ card.body }}</p>
      <slot name="meta" />
      <footer class="board-card-footer mt-auto border-t border-[var(--ui-border)]">
        <slot name="footer" />
      </footer>
    </div>
  </article>
</template>

<style scoped>
.board-card-view{background:var(--ui-panel);border-color:var(--ui-border);border-radius:var(--activity-radius,1.5rem);box-shadow:var(--activity-shadow,none);color:var(--ui-text)}
.board-card-image{background:var(--ui-panel-muted);color:var(--ui-text-muted)}
.board-card-content{display:flex;flex:1;flex-direction:column;padding:1.25rem}
.board-card-content h2,.board-card-body{overflow-wrap:anywhere;word-break:break-word}
.board-card-content h2{font-size:1.1rem;line-height:1.45}
.board-card-body{margin-top:.55rem;font-size:.925rem;line-height:1.65}
.board-card-footer{margin-top:1rem;padding-top:1rem}
.board-card-layout-compact .board-card-content{padding:1rem}
.board-card-layout-compact .board-card-content h2{font-size:1rem}
.board-card-layout-compact .board-card-body{font-size:.85rem;line-height:1.5}
@media (min-width:640px){.board-card-content{padding:1.4rem}}
</style>

