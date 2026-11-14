<script setup lang="ts">
import { computed, ref, watch } from 'vue';

const props = defineProps<{
  href?: string | null;
  emoji?: string | null;
}>();

const faviconFailed = ref(false);
const favicon = computed(() => {
  if (!props.href || faviconFailed.value) return null;
  const baseUrl = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  try { return `${new URL(props.href, baseUrl).origin}/favicon.ico`; }
  catch { return null; }
});

watch(() => props.href, () => { faviconFailed.value = false; });
</script>

<template>
  <span class="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--page-border)] bg-white/85">
    <img v-if="favicon" :src="favicon" alt="" data-page-favicon class="h-5 w-5 object-contain" referrerpolicy="no-referrer" @error="faviconFailed = true" />
    <span v-else-if="emoji" class="text-lg" aria-hidden="true">{{ emoji }}</span>
    <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0h24v24H0z" fill="none"/><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M13.544 10.456a4.37 4.37 0 0 0-6.176 0l-3.089 3.088a4.367 4.367 0 1 0 6.177 6.177L12 18.177"/><path d="M10.456 13.544a4.37 4.37 0 0 0 6.176 0l3.089-3.088a4.367 4.367 0 1 0-6.177-6.177L12 5.823"/></g></svg>
  </span>
</template>
