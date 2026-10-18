<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { UAParser } from 'ua-parser-js';
import { api } from '../lib/api';
import { useToast } from '../composables/useToast';
import type { ModerationMatchMode, ModerationRule, UserSession } from '@/shared/types';
import { useI18n } from 'vue-i18n';
import { usePreferences } from '../composables/usePreferences';

const sessions = ref<UserSession[]>([]);
const password = ref('');
const clearingAnalytics = ref(false);
const moderationRules = ref<ModerationRule[]>([]);
const rulePattern = ref('');
const ruleMode = ref<ModerationMatchMode>('whole_word');
const editingRuleId = ref<string | null>(null);
const { pushToast } = useToast();
const { t, locale } = useI18n();
const { locale: selectedLocale, setLocale, syncError, retry } = usePreferences();

const formatSessionTime = (value: string) =>
  new Date(value).toLocaleString(locale.value === 'lv' ? 'lv-LV' : 'en-US');

const formatUserAgent = (value: string | null) => {
  if (!value) return t('settings.unknownAgent');

  const parser = new UAParser(value);
  const browser = parser.getBrowser().name ?? t('settings.unknownBrowser');
  const os = parser.getOS().name ?? t('settings.unknownOs');
  const rawDeviceType = parser.getDevice().type ?? 'desktop';
  const deviceType = ['desktop', 'mobile', 'tablet'].includes(rawDeviceType)
    ? t(`analytics.${rawDeviceType}`)
    : rawDeviceType;

  return t('settings.agentSummary', { browser, os, device: deviceType });
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
    pushToast({ tone: 'error', title: t('notices.sessionsLoadFailed'), description: (error as Error).message });
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
    pushToast({ tone: 'success', title: t('notices.ruleSaved') });
  } catch (error) { pushToast({ tone: 'error', title: t('notices.ruleSaveFailed'), description: (error as Error).message }); }
};

const editRule = (rule: ModerationRule) => {
  editingRuleId.value = rule.id; rulePattern.value = rule.pattern; ruleMode.value = rule.matchMode;
};

const deleteRule = async (rule: ModerationRule) => {
  try {
    await api(`/api/moderation/rules/${rule.id}`, { method: 'DELETE', body: JSON.stringify({}) });
    moderationRules.value = moderationRules.value.filter((item) => item.id !== rule.id);
  } catch (error) { pushToast({ tone: 'error', title: t('notices.ruleDeleteFailed'), description: (error as Error).message }); }
};

const revoke = async (id: string) => {
  try {
    await api(`/api/sessions/${id}`, { method: 'DELETE', body: JSON.stringify({}) });
    sessions.value = sessions.value.filter((session) => session.id !== id);
    pushToast({ tone: 'error', title: t('notices.sessionRevoked'), description: t('notices.sessionRevokedDescription') });
  } catch (error) {
    pushToast({ tone: 'error', title: t('notices.sessionRevokeFailed'), description: (error as Error).message });
  }
};

const changePassword = async () => {
  if (!password.value.trim()) {
    pushToast({ tone: 'error', title: t('notices.passwordChangeFailed'), description: t('notices.passwordRequired') });
    return;
  }
  try {
    await api('/api/settings/password', { method: 'POST', body: JSON.stringify({ password: password.value }) });
    password.value = '';
    pushToast({ tone: 'success', title: t('notices.passwordUpdated'), description: t('notices.passwordUpdatedDescription') });
  } catch (error) {
    pushToast({ tone: 'error', title: t('notices.passwordChangeFailed'), description: (error as Error).message });
  }
};

const clearAnalytics = async () => {
  if (!window.confirm(t('notices.clearAllConfirm'))) return;
  clearingAnalytics.value = true;
  try {
    await api('/api/settings/analytics/clear', { method: 'POST', body: JSON.stringify({}) });
    pushToast({
      tone: 'error',
      title: t('notices.analyticsCleared'),
      description: t('notices.allAnalyticsClearedDescription')
    });
  } catch (error) {
    pushToast({ tone: 'error', title: t('notices.analyticsClearFailed'), description: (error as Error).message });
  } finally {
    clearingAnalytics.value = false;
  }
};

onMounted(load);
</script>

<template>
  <div class="grid min-w-0 gap-4 xl:grid-cols-[1fr_0.92fr] xl:gap-6">
    <section class="min-w-0 xl:col-span-2">
      <div class="panel p-5 sm:p-6">
        <h2 class="text-xl font-semibold">{{ t('settings.preferences') }}</h2>
        <p class="mt-2 text-sm text-[var(--ui-text-muted)]">{{ t('settings.preferencesDescription') }}</p>
        <div class="mt-5 max-w-md">
          <label class="mb-2 block text-sm font-medium" for="interface-locale">{{ t('locale.label') }}</label>
          <select id="interface-locale" class="input px-4 py-3" :value="selectedLocale" @change="setLocale(($event.target as HTMLSelectElement).value as 'en' | 'lv')">
            <option value="en">{{ t('locale.en') }}</option>
            <option value="lv">{{ t('locale.lv') }}</option>
          </select>
          <p class="mt-2 text-xs text-[var(--ui-text-muted)]">{{ t('locale.description') }}</p>
        </div>
        <button v-if="syncError" type="button" class="mt-4 rounded-2xl bg-[#FCE8DB] px-4 py-3 text-left text-sm text-[#AF3029] dark:bg-[#321F1C] dark:text-[#F89A8A]" @click="retry">
          {{ t('settings.syncFailed') }} <span class="font-semibold">{{ t('common.retry') }}</span>
        </button>
      </div>
    </section>
    <section class="min-w-0">
      <div class="panel min-w-0 overflow-hidden p-5 sm:p-6">
        <h2 class="text-xl font-semibold">{{ t('settings.account') }}</h2>
        <p class="mt-2 text-sm text-[var(--ui-text-muted)]">{{ t('settings.accountDescription') }}</p>
        <div class="mt-4 break-words rounded-[1.75rem] border border-[var(--ui-border)] bg-[var(--ui-panel-muted)] p-4 text-sm text-[var(--ui-text-muted)]">
          {{ t('settings.policyDescription') }}
        </div>
        <label class="mt-4 block min-w-0">
          <span class="mb-2 block text-sm font-medium">{{ t('settings.newPassword') }}</span>
          <input v-model="password" class="input" type="password" :placeholder="t('settings.passwordPlaceholder')" />
        </label>
        <div class="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <button class="btn-primary w-full sm:w-auto" @click="changePassword">{{ t('settings.password') }}</button>
          <button
            class="inline-flex w-full items-center justify-center rounded-2xl border border-[#AF3029]/20 bg-[#FCE8DB] px-4 py-2.5 font-medium text-[#AF3029] transition hover:border-[#AF3029]/30 hover:bg-[#FCE8DB] dark:border-[#F89A8A]/20 dark:bg-[#321F1C] dark:text-[#F89A8A] dark:hover:border-[#F89A8A]/30 dark:hover:bg-[#321F1C] sm:w-auto"
            :disabled="clearingAnalytics"
            @click="clearAnalytics"
          >
            {{ t('settings.clearAnalytics') }}
          </button>
        </div>
      </div>
    </section>

    <section class="min-w-0">
      <div class="panel flex min-w-0 h-full min-h-[28rem] flex-col overflow-hidden p-5 sm:min-h-[34rem] sm:p-6">
        <h2 class="text-xl font-semibold">{{ t('settings.sessions') }}</h2>
        <p class="mt-2 text-sm text-[var(--ui-text-muted)]">{{ t('settings.sessionsDescription') }}</p>
        <div class="app-scrollbar app-scrollbar-stable mt-4 min-h-0 flex-1 overflow-y-auto pr-2">
          <div class="space-y-3">
            <div
              v-for="session in sessions"
              :key="session.id"
              class="panel-muted flex min-w-0 flex-col items-start gap-3 overflow-hidden p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="min-w-0 w-full sm:flex-1">
                <p class="font-medium">{{ session.isCurrent ? t('settings.currentSession') : t('settings.activeSession') }}</p>
                <div class="mt-2 flex flex-col gap-1 text-xs text-[var(--ui-text-muted)] sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1">
                  <span class="truncate">{{ t('settings.created', { value: formatSessionTime(session.createdAt) }) }}</span>
                  <span class="truncate">{{ t('settings.ip', { value: session.ipAddress ?? t('analytics.unknown') }) }}</span>
                  <span class="truncate">{{ t('settings.agent', { value: formatUserAgent(session.userAgent) }) }}</span>
                </div>
              </div>
              <button class="btn-secondary w-full shrink-0 sm:w-auto" :disabled="session.isCurrent" @click="revoke(session.id)">
                {{ t('settings.revoke') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="min-w-0 xl:col-span-2">
      <div class="panel p-5 sm:p-6">
        <h2 class="text-xl font-semibold">{{ t('settings.moderation') }}</h2>
        <p class="mt-2 text-sm text-[var(--ui-text-muted)]">{{ t('settings.moderationDescription') }}</p>
        <form class="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]" @submit.prevent="saveRule">
          <input v-model="rulePattern" class="input px-4 py-3" maxlength="120" :placeholder="t('settings.rulePlaceholder')" required />
          <select v-model="ruleMode" class="input px-4 py-3"><option value="whole_word">{{ t('settings.wholeWord') }}</option><option value="contains">{{ t('settings.contains') }}</option></select>
          <button class="btn-primary">{{ editingRuleId ? t('settings.updateRule') : t('settings.addRule') }}</button>
        </form>
        <div class="mt-5 grid gap-3 md:grid-cols-2">
          <div v-for="rule in moderationRules" :key="rule.id" class="panel-muted flex min-w-0 items-center justify-between gap-3 p-4">
            <div class="min-w-0"><p class="truncate font-medium">{{ rule.pattern }}</p><p class="mt-1 text-xs text-[var(--ui-text-muted)]">{{ rule.matchMode === 'whole_word' ? t('settings.wholeWord') : t('settings.contains') }}</p></div>
            <div class="flex gap-2"><button class="btn-secondary px-3 py-2 text-sm" @click="editRule(rule)">{{ t('common.edit') }}</button><button class="btn-secondary px-3 py-2 text-sm text-[#AF3029] dark:text-[#F89A8A]" @click="deleteRule(rule)">{{ t('common.delete') }}</button></div>
          </div>
          <p v-if="moderationRules.length === 0" class="text-sm text-[var(--ui-text-muted)]">{{ t('settings.noRules') }}</p>
        </div>
      </div>
    </section>
  </div>
</template>
