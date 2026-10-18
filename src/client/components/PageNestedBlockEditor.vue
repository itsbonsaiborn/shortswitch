<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { LinkRecord, LiveActivitySummary, PageBlockType, PageNestedBlock, PageNestedBlockType } from '@/shared/types';
import LiveActivityPicker from './LiveActivityPicker.vue';
import PageBlockIcon from './PageBlockIcon.vue';

const { t } = useI18n();

const props = defineProps<{
  block: PageNestedBlock;
  links: LinkRecord[];
  activities: LiveActivitySummary[];
  labels: Record<PageBlockType, string>;
  column: number;
}>();

const search = ref('');
const nestedTypes: PageNestedBlockType[] = ['heading', 'text', 'link', 'existing_link', 'live_activity', 'email', 'divider', 'spacer', 'image'];
const filteredLinks = computed(() => {
  const query = search.value.trim().toLowerCase();
  return props.links.filter((item) => !query || item.slug.toLowerCase().includes(query) || item.targetUrl.toLowerCase().includes(query)).slice(0, 30);
});
const defaultConfig = (type: PageNestedBlockType) => {
  if (type === 'heading') return { text: t('editor.defaultSectionHeading'), alignment: 'left' as const, size: 'medium' as const };
  if (type === 'text') return { text: t('editor.defaultText'), alignment: 'left' as const };
  if (type === 'link') return { title: t('editor.defaultNewLink'), url: 'https://example.com', subtitle: '', emoji: '↗', openInNewTab: true };
  if (type === 'existing_link') return { title: t('editor.defaultShortLink'), resourceId: props.links[0]?.id ?? '', subtitle: '', emoji: '↗', openInNewTab: false };
  if (type === 'live_activity') return { title: t('editor.defaultJoinLive'), resourceId: props.activities[0]?.id ?? '', subtitle: '', emoji: '◉', openInNewTab: true };
  if (type === 'email') return { label: t('editor.defaultEmail'), email: 'hello@example.com', style: 'button' as const };
  if (type === 'divider') return { style: 'solid' as const, spacing: 'medium' as const };
  if (type === 'spacer') return { spacing: 'medium' as const };
  return { url: 'https://example.com/image.jpg', alt: t('editor.defaultImageDescription'), caption: '', alignment: 'center' as const };
};
const changeType = (event: Event) => {
  const type = (event.target as HTMLSelectElement).value as PageNestedBlockType;
  props.block.type = type;
  props.block.config = defaultConfig(type);
  search.value = '';
};
</script>

<template>
  <section class="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-panel-muted)] p-4">
    <div class="mb-4 flex items-center gap-3">
      <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--ui-border)] bg-[var(--ui-panel)] text-[var(--ui-accent)]"><PageBlockIcon :type="block.type" /></span>
      <div class="min-w-0 flex-1"><p class="text-xs text-[var(--ui-text-muted)]">{{ t('columns.label', { count: column }) }}</p><p class="truncate text-sm font-semibold">{{ labels[block.type] }}</p></div>
      <label class="flex items-center gap-2 text-xs"><input v-model="block.visible" type="checkbox" /> {{ t('editor.visible') }}</label>
    </div>

    <label><span class="field-label">{{ t('editor.blockType') }}</span><select :value="block.type" class="input px-3 py-2" @change="changeType"><option v-for="type in nestedTypes" :key="type" :value="type">{{ labels[type] }}</option></select></label>
    <div class="mt-4 grid gap-3">
      <template v-if="block.type === 'heading'">
        <label><span class="field-label">{{ t('editor.heading') }}</span><input v-model="block.config.text" class="input px-3 py-2" maxlength="240" /></label>
        <label><span class="field-label">{{ t('editor.size') }}</span><select v-model="block.config.size" class="input px-3 py-2"><option value="small">{{ t('options.small') }}</option><option value="medium">{{ t('options.medium') }}</option><option value="large">{{ t('options.large') }}</option></select></label>
        <label><span class="field-label">{{ t('editor.alignment') }}</span><select v-model="block.config.alignment" class="input px-3 py-2"><option value="left">{{ t('options.left') }}</option><option value="center">{{ t('options.center') }}</option><option value="right">{{ t('options.right') }}</option></select></label>
      </template>
      <template v-else-if="block.type === 'text'">
        <label><span class="field-label">{{ t('editor.text') }}</span><textarea v-model="block.config.text" class="input min-h-28 px-3 py-2" maxlength="4000" /></label>
        <label><span class="field-label">{{ t('editor.alignment') }}</span><select v-model="block.config.alignment" class="input px-3 py-2"><option value="left">{{ t('options.left') }}</option><option value="center">{{ t('options.center') }}</option><option value="right">{{ t('options.right') }}</option></select></label>
      </template>
      <template v-else-if="block.type === 'link'">
        <label><span class="field-label">{{ t('common.title') }}</span><input v-model="block.config.title" class="input px-3 py-2" maxlength="120" /></label>
        <label><span class="field-label">{{ t('editor.url') }}</span><input v-model="block.config.url" class="input px-3 py-2" type="url" /></label>
        <label><span class="field-label">{{ t('editor.subtitle') }}</span><input v-model="block.config.subtitle" class="input px-3 py-2" maxlength="240" /></label>
        <label><span class="field-label">{{ t('editor.emojiFallback') }}</span><input v-model="block.config.emoji" class="input px-3 py-2" maxlength="16" /></label>
        <label class="flex items-center gap-2 text-sm"><input v-model="block.config.openInNewTab" type="checkbox" /> {{ t('editor.openNewTab') }}</label>
      </template>
      <template v-else-if="block.type === 'existing_link'">
        <label><span class="field-label">{{ t('editor.searchLinks') }}</span><input v-model="search" class="input px-3 py-2" :placeholder="t('links.search')" /></label>
        <label><span class="field-label">{{ t('editor.linkSelect') }}</span><select v-model="block.config.resourceId" class="input px-3 py-2"><option value="">{{ t('editor.selectLink') }}</option><option v-for="link in filteredLinks" :key="link.id" :value="link.id">/{{ link.slug }} · {{ link.targetUrl }}</option></select></label>
        <label><span class="field-label">{{ t('editor.buttonTitle') }}</span><input v-model="block.config.title" class="input px-3 py-2" maxlength="120" /></label>
        <label><span class="field-label">{{ t('editor.subtitle') }}</span><input v-model="block.config.subtitle" class="input px-3 py-2" maxlength="240" /></label>
      </template>
      <template v-else-if="block.type === 'live_activity'">
        <LiveActivityPicker v-model="block.config.resourceId" :activities="activities" />
        <label><span class="field-label">{{ t('editor.buttonTitle') }}</span><input v-model="block.config.title" class="input px-3 py-2" maxlength="120" /></label>
        <label><span class="field-label">{{ t('editor.subtitle') }}</span><input v-model="block.config.subtitle" class="input px-3 py-2" maxlength="240" /></label>
      </template>
      <template v-else-if="block.type === 'email'">
        <label><span class="field-label">{{ t('editor.label') }}</span><input v-model="block.config.label" class="input px-3 py-2" maxlength="120" /></label>
        <label><span class="field-label">{{ t('editor.email') }}</span><input v-model="block.config.email" class="input px-3 py-2" type="email" /></label>
        <label><span class="field-label">{{ t('editor.style') }}</span><select v-model="block.config.style" class="input px-3 py-2"><option value="button">{{ t('options.button') }}</option><option value="text">{{ t('options.text') }}</option></select></label>
      </template>
      <template v-else-if="block.type === 'divider'">
        <label><span class="field-label">{{ t('editor.style') }}</span><select v-model="block.config.style" class="input px-3 py-2"><option value="solid">{{ t('options.solid') }}</option><option value="dashed">{{ t('options.dashed') }}</option><option value="dotted">{{ t('options.dotted') }}</option></select></label>
        <label><span class="field-label">{{ t('editor.spacing') }}</span><select v-model="block.config.spacing" class="input px-3 py-2"><option value="small">{{ t('options.small') }}</option><option value="medium">{{ t('options.medium') }}</option><option value="large">{{ t('options.large') }}</option></select></label>
      </template>
      <template v-else-if="block.type === 'spacer'">
        <label><span class="field-label">{{ t('editor.spacing') }}</span><select v-model="block.config.spacing" class="input px-3 py-2"><option value="small">{{ t('options.small') }}</option><option value="medium">{{ t('options.medium') }}</option><option value="large">{{ t('options.large') }}</option></select></label>
      </template>
      <template v-else>
        <label><span class="field-label">{{ t('editor.imageUrl') }}</span><input v-model="block.config.url" class="input px-3 py-2" type="url" /></label>
        <label><span class="field-label">{{ t('editor.altText') }}</span><input v-model="block.config.alt" class="input px-3 py-2" maxlength="300" /></label>
        <label><span class="field-label">{{ t('editor.caption') }}</span><input v-model="block.config.caption" class="input px-3 py-2" maxlength="500" /></label>
        <label><span class="field-label">{{ t('editor.alignment') }}</span><select v-model="block.config.alignment" class="input px-3 py-2"><option value="left">{{ t('options.left') }}</option><option value="center">{{ t('options.center') }}</option><option value="right">{{ t('options.right') }}</option></select></label>
      </template>
    </div>
  </section>
</template>

<style scoped>
.field-label { display:block; margin-bottom:.4rem; font-size:.75rem; color:var(--ui-text-muted); }
</style>
