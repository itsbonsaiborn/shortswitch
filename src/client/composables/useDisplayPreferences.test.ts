// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('public display preferences', () => {
  beforeEach(() => {
    document.cookie = 'ss_public_language_preference=; Max-Age=0; Path=/';
    document.cookie = 'ss_public_appearance_preference=; Max-Age=0; Path=/';
    vi.resetModules();
  });

  test('applies the server-owned policy without writing browser storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { useDisplayPreferences } = await import('./useDisplayPreferences');
    const preferences = useDisplayPreferences();
    preferences.setPublicDisplayPreferences({ language: 'lv', appearance: 'dark' });

    expect(preferences.publicLanguagePreference.value).toBe('lv');
    expect(preferences.publicAppearancePreference.value).toBe('dark');
    expect(preferences.resolvedPublicLocale.value).toBe('lv');
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  test('uses public preference cookies as the no-flash startup cache', async () => {
    document.cookie = 'ss_public_language_preference=en; Path=/';
    document.cookie = 'ss_public_appearance_preference=light; Path=/';
    const { useDisplayPreferences } = await import('./useDisplayPreferences');
    const preferences = useDisplayPreferences();

    expect(preferences.publicLanguagePreference.value).toBe('en');
    expect(preferences.publicAppearancePreference.value).toBe('light');
    expect(preferences.resolvedPublicLocale.value).toBe('en');
  });
});
