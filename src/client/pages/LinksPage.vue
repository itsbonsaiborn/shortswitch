<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { api } from '../lib/api';
import { useToast } from '../composables/useToast';
import LinkCard from '../components/LinkCard.vue';
import StatCard from '../components/StatCard.vue';
import CreateLinkModal from '../components/CreateLinkModal.vue';
import type { LinkRecord } from '@/shared/types';
import { useI18n } from 'vue-i18n';

const links = ref<LinkRecord[]>([]);
const loading = ref(true);
const editingLink = ref<LinkRecord | null>(null);
const editOpen = ref(false);
const search = ref('');
const sort = ref<'newest' | 'oldest' | 'slug' | 'clicks'>('newest');
const { pushToast } = useToast();
const { t } = useI18n();

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
    pushToast({ tone: 'error', title: t('notices.linkDeleted'), description: t('notices.linkRemoved', { name: link.slug }) });
  } catch (error) {
    pushToast({ tone: 'error', title: t('notices.deleteLinkFailed'), description: (error as Error).message });
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
      title: t(enabled ? 'notices.linkEnabled' : 'notices.linkDisabled'),
      description: `${updated.slug} · ${t(enabled ? 'common.active' : 'common.disabled')}`
    });
  } catch (error) {
    pushToast({ tone: 'error', title: t('notices.statusFailed'), description: (error as Error).message });
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
      title: t('notices.passwordRemoved'),
      description: `${updated.slug} · ${t('notices.passwordRemovedDescription')}`
    });
  } catch (error) {
    pushToast({ tone: 'error', title: t('notices.passwordFailed'), description: (error as Error).message });
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
      title: t('notices.analyticsCleared'),
      description: t('notices.linkAnalyticsCleared', { name: updated.slug })
    });
  } catch (error) {
    pushToast({ tone: 'error', title: t('notices.analyticsClearFailed'), description: (error as Error).message });
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
      <StatCard :label="t('links.total')" :value="links.length" icon="links" />
      <StatCard :label="t('links.clicks')" :value="links.reduce((sum, item) => sum + item.clickCount, 0)" icon="clicks" />
      <StatCard :label="t('links.unique')" :value="totalUniqueClicks" icon="clicks" />
    </section>

    <section class="flex justify-end">
      <div class="grid w-full gap-2 sm:w-auto sm:grid-cols-[minmax(220px,1fr)_170px]">
        <label class="sr-only" for="link-search">{{ t('links.search') }}</label>
        <input id="link-search" v-model="search" class="input" :placeholder="t('links.search')" />
        <label class="sr-only" for="link-sort">{{ t('common.actions') }}</label>
        <select id="link-sort" v-model="sort" class="input">
          <option value="newest">{{ t('common.newest') }}</option>
          <option value="oldest">{{ t('common.oldest') }}</option>
          <option value="slug">{{ t('common.slug') }}</option>
          <option value="clicks">{{ t('common.mostClicked') }}</option>
        </select>
      </div>
    </section>

    <section v-if="loading" class="panel p-8 text-center text-slate-500 dark:text-slate-400">{{ t('links.loading') }}</section>
    <section v-else-if="!links.length" class="panel p-10 text-center">
      <h2 class="text-2xl font-semibold">{{ t('links.empty') }}</h2>
      <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">{{ t('links.emptyDescription') }}</p>
    </section>
    <section v-else-if="!visibleLinks.length" class="panel p-10 text-center">
      <h2 class="text-2xl font-semibold">{{ t('links.noMatches') }}</h2>
      <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">{{ t('links.noMatchesDescription') }}</p>
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
