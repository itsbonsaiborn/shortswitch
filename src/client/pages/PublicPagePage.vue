<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import type { PageBlock, PublicPage } from '@/shared/types';
import { api } from '../lib/api';
import PageRenderer from '../components/PageRenderer.vue';

const route = useRoute();
const page = ref<PublicPage | null>(null);
const loading = ref(true);
const error = ref('');

const trackClick = (block: PageBlock) => {
  const eventId = crypto.randomUUID().replaceAll('-', '');
  const url = `/api/pages/public/${encodeURIComponent(String(route.params.slug))}/clicks`;
  const payload = JSON.stringify({ blockId: block.id, eventId });
  if (navigator.sendBeacon) {
    navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
    return;
  }
  void fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, keepalive: true });
};

onMounted(async () => {
  try {
    page.value = await api<PublicPage>(`/api/pages/public/${encodeURIComponent(String(route.params.slug))}`);
    document.title = page.value.title;
  } catch (caught) {
    error.value = (caught as Error).message || 'This Page is unavailable.';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="min-h-dvh">
    <div v-if="loading" class="flex min-h-dvh items-center justify-center bg-[#f8f8f6] px-6 text-center text-sm text-[#6f6f69]">Loading Page…</div>
    <div v-else-if="error || !page" class="flex min-h-dvh items-center justify-center bg-[#f8f8f6] px-6">
      <div class="max-w-md text-center">
        <p class="text-2xl font-semibold text-[#1f1f1d]">Page unavailable</p>
        <p class="mt-3 text-sm text-[#6f6f69]">{{ error }}</p>
      </div>
    </div>
    <PageRenderer v-else :page="page" @block-click="trackClick" />
  </div>
</template>
