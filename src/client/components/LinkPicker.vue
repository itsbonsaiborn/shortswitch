<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { LinkRecord } from '@/shared/types';

const props = defineProps<{
  modelValue: string;
  links: LinkRecord[];
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const { t } = useI18n();

const open = ref(false);
const query = ref('');
let closeTimer: ReturnType<typeof setTimeout> | null = null;

const selectedLink = computed(() => props.links.find((link) => link.id === props.modelValue) ?? null);
const labelFor = (link: LinkRecord) => `/${link.slug} · ${link.targetUrl}`;
const selectedLabel = computed(() => selectedLink.value ? labelFor(selectedLink.value) : '');
const filteredLinks = computed(() => {
  const normalized = query.value.trim().toLocaleLowerCase();
  return props.links
    .filter((link) => !normalized
      || link.slug.toLocaleLowerCase().includes(normalized)
      || link.targetUrl.toLocaleLowerCase().includes(normalized)
      || link.comment?.toLocaleLowerCase().includes(normalized))
    .slice(0, 30);
});

watch(selectedLabel, (label) => {
  if (!open.value) query.value = label;
}, { immediate: true });

const showOptions = () => {
  if (closeTimer) clearTimeout(closeTimer);
  query.value = '';
  open.value = true;
};
const scheduleClose = () => {
  closeTimer = setTimeout(() => {
    open.value = false;
    query.value = selectedLabel.value;
  }, 120);
};
const updateQuery = (event: Event) => {
  query.value = (event.target as HTMLInputElement).value;
  if (props.modelValue) emit('update:modelValue', '');
};
const selectLink = (link: LinkRecord) => {
  if (closeTimer) clearTimeout(closeTimer);
  emit('update:modelValue', link.id);
  query.value = labelFor(link);
  open.value = false;
};

onBeforeUnmount(() => {
  if (closeTimer) clearTimeout(closeTimer);
});
</script>

<template>
  <label class="relative block">
    <span class="field-label">{{ t('editor.linkSelect') }}</span>
    <input
      :value="query"
      class="input px-3 py-2"
      :placeholder="t('links.search')"
      autocomplete="off"
      role="combobox"
      :aria-expanded="open"
      aria-autocomplete="list"
      @focus="showOptions"
      @input="updateQuery"
      @blur="scheduleClose"
      @keydown.esc="open = false; query = selectedLabel"
    />
    <div
      v-if="open"
      class="app-scrollbar absolute inset-x-0 top-full z-30 mt-2 max-h-56 overflow-y-auto rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-panel)] p-1.5 shadow-xl"
      role="listbox"
    >
      <button
        v-for="link in filteredLinks"
        :key="link.id"
        type="button"
        class="flex w-full min-w-0 flex-col rounded-xl px-3 py-2 text-left transition-colors hover:bg-[var(--ui-panel-muted)] focus-visible:bg-[var(--ui-panel-muted)] focus-visible:outline-none"
        :aria-selected="link.id === modelValue"
        role="option"
        @mousedown.prevent="selectLink(link)"
      >
        <span class="truncate text-sm font-medium">/{{ link.slug }}</span>
        <span class="truncate text-xs text-[var(--ui-text-muted)]">{{ link.targetUrl }}</span>
      </button>
      <p v-if="!filteredLinks.length" class="px-3 py-5 text-center text-sm text-[var(--ui-text-muted)]">
        {{ t('links.noMatches') }}
      </p>
    </div>
  </label>
</template>

<style scoped>
.field-label { display:block; margin-bottom:.4rem; font-size:.75rem; color:var(--ui-text-muted); }
</style>
