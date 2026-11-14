<script setup lang="ts">
import { computed } from 'vue';
import type { PageBlock, ServiceContactBlock, ServiceContactConfig } from '@/shared/types';
import PageActionLink from './PageActionLink.vue';
import PageBlockRenderer from './PageBlockRenderer.vue';
import PageLinkIcon from './PageLinkIcon.vue';
import RichTextContent from './RichTextContent.vue';

const props = defineProps<{
  config: ServiceContactConfig;
  locale: 'en' | 'lv';
  compact?: boolean;
}>();

const localized = (block: ServiceContactBlock, field: 'title' | 'description' | 'body') => {
  const suffix = props.locale === 'lv' ? 'Lv' : 'En';
  const key = `${field}${suffix}` as keyof ServiceContactBlock;
  return typeof block[key] === 'string' ? block[key] : '';
};

const safeExternalUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch { return null; }
};

const safeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;

const asPageBlock = (block: ServiceContactBlock, position: number): PageBlock | null => {
  const base = { id: block.id, position, visible: true, createdAt: '', updatedAt: '' };
  if (block.type === 'heading') return { ...base, type: 'heading', config: { text: localized(block, 'title'), size: 'large', alignment: 'left' } };
  if (block.type === 'text') return { ...base, type: 'text', config: { text: localized(block, 'body'), alignment: 'left' } };
  if (block.type === 'divider') return { ...base, type: 'divider', config: { style: 'solid', spacing: 'medium' } };
  if (block.type === 'contact_email') {
    const email = safeEmail(block.email);
    return { ...base, type: 'email', config: { email: email ?? '', label: localized(block, 'title') || email || '', style: 'button' } };
  }
  return null;
};

const renderedBlocks = computed(() => props.config.blocks.map((block, position) => ({
  block,
  pageBlock: asPageBlock(block, position)
})));

</script>

<template>
  <div
    class="service-contact-preview space-y-3"
    :class="compact ? 'service-contact-preview-compact' : ''"
    style="--page-text:var(--ui-text);--page-muted:var(--ui-text-muted);--page-accent:var(--ui-accent);--page-border:var(--ui-border);--page-card:var(--ui-panel);--page-radius:1rem;--page-shadow:0 5px 16px rgba(0,0,0,.045)"
  >
    <template v-for="entry in renderedBlocks" :key="entry.block.id">
      <PageBlockRenderer v-if="entry.pageBlock" :block="entry.pageBlock" preview />

      <PageActionLink
        v-else-if="entry.block.type === 'social_card'"
        class="service-social-card"
        :class="safeExternalUrl(entry.block.url) ? '' : 'pointer-events-none opacity-55'"
        :href="safeExternalUrl(entry.block.url) ?? undefined"
        target="_blank"
        rel="noopener noreferrer external"
        referrerpolicy="no-referrer"
      >
        <PageLinkIcon :href="safeExternalUrl(entry.block.url)" />
        <span class="min-w-0 flex-1">
          <RichTextContent :value="localized(entry.block, 'title')" class="block break-words font-semibold" />
          <RichTextContent v-if="localized(entry.block, 'description')" :value="localized(entry.block, 'description')" class="mt-0.5 block break-words text-xs text-[var(--page-muted)]" />
        </span>
      </PageActionLink>

      <section v-else-if="entry.block.type === 'contact_form'" class="rounded-[var(--page-radius)] bg-[var(--page-card)] p-5 shadow-[var(--page-shadow)]" data-contact-form-component>
        <div class="flex items-start gap-3">
          <span class="page-email-icon-shell flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--page-border)] bg-white/85" aria-hidden="true">
            <svg class="h-5 w-5" viewBox="0 0 32 32"><path d="M0 0h32v32H0z" fill="none"/><path fill="currentColor" d="M28 6H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2m-2.2 2L16 14.78L6.2 8ZM4 24V8.91l11.43 7.91a1 1 0 0 0 1.14 0L28 8.91V24Z"/></svg>
          </span>
          <div class="min-w-0">
            <h3 class="break-words font-semibold text-[var(--page-text)]"><RichTextContent :value="localized(entry.block, 'title')" inline /></h3>
            <RichTextContent :value="localized(entry.block, 'description')" class="mt-0.5 break-words text-xs text-[var(--page-muted)]" />
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.service-social-card { color:var(--page-text); }
.service-contact-preview-compact :deep(h2) { font-size:1.125rem; }
</style>
