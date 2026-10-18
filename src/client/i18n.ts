import { createI18n } from 'vue-i18n';
import en from './locales/en.json';
import lv from './locales/lv.json';
import type { Locale } from '@/shared/types';
import { isPublicClientPath, resolvePublicLocale } from '@/shared/public-locale';

const initialLocale = (): Locale => {
  if (typeof window === 'undefined') return 'en';
  if (isPublicClientPath(window.location.pathname)) {
    return resolvePublicLocale(window.navigator.language);
  }
  try {
    const cached = JSON.parse(window.localStorage.getItem('ss_preferences_active') ?? 'null') as { locale?: unknown } | null;
    return cached?.locale === 'lv' ? 'lv' : 'en';
  } catch {
    return 'en';
  }
};

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale(),
  fallbackLocale: 'en',
  messages: { en, lv }
});

export const setDocumentLocale = (locale: Locale) => {
  i18n.global.locale.value = locale;
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
};
