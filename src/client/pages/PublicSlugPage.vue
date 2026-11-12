<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue';

const PublicLivePage = defineAsyncComponent(() => import('./PublicLivePage.vue'));
const PublicPagePage = defineAsyncComponent(() => import('./PublicPagePage.vue'));
const PublicActivityPage = defineAsyncComponent(() => import('./PublicActivityPage.vue'));
const PublicBoardPage = defineAsyncComponent(() => import('./PublicBoardPage.vue'));
const resourceType = computed(() =>
  typeof document === 'undefined'
    ? 'live'
    : document.querySelector('meta[name="shortswitch-resource-type"]')?.getAttribute('content') || 'live'
);
</script>

<template>
  <PublicPagePage v-if="resourceType === 'page'" />
  <PublicActivityPage v-else-if="resourceType === 'activity'" />
  <PublicBoardPage v-else-if="resourceType === 'board'" />
  <PublicLivePage v-else />
</template>
