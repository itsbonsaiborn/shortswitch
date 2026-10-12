<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { UAParser } from 'ua-parser-js';
import { api } from '../lib/api';
import { useToast } from '../composables/useToast';
import type { ModerationMatchMode, ModerationRule, UserSession } from '@/shared/types';

const sessions = ref<UserSession[]>([]);
const password = ref('');
const clearingAnalytics = ref(false);
const moderationRules = ref<ModerationRule[]>([]);
const rulePattern = ref('');
const ruleMode = ref<ModerationMatchMode>('whole_word');
const editingRuleId = ref<string | null>(null);
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
    const [nextSessions, nextRules] = await Promise.all([
      api<UserSession[]>('/api/sessions'),
      api<ModerationRule[]>('/api/moderation/rules')
    ]);
    sessions.value = nextSessions;
    moderationRules.value = nextRules;
  } catch (error) {
    pushToast({ tone: 'error', title: 'Failed to load sessions', description: (error as Error).message });
  }
};

const saveRule = async () => {
  if (!rulePattern.value.trim()) return;
  try {
    const rule = await api<ModerationRule>(editingRuleId.value ? `/api/moderation/rules/${editingRuleId.value}` : '/api/moderation/rules', {
      method: editingRuleId.value ? 'PATCH' : 'POST',
      body: JSON.stringify({ pattern: rulePattern.value, matchMode: ruleMode.value })
    });
    const index = moderationRules.value.findIndex((item) => item.id === rule.id);
    if (index === -1) moderationRules.value.unshift(rule); else moderationRules.value[index] = rule;
    rulePattern.value = ''; editingRuleId.value = null; ruleMode.value = 'whole_word';
    pushToast({ tone: 'success', title: 'Moderation rule saved' });
  } catch (error) { pushToast({ tone: 'error', title: 'Failed to save rule', description: (error as Error).message }); }
};

const editRule = (rule: ModerationRule) => {
  editingRuleId.value = rule.id; rulePattern.value = rule.pattern; ruleMode.value = rule.matchMode;
};

const deleteRule = async (rule: ModerationRule) => {
  try {
    await api(`/api/moderation/rules/${rule.id}`, { method: 'DELETE', body: JSON.stringify({}) });
    moderationRules.value = moderationRules.value.filter((item) => item.id !== rule.id);
  } catch (error) { pushToast({ tone: 'error', title: 'Failed to delete rule', description: (error as Error).message }); }
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
  if (!window.confirm('Clear all Link analytics, Live responses and participants, and Page views and clicks? This cannot be undone.')) return;
  clearingAnalytics.value = true;
  try {
    await api('/api/settings/analytics/clear', { method: 'POST', body: JSON.stringify({}) });
    pushToast({
      tone: 'error',
      title: 'Analytics cleared',
      description: 'Link analytics, Live responses, and Page views and clicks were removed.'
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

    <section class="min-w-0 xl:col-span-2">
      <div class="panel p-5 sm:p-6">
        <h2 class="text-xl font-semibold">Moderation / Ban Filter</h2>
        <p class="mt-2 text-sm text-[var(--ui-text-muted)]">Global, case-insensitive rules for moderated Live text responses. Unicode and repeated spaces are normalized on the server.</p>
        <form class="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]" @submit.prevent="saveRule">
          <input v-model="rulePattern" class="input px-4 py-3" maxlength="120" placeholder="Forbidden word or phrase" required />
          <select v-model="ruleMode" class="input px-4 py-3"><option value="whole_word">Whole word</option><option value="contains">Contains</option></select>
          <button class="btn-primary">{{ editingRuleId ? 'Update rule' : 'Add rule' }}</button>
        </form>
        <div class="mt-5 grid gap-3 md:grid-cols-2">
          <div v-for="rule in moderationRules" :key="rule.id" class="panel-muted flex min-w-0 items-center justify-between gap-3 p-4">
            <div class="min-w-0"><p class="truncate font-medium">{{ rule.pattern }}</p><p class="mt-1 text-xs text-[var(--ui-text-muted)]">{{ rule.matchMode === 'whole_word' ? 'Whole word' : 'Contains' }}</p></div>
            <div class="flex gap-2"><button class="btn-secondary px-3 py-2 text-sm" @click="editRule(rule)">Edit</button><button class="btn-secondary px-3 py-2 text-sm text-[#AF3029] dark:text-[#F89A8A]" @click="deleteRule(rule)">Delete</button></div>
          </div>
          <p v-if="moderationRules.length === 0" class="text-sm text-[var(--ui-text-muted)]">No ban filter rules configured.</p>
        </div>
      </div>
    </section>
  </div>
</template>
