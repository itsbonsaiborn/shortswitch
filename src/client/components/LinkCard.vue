<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import QRCode from 'qrcode';
import type { LinkRecord } from '@/shared/types';

const props = defineProps<{ link: LinkRecord }>();
const emit = defineEmits<{
  open: [id: string];
  edit: [link: LinkRecord];
  delete: [link: LinkRecord];
  clearAnalytics: [link: LinkRecord];
  removePassword: [link: LinkRecord];
  toggleEnabled: [link: LinkRecord, enabled: boolean, clearExpirationOnEnable: boolean];
}>();

const qrOpen = ref(false);
const actionsOpen = ref(false);
const qrDataUrl = ref('');
const rootRef = ref<HTMLElement | null>(null);
const qrButtonRef = ref<HTMLElement | null>(null);
const actionsButtonRef = ref<HTMLElement | null>(null);
const copied = ref(false);
const faviconIndex = ref(0);
const qrMenuStyle = ref<Record<string, string>>({});
const actionsMenuStyle = ref<Record<string, string>>({});
const menuOpenEventName = 'link-card-menu-open';

const targetHost = computed(() => {
  try {
    return new URL(props.link.targetUrl).hostname;
  } catch {
    return props.link.targetUrl;
  }
});

const targetOrigin = computed(() => {
  try {
    return new URL(props.link.targetUrl).origin;
  } catch {
    return '';
  }
});

const isSharePointHost = computed(() => /(^|\.)(sharepoint\.com)$/i.test(targetHost.value));

const faviconCandidates = computed(() => {
  if (!targetOrigin.value) return [];
  if (isSharePointHost.value) {
    return [
      `${targetOrigin.value}/_layouts/15/images/odbfavicon.ico`,
      `${targetOrigin.value}/favicon.ico`,
      `${targetOrigin.value}/favicon.png`,
      `${targetOrigin.value}/odbfavicon.ico`
    ];
  }
  const candidates = [
    `${targetOrigin.value}/favicon.ico`,
    `${targetOrigin.value}/favicon.png`,
    `${targetOrigin.value}/odbfavicon.ico`
  ];
  return candidates;
});

const faviconSrc = computed(() => faviconCandidates.value[faviconIndex.value] ?? null);
const faviconFailed = computed(() => !faviconSrc.value);

const shortLabel = computed(() => {
  try {
    const url = new URL(props.link.shortUrl);
    return `${url.hostname}/${props.link.slug}`;
  } catch {
    return props.link.shortUrl;
  }
});

watch(
  () => props.link.targetUrl,
  () => {
    faviconIndex.value = 0;
  }
);

const remainingLifetime = computed(() => {
  if (!props.link.expiresAt) return null;

  const diffMs = new Date(props.link.expiresAt).getTime() - Date.now();
  if (diffMs <= 0) {
    return {
      label: 'Expired',
      tone: 'expired' as const
    };
  }

  const totalMinutes = Math.max(Math.floor(diffMs / 60000), 0);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;
  const remainingMinutes = totalMinutes % 60;

  let label = '';
  if (totalDays >= 1) {
    label = `${totalDays}d ${remainingHours}h ${remainingMinutes}m left`;
  } else if (totalHours >= 1) {
    label = `${totalHours}h ${remainingMinutes}m left`;
  } else {
    label = `${Math.max(totalMinutes, 1)}m left`;
  }

  return {
    label,
    tone: totalHours < 1 ? ('danger' as const) : totalHours < 24 ? ('warning' as const) : ('safe' as const)
  };
});

const isExpired = computed(() => Boolean(props.link.expiresAt && new Date(props.link.expiresAt).getTime() <= Date.now()));
const isDisabled = computed(() => !props.link.enabled || isExpired.value);
const statusLabel = computed(() => (isDisabled.value ? 'Disabled' : 'Enabled'));
const statusClass = computed(() =>
  isDisabled.value
    ? 'border-transparent bg-[#FCE8DB] text-[#AF3029] dark:bg-[#321F1C] dark:text-[#F89A8A]'
    : 'border-transparent bg-[#E8F3E6] text-[#66800B] dark:bg-[#1B2B29] dark:text-[#BEC97E]'
);

const remainingLifetimeClass = computed(() => {
  if (!remainingLifetime.value) return '';
  if (remainingLifetime.value.tone === 'danger') {
    return 'border-transparent bg-[#FCE8DB] text-[#AF3029] dark:bg-[#321F1C] dark:text-[#F89A8A]';
  }
  if (remainingLifetime.value.tone === 'warning') {
    return 'border-transparent bg-[var(--ui-pill-bg)] text-[#AD8301] dark:text-[#ECCB60]';
  }
  if (remainingLifetime.value.tone === 'expired') {
    return 'border-transparent bg-[#FCE8DB] text-[#AF3029] dark:bg-[#321F1C] dark:text-[#F89A8A]';
  }
  return 'border-transparent bg-[#E8F3E6] text-[#66800B] dark:bg-[#1B2B29] dark:text-[#BEC97E]';
});

const copy = async () => {
  await navigator.clipboard.writeText(props.link.shortUrl);
  copied.value = true;
  window.setTimeout(() => {
    copied.value = false;
  }, 1400);
};

const showQr = async () => {
  qrDataUrl.value = await QRCode.toDataURL(props.link.shortUrl, { margin: 1, width: 256 });
  qrOpen.value = !qrOpen.value;
  if (qrOpen.value) {
    window.dispatchEvent(new CustomEvent(menuOpenEventName, { detail: { linkId: props.link.id } }));
    qrMenuStyle.value = buildMenuStyle(qrButtonRef.value, 260, 276);
  }
  actionsOpen.value = false;
};

const toggleActions = () => {
  actionsOpen.value = !actionsOpen.value;
  if (actionsOpen.value) {
    window.dispatchEvent(new CustomEvent(menuOpenEventName, { detail: { linkId: props.link.id } }));
    actionsMenuStyle.value = buildMenuStyle(actionsButtonRef.value, 220, props.link.passwordProtected ? 280 : 228);
  }
  qrOpen.value = false;
};

const downloadQr = () => {
  const link = document.createElement('a');
  link.href = qrDataUrl.value;
  link.download = `${props.link.slug}-qr.png`;
  link.click();
};

const openAnalytics = () => {
  emit('open', props.link.id);
};

const handleFaviconError = () => {
  if (faviconIndex.value < faviconCandidates.value.length - 1) {
    faviconIndex.value += 1;
    return;
  }
  faviconIndex.value = faviconCandidates.value.length;
};

const buildMenuStyle = (anchor: HTMLElement | null, menuWidth: number, menuHeight: number) => {
  if (!anchor || typeof window === 'undefined') return {};
  const rect = anchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const gap = 10;

  const centeredLeft = rect.left + rect.width / 2 - menuWidth / 2;
  const left = Math.min(
    Math.max(centeredLeft, gap),
    Math.max(viewportWidth - menuWidth - gap, gap)
  );
  const hasSpaceBelow = rect.bottom + gap + menuHeight <= viewportHeight - gap;
  const hasSpaceAbove = rect.top - gap - menuHeight >= gap;
  const top = hasSpaceBelow || !hasSpaceAbove ? rect.bottom + gap : rect.top - menuHeight - gap;

  return {
    position: 'fixed',
    left: `${left}px`,
    top: `${Math.max(top, gap)}px`,
    width: `${menuWidth}px`,
    maxWidth: `calc(100vw - ${gap * 2}px)`,
    zIndex: '60'
  };
};

const syncOpenMenus = () => {
  if (qrOpen.value) {
    qrMenuStyle.value = buildMenuStyle(qrButtonRef.value, 260, 276);
  }
  if (actionsOpen.value) {
    actionsMenuStyle.value = buildMenuStyle(actionsButtonRef.value, 220, props.link.passwordProtected ? 228 : 176);
  }
};

const onCardClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest('[data-no-open="true"]')) return;
  openAnalytics();
};

const closeDropdowns = (event: MouseEvent) => {
  const target = event.target as Node | null;
  if (rootRef.value?.contains(target)) return;
  qrOpen.value = false;
  actionsOpen.value = false;
};

const closeMenusFromOtherCards = (event: Event) => {
  const detail = (event as CustomEvent<{ linkId?: string }>).detail;
  if (!detail || detail.linkId === props.link.id) return;
  qrOpen.value = false;
  actionsOpen.value = false;
};

onMounted(() => {
  document.addEventListener('click', closeDropdowns);
  window.addEventListener('resize', syncOpenMenus);
  window.addEventListener('scroll', syncOpenMenus, true);
  window.addEventListener(menuOpenEventName, closeMenusFromOtherCards as EventListener);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', closeDropdowns);
  window.removeEventListener('resize', syncOpenMenus);
  window.removeEventListener('scroll', syncOpenMenus, true);
  window.removeEventListener(menuOpenEventName, closeMenusFromOtherCards as EventListener);
});

const formatDate = (value: string) => {
  const date = new Date(value);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
};
</script>

<template>
  <article
    ref="rootRef"
    class="panel group relative flex min-w-0 cursor-pointer flex-col gap-4 p-4 transition-all duration-300 hover:z-20 hover:border-accent-300/80 dark:hover:border-accent-700/70"
    @click="onCardClick"
  >
    <div class="flex items-center justify-between gap-3">
      <div class="flex min-w-0 flex-1 items-center gap-3">
        <img
          v-if="faviconSrc"
          :src="faviconSrc"
          alt=""
          class="h-9 w-9 rounded-2xl border border-[var(--ui-border)] bg-white object-contain p-1"
          @error="handleFaviconError"
        />
        <div
          v-else
          class="flex h-9 w-9 items-center justify-center rounded-2xl border border-[var(--ui-border)] bg-white text-sm font-semibold"
        >
          {{ targetHost.charAt(0).toUpperCase() }}
        </div>
        <div class="min-w-0 flex-1">
          <a
            :href="props.link.shortUrl"
            target="_blank"
            rel="noreferrer"
            class="block min-w-0 truncate text-[15px] font-semibold transition-colors hover:text-accent-600 dark:hover:text-accent-300"
            data-no-open="true"
            @click.stop
          >
            {{ shortLabel }}
          </a>
          <p
            v-if="props.link.comment"
            class="mt-1 min-w-0 truncate text-sm text-[var(--ui-text-muted)]"
          >
            {{ props.link.comment }}
          </p>
        </div>
      </div>

      <div class="relative z-20 flex items-center gap-2" data-no-open="true">
        <button class="icon-button" :aria-label="copied ? 'Copied' : 'Copy link'" @click.stop="copy">
          <svg
            v-if="!copied"
            xmlns="http://www.w3.org/2000/svg"
            class="h-4.5 w-4.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <rect x="9" y="9" width="13" height="13" rx="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          <svg
            v-else
            xmlns="http://www.w3.org/2000/svg"
            class="h-4.5 w-4.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M20 6 9 17l-5-5"></path>
          </svg>
        </button>

        <div class="relative">
          <button ref="qrButtonRef" class="icon-button" aria-label="Show QR code" @click.stop="showQr">
            <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
              <path d="M0 0h24v24H0z" fill="none" />
              <path fill="currentColor" d="M3 4.5v5c0 .83.67 1.5 1.5 1.5h5c.83 0 1.5-.67 1.5-1.5v-5c0-.83-.67-1.5-1.5-1.5h-5C3.67 3 3 3.67 3 4.5M5 5h4v4H5zM3 19.5c0 .83.67 1.5 1.5 1.5h5c.83 0 1.5-.67 1.5-1.5v-5c0-.83-.67-1.5-1.5-1.5h-5c-.83 0-1.5.67-1.5 1.5zM5 15h4v4H5zM19.5 3h-5c-.83 0-1.5.67-1.5 1.5v5c0 .83.67 1.5 1.5 1.5h5c.83 0 1.5-.67 1.5-1.5v-5c0-.83-.67-1.5-1.5-1.5M19 9h-4V5h4zm-6 4h2v2h-2zm2 2h2v2h-2zm-2 2h2v2h-2zm4 0h2v2h-2zm2 2h2v2h-2zm-4 0h2v2h-2zm2-6h2v2h-2zm2 2h2v2h-2z" />
            </svg>
          </button>

          <Transition
            enter-active-class="transition duration-300 ease-out"
            enter-from-class="opacity-0"
            enter-to-class="opacity-100"
            leave-active-class="transition duration-200 ease-in"
            leave-from-class="opacity-100"
            leave-to-class="opacity-0"
          >
            <Teleport to="body">
              <div
                v-if="qrOpen"
                class="cursor-default rounded-3xl border border-[var(--ui-border)] bg-[var(--ui-dropdown-bg)] p-3 ring-1 ring-black/5 backdrop-blur-xl dark:ring-white/5"
                :style="qrMenuStyle"
                data-no-open="true"
                @click.stop
              >
                <div class="flex flex-col items-center gap-4">
                  <img :src="qrDataUrl" alt="QR code" class="h-44 w-44 rounded-3xl bg-white p-3" />
                  <button class="btn-secondary w-full gap-2" @click.stop="downloadQr">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                      <path d="m7 10 5 5 5-5"></path>
                      <path d="M12 15V3"></path>
                    </svg>
                    Download QR
                  </button>
                </div>
              </div>
            </Teleport>
          </Transition>
        </div>

        <div class="relative">
          <button
            ref="actionsButtonRef"
            class="icon-button"
            aria-label="Link actions"
            @click.stop="toggleActions"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="m6 9 6 6 6-6"></path>
            </svg>
          </button>

          <Transition
            enter-active-class="transition duration-300 ease-out"
            enter-from-class="opacity-0"
            enter-to-class="opacity-100"
            leave-active-class="transition duration-200 ease-in"
            leave-from-class="opacity-100"
            leave-to-class="opacity-0"
          >
            <Teleport to="body">
              <div
                v-if="actionsOpen"
                class="cursor-default rounded-3xl border border-[var(--ui-border)] bg-[var(--ui-dropdown-bg)] p-3 ring-1 ring-black/5 backdrop-blur-xl dark:ring-white/5"
                :style="actionsMenuStyle"
                @click.stop
              >
                <button
                  class="flex w-full items-center rounded-2xl border border-transparent px-4 py-3 text-left text-sm transition hover:border-[var(--ui-border)] hover:bg-[#FFFBEF] dark:hover:border-[var(--ui-border)] dark:hover:bg-[#1C1A19]"
                  @click="actionsOpen = false; emit('edit', props.link)"
                >
                  Edit
                </button>
                <button
                  v-if="props.link.passwordProtected"
                  class="mt-1 flex w-full items-center rounded-2xl border border-transparent px-4 py-3 text-left text-sm transition hover:border-[var(--ui-border)] hover:bg-[#FFFBEF] dark:hover:border-[var(--ui-border)] dark:hover:bg-[#1C1A19]"
                  @click="actionsOpen = false; emit('removePassword', props.link)"
                >
                  Remove password
                </button>
                <button
                  class="mt-1 flex w-full items-center rounded-2xl border border-transparent px-4 py-3 text-left text-sm text-[#AF3029] transition hover:border-[#AF3029]/20 hover:bg-[#FCE8DB] dark:text-[#F89A8A] dark:hover:border-[#F89A8A]/20 dark:hover:bg-[#321F1C]"
                  @click="actionsOpen = false; emit('clearAnalytics', props.link)"
                >
                  Clear analytics
                </button>
                <button
                  class="mt-1 flex w-full items-center rounded-2xl border border-transparent px-4 py-3 text-left text-sm transition"
                  :class="
                    isDisabled
                      ? 'text-[#66800B] hover:border-[#66800B]/20 hover:bg-[#E8F3E6] dark:text-[#BEC97E] dark:hover:border-[#BEC97E]/20 dark:hover:bg-[#1B2B29]'
                      : 'text-[#AF3029] hover:border-[#AF3029]/20 hover:bg-[#FCE8DB] dark:text-[#F89A8A] dark:hover:border-[#F89A8A]/20 dark:hover:bg-[#321F1C]'
                  "
                  @click="actionsOpen = false; emit('toggleEnabled', props.link, isDisabled, isExpired)"
                >
                  {{ isDisabled ? 'Enable' : 'Disable' }}
                </button>
                <button
                  class="mt-1 flex w-full items-center rounded-2xl border border-transparent px-4 py-3 text-left text-sm text-[#AF3029] transition hover:border-[#AF3029]/20 hover:bg-[#FCE8DB] dark:text-[#F89A8A] dark:hover:border-[#F89A8A]/20 dark:hover:bg-[#321F1C]"
                  @click="actionsOpen = false; emit('delete', props.link)"
                >
                  Delete
                </button>
              </div>
            </Teleport>
          </Transition>
        </div>
      </div>
    </div>

    <div class="flex min-w-0 items-center text-left text-sm text-slate-500 dark:text-slate-400">
      <span class="shrink-0">{{ formatDate(props.link.createdAt) }}</span>
      <span class="mx-2 shrink-0 opacity-50">|</span>
      <span class="min-w-0 truncate">{{ props.link.targetUrl }}</span>
    </div>

    <div class="flex flex-wrap gap-2">
      <div class="rounded-full border border-transparent bg-[var(--ui-pill-bg)] px-3 py-1.5 text-xs font-medium text-[var(--ui-text-muted)] transition-colors">
        Total clicks: {{ props.link.clickCount }}
      </div>
      <div class="rounded-full border border-transparent bg-[var(--ui-pill-bg)] px-3 py-1.5 text-xs font-medium text-[var(--ui-text-muted)] transition-colors">
        Unique clicks: {{ props.link.uniqueClickCount }}
      </div>
      <div
        v-if="remainingLifetime && !isDisabled"
        class="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
        :class="remainingLifetimeClass"
      >
        {{ remainingLifetime.label }}
      </div>
      <div class="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors" :class="statusClass">
        {{ statusLabel }}
      </div>
      <div
        v-if="props.link.passwordProtected"
        class="rounded-full border border-transparent bg-[var(--ui-pill-bg)] px-3 py-1.5 text-xs font-medium text-[var(--ui-accent)]"
      >
        Protected
      </div>
    </div>
  </article>
</template>
