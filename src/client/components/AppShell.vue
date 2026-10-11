<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useWindowSize } from '@vueuse/core';
import { useAuth } from '../composables/useAuth';
import { useAppConfig } from '../composables/useAppConfig';
import { useTheme } from '../composables/useTheme';

const route = useRoute();
const router = useRouter();
const { user, logout } = useAuth();
const { appName, loadAppConfig } = useAppConfig();
const { resolvedTheme, setTheme } = useTheme();
const emit = defineEmits<{ createLink: []; createLive: [] }>();

const readSessionCookie = (name: string) => {
  if (typeof document === 'undefined') return null;
  return (
    document.cookie
      .split('; ')
      .find((item) => item.startsWith(`${name}=`))
      ?.split('=')
      .slice(1)
      .join('=') ?? null
  );
};

const writeSessionCookie = (name: string, value: string) => {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; SameSite=Lax`;
};

const mobileOpen = ref(false);
const sidebarRef = ref<HTMLElement | null>(null);
const menuButtonRef = ref<HTMLElement | null>(null);
const { width } = useWindowSize();

const manualCollapsed = ref(false);
const tabs = [
  {
    name: 'Links',
    path: '/app/links',
    icon: 'links'
  },
  {
    name: 'Live',
    path: '/app/live',
    icon: 'live'
  },
  {
    name: 'Analytics',
    path: '/app/analytics',
    icon: 'analytics'
  },
  {
    name: 'Settings',
    path: '/app/settings',
    icon: 'settings'
  }
] as const;

const activePath = computed(() =>
  tabs.find((tab) => route.path.startsWith(tab.path))?.path ?? '/app/links'
);
const hasInlineSidebar = computed(() => width.value >= 1100);
const autoCollapsed = computed(() => hasInlineSidebar.value && width.value < 1360);
const sidebarCollapsed = computed(() => hasInlineSidebar.value && (autoCollapsed.value || manualCollapsed.value));
const showMenuButton = computed(() => !hasInlineSidebar.value);
const sidebarGridClass = computed(() =>
  hasInlineSidebar.value
    ? sidebarCollapsed.value
      ? 'grid-cols-[88px_minmax(0,1fr)]'
      : 'grid-cols-[260px_minmax(0,1fr)]'
    : 'grid-cols-1'
);
const shellGridStyle = computed(() =>
  hasInlineSidebar.value
    ? { gridTemplateColumns: sidebarCollapsed.value ? '88px minmax(0,1fr)' : '260px minmax(0,1fr)' }
    : undefined
);

watch(
  manualCollapsed,
  (value) => {
    writeSessionCookie('ss_sidebar_collapsed', value ? '1' : '0');
  },
  { flush: 'post' }
);

watch(hasInlineSidebar, (inline) => {
  if (inline) mobileOpen.value = false;
});

const toggleSidebar = () => {
  if (!hasInlineSidebar.value) {
    mobileOpen.value = !mobileOpen.value;
    return;
  }
  manualCollapsed.value = !manualCollapsed.value;
};

const doLogout = async () => {
  await logout();
  await router.push('/login');
};

const closeSidebarOnOutsideClick = (event: MouseEvent) => {
  if (!showMenuButton.value || !mobileOpen.value) return;
  const target = event.target as Node | null;
  if (sidebarRef.value?.contains(target)) return;
  if (menuButtonRef.value?.contains(target)) return;
  mobileOpen.value = false;
};

onMounted(() => {
  const savedValue = readSessionCookie('ss_sidebar_collapsed');
  manualCollapsed.value = savedValue === '1';
  loadAppConfig();
  document.addEventListener('click', closeSidebarOnOutsideClick);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', closeSidebarOnOutsideClick);
});
</script>

<template>
  <div class="box-border min-h-dvh px-3 py-3 md:px-4 md:py-4">
    <div
      class="grid min-h-[calc(100dvh-1.5rem)] w-full gap-4 transition-[grid-template-columns] duration-300 ease-out"
      :class="sidebarGridClass"
      :style="shellGridStyle"
    >
      <Transition
        enter-active-class="transition duration-300 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-200 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <aside
          v-if="hasInlineSidebar || mobileOpen"
          ref="sidebarRef"
          class="panel z-40 flex min-h-0 flex-col p-4 transition-all duration-300 ease-out md:p-5"
          :class="hasInlineSidebar ? 'sticky top-4 h-[calc(100dvh-2rem)]' : 'fixed inset-y-3 left-3 w-[min(86vw,290px)]'"
        >
          <div class="flex items-center gap-3" :class="sidebarCollapsed ? 'justify-center' : ''">
            <img
              src="/icons/icon-192.png"
              alt=""
              class="h-11 w-11 shrink-0 object-contain"
            />
            <div v-if="!sidebarCollapsed" class="min-w-0">
              <p class="truncate text-lg font-semibold">{{ appName }}</p>
              <p class="truncate text-sm text-[var(--ui-text-muted)]">Self-hosted control tower</p>
            </div>
          </div>

          <nav class="mt-8 space-y-2">
            <button
              v-for="tab in tabs"
              :key="tab.path"
              class="flex w-full items-center rounded-2xl px-4 py-3 text-left transition-colors duration-200"
              :class="
                activePath === tab.path
                  ? 'bg-[var(--ui-accent)] text-[var(--ui-accent-contrast)]'
                  : 'text-[var(--ui-text)] hover:bg-[var(--ui-panel-muted)]'
              "
              @click="router.push(tab.path); mobileOpen = false"
            >
              <span class="flex w-full items-center" :class="sidebarCollapsed ? 'justify-center' : 'justify-between gap-3'">
                <span v-if="!sidebarCollapsed">{{ tab.name }}</span>
                <span
                  class="flex h-5 w-5 items-center justify-center"
                  :class="sidebarCollapsed ? 'scale-110' : 'opacity-85'"
                >
                  <svg v-if="tab.icon === 'links'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
                    <path d="M17.74 2.76a4.32 4.32 0 0 1 0 6.1l-1.53 1.52c-1.12 1.12-2.7 1.47-4.14 1.09l2.62-2.61l.76-.77l.76-.76c.84-.84.84-2.2 0-3.04a2.13 2.13 0 0 0-3.04 0l-.77.76l-3.38 3.38c-.37-1.44-.02-3.02 1.1-4.14l1.52-1.53a4.32 4.32 0 0 1 6.1 0M8.59 13.43l5.34-5.34c.42-.42.42-1.1 0-1.52c-.44-.43-1.13-.39-1.53 0l-5.33 5.34c-.42.42-.42 1.1 0 1.52c.44.43 1.13.39 1.52 0m-.76 2.29l4.14-4.15c.38 1.44.03 3.02-1.09 4.14l-1.52 1.53a4.32 4.32 0 0 1-6.1 0a4.32 4.32 0 0 1 0-6.1l1.53-1.52c1.12-1.12 2.7-1.47 4.14-1.1l-4.14 4.15c-.85.84-.85 2.2 0 3.05c.84.84 2.2.84 3.04 0" />
                  </svg>
                  <svg v-else-if="tab.icon === 'live'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-5 w-5">
                    <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-5l-4.5 4v-4H6a2 2 0 0 1-2-2zm4 3a1 1 0 1 0 0 2a1 1 0 0 0 0-2m4 0a1 1 0 1 0 0 2a1 1 0 0 0 0-2m4 0a1 1 0 1 0 0 2a1 1 0 0 0 0-2" />
                  </svg>
                  <svg v-else-if="tab.icon === 'analytics'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-5 w-5">
                    <path d="M3 22V8h4v14zm7 0V2h4v20zm7 0v-8h4v8z" />
                  </svg>
                  <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-5 w-5">
                    <path d="M10.825 22q-.675 0-1.162-.45t-.588-1.1L8.85 18.8q-.325-.125-.612-.3t-.563-.375l-1.55.65q-.625.275-1.25.05t-.975-.8l-1.175-2.05q-.35-.575-.2-1.225t.675-1.075l1.325-1Q4.5 12.5 4.5 12.337v-.675q0-.162.025-.337l-1.325-1Q2.675 9.9 2.525 9.25t.2-1.225L3.9 5.975q.35-.575.975-.8t1.25.05l1.55.65q.275-.2.575-.375t.6-.3l.225-1.65q.1-.65.588-1.1T10.825 2h2.35q.675 0 1.163.45t.587 1.1l.225 1.65q.325.125.613.3t.562.375l1.55-.65q.625-.275 1.25-.05t.975.8l1.175 2.05q.35.575.2 1.225t-.675 1.075l-1.325 1q.025.175.025.338v.674q0 .163-.05.338l1.325 1q.525.425.675 1.075t-.2 1.225l-1.2 2.05q-.35.575-.975.8t-1.25-.05l-1.5-.65q-.275.2-.575.375t-.6.3l-.225 1.65q-.1.65-.587 1.1t-1.163.45zm1.225-6.5q1.45 0 2.475-1.025T15.55 12t-1.025-2.475T12.05 8.5q-1.475 0-2.488 1.025T8.55 12t1.013 2.475T12.05 15.5" />
                  </svg>
                </span>
              </span>
            </button>
          </nav>

          <div class="mt-auto pt-8">
            <div class="panel-muted p-4" :class="sidebarCollapsed ? 'px-2 py-3 text-center' : ''">
              <p class="truncate text-sm font-medium">{{ sidebarCollapsed ? user?.name?.charAt(0) : user?.name }}</p>
              <p v-if="!sidebarCollapsed" class="truncate text-xs text-[var(--ui-text-muted)]">{{ user?.email }}</p>
            </div>
          </div>
        </aside>
      </Transition>

      <Transition
        enter-active-class="transition duration-200"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-200"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <button
          v-if="mobileOpen && showMenuButton"
          aria-label="Close menu overlay"
          class="fixed inset-0 z-30 bg-black/45 backdrop-blur-sm"
          @click="mobileOpen = false"
        />
      </Transition>

      <div class="flex min-h-[calc(100dvh-1.5rem)] min-w-0 flex-col gap-4">
        <header class="panel px-4 py-4 md:px-6">
          <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div class="flex min-w-0 items-start gap-3 lg:items-center">
              <div class="flex min-w-0 items-center gap-3">
                <button
                  v-if="showMenuButton"
                  ref="menuButtonRef"
                  class="btn-secondary h-11 px-4"
                  @click.stop="mobileOpen = !mobileOpen"
                >
                  Menu
                </button>
                <button
                  v-else
                  class="btn-secondary h-11 shrink-0 gap-2 px-3"
                  :aria-label="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
                  @click="toggleSidebar"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9.367 2.25h5.266c1.092 0 1.958 0 2.655.057c.714.058 1.317.18 1.869.46a4.75 4.75 0 0 1 2.075 2.077c.281.55.403 1.154.461 1.868c.057.697.057 1.563.057 2.655v5.266c0 1.092 0 1.958-.057 2.655c-.058.714-.18 1.317-.46 1.869a4.75 4.75 0 0 1-2.076 2.075c-.552.281-1.155.403-1.869.461c-.697.057-1.563.057-2.655.057H9.367c-1.092 0-1.958 0-2.655-.057c-.714-.058-1.317-.18-1.868-.46a4.75 4.75 0 0 1-2.076-2.076c-.281-.552-.403-1.155-.461-1.869c-.057-.697-.057-1.563-.057-2.655V9.367c0-1.092 0-1.958.057-2.655c.058-.714.18-1.317.46-1.868a4.75 4.75 0 0 1 2.077-2.076c.55-.281 1.154-.403 1.868-.461c.697-.057 1.563-.057 2.655-.057M6.834 3.802c-.62.05-1.005.147-1.31.302a3.25 3.25 0 0 0-1.42 1.42c-.155.305-.251.69-.302 1.31c-.051.63-.052 1.434-.052 2.566v5.2c0 1.133 0 1.937.052 2.566c.05.62.147 1.005.302 1.31a3.25 3.25 0 0 0 1.42 1.42c.305.155.69.251 1.31.302c.392.032.851.044 1.416.05V3.752c-.565.005-1.024.017-1.416.049" />
                  </svg>
                  <span class="text-sm font-medium">
                    {{ sidebarCollapsed ? 'Expand' : 'Collapse' }}
                  </span>
                </button>
                <div class="min-w-0">
                  <p class="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--ui-accent)]">Dashboard</p>
                  <h1 class="truncate text-xl font-semibold text-[var(--ui-text)]">{{ route.meta?.title ?? appName }}</h1>
                </div>
              </div>
            </div>

            <div
              class="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-3"
              :class="showMenuButton ? 'w-full' : 'self-start lg:self-center'"
            >
              <button class="btn-primary h-11 min-w-0 whitespace-nowrap px-3 text-[13px] sm:flex-none sm:px-4 sm:text-sm" @click="emit('createLink')">Create Link</button>
              <button class="btn-secondary h-11 min-w-0 whitespace-nowrap px-3 text-[13px] sm:flex-none sm:px-4 sm:text-sm" @click="emit('createLive')">Create Live</button>
              <button class="btn-secondary h-11 min-w-0 whitespace-nowrap px-3 text-[13px] sm:flex-none sm:px-4 sm:text-sm" @click="setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')">
                {{ resolvedTheme === 'dark' ? 'Light' : 'Dark' }}
              </button>
              <button class="btn-secondary h-11 min-w-0 whitespace-nowrap px-3 text-[13px] sm:flex-none sm:px-4 sm:text-sm" @click="doLogout">Sign out</button>
            </div>
          </div>
        </header>

        <main class="min-w-0 flex-1" @click="showMenuButton && mobileOpen ? mobileOpen = false : undefined">
          <slot />
        </main>
      </div>
    </div>
  </div>
</template>
