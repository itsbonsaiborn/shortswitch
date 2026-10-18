import type { Locale } from './types.js';

export const resolvePublicLocale = (language: string | null | undefined): Locale => {
  const primary = language?.split(',', 1)[0]?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return primary === 'lv' || primary.startsWith('lv-') ? 'lv' : 'en';
};

export const isPublicClientPath = (pathname: string) => {
  if (/^\/present\/[^/]+\/?$/i.test(pathname)) return true;
  if (!/^\/[^/]+\/?$/.test(pathname)) return false;
  return pathname !== '/' && pathname !== '/login';
};
