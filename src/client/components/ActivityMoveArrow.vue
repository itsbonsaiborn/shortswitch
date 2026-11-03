<script setup lang="ts">
defineProps<{ direction: 'up' | 'down' }>();
</script>

<template>
  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 1024 1024" aria-hidden="true">
    <path d="M0 0h1024v1024H0z" fill="none" />
    <path v-if="direction === 'up'" fill="currentColor" d="M858.9 689L530.5 308.2c-9.4-10.9-27.5-10.9-37 0L165.1 689c-12.2 14.2-1.2 35 18.5 35h656.8c19.7 0 30.7-20.8 18.5-35" />
    <path v-else fill="currentColor" d="M840.4 300H183.6c-19.7 0-30.7 20.8-18.5 35l328.4 380.8c9.4 10.9 27.5 10.9 37 0L858.9 335c12.2-14.2 1.2-35-18.5-35" />
  </svg>
</template>
