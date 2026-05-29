import { computed, watch } from 'vue';
import { usePreferredDark } from '@vueuse/core';
import { api } from '../lib/api';
import { useAuth } from './useAuth';

const readSessionTheme = () => {
  if (typeof document === 'undefined') return null;
  const value = document.cookie
    .split('; ')
    .find((item) => item.startsWith('ss_theme='))
    ?.split('=')
    .slice(1)
    .join('=');
  if (!value) return null;
  const decoded = decodeURIComponent(value);
  return decoded === 'light' || decoded === 'dark' || decoded === 'system' ? decoded : null;
};

const writeSessionTheme = (theme: 'light' | 'dark' | 'system') => {
  if (typeof document === 'undefined') return;
  document.cookie = `ss_theme=${encodeURIComponent(theme)}; path=/; SameSite=Lax`;
};

export const useTheme = () => {
  const preferredDark = usePreferredDark();
  const { user } = useAuth();

  const resolvedTheme = computed(() => {
    const sessionTheme = readSessionTheme();
    const sourceTheme = user.value?.theme ?? sessionTheme ?? 'system';

    if (sourceTheme === 'light') return 'light';
    if (sourceTheme === 'dark') return 'dark';
    return preferredDark.value ? 'dark' : 'light';
  });

  watch(
    resolvedTheme,
    (theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
    },
    { immediate: true }
  );

  const setTheme = async (theme: 'light' | 'dark' | 'system') => {
    writeSessionTheme(theme);
    if (!user.value) return;
    user.value.theme = theme;
    await api('/api/settings/theme', {
      method: 'POST',
      body: JSON.stringify({ theme })
    });
  };

  return { resolvedTheme, setTheme };
};
