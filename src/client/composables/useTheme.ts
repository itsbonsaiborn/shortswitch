import { computed, ref, watch, type Ref } from 'vue';
import { usePreferredDark } from '@vueuse/core';
import { usePreferences } from './usePreferences';
import { useDisplayPreferences } from './useDisplayPreferences';

export const useTheme = (usesPublicPreferences: Ref<boolean> = ref(false)) => {
  const preferredDark = usePreferredDark();
  const preferences = usePreferences();
  const { publicAppearancePreference } = useDisplayPreferences();
  const theme = computed(() => usesPublicPreferences.value ? publicAppearancePreference.value : preferences.theme.value);

  const resolvedTheme = computed(() => {
    if (theme.value === 'light') return 'light';
    if (theme.value === 'dark') return 'dark';
    return preferredDark.value ? 'dark' : 'light';
  });

  watch(
    resolvedTheme,
    (resolved) => {
      document.documentElement.classList.toggle('dark', resolved === 'dark');
      document.documentElement.dataset.theme = theme.value;
    },
    { immediate: true }
  );

  return { theme, resolvedTheme, setTheme: preferences.setTheme };
};
