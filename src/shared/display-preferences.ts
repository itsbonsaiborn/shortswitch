import type { Locale, ThemeMode } from './types.js';

export type LanguagePreference = 'auto' | Locale;
export type AppearancePreference = ThemeMode;

export interface DisplayPreferences {
  language: LanguagePreference;
  appearance: AppearancePreference;
}

export type PublicDisplayPreferences = DisplayPreferences;

export const PUBLIC_LANGUAGE_PREFERENCE_COOKIE = 'ss_public_language_preference';
export const PUBLIC_APPEARANCE_PREFERENCE_COOKIE = 'ss_public_appearance_preference';
export const defaultDisplayPreferences: DisplayPreferences = { language: 'auto', appearance: 'system' };

export const isLanguagePreference = (value: unknown): value is LanguagePreference =>
  value === 'auto' || value === 'en' || value === 'lv';

export const isAppearancePreference = (value: unknown): value is AppearancePreference =>
  value === 'system' || value === 'light' || value === 'dark';

export const parseDisplayPreferences = (value: unknown): DisplayPreferences => {
  if (!value || typeof value !== 'object') return { ...defaultDisplayPreferences };
  const candidate = value as Partial<DisplayPreferences>;
  return {
    language: isLanguagePreference(candidate.language) ? candidate.language : 'auto',
    appearance: isAppearancePreference(candidate.appearance) ? candidate.appearance : 'system'
  };
};

export const resolveDisplayLocale = (
  preference: LanguagePreference,
  browserLanguage: string | null | undefined
): Locale => preference === 'auto'
  ? ((browserLanguage ?? '').toLowerCase() === 'lv' || (browserLanguage ?? '').toLowerCase().startsWith('lv-') ? 'lv' : 'en')
  : preference;

export const resolveDisplayTheme = (preference: AppearancePreference, prefersDark: boolean): 'light' | 'dark' =>
  preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference;
