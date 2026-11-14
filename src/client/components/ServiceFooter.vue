<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { ServiceFooterLink } from '@/shared/types';

const isLatvian = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('lv');
const links = ref<ServiceFooterLink[]>([
  { type: 'security', href: '/service/security', label: isLatvian ? 'Drošības politika' : 'Security Policy' },
  { type: 'privacy', href: '/service/privacy', label: isLatvian ? 'Privātuma politika' : 'Privacy Policy' },
  { type: 'contacts', href: '/service/contacts', label: isLatvian ? 'Kontakti' : 'Contacts' },
  { type: 'report_abuse', href: '/service/report-abuse', label: isLatvian ? 'Ziņot par pārkāpumu' : 'Report Abuse' }
]);

onMounted(async () => {
  try {
    const response = await fetch('/api/public/service-sections', { credentials: 'same-origin' });
    if (!response.ok) return;
    const data = await response.json() as { links?: ServiceFooterLink[] };
    if (Array.isArray(data.links)) links.value = data.links;
  } catch {
    // Essential fallback links remain available when the API cannot be reached.
  }
});
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
