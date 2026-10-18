import { computed, watch } from 'vue';
import { usePreferredDark } from '@vueuse/core';
import { usePreferences } from './usePreferences';

export const useTheme = () => {
  const preferredDark = usePreferredDark();
  const { theme, setTheme } = usePreferences();

  const resolvedTheme = computed(() => {
    if (theme.value === 'light') return 'light';
    if (theme.value === 'dark') return 'dark';
    return preferredDark.value ? 'dark' : 'light';
  });

  watch(
    resolvedTheme,
    (theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
    },
    { immediate: true }
  );

  return { theme, resolvedTheme, setTheme };
};
