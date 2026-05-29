import { computed, reactive } from 'vue';
import { api } from '../lib/api';
import type { CurrentUser } from '@/shared/types';

const state = reactive<{
  user: CurrentUser | null;
  initialized: boolean;
}>({
  user: null,
  initialized: false
});

export const useAuth = () => {
  const loadUser = async () => {
    try {
      state.user = await api<CurrentUser>('/api/auth/me');
    } catch {
      state.user = null;
    } finally {
      state.initialized = true;
    }
  };

  const login = async (email: string, password: string) => {
    state.user = await api<CurrentUser>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    return state.user;
  };

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    state.user = null;
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
