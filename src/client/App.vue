<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppShell from './components/AppShell.vue';
import CreateLinkModal from './components/CreateLinkModal.vue';
import ToastViewport from './components/ToastViewport.vue';
import { useAuth } from './composables/useAuth';
import type { LinkRecord } from '@/shared/types';

const { initialized, loadUser, user } = useAuth();
const route = useRoute();
const router = useRouter();
const createOpen = ref(false);

const isLoginRoute = computed(() => route.path === '/login');

watch(
  [initialized, user, isLoginRoute],
  async ([ready, currentUser, loginRoute]) => {
    if (!ready) return;
    if (!currentUser && !loginRoute) await router.push('/login');
    if (currentUser && loginRoute) await router.push('/app/links');
  },
  { immediate: true }
);

onMounted(loadUser);

const onCreated = async (link: LinkRecord) => {
  if (route.path === '/app/links') {
    window.dispatchEvent(new CustomEvent('link-created', { detail: link }));
  }
};
</script>

<template>
  <RouterView v-if="isLoginRoute || !user" />
  <AppShell v-else @create-link="createOpen = true">
    <RouterView />
  </AppShell>
  <CreateLinkModal :open="createOpen" @close="createOpen = false" @created="onCreated" />
  <ToastViewport />
</template>
