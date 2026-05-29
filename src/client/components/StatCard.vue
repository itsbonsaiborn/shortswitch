<script setup lang="ts">
defineProps<{ label: string; value: string | number; hint?: string }>();
</script>

<template>
  <div class="panel p-5">
    <p class="text-sm text-slate-500 dark:text-slate-400">{{ label }}</p>
    <p class="mt-3 text-3xl font-semibold">{{ value }}</p>
    <p v-if="hint" class="mt-2 text-sm text-accent-600 dark:text-accent-300">{{ hint }}</p>
  </div>
</template>
