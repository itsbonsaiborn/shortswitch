<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue';

const PublicLivePage = defineAsyncComponent(() => import('./PublicLivePage.vue'));
const PublicPagePage = defineAsyncComponent(() => import('./PublicPagePage.vue'));
const resourceType = computed(() =>
  typeof document === 'undefined'
    ? 'live'
    : document.querySelector('meta[name="shortswitch-resource-type"]')?.getAttribute('content') || 'live'
);
</script>

<template>
  <PublicPagePage v-if="resourceType === 'page'" />
  <PublicLivePage v-else />
</template>
