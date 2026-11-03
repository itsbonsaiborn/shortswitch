<script setup lang="ts">
import { reactive } from 'vue';
import type { ActivityBackgroundPattern, ActivityLayout, ActivitySlide, ActivityTheme } from '@/shared/activity-types';
import ActivityImageLabelingInput from './ActivityImageLabelingInput.vue';
import ActivityMatchingInput from './ActivityMatchingInput.vue';
import ActivityOrderingInput from './ActivityOrderingInput.vue';
import { formatActivityNumber } from '../lib/activity-results';

const props = defineProps<{ slide: ActivitySlide | null; activityTitle: string; mode: 'desktop' | 'mobile'; standalone?: boolean; theme?: ActivityTheme; layout?: ActivityLayout; backgroundPattern?: ActivityBackgroundPattern; patternIntensity?: number }>();
const imageAnswers = reactive<Record<string, Array<{ markerId: string; labelId: string }>>>({});
const singleAnswers = reactive<Record<string, string>>({});
const multipleAnswers = reactive<Record<string, string[]>>({});
const textAnswers = reactive<Record<string, string>>({});
const orderingAnswers = reactive<Record<string, string[]>>({});
const matchingAnswers = reactive<Record<string, Array<{ leftId: string; rightId: string }>>>({});
const toggleMultiple = (blockId: string, optionId: string) => {
  const current = multipleAnswers[blockId] ?? [];
  multipleAnswers[blockId] = current.includes(optionId)
    ? current.filter((id) => id !== optionId)
    : [...current, optionId];
};
</script>

<template>
  <div class="activity-surface mx-auto flex w-full flex-col overflow-hidden border border-[var(--ui-border)] transition-[max-width]" :class="[standalone ? 'min-h-[calc(100dvh-10.5rem)]' : 'min-h-[560px]', mode === 'mobile' ? 'max-w-[390px]' : standalone ? 'max-w-none' : 'max-w-[960px]', `activity-theme-${theme ?? 'minimal_light'}`, `activity-layout-${layout ?? 'classic'}`, `activity-pattern-${backgroundPattern ?? 'none'}`]" :style="{ borderRadius: 'var(--activity-radius)', boxShadow: 'var(--activity-shadow)', '--activity-pattern-opacity': String((props.patternIntensity ?? 35) / 100) }">
    <div class="border-b border-[var(--ui-border)] px-5 py-4">
      <p class="text-xs font-semibold uppercase tracking-[.24em] text-[var(--ui-accent)]">{{ activityTitle || 'Activity' }}</p>
      <p v-if="slide" class="mt-1 text-sm text-[var(--ui-text-muted)]">Slide {{ slide.position + 1 }}</p>
    </div>
    <div v-if="slide" class="app-scrollbar flex-1 space-y-4 overflow-y-auto p-5 sm:p-7">
      <div>
        <h2 class="text-2xl font-semibold">{{ slide.title || `Slide ${slide.position + 1}` }}</h2>
        <p v-if="slide.description" class="mt-2 text-sm leading-6 text-[var(--ui-text-muted)]">{{ slide.description }}</p>
      </div>
      <template v-for="block in slide.blocks" :key="block.id">
        <h2 v-if="block.type === 'heading'" :class="block.config.level === 1 ? 'text-3xl' : block.config.level === 2 ? 'text-2xl' : 'text-xl'" class="font-semibold">{{ block.config.text }}</h2>
        <p v-else-if="block.type === 'text'" class="whitespace-pre-wrap leading-7">{{ block.config.text }}</p>
        <figure v-else-if="block.type === 'image'" class="overflow-hidden rounded-2xl border border-[var(--ui-border)]">
          <img :src="block.config.url" :alt="block.config.alt" class="max-h-72 w-full object-cover" />
          <figcaption v-if="block.config.caption" class="px-4 py-3 text-sm text-[var(--ui-text-muted)]">{{ block.config.caption }}</figcaption>
        </figure>
        <hr v-else-if="block.type === 'divider'" class="border-[var(--ui-border)]" :class="block.config.style === 'dashed' ? 'border-dashed' : block.config.style === 'dotted' ? 'border-dotted' : ''" />
        <section v-else class="activity-themed-card rounded-3xl border border-[var(--ui-border)] bg-[var(--ui-panel)] p-5">
          <div class="flex items-start justify-between gap-3">
            <h3 class="text-lg font-semibold">{{ block.config.prompt }}</h3>
            <span class="rounded-full bg-[var(--ui-accent-soft)] px-2.5 py-1 text-xs text-[var(--ui-accent)]">{{ formatActivityNumber(block.points) }} pt</span>
          </div>
          <p v-if="(block.questionType === 'single_choice' || block.questionType === 'multiple_choice') && block.config.description" class="mt-2 text-sm leading-6 text-[var(--ui-text-muted)]">{{ block.config.description }}</p>
          <div v-if="block.questionType === 'single_choice' || block.questionType === 'multiple_choice'" class="mt-4 space-y-2">
            <label v-for="option in block.config.options" :key="option.id" class="flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition-colors" :class="(block.questionType === 'single_choice' ? singleAnswers[block.id] === option.id : (multipleAnswers[block.id] ?? []).includes(option.id)) ? 'border-[var(--ui-accent)] bg-[var(--ui-accent-soft)]' : 'border-[var(--ui-border)] hover:border-[var(--ui-accent)]'">
              <input v-if="block.questionType === 'single_choice'" v-model="singleAnswers[block.id]" type="radio" :name="`preview-${block.id}`" :value="option.id" class="text-[var(--ui-accent)]" />
              <input v-else type="checkbox" :checked="(multipleAnswers[block.id] ?? []).includes(option.id)" class="text-[var(--ui-accent)]" @change="toggleMultiple(block.id, option.id)" />
              <span>{{ option.label }}</span>
            </label>
          </div>
          <div v-else-if="block.questionType === 'open_answer'" class="mt-4"><p v-if="block.config.instructions" class="mb-3 text-sm text-[var(--ui-text-muted)]">{{ block.config.instructions }}</p><input v-if="block.config.responseMode === 'single_line'" v-model="textAnswers[block.id]" class="input" placeholder="Your answer" /><textarea v-else v-model="textAnswers[block.id]" class="input min-h-24" placeholder="Your answer"></textarea></div>
          <div v-else-if="block.questionType === 'word_cloud'" class="mt-4"><p v-if="block.config.instructions" class="mb-3 text-sm text-[var(--ui-text-muted)]">{{ block.config.instructions }}</p><input v-model="textAnswers[block.id]" class="input" placeholder="Short response" /></div>
          <ActivityOrderingInput v-else-if="block.questionType === 'ordering'" class="mt-4" :items="block.config.items" :model-value="orderingAnswers[block.id] ?? []" @update:model-value="orderingAnswers[block.id] = $event" />
          <ActivityMatchingInput v-else-if="block.questionType === 'matching'" class="mt-4" :left-items="block.config.leftItems" :right-items="block.config.rightItems" :pairs="matchingAnswers[block.id] ?? []" @update:pairs="matchingAnswers[block.id] = $event" />
          <ActivityImageLabelingInput v-else-if="block.questionType === 'image_labeling'" class="mt-4" :image-url="block.config.imageUrl" :image-alt="block.config.imageAlt" :markers="block.config.markers" :labels="block.config.labels" :one-to-one="block.config.oneToOne" :assignments="imageAnswers[block.id] ?? []" @update:assignments="imageAnswers[block.id] = $event" />
          <div v-else class="mt-4 rounded-2xl bg-[var(--ui-panel-muted)] p-4 text-sm text-[var(--ui-text-muted)]">Question preview is not available.</div>
        </section>
      </template>
      <div v-if="slide.blocks.length === 0" class="rounded-3xl border border-dashed border-[var(--ui-border)] p-10 text-center text-sm text-[var(--ui-text-muted)]">This slide has no blocks yet.</div>
    </div>
    <div v-else class="flex flex-1 items-center justify-center p-10 text-sm text-[var(--ui-text-muted)]">Add a slide to start the preview.</div>
  </div>
</template>
