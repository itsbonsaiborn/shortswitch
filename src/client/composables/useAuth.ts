import { computed, reactive } from 'vue';
import { api } from '../lib/api';
import type { CurrentUser, TwoFactorLoginRequired } from '@/shared/types';
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
    const result = await api<CurrentUser | TwoFactorLoginRequired>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    if ('requiresTwoFactor' in result) return result;
    state.user = result;
    preferences.hydrateUser(state.user);
    return state.user;
  };

  const verifyTwoFactor = async (code: string) => {
    state.user = await api<CurrentUser>('/api/auth/two-factor', {
      method: 'POST',
      body: JSON.stringify({ code })
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
    verifyTwoFactor,
    logout
  };
};
