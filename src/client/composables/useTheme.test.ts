// @vitest-environment jsdom
import { nextTick, ref } from 'vue';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ThemeMode } from '@/shared/types';

describe('useTheme', () => {
  afterEach(() => {
    vi.doUnmock('@vueuse/core');
    vi.doUnmock('./usePreferences');
    vi.doUnmock('./useDisplayPreferences');
    vi.resetModules();
    document.documentElement.classList.remove('dark');
    delete document.documentElement.dataset.theme;
  });

  test('reacts to system appearance changes only in automatic mode', async () => {
    const preferredDark = ref(false);
    const appearance = ref<ThemeMode>('system');
    vi.doMock('@vueuse/core', () => ({ usePreferredDark: () => preferredDark }));
    vi.doMock('./usePreferences', () => ({ usePreferences: () => ({
      state: { userId: null }, theme: appearance, setTheme: vi.fn()
    }) }));
    vi.doMock('./useDisplayPreferences', () => ({
      useDisplayPreferences: () => ({ publicAppearancePreference: appearance })
    }));

    const { useTheme } = await import('./useTheme');
    const theme = useTheme();
    expect(theme.resolvedTheme.value).toBe('light');

    preferredDark.value = true;
    await nextTick();
    expect(theme.resolvedTheme.value).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    appearance.value = 'light';
    await nextTick();
    expect(theme.resolvedTheme.value).toBe('light');
    preferredDark.value = false;
    await nextTick();
    expect(theme.resolvedTheme.value).toBe('light');
  });

  test('keeps account and public appearance policies independent', async () => {
    const preferredDark = ref(false);
    const accountAppearance = ref<ThemeMode>('light');
    const publicAppearance = ref<ThemeMode>('dark');
    const publicInterface = ref(true);
    vi.doMock('@vueuse/core', () => ({ usePreferredDark: () => preferredDark }));
    vi.doMock('./usePreferences', () => ({ usePreferences: () => ({
      state: { userId: 'admin' }, theme: accountAppearance, setTheme: vi.fn()
    }) }));
    vi.doMock('./useDisplayPreferences', () => ({
      useDisplayPreferences: () => ({ publicAppearancePreference: publicAppearance })
    }));

    const { useTheme } = await import('./useTheme');
    const theme = useTheme(publicInterface);
    expect(theme.resolvedTheme.value).toBe('dark');

    publicInterface.value = false;
    await nextTick();
    expect(theme.resolvedTheme.value).toBe('light');
  });
});
