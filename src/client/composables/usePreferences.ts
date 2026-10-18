import { computed, reactive } from 'vue';
import type { CurrentUser, Locale, ThemeMode, UserPreferences } from '@/shared/types';
import { api } from '../lib/api';
import { setDocumentLocale } from '../i18n';

type EditablePreferences = Omit<UserPreferences, 'initialized'>;

const defaults: EditablePreferences = { theme: 'system', sidebarCollapsed: false, locale: 'en' };
const state = reactive({
  ...defaults,
  userId: null as string | null,
  initialized: false,
  syncing: false,
  syncError: ''
});
let pending: Partial<EditablePreferences> = {};
let timer: number | undefined;
let requestSequence = 0;
let appliedSequence = 0;

const isTheme = (value: unknown): value is ThemeMode => ['light', 'dark', 'system'].includes(String(value));
const isLocale = (value: unknown): value is Locale => value === 'en' || value === 'lv';

const readLegacyCookie = (name: string) => {
  if (typeof document === 'undefined') return null;
  return document.cookie.split('; ').find((item) => item.startsWith(`${name}=`))?.split('=').slice(1).join('=') ?? null;
};

const cache = () => {
  if (typeof window === 'undefined' || !state.userId) return;
  const value = { userId: state.userId, theme: state.theme, sidebarCollapsed: state.sidebarCollapsed, locale: state.locale };
  try {
    window.localStorage.setItem(`ss_preferences:${state.userId}`, JSON.stringify(value));
    window.localStorage.setItem('ss_preferences_active', JSON.stringify(value));
  } catch {
    // Preferences still work in-memory when browser storage is unavailable.
  }
};

const flush = async () => {
  if (!state.userId || state.syncing || !Object.keys(pending).length) return;
  const payload = pending;
  const userId = state.userId;
  pending = {};
  const sequence = ++requestSequence;
  state.syncing = true;
  state.syncError = '';
  try {
    const saved = await api<UserPreferences>('/api/settings/preferences', { method: 'PATCH', body: JSON.stringify(payload) });
    if (state.userId === userId && sequence >= appliedSequence) {
      appliedSequence = sequence;
      if (pending.theme === undefined) state.theme = saved.theme;
      if (pending.sidebarCollapsed === undefined) state.sidebarCollapsed = saved.sidebarCollapsed;
      if (pending.locale === undefined) {
        state.locale = saved.locale;
        setDocumentLocale(saved.locale);
      }
      cache();
    }
  } catch (error) {
    if (state.userId !== userId) return;
    pending = { ...payload, ...pending };
    state.syncError = error instanceof Error ? error.message : 'Preference sync failed.';
  } finally {
    state.syncing = false;
    if (Object.keys(pending).length && !state.syncError) void flush();
  }
};

const schedule = () => {
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => void flush(), 180);
};

const apply = (next: Partial<EditablePreferences>, persist = true) => {
  if (next.theme !== undefined) state.theme = next.theme;
  if (next.sidebarCollapsed !== undefined) state.sidebarCollapsed = next.sidebarCollapsed;
  if (next.locale !== undefined) {
    state.locale = next.locale;
    setDocumentLocale(next.locale);
  }
  cache();
  if (persist && state.userId) {
    pending = { ...pending, ...next };
    state.syncError = '';
    schedule();
  }
};

const hydrateUser = (user: CurrentUser) => {
  state.userId = user.id;
  let server = { theme: user.theme, sidebarCollapsed: user.sidebarCollapsed, locale: user.locale };
  if (!user.preferencesInitialized) {
    let legacyTheme = readLegacyCookie('ss_theme') ?? '';
    let legacySidebar = readLegacyCookie('ss_sidebar_collapsed') ?? '';
    try { legacyTheme = decodeURIComponent(legacyTheme); } catch { /* Keep the raw cookie value. */ }
    try { legacySidebar = decodeURIComponent(legacySidebar); } catch { /* Keep the raw cookie value. */ }
    server = {
      theme: isTheme(legacyTheme) ? legacyTheme : server.theme,
      sidebarCollapsed: legacySidebar === '1' ? true : legacySidebar === '0' ? false : server.sidebarCollapsed,
      locale: server.locale
    };
    apply(server, true);
  } else {
    apply(server, false);
  }
  state.initialized = true;
};

const reset = () => {
  if (timer) window.clearTimeout(timer);
  timer = undefined;
  pending = {};
  state.userId = null;
  state.initialized = false;
  state.syncing = false;
  state.syncError = '';
  Object.assign(state, defaults);
  setDocumentLocale('en');
  if (typeof window !== 'undefined') {
    try { window.localStorage.removeItem('ss_preferences_active'); } catch { /* Storage can be disabled. */ }
  }
};

export const usePreferences = () => ({
  state,
  theme: computed(() => state.theme),
  sidebarCollapsed: computed(() => state.sidebarCollapsed),
  locale: computed(() => state.locale),
  syncing: computed(() => state.syncing),
  syncError: computed(() => state.syncError),
  hydrateUser,
  reset,
  setTheme: (theme: ThemeMode) => apply({ theme }),
  setSidebarCollapsed: (sidebarCollapsed: boolean) => apply({ sidebarCollapsed }),
  setLocale: (locale: Locale) => apply({ locale }),
  retry: () => { state.syncError = ''; void flush(); }
});
