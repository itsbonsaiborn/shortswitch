// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', () => ({ api: apiMock }));

const createStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); }
  };
};

describe('usePreferences', () => {
  beforeEach(() => {
    const storage = createStorage();
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    vi.useFakeTimers();
    apiMock.mockReset();
    localStorage.clear();
  });

  test('hydrates server preferences, updates immediately and coalesces fast changes', async () => {
    apiMock.mockResolvedValue({ theme: 'dark', sidebarCollapsed: true, locale: 'lv', initialized: true });
    const { usePreferences } = await import('./usePreferences');
    const preferences = usePreferences();
    preferences.reset();
    preferences.hydrateUser({
      id: 'user-1', email: 'admin@example.com', name: 'Admin', theme: 'light',
      sidebarCollapsed: false, locale: 'en', preferencesInitialized: true
    });

    preferences.setTheme('dark');
    preferences.setSidebarCollapsed(true);
    preferences.setLocale('lv');
    expect(preferences.theme.value).toBe('dark');
    expect(preferences.locale.value).toBe('lv');
    await vi.advanceTimersByTimeAsync(200);

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(apiMock.mock.calls[0][1].body))).toEqual({
      theme: 'dark', sidebarCollapsed: true, locale: 'lv'
    });
    expect(JSON.parse(localStorage.getItem('ss_preferences:user-1') ?? '{}')).toMatchObject({ locale: 'lv' });
  });

  test('clears the active cache and preferences when a user signs out', async () => {
    const { usePreferences } = await import('./usePreferences');
    const preferences = usePreferences();
    preferences.reset();
    preferences.hydrateUser({
      id: 'user-2', email: 'user@example.com', name: 'User', theme: 'dark',
      sidebarCollapsed: true, locale: 'lv', preferencesInitialized: true
    });
    preferences.reset();
    expect(preferences.theme.value).toBe('system');
    expect(preferences.locale.value).toBe('en');
    expect(localStorage.getItem('ss_preferences_active')).toBeNull();
  });

  test('does not overwrite a newer optimistic value with an older server response', async () => {
    let resolveRequest!: (value: unknown) => void;
    apiMock.mockImplementationOnce(() => new Promise((resolve) => { resolveRequest = resolve; }));
    apiMock.mockResolvedValueOnce({ theme: 'light', sidebarCollapsed: false, locale: 'lv', initialized: true });
    const { usePreferences } = await import('./usePreferences');
    const preferences = usePreferences();
    preferences.reset();
    preferences.hydrateUser({
      id: 'user-race', email: 'admin@example.com', name: 'Admin', theme: 'light',
      sidebarCollapsed: false, locale: 'en', preferencesInitialized: true
    });

    preferences.setTheme('dark');
    await vi.advanceTimersByTimeAsync(200);
    preferences.setTheme('light');
    resolveRequest({ theme: 'dark', sidebarCollapsed: false, locale: 'en', initialized: true });
    await Promise.resolve();

    expect(preferences.theme.value).toBe('light');
    await vi.advanceTimersByTimeAsync(200);
    expect(apiMock).toHaveBeenCalledTimes(2);
  });
});
