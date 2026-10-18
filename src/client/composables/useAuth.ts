import { computed, reactive } from 'vue';
import { api } from '../lib/api';
import type { CurrentUser } from '@/shared/types';
import { usePreferences } from './usePreferences';

const state = reactive<{
  user: CurrentUser | null;
  initialized: boolean;
}>({
  user: null,
  initialized: false
});

export const useAuth = () => {
  const preferences = usePreferences();
  const loadUser = async () => {
    try {
      state.user = await api<CurrentUser>('/api/auth/me');
      preferences.hydrateUser(state.user);
    } catch {
      state.user = null;
      preferences.reset();
    } finally {
      state.initialized = true;
    }
  };

  const login = async (email: string, password: string) => {
    state.user = await api<CurrentUser>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    preferences.hydrateUser(state.user);
    return state.user;
  };

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    state.user = null;
    preferences.reset();
  };

  return {
    state,
    user: computed(() => state.user),
    initialized: computed(() => state.initialized),
    loadUser,
    login,
    logout
  };
};
