<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { api } from '../lib/api';
import { useToast } from '../composables/useToast';
import LinkCard from '../components/LinkCard.vue';
import StatCard from '../components/StatCard.vue';
import CreateLinkModal from '../components/CreateLinkModal.vue';
import type { LinkRecord } from '@/shared/types';

const links = ref<LinkRecord[]>([]);
const loading = ref(true);
const editingLink = ref<LinkRecord | null>(null);
const editOpen = ref(false);
const search = ref('');
const sort = ref<'newest' | 'oldest' | 'slug' | 'clicks'>('newest');
const { pushToast } = useToast();

const load = async () => {
  loading.value = true;
  try {
    links.value = await api<LinkRecord[]>('/api/links');
  } finally {
    loading.value = false;
  }
};

const onCreated = (event: Event) => {
  links.value.unshift((event as CustomEvent<LinkRecord>).detail);
};

const totalUniqueClicks = computed(() =>
  links.value.reduce((sum, item) => sum + item.uniqueClickCount, 0)
);

const visibleLinks = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  const filtered = query
    ? links.value.filter((link) =>
        [link.slug, link.targetUrl, link.comment ?? ''].some((value) =>
          value.toLocaleLowerCase().includes(query)
        )
      )
    : links.value;

  return [...filtered].sort((left, right) => {
    if (sort.value === 'oldest') return Date.parse(left.createdAt) - Date.parse(right.createdAt);
    if (sort.value === 'slug') return left.slug.localeCompare(right.slug, undefined, { sensitivity: 'base' });
    if (sort.value === 'clicks') return right.clickCount - left.clickCount || Date.parse(right.createdAt) - Date.parse(left.createdAt);
    return Date.parse(right.createdAt) - Date.parse(left.createdAt);
  });
});

const removeLink = async (link: LinkRecord) => {
  try {
    await api(`/api/links/${link.id}`, { method: 'DELETE', body: JSON.stringify({}) });
    links.value = links.value.filter((candidate) => candidate.id !== link.id);
    pushToast({ tone: 'error', title: 'Link deleted', description: `${link.slug} was removed.` });
  } catch (error) {
    pushToast({ tone: 'error', title: 'Failed to delete link', description: (error as Error).message });
  }
};

const toggleEnabled = async (link: LinkRecord, enabled: boolean, clearExpirationOnEnable: boolean) => {
  try {
    const updated = await api<LinkRecord>(`/api/links/${link.id}/enabled`, {
      method: 'POST',
      body: JSON.stringify({ enabled, clearExpirationOnEnable })
    });
    links.value = links.value.map((candidate) => (candidate.id === updated.id ? updated : candidate));
    pushToast({
      tone: enabled ? 'success' : 'error',
      title: enabled ? 'Link enabled' : 'Link disabled',
      description: `${updated.slug} is now ${enabled ? 'active' : 'disabled'}.`
    });
  } catch (error) {
    pushToast({ tone: 'error', title: 'Failed to change link status', description: (error as Error).message });
  }
};

const removePassword = async (link: LinkRecord) => {
  try {
    const updated = await api<LinkRecord>(`/api/links/${link.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ password: '' })
    });
    links.value = links.value.map((candidate) => (candidate.id === updated.id ? updated : candidate));
    pushToast({
      tone: 'success',
      title: 'Password removed',
      description: `${updated.slug} is no longer password-protected.`
    });
  } catch (error) {
    pushToast({ tone: 'error', title: 'Failed to remove password', description: (error as Error).message });
  }
};

const clearAnalytics = async (link: LinkRecord) => {
  try {
    const updated = await api<LinkRecord>(`/api/links/${link.id}/analytics/clear`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    links.value = links.value.map((candidate) => (candidate.id === updated.id ? updated : candidate));
    pushToast({
      tone: 'error',
      title: 'Analytics cleared',
      description: `${updated.slug} analytics history was removed.`
    });
  } catch (error) {
    pushToast({ tone: 'error', title: 'Failed to clear analytics', description: (error as Error).message });
  }
};

const openEdit = (link: LinkRecord) => {
  editingLink.value = link;
  editOpen.value = true;
};

const onUpdated = (updatedLink: LinkRecord) => {
  links.value = links.value.map((link) => (link.id === updatedLink.id ? updatedLink : link));
};

onMounted(() => {
  load();
  window.addEventListener('link-created', onCreated as EventListener);
});

onUnmounted(() => {
  window.removeEventListener('link-created', onCreated as EventListener);
});
</script>

<template>
  <div class="space-y-4 sm:space-y-6">
    <section class="grid gap-3 sm:grid-cols-3">
      <StatCard label="Total links" :value="links.length" icon="links" />
      <StatCard label="Total clicks" :value="links.reduce((sum, item) => sum + item.clickCount, 0)" icon="clicks" />
      <StatCard label="Unique clicks" :value="totalUniqueClicks" icon="clicks" />
    </section>

    <section class="flex justify-end">
      <div class="grid w-full gap-2 sm:w-auto sm:grid-cols-[minmax(220px,1fr)_170px]">
        <label class="sr-only" for="link-search">Search Links</label>
        <input id="link-search" v-model="search" class="input" placeholder="Search target or slug" />
        <label class="sr-only" for="link-sort">Sort Links</label>
        <select id="link-sort" v-model="sort" class="input">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="slug">Slug</option>
          <option value="clicks">Most clicked</option>
        </select>
      </div>
    </section>

    <section v-if="loading" class="panel p-8 text-center text-slate-500 dark:text-slate-400">Loading links...</section>
    <section v-else-if="!links.length" class="panel p-10 text-center">
      <h2 class="text-2xl font-semibold">No links yet</h2>
      <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">Create your first short link from the header to get started.</p>
    </section>
    <section v-else-if="!visibleLinks.length" class="panel p-10 text-center">
      <h2 class="text-2xl font-semibold">No matching links</h2>
      <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">Try another target URL, slug, or comment.</p>
    </section>
    <section v-else class="grid min-w-0 gap-4 lg:grid-cols-3">
      <LinkCard
        v-for="link in visibleLinks"
        :key="link.id"
        :link="link"
        @open="$router.push(`/app/links/${$event}`)"
        @edit="openEdit"
        @delete="removeLink"
        @clear-analytics="clearAnalytics"
        @remove-password="removePassword"
        @toggle-enabled="toggleEnabled"
      />
    </section>

    <CreateLinkModal
      :open="editOpen"
      :link="editingLink"
      @close="editOpen = false; editingLink = null"
      @created="onCreated"
      @updated="onUpdated"
    />
  </div>
</template>
