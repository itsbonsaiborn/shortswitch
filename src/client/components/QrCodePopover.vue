<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import QRCode from 'qrcode';

const props = defineProps<{
  url: string;
  slug: string;
  instanceId: string;
}>();
const emit = defineEmits<{ open: [] }>();
const { t } = useI18n();

const open = ref(false);
const dataUrl = ref('');
const rootRef = ref<HTMLElement | null>(null);
const buttonRef = ref<HTMLElement | null>(null);
const menuStyle = ref<Record<string, string>>({});
const menuOpenEventName = 'link-card-menu-open';

const buildMenuStyle = () => {
  const anchor = buttonRef.value;
  if (!anchor) return {};
  const rect = anchor.getBoundingClientRect();
  const menuWidth = 260;
  const menuHeight = 276;
  const gap = 10;
  const centeredLeft = rect.left + rect.width / 2 - menuWidth / 2;
  const left = Math.min(
    Math.max(centeredLeft, gap),
    Math.max(window.innerWidth - menuWidth - gap, gap)
  );
  const hasSpaceBelow = rect.bottom + gap + menuHeight <= window.innerHeight - gap;
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

const close = () => { open.value = false; };
const toggle = async () => {
  if (!dataUrl.value) dataUrl.value = await QRCode.toDataURL(props.url, { margin: 1, width: 256 });
  open.value = !open.value;
  if (open.value) {
    emit('open');
    window.dispatchEvent(new CustomEvent(menuOpenEventName, { detail: { linkId: props.instanceId } }));
    menuStyle.value = buildMenuStyle();
  }
};
const download = () => {
  const link = document.createElement('a');
  link.href = dataUrl.value;
  link.download = `${props.slug}-qr.png`;
  link.click();
};
const closeOutside = (event: MouseEvent) => {
  if (rootRef.value?.contains(event.target as Node | null)) return;
  close();
};
const closeFromOtherMenu = (event: Event) => {
  const detail = (event as CustomEvent<{ linkId?: string }>).detail;
  if (detail?.linkId !== props.instanceId) close();
};
const syncPosition = () => {
  if (open.value) menuStyle.value = buildMenuStyle();
};

onMounted(() => {
  document.addEventListener('click', closeOutside);
  window.addEventListener('resize', syncPosition);
  window.addEventListener('scroll', syncPosition, true);
  window.addEventListener(menuOpenEventName, closeFromOtherMenu as EventListener);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', closeOutside);
  window.removeEventListener('resize', syncPosition);
  window.removeEventListener('scroll', syncPosition, true);
  window.removeEventListener(menuOpenEventName, closeFromOtherMenu as EventListener);
});

defineExpose({ close });
</script>

<template>
  <span ref="rootRef" class="relative inline-flex" data-no-open="true">
    <button ref="buttonRef" class="icon-button" :aria-label="t('qr.show')" @click.stop="toggle">
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
          v-if="open"
          class="cursor-default rounded-3xl border border-[var(--ui-border)] bg-[var(--ui-dropdown-bg)] p-3 ring-1 ring-black/5 backdrop-blur-xl dark:ring-white/5"
          :style="menuStyle"
          data-no-open="true"
          @click.stop
        >
          <div class="flex flex-col items-center gap-4">
            <img :src="dataUrl" alt="QR code" class="h-44 w-44 rounded-3xl bg-white p-3" />
            <button class="btn-secondary w-full gap-2" @click.stop="download">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <path d="m7 10 5 5 5-5"></path>
                <path d="M12 15V3"></path>
              </svg>
              {{ t('qr.download') }}
            </button>
          </div>
        </div>
      </Teleport>
    </Transition>
  </span>
</template>
