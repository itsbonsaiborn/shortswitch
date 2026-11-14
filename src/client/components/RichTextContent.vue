<script setup lang="ts">
import { computed } from 'vue';
import { renderRichTextHtml } from '@/shared/rich-text';

const props = withDefaults(defineProps<{ value: string; inline?: boolean }>(), { inline: false });
const safeHtml = computed(() => renderRichTextHtml(props.value));
</script>

<template>
  <!-- renderRichTextHtml escapes all input before applying the fixed formatting allowlist. -->
  <span v-if="inline" class="rich-text-content" v-html="safeHtml" />
  <div v-else class="rich-text-content" v-html="safeHtml" />
</template>

<style>
.rich-text-content{overflow-wrap:anywhere;word-break:break-word}
.rich-text-content sup,.rich-text-content sub{font-size:.72em;line-height:0}
</style>
