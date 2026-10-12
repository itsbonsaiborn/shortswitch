<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from './composables/useAuth';
import type { LinkRecord, LiveActivitySummary } from '@/shared/types';

const AppShell = defineAsyncComponent(() => import('./components/AppShell.vue'));
const CreateLinkModal = defineAsyncComponent(() => import('./components/CreateLinkModal.vue'));
const LiveActivityModal = defineAsyncComponent(() => import('./components/LiveActivityModal.vue'));
const ToastViewport = defineAsyncComponent(() => import('./components/ToastViewport.vue'));

const { initialized, loadUser, user } = useAuth();
const route = useRoute();
const router = useRouter();
const createOpen = ref(false);
const liveCreateOpen = ref(false);

const isLoginRoute = computed(() => route.path === '/login');
const isPublicRoute = computed(() => route.meta.public === true);
const showAdminOverlays = computed(() => Boolean(user.value && !isLoginRoute.value && !isPublicRoute.value));

watch(
  [initialized, user, isLoginRoute, isPublicRoute],
  async ([ready, currentUser, loginRoute, publicRoute]) => {
    if (!ready) return;
    if (publicRoute) return;
    if (!currentUser && !loginRoute) await router.push('/login');
    if (currentUser && loginRoute) await router.push('/app/links');
  },
  { immediate: true }
);

onMounted(() => {
  if (!isPublicRoute.value) void loadUser();
});

const onCreated = async (link: LinkRecord) => {
  if (route.path === '/app/links') {
    window.dispatchEvent(new CustomEvent('link-created', { detail: link }));
  }
};

const onLiveCreated = (activity: LiveActivitySummary) => {
  if (route.path === '/app/live') {
    window.dispatchEvent(new CustomEvent('live-created', { detail: activity }));
  }
};
</script>

<template>
  <RouterView v-if="isLoginRoute || isPublicRoute || !user" />
  <AppShell v-else @create-link="createOpen = true" @create-live="liveCreateOpen = true" @create-page="router.push('/app/pages/new')">
    <RouterView />
  </AppShell>
  <template v-if="showAdminOverlays">
    <CreateLinkModal :open="createOpen" @close="createOpen = false" @created="onCreated" />
    <LiveActivityModal :open="liveCreateOpen" @close="liveCreateOpen = false" @saved="onLiveCreated" />
    <ToastViewport />
  </template>
</template>
