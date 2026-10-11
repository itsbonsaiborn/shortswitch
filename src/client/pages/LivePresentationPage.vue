<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import QRCode from 'qrcode';
import { api } from '../lib/api';
import { applyLiveResultsDelta } from '../lib/live-results';
import { useTheme } from '../composables/useTheme';
import LiveResultsBoard from '../components/LiveResultsBoard.vue';
import type { LiveResultsDelta, LiveResultsSnapshot, PublicLiveActivity } from '@/shared/types';

useTheme();
const route = useRoute();
const activity = ref<PublicLiveActivity | null>(null);
const qr = ref('');
const error = ref('');
let events: EventSource | null = null;
const exitPresentation = () => {
  window.close();
  if (!window.closed && activity.value) window.location.assign(activity.value.publicUrl);
};
onMounted(async () => {
  try {
    activity.value = await api<PublicLiveActivity>(`/api/live/public/${encodeURIComponent(String(route.params.slug))}/presentation`);
    if (!activity.value.results) throw new Error('Presentation results are unavailable.');
    qr.value = await QRCode.toDataURL(activity.value.publicUrl, { width: 280, margin: 1 });
    events = new EventSource(`/api/live/public/${encodeURIComponent(activity.value.slug)}/presentation/events?protocol=2`);
    events.addEventListener('snapshot', (event) => {
      if (activity.value) activity.value.results = JSON.parse((event as MessageEvent).data) as LiveResultsSnapshot;
    });
    events.addEventListener('delta', (event) => {
      if (!activity.value?.results) return;
      const next = applyLiveResultsDelta(activity.value.results, JSON.parse((event as MessageEvent).data) as LiveResultsDelta);
      if (next) activity.value.results = next;
      else window.location.reload();
    });
  } catch (err) { error.value = (err as Error).message; }
});
onBeforeUnmount(() => events?.close());
</script>

<template>
  <main class="min-h-dvh p-5 lg:p-8">
    <div v-if="error" class="panel mx-auto max-w-xl p-8 text-center">{{ error }}</div>
    <div v-else-if="activity?.results" class="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-[1800px] flex-col gap-6">
      <header class="panel flex flex-col gap-5 p-6 md:flex-row md:items-center md:justify-between"><div class="min-w-0"><p class="text-sm font-semibold uppercase tracking-[0.28em] text-[var(--ui-accent)]">Live results</p><h1 class="mt-2 text-4xl font-semibold lg:text-6xl">{{ activity.title }}</h1><p class="mt-3 text-xl text-[var(--ui-text-muted)] lg:text-3xl">{{ activity.question }}</p></div><div class="flex shrink-0 items-center gap-4"><div class="hidden text-right md:block"><p class="font-medium">Join at</p><p class="text-lg text-[var(--ui-accent)]">{{ activity.publicUrl }}</p></div><img :src="qr" alt="Join QR code" class="h-32 w-32 rounded-2xl bg-white p-2 lg:h-40 lg:w-40" /></div></header>
      <section class="panel flex-1 p-6 lg:p-10"><LiveResultsBoard :activity="activity" :results="activity.results" presentation /></section>
      <footer class="flex items-center justify-between"><span class="text-sm text-[var(--ui-text-muted)]">{{ activity.results.responseCount }} published responses · {{ activity.status }}</span><button class="btn-secondary" @click="exitPresentation">Exit presentation</button></footer>
    </div>
  </main>
</template>
