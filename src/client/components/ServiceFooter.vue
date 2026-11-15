<script setup lang="ts">
import { ref, watch } from 'vue';
import type { ServiceFooterLink } from '@/shared/types';
import { useI18n } from 'vue-i18n';

const { locale } = useI18n();
const fallbackLinks = (): ServiceFooterLink[] => locale.value === 'lv' ? [
  { type: 'security', href: '/service/security', label: 'Drošības politika' },
  { type: 'privacy', href: '/service/privacy', label: 'Privātuma politika' },
  { type: 'contacts', href: '/service/contacts', label: 'Kontakti' },
  { type: 'report_abuse', href: '/service/report-abuse', label: 'Ziņot par pārkāpumu' }
] : [
  { type: 'security', href: '/service/security', label: 'Security Policy' },
  { type: 'privacy', href: '/service/privacy', label: 'Privacy Policy' },
  { type: 'contacts', href: '/service/contacts', label: 'Contacts' },
  { type: 'report_abuse', href: '/service/report-abuse', label: 'Report Abuse' }
];
const links = ref<ServiceFooterLink[]>(fallbackLinks());

const loadLinks = async () => {
  links.value = fallbackLinks();
  try {
    const response = await fetch('/api/public/service-sections', { credentials: 'same-origin' });
    if (!response.ok) return;
    const data = await response.json() as { links?: ServiceFooterLink[] };
    if (Array.isArray(data.links)) links.value = data.links;
  } catch {
    // Essential fallback links remain available when the API cannot be reached.
  }
};

watch(locale, () => void loadLinks(), { immediate: true });
</script>

<template>
  <footer class="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-center text-xs text-[var(--ui-text-muted)]">
    <a
      v-for="link in links"
      :key="link.type"
      :href="link.href"
      class="rounded-md transition-colors hover:text-[var(--ui-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-accent)]"
    >{{ link.label }}</a>
  </footer>
</template>
