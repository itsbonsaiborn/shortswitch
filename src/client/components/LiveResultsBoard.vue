<script setup lang="ts">
import { computed } from 'vue';
import type { LiveActivitySummary, LiveResultsSnapshot, PublicLiveActivity } from '@/shared/types';

const props = defineProps<{
  activity: Pick<LiveActivitySummary | PublicLiveActivity, 'type' | 'scaleMin' | 'scaleMax'>;
  results: LiveResultsSnapshot;
  presentation?: boolean;
}>();

const maxChoice = computed(() => Math.max(1, ...props.results.choices.map((choice) => choice.count)));
const maxScale = computed(() => Math.max(1, ...(props.results.scale?.distribution.map((item) => item.count) ?? [1])));
const maxWord = computed(() => Math.max(1, ...props.results.wordCloud.map((word) => word.count)));
const wordColorClasses = [
  'text-[#AF3029] dark:text-[#F89A8A]',
  'text-[#BC5215] dark:text-[#F9AE77]',
  'text-[#AD8301] dark:text-[#ECCB60]',
  'text-[#66800B] dark:text-[#BEC97E]',
  'text-[#24837B] dark:text-[#87D3C3]',
  'text-[#205EA6] dark:text-[#92BFDB]',
  'text-[#5E409D] dark:text-[#CEB1BE]',
  'text-[#A02F6F] dark:text-[#EEB1C1]'
];
const wordColorClass = (text: string) => {
  let hash = 2_166_136_261;
  for (const character of text.normalize('NFKC').toLocaleLowerCase()) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return wordColorClasses[(hash >>> 0) % wordColorClasses.length];
};
const wordHash = (text: string) => {
  let hash = 0;
  for (const character of text.normalize('NFKC').toLocaleLowerCase()) {
    hash = Math.imul(hash, 31) + (character.codePointAt(0) ?? 0);
  }
  return hash >>> 0;
};
const wordStyle = (text: string, count: number) => {
  const popularitySize = (props.presentation ? 1.4 : 1) + (count / maxWord.value) * (props.presentation ? 3.8 : 2.1);
  const lengthFactor = text.length > 18 ? Math.max(0.46, Math.sqrt(18 / text.length)) : 1;
  const rotation = text.length <= 20 ? [-5, 0, 4, 0][wordHash(text) % 4] : 0;
  return {
    fontSize: `${Math.max(props.presentation ? 1.15 : 0.95, popularitySize * lengthFactor)}rem`,
    transform: `rotate(${rotation}deg)`
  };
};
</script>

<template>
  <div class="min-w-0">
    <div v-if="results.responseCount === 0" class="panel-muted px-6 py-12 text-center">
      <p class="text-lg font-semibold">No published responses yet</p>
      <p class="mt-2 text-sm text-[var(--ui-text-muted)]">Responses may still be arriving or waiting for moderation.</p>
    </div>

    <div v-else-if="activity.type === 'open_answer'" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <article v-for="answer in results.openAnswers" :key="answer.id" class="panel-muted p-5">
        <p :class="presentation ? 'text-2xl leading-relaxed' : 'text-base leading-relaxed'">{{ answer.text }}</p>
        <div class="mt-4 flex flex-wrap gap-2 text-xs text-[var(--ui-text-muted)]">
          <span v-if="answer.participantName">{{ answer.participantName }}</span>
          <span v-if="answer.editedByModerator" class="rounded-full bg-[var(--ui-pill-bg)] px-2 py-1">Edited by moderator</span>
        </div>
      </article>
    </div>

    <div v-else-if="activity.type === 'word_cloud'" class="panel-muted flex min-h-[18rem] min-w-0 flex-wrap items-center justify-center gap-x-4 gap-y-4 overflow-hidden p-4 text-center sm:gap-x-6 sm:p-8">
      <span
        v-for="word in results.wordCloud"
        :key="word.text.toLocaleLowerCase()"
        class="max-w-full whitespace-normal break-words px-1 py-1 font-semibold leading-tight transition-all [overflow-wrap:anywhere]"
        :class="wordColorClass(word.text)"
        :style="wordStyle(word.text, word.count)"
        :title="`${word.count} responses`"
        data-word-cloud-item
      >{{ word.text }}</span>
    </div>

    <div v-else-if="activity.type === 'multiple_choice'" class="space-y-4">
      <div v-for="choice in results.choices" :key="choice.id" class="panel-muted overflow-hidden p-4">
        <div class="mb-2 flex items-center justify-between gap-4">
          <span class="font-medium">{{ choice.label }}</span>
          <span class="text-sm text-[var(--ui-text-muted)]">{{ choice.count }} · {{ choice.percentage }}%</span>
        </div>
        <div class="h-3 overflow-hidden rounded-full bg-[var(--ui-pill-bg)]">
          <div class="h-full rounded-full bg-[var(--ui-accent)] transition-all" :style="{ width: `${(choice.count / maxChoice) * 100}%` }" />
        </div>
      </div>
    </div>

    <div v-else-if="activity.type === 'scale'" class="space-y-5">
      <div class="panel-muted p-6 text-center">
        <p class="text-sm uppercase tracking-[0.2em] text-[var(--ui-text-muted)]">Average</p>
        <p :class="presentation ? 'mt-3 text-7xl font-semibold' : 'mt-3 text-5xl font-semibold'">{{ results.scale?.average ?? '—' }}</p>
      </div>
      <div data-scale-results class="grid min-w-0 items-end gap-1 sm:gap-2" :style="{ gridTemplateColumns: `repeat(${results.scale?.distribution.length ?? 1}, minmax(0, 1fr))` }">
        <div v-for="item in results.scale?.distribution" :key="item.value" class="flex min-w-0 flex-col items-center gap-2">
          <span class="max-w-full truncate text-[0.65rem] tabular-nums text-[var(--ui-text-muted)] sm:text-xs">{{ item.count }}</span>
          <div class="h-32 w-full min-w-0 overflow-hidden rounded-t-md bg-[var(--ui-pill-bg)] sm:h-40 sm:rounded-t-xl">
            <div class="mt-auto h-full origin-bottom rounded-t-md bg-[var(--ui-accent)] transition-transform sm:rounded-t-xl" :style="{ transform: `scaleY(${item.count / maxScale})` }" />
          </div>
          <span class="max-w-full text-xs font-medium tabular-nums sm:text-base">{{ item.value }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
