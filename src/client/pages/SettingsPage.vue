<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { UAParser } from 'ua-parser-js';
import { api } from '../lib/api';
import { useToast } from '../composables/useToast';
import type { UserSession } from '@/shared/types';

const sessions = ref<UserSession[]>([]);
const password = ref('');
const clearingAnalytics = ref(false);
const { pushToast } = useToast();

const formatSessionTime = (value: string) =>
  new Date(value).toLocaleString();

const formatUserAgent = (value: string | null) => {
  if (!value) return 'Unknown browser on Unknown OS (unknown device)';

  const parser = new UAParser(value);
  const browser = parser.getBrowser().name ?? 'Unknown browser';
  const os = parser.getOS().name ?? 'Unknown OS';
  const deviceType = parser.getDevice().type ?? 'desktop';

  return `${browser} on ${os} (${deviceType})`;
};

const load = async () => {
  try {
    sessions.value = await api<UserSession[]>('/api/sessions');
  } catch (error) {
    pushToast({ tone: 'error', title: 'Failed to load sessions', description: (error as Error).message });
  }
};

const revoke = async (id: string) => {
  try {
    await api(`/api/sessions/${id}`, { method: 'DELETE', body: JSON.stringify({}) });
    sessions.value = sessions.value.filter((session) => session.id !== id);
    pushToast({ tone: 'error', title: 'Session revoked', description: 'The selected session was removed.' });
  } catch (error) {
    pushToast({ tone: 'error', title: 'Failed to revoke session', description: (error as Error).message });
  }
};

const changePassword = async () => {
  if (!password.value.trim()) {
    pushToast({ tone: 'error', title: 'Failed to change password', description: 'Enter a new password first.' });
    return;
  }
  try {
    await api('/api/settings/password', { method: 'POST', body: JSON.stringify({ password: password.value }) });
    password.value = '';
    pushToast({ tone: 'success', title: 'Password updated', description: 'Other active sessions were invalidated.' });
  } catch (error) {
    pushToast({ tone: 'error', title: 'Failed to change password', description: (error as Error).message });
  }
};

const clearAnalytics = async () => {
  clearingAnalytics.value = true;
  try {
    await api('/api/settings/analytics/clear', { method: 'POST', body: JSON.stringify({}) });
    pushToast({
      tone: 'error',
      title: 'Analytics cleared',
      description: 'All recorded analytics events were removed and link counters were reset.'
    });
  } catch (error) {
    pushToast({ tone: 'error', title: 'Failed to clear analytics', description: (error as Error).message });
  } finally {
    clearingAnalytics.value = false;
  }
};

onMounted(load);
</script>

<template>
  <div class="grid min-w-0 gap-4 xl:grid-cols-[1fr_0.92fr] xl:gap-6">
    <section class="min-w-0">
      <div class="panel min-w-0 overflow-hidden p-5 sm:p-6">
        <h2 class="text-xl font-semibold">Account settings</h2>
        <p class="mt-2 text-sm text-[var(--ui-text-muted)]">Changing your password invalidates all other active sessions.</p>
        <div class="mt-4 break-words rounded-[1.75rem] border border-[var(--ui-border)] bg-[var(--ui-panel-muted)] p-4 text-sm text-[var(--ui-text-muted)]">
          Link generation policy, slug settings, and security limits are configured only through
          <code class="break-all">docker-compose.yml</code> and apply after container restart.
        </div>
        <label class="mt-4 block min-w-0">
          <span class="mb-2 block text-sm font-medium">New password</span>
          <input v-model="password" class="input" type="password" placeholder="Enter a new account password" />
        </label>
        <div class="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <button class="btn-primary w-full sm:w-auto" @click="changePassword">Change password</button>
          <button
            class="inline-flex w-full items-center justify-center rounded-2xl border border-[#AF3029]/20 bg-[#FCE8DB] px-4 py-2.5 font-medium text-[#AF3029] transition hover:border-[#AF3029]/30 hover:bg-[#FCE8DB] dark:border-[#F89A8A]/20 dark:bg-[#321F1C] dark:text-[#F89A8A] dark:hover:border-[#F89A8A]/30 dark:hover:bg-[#321F1C] sm:w-auto"
            :disabled="clearingAnalytics"
            @click="clearAnalytics"
          >
            Clear analytics
          </button>
        </div>
      </div>
    </section>

    <section class="min-w-0">
      <div class="panel flex min-w-0 h-full min-h-[28rem] flex-col overflow-hidden p-5 sm:min-h-[34rem] sm:p-6">
        <h2 class="text-xl font-semibold">Session management</h2>
        <p class="mt-2 text-sm text-[var(--ui-text-muted)]">Active sessions stay in a dedicated scrollable column.</p>
        <div class="app-scrollbar app-scrollbar-stable mt-4 min-h-0 flex-1 overflow-y-auto pr-2">
          <div class="space-y-3">
            <div
              v-for="session in sessions"
              :key="session.id"
              class="panel-muted flex min-w-0 flex-col items-start gap-3 overflow-hidden p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="min-w-0 w-full sm:flex-1">
                <p class="font-medium">{{ session.isCurrent ? 'Current session' : 'Active session' }}</p>
                <div class="mt-2 flex flex-col gap-1 text-xs text-[var(--ui-text-muted)] sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1">
                  <span class="truncate">Created: {{ formatSessionTime(session.createdAt) }}</span>
                  <span class="truncate">IP: {{ session.ipAddress ?? 'Unknown IP' }}</span>
                  <span class="truncate">Agent: {{ formatUserAgent(session.userAgent) }}</span>
                </div>
              </div>
              <button class="btn-secondary w-full shrink-0 sm:w-auto" :disabled="session.isCurrent" @click="revoke(session.id)">
                Revoke
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
