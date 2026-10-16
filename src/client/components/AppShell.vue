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
const emit = defineEmits<{ createLink: []; createLive: []; createPage: [] }>();

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
const createMenuRef = ref<HTMLElement | null>(null);
const createMenuOpen = ref(false);
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
    name: 'Pages',
    path: '/app/pages',
    icon: 'pages'
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
const runCreateAction = (action: 'link' | 'live' | 'page') => {
  createMenuOpen.value = false;
  if (action === 'link') emit('createLink');
  else if (action === 'live') emit('createLive');
  else emit('createPage');
};

const closeSidebarOnOutsideClick = (event: MouseEvent) => {
  const target = event.target as Node | null;
  if (createMenuOpen.value && !createMenuRef.value?.contains(target)) createMenuOpen.value = false;
  if (!showMenuButton.value || !mobileOpen.value) return;
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
          class="panel z-[60] flex min-h-0 flex-col p-4 transition-all duration-300 ease-out md:p-5"
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
                  <svg v-else-if="tab.icon === 'pages'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-5 w-5">
                    <path d="M6 2.75A2.75 2.75 0 0 0 3.25 5.5v13A2.75 2.75 0 0 0 6 21.25h12a2.75 2.75 0 0 0 2.75-2.75v-13A2.75 2.75 0 0 0 18 2.75zm1.25 4.5h9.5v1.5h-9.5zm0 4h9.5v1.5h-9.5zm0 4h6.5v1.5h-6.5z" />
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
            <div
              class="panel-muted flex items-center gap-3"
              :class="sidebarCollapsed ? 'justify-center p-1' : 'justify-between p-4'"
            >
              <div v-if="!sidebarCollapsed" class="min-w-0">
                <p class="truncate text-sm font-medium">{{ user?.name }}</p>
                <p class="truncate text-xs text-[var(--ui-text-muted)]">{{ user?.email }}</p>
              </div>
              <button
                type="button"
                class="flex shrink-0 items-center justify-center rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-panel)] text-[var(--ui-text-muted)] transition-all duration-200 hover:border-[var(--ui-accent)] hover:bg-[var(--ui-accent-soft)] hover:text-[var(--ui-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-accent)]"
                :class="sidebarCollapsed ? 'h-10 w-10' : 'h-11 w-12'"
                aria-label="Sign out"
                title="Sign out"
                @click="doLogout"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M0 0h24v24H0z" fill="none" />
                  <g fill="currentColor" fill-rule="evenodd" clip-rule="evenodd">
                    <path d="M15.99 7.823a.75.75 0 0 1 1.061.021l3.49 3.637a.75.75 0 0 1 0 1.038l-3.49 3.637a.75.75 0 0 1-1.082-1.039l2.271-2.367h-6.967a.75.75 0 0 1 0-1.5h6.968l-2.272-2.367a.75.75 0 0 1 .022-1.06" />
                    <path d="M3.25 4A.75.75 0 0 1 4 3.25h9.455a.75.75 0 0 1 .75.75v3a.75.75 0 1 1-1.5 0V4.75H4.75v14.5h7.954V17a.75.75 0 0 1 1.5 0v3a.75.75 0 0 1-.75.75H4a.75.75 0 0 1-.75-.75z" />
                  </g>
                </svg>
              </button>
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
          class="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm"
          @click="mobileOpen = false"
        />
      </Transition>

      <div class="flex min-h-[calc(100dvh-1.5rem)] min-w-0 flex-col gap-4">
        <header class="panel relative z-40 px-4 py-4 md:px-6">
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
              class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 sm:flex sm:items-center sm:gap-3"
              :class="showMenuButton ? 'w-full' : 'self-start lg:self-center'"
            >
              <div ref="createMenuRef" class="relative min-w-0">
                <button
                  class="btn-primary h-11 w-full whitespace-nowrap px-5 text-sm sm:w-auto"
                  :aria-expanded="createMenuOpen"
                  aria-haspopup="menu"
                  @click.stop="createMenuOpen = !createMenuOpen"
                >Create</button>
                <Transition
                  enter-active-class="transition duration-200 ease-out"
                  enter-from-class="-translate-y-1 opacity-0"
                  enter-to-class="translate-y-0 opacity-100"
                  leave-active-class="transition duration-150 ease-in"
                  leave-from-class="opacity-100"
                  leave-to-class="opacity-0"
                >
                  <div v-if="createMenuOpen" class="absolute right-0 z-[70] mt-2 w-48 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-dropdown-bg)] p-2 shadow-xl" role="menu">
                    <button class="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-[var(--ui-panel-muted)]" role="menuitem" @click="runCreateAction('link')">Create Link</button>
                    <button class="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-[var(--ui-panel-muted)]" role="menuitem" @click="runCreateAction('live')">Create Live</button>
                    <button class="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-[var(--ui-panel-muted)]" role="menuitem" @click="runCreateAction('page')">Create Page</button>
                  </div>
                </Transition>
              </div>
              <div
                class="grid h-11 shrink-0 grid-cols-2 divide-x divide-[var(--ui-border)] overflow-hidden rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-panel)]"
                role="group"
                aria-label="Color theme"
              >
                <button
                  type="button"
                  class="flex h-full w-11 items-center justify-center transition-colors duration-200 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ui-accent)]"
                  :class="resolvedTheme === 'light' ? 'bg-[var(--ui-accent-soft)] text-[var(--ui-accent)]' : 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'"
                  :aria-pressed="resolvedTheme === 'light'"
                  aria-label="Use light theme"
                  title="Light theme"
                  @click="setTheme('light')"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M0 0h24v24H0z" fill="none" />
                    <path fill="currentColor" d="M12 7a5 5 0 1 0 0 10a5 5 0 0 0 0-10" />
                    <path fill="currentColor" fill-rule="evenodd" d="M12 1a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V2a1 1 0 0 1 1-1M3.293 3.293a1 1 0 0 1 1.414 0l1.5 1.5a1 1 0 0 1-1.414 1.414l-1.5-1.5a1 1 0 0 1 0-1.414m17.414 0a1 1 0 0 1 0 1.414l-1.5 1.5a1 1 0 1 1-1.414-1.414l1.5-1.5a1 1 0 0 1 1.414 0M1 12a1 1 0 0 1 1-1h1a1 1 0 1 1 0 2H2a1 1 0 0 1-1-1m19 0a1 1 0 0 1 1-1h1a1 1 0 1 1 0 2h-1a1 1 0 0 1-1-1M6.207 17.793a1 1 0 0 1 0 1.414l-1.5 1.5a1 1 0 0 1-1.414-1.414l1.5-1.5a1 1 0 0 1 1.414 0m11.586 0a1 1 0 0 1 1.414 0l1.5 1.5a1 1 0 0 1-1.414 1.414l-1.5-1.5a1 1 0 0 1 0-1.414M12 20a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1" clip-rule="evenodd" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="flex h-full w-11 items-center justify-center transition-colors duration-200 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ui-accent)]"
                  :class="resolvedTheme === 'dark' ? 'bg-[var(--ui-accent-soft)] text-[var(--ui-accent)]' : 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'"
                  :aria-pressed="resolvedTheme === 'dark'"
                  aria-label="Use dark theme"
                  title="Dark theme"
                  @click="setTheme('dark')"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 1024 1024" aria-hidden="true">
                    <path d="M0 0h1024v1024H0z" fill="none" />
                    <path fill="currentColor" fill-rule="evenodd" d="M489.493 111.658c30.658-1.792 45.991 36.44 22.59 56.329C457.831 214.095 426 281.423 426 354c0 134.757 109.243 244 244 244c72.577 0 139.905-31.832 186.014-86.084c19.868-23.377 58.064-8.102 56.332 22.53C900.4 745.823 725.141 912 512.5 912C291.31 912 112 732.69 112 511.5c0-211.39 164.287-386.024 374.198-399.649l.206-.013z" />
                  </svg>
                </button>
              </div>
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
