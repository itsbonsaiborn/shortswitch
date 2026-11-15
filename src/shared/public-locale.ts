import type { Locale } from './types.js';
import { isLanguagePreference, resolveDisplayLocale } from './display-preferences.js';

export const resolvePublicLocale = (language: string | null | undefined): Locale => {
  const primary = language?.split(',', 1)[0]?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return primary === 'lv' || primary.startsWith('lv-') ? 'lv' : 'en';
};

export const resolvePreferredPublicLocale = (
  preference: string | null | undefined,
  language: string | null | undefined
): Locale => resolveDisplayLocale(isLanguagePreference(preference) ? preference : 'auto', language);

export const isPublicClientPath = (pathname: string) => {
  if (/^\/present\/[^/]+\/?$/i.test(pathname)) return true;
  if (!/^\/[^/]+\/?$/.test(pathname)) return false;
  return pathname !== '/' && pathname !== '/login';
};
