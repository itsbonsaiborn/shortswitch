import { computed, reactive, ref } from 'vue';
import {
  PUBLIC_APPEARANCE_PREFERENCE_COOKIE,
  PUBLIC_LANGUAGE_PREFERENCE_COOKIE,
  defaultDisplayPreferences,
  isAppearancePreference,
  isLanguagePreference,
  resolveDisplayLocale,
  type PublicDisplayPreferences
} from '@/shared/display-preferences';

const readCookie = (name: string) => {
  if (typeof document === 'undefined') return null;
  const raw = document.cookie.split('; ').find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!raw) return null;
  try { return decodeURIComponent(raw); } catch { return raw; }
};

const initialLanguage = readCookie(PUBLIC_LANGUAGE_PREFERENCE_COOKIE);
const initialAppearance = readCookie(PUBLIC_APPEARANCE_PREFERENCE_COOKIE);
const state = reactive<PublicDisplayPreferences>({
  language: isLanguagePreference(initialLanguage) ? initialLanguage : defaultDisplayPreferences.language,
  appearance: isAppearancePreference(initialAppearance) ? initialAppearance : defaultDisplayPreferences.appearance
});
const browserLanguage = ref(typeof navigator === 'undefined' ? 'en' : navigator.language);

const setPublicDisplayPreferences = (preferences: PublicDisplayPreferences) => {
  state.language = preferences.language;
  state.appearance = preferences.appearance;
};

if (typeof window !== 'undefined') {
  window.addEventListener('languagechange', () => { browserLanguage.value = navigator.language; });
}

export const useDisplayPreferences = () => ({
  publicLanguagePreference: computed(() => state.language),
  publicAppearancePreference: computed(() => state.appearance),
  resolvedPublicLocale: computed(() => resolveDisplayLocale(state.language, browserLanguage.value)),
  setPublicDisplayPreferences
});
