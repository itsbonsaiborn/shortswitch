<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import QRCode from 'qrcode';
import { UAParser } from 'ua-parser-js';
import { api } from '../lib/api';
import { useToast } from '../composables/useToast';
import type { ModerationMatchMode, ModerationRule, TwoFactorEnrollment, TwoFactorStatus, UserSession } from '@/shared/types';
import { useI18n } from 'vue-i18n';
import { usePreferences } from '../composables/usePreferences';
import { useDisplayPreferences } from '../composables/useDisplayPreferences';
import { useTheme } from '../composables/useTheme';
import type { AppearancePreference, LanguagePreference, PublicDisplayPreferences } from '@/shared/display-preferences';
import RemoteBlocklistsSection from '../components/RemoteBlocklistsSection.vue';

const sessions = ref<UserSession[]>([]);
const password = ref('');
const clearingAnalytics = ref(false);
const moderationRules = ref<ModerationRule[]>([]);
const rulePattern = ref('');
const ruleMode = ref<ModerationMatchMode>('whole_word');
const editingRuleId = ref<string | null>(null);
const { pushToast } = useToast();
const { t, locale } = useI18n();
const { locale: accountLocale, setLocale, syncError, retry } = usePreferences();
const {
  publicLanguagePreference,
  publicAppearancePreference,
  setPublicDisplayPreferences
} = useDisplayPreferences();
const { theme: appearancePreference, setTheme } = useTheme();
const twoFactorStatus = ref<TwoFactorStatus | null>(null);
const twoFactorPassword = ref('');
const twoFactorCode = ref('');
const twoFactorEnrollment = ref<TwoFactorEnrollment | null>(null);
const twoFactorQr = ref('');
const recoveryCodes = ref<string[]>([]);
const twoFactorBusy = ref(false);
const twoFactorDialogStage = ref<'enrollment' | 'recovery' | null>(null);
const recoveryCloseSeconds = ref(0);
let recoveryCloseTimer: number | undefined;

const recoveryCloseBlocked = computed(() =>
  twoFactorDialogStage.value === 'recovery' && recoveryCloseSeconds.value > 0
);

const clearRecoveryCloseTimer = () => {
  if (recoveryCloseTimer !== undefined) {
    window.clearInterval(recoveryCloseTimer);
    recoveryCloseTimer = undefined;
  }
};

const startRecoveryCloseCountdown = () => {
  clearRecoveryCloseTimer();
  recoveryCloseSeconds.value = 5;
  recoveryCloseTimer = window.setInterval(() => {
    recoveryCloseSeconds.value = Math.max(0, recoveryCloseSeconds.value - 1);
    if (recoveryCloseSeconds.value === 0) clearRecoveryCloseTimer();
  }, 1_000);
};

const closeTwoFactorDialog = () => {
  if (recoveryCloseBlocked.value || twoFactorBusy.value) return;
  clearRecoveryCloseTimer();
  twoFactorDialogStage.value = null;
  twoFactorEnrollment.value = null;
  twoFactorQr.value = '';
  recoveryCodes.value = [];
  twoFactorCode.value = '';
};

const closeTwoFactorDialogOnEscape = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || !twoFactorDialogStage.value) return;
  event.preventDefault();
  closeTwoFactorDialog();
};

const publicDisplayBusy = ref(false);

const changeLanguage = (value: string) => setLocale(value as 'en' | 'lv');

const savePublicDisplayPreferences = async (next: PublicDisplayPreferences) => {
  const previous = {
    language: publicLanguagePreference.value,
    appearance: publicAppearancePreference.value
  };
  setPublicDisplayPreferences(next);
  publicDisplayBusy.value = true;
  try {
    const saved = await api<PublicDisplayPreferences>('/api/settings/public-display', {
      method: 'PATCH', body: JSON.stringify(next)
    });
    setPublicDisplayPreferences(saved);
    pushToast({ tone: 'success', title: t('publicDisplay.saved') });
  } catch (error) {
    setPublicDisplayPreferences(previous);
    pushToast({ tone: 'error', title: t('publicDisplay.saveFailed'), description: (error as Error).message });
  } finally { publicDisplayBusy.value = false; }
};

const changePublicLanguage = (value: string) => savePublicDisplayPreferences({
  language: value as LanguagePreference,
  appearance: publicAppearancePreference.value
});

const changePublicAppearance = (value: string) => savePublicDisplayPreferences({
  language: publicLanguagePreference.value,
  appearance: value as AppearancePreference
});

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
    const [nextSessions, nextRules, nextTwoFactorStatus, nextPublicDisplay] = await Promise.all([
      api<UserSession[]>('/api/sessions'),
      api<ModerationRule[]>('/api/moderation/rules'),
      api<TwoFactorStatus>('/api/settings/two-factor'),
      api<PublicDisplayPreferences>('/api/settings/public-display')
    ]);
    sessions.value = nextSessions;
    moderationRules.value = nextRules;
    twoFactorStatus.value = nextTwoFactorStatus;
    setPublicDisplayPreferences(nextPublicDisplay);
  } catch (error) {
    pushToast({ tone: 'error', title: t('notices.sessionsLoadFailed'), description: (error as Error).message });
  }
};

const startTwoFactorEnrollment = async () => {
  twoFactorBusy.value = true;
  try {
    twoFactorEnrollment.value = await api<TwoFactorEnrollment>('/api/settings/two-factor/enrollment', {
      method: 'POST', body: JSON.stringify({ password: twoFactorPassword.value })
    });
    twoFactorQr.value = await QRCode.toDataURL(twoFactorEnrollment.value.otpauthUri, { width: 280, margin: 1 });
    twoFactorCode.value = '';
    twoFactorDialogStage.value = 'enrollment';
  } catch (error) {
    pushToast({ tone: 'error', title: t('twoFactor.setupFailed'), description: (error as Error).message });
  } finally { twoFactorBusy.value = false; }
};

const confirmTwoFactorEnrollment = async () => {
  twoFactorBusy.value = true;
  try {
    const result = await api<{ enabled: true; recoveryCodes: string[] }>('/api/settings/two-factor/enrollment/confirm', {
      method: 'POST', body: JSON.stringify({ code: twoFactorCode.value })
    });
    recoveryCodes.value = result.recoveryCodes;
    twoFactorStatus.value = await api<TwoFactorStatus>('/api/settings/two-factor');
    twoFactorEnrollment.value = null;
    twoFactorQr.value = '';
    twoFactorPassword.value = '';
    twoFactorCode.value = '';
    twoFactorDialogStage.value = 'recovery';
    startRecoveryCloseCountdown();
    pushToast({ tone: 'success', title: t('twoFactor.enabled') });
  } catch (error) {
    pushToast({ tone: 'error', title: t('twoFactor.setupFailed'), description: (error as Error).message });
  } finally { twoFactorBusy.value = false; }
};

const disableTwoFactor = async () => {
  twoFactorBusy.value = true;
  try {
    await api('/api/settings/two-factor/disable', {
      method: 'POST', body: JSON.stringify({ password: twoFactorPassword.value, code: twoFactorCode.value })
    });
    twoFactorStatus.value = await api<TwoFactorStatus>('/api/settings/two-factor');
    twoFactorPassword.value = '';
    twoFactorCode.value = '';
    recoveryCodes.value = [];
    await load();
    pushToast({ tone: 'success', title: t('twoFactor.disabled') });
  } catch (error) {
    pushToast({ tone: 'error', title: t('twoFactor.disableFailed'), description: (error as Error).message });
  } finally { twoFactorBusy.value = false; }
};

const copyRecoveryCodes = async () => {
  await navigator.clipboard.writeText(recoveryCodes.value.join('\n'));
  pushToast({ tone: 'success', title: t('twoFactor.copied') });
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

onMounted(() => {
  document.addEventListener('keydown', closeTwoFactorDialogOnEscape);
  void load();
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', closeTwoFactorDialogOnEscape);
  clearRecoveryCloseTimer();
});
</script>

<template>
  <div class="grid min-w-0 gap-4 xl:grid-cols-[1fr_0.92fr] xl:gap-6">
    <section class="min-w-0 xl:col-span-2">
      <div class="panel p-5 sm:p-6">
        <h2 class="text-xl font-semibold">{{ t('settings.preferences') }}</h2>
        <p class="mt-2 text-sm text-[var(--ui-text-muted)]">{{ t('displayPreferences.description') }}</p>
        <div class="mt-5 grid max-w-3xl gap-5 sm:grid-cols-2">
          <div>
          <label class="mb-2 block text-sm font-medium" for="interface-locale">{{ t('locale.label') }}</label>
          <select id="interface-locale" class="input px-4 py-3" :value="accountLocale" @change="changeLanguage(($event.target as HTMLSelectElement).value)">
            <option value="en">{{ t('locale.en') }}</option>
            <option value="lv">{{ t('locale.lv') }}</option>
          </select>
          <p class="mt-2 text-xs text-[var(--ui-text-muted)]">{{ t('locale.description') }}</p>
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium" for="interface-appearance">{{ t('theme.label') }}</label>
            <select id="interface-appearance" class="input px-4 py-3" :value="appearancePreference" @change="setTheme(($event.target as HTMLSelectElement).value as 'system' | 'light' | 'dark')">
              <option value="system">{{ t('theme.system') }}</option>
              <option value="light">{{ t('theme.light') }}</option>
              <option value="dark">{{ t('theme.dark') }}</option>
            </select>
            <p class="mt-2 text-xs text-[var(--ui-text-muted)]">{{ t('theme.description') }}</p>
          </div>
        </div>
        <button v-if="syncError" type="button" class="mt-4 rounded-2xl bg-[#FCE8DB] px-4 py-3 text-left text-sm text-[#AF3029] dark:bg-[#321F1C] dark:text-[#F89A8A]" @click="retry">
          {{ t('settings.syncFailed') }} <span class="font-semibold">{{ t('common.retry') }}</span>
        </button>
      </div>
    </section>
    <section class="min-w-0 xl:col-span-2">
      <div class="panel p-5 sm:p-6">
        <h2 class="text-xl font-semibold">{{ t('publicDisplay.title') }}</h2>
        <p class="mt-2 text-sm text-[var(--ui-text-muted)]">{{ t('publicDisplay.description') }}</p>
        <div class="mt-5 grid max-w-3xl gap-5 sm:grid-cols-2">
          <div>
            <label class="mb-2 block text-sm font-medium" for="public-locale">{{ t('publicDisplay.language') }}</label>
            <select id="public-locale" class="input px-4 py-3" :value="publicLanguagePreference" :disabled="publicDisplayBusy" @change="changePublicLanguage(($event.target as HTMLSelectElement).value)">
              <option value="auto">{{ t('locale.auto') }}</option>
              <option value="en">{{ t('locale.en') }}</option>
              <option value="lv">{{ t('locale.lv') }}</option>
            </select>
            <p class="mt-2 text-xs text-[var(--ui-text-muted)]">{{ t('publicDisplay.languageDescription') }}</p>
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium" for="public-appearance">{{ t('publicDisplay.appearance') }}</label>
            <select id="public-appearance" class="input px-4 py-3" :value="publicAppearancePreference" :disabled="publicDisplayBusy" @change="changePublicAppearance(($event.target as HTMLSelectElement).value)">
              <option value="system">{{ t('theme.system') }}</option>
              <option value="light">{{ t('theme.light') }}</option>
              <option value="dark">{{ t('theme.dark') }}</option>
            </select>
            <p class="mt-2 text-xs text-[var(--ui-text-muted)]">{{ t('publicDisplay.appearanceDescription') }}</p>
          </div>
        </div>
      </div>
    </section>
    <section class="min-w-0 xl:col-span-2">
      <div class="panel p-5 sm:p-6">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 class="text-xl font-semibold">{{ t('twoFactor.title') }}</h2>
            <p class="mt-2 text-sm text-[var(--ui-text-muted)]">{{ t('twoFactor.description') }}</p>
          </div>
          <span v-if="twoFactorStatus" class="rounded-full px-3 py-1.5 text-xs font-semibold" :class="twoFactorStatus.enabled ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-[var(--ui-panel-muted)] text-[var(--ui-text-muted)]'">
            {{ twoFactorStatus.enabled ? t('twoFactor.on') : t('twoFactor.off') }}
          </span>
        </div>

        <div v-if="twoFactorStatus && !twoFactorStatus.enrollmentAvailable && !twoFactorStatus.enabled" class="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
          {{ t('twoFactor.keyMissing') }}
        </div>

        <div v-if="twoFactorStatus" class="mt-5 grid max-w-3xl gap-4 sm:grid-cols-2">
          <label class="block">
            <span class="mb-2 block text-sm font-medium">{{ t('twoFactor.currentPassword') }}</span>
            <input v-model="twoFactorPassword" class="input" type="password" autocomplete="current-password" maxlength="256" />
          </label>
          <label v-if="twoFactorStatus.enabled" class="block">
            <span class="mb-2 block text-sm font-medium">{{ t('twoFactor.verificationOrRecovery') }}</span>
            <input v-model="twoFactorCode" class="input" autocomplete="one-time-code" maxlength="32" />
          </label>
          <div class="sm:col-span-2">
            <p v-if="twoFactorStatus.enabled" class="mb-4 text-sm text-[var(--ui-text-muted)]">{{ t('twoFactor.remaining', { count: twoFactorStatus.recoveryCodesRemaining }) }}</p>
            <button v-if="twoFactorStatus.enabled" type="button" class="btn-secondary text-[#AF3029] dark:text-[#F89A8A]" :disabled="twoFactorBusy" @click="disableTwoFactor">{{ t('twoFactor.disable') }}</button>
            <button v-else type="button" class="btn-primary" :disabled="twoFactorBusy || !twoFactorStatus.enrollmentAvailable" @click="startTwoFactorEnrollment">{{ t('twoFactor.start') }}</button>
          </div>
        </div>
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
          <input v-model="password" class="input" type="password" minlength="12" maxlength="256" autocomplete="new-password" :placeholder="t('settings.passwordPlaceholder')" />
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
    <section class="min-w-0 xl:col-span-2">
      <RemoteBlocklistsSection />
    </section>
  </div>

  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-200 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="twoFactorDialogStage"
        class="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur"
        role="presentation"
      >
        <section
          class="panel app-scrollbar max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-y-auto p-5 sm:p-7"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="twoFactorDialogStage === 'recovery' ? 'two-factor-recovery-title' : 'two-factor-setup-title'"
          @click.stop
        >
          <div v-if="twoFactorDialogStage === 'enrollment' && twoFactorEnrollment" class="min-w-0">
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="text-sm font-semibold uppercase tracking-[0.2em] text-accent-600 dark:text-accent-300">{{ t('twoFactor.title') }}</p>
                <h2 id="two-factor-setup-title" class="mt-1 text-2xl font-semibold">{{ t('twoFactor.start') }}</h2>
              </div>
              <button type="button" class="btn-secondary shrink-0" :disabled="twoFactorBusy" @click="closeTwoFactorDialog">{{ t('common.close') }}</button>
            </div>

            <div class="mt-6 grid gap-6 md:grid-cols-[280px_minmax(0,1fr)] md:items-center">
              <img :src="twoFactorQr" class="mx-auto w-full max-w-[280px] rounded-2xl bg-white p-3" :alt="t('twoFactor.qrAlt')" />
              <div class="min-w-0">
                <p class="text-sm leading-6 text-[var(--ui-text-muted)]">{{ t('twoFactor.scanHelp') }}</p>
                <p class="mt-3 break-all rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-panel-muted)] p-3 font-mono text-xs">{{ twoFactorEnrollment.manualKey }}</p>
                <label class="mt-5 block">
                  <span class="mb-2 block text-sm font-medium">{{ t('twoFactor.verificationCode') }}</span>
                  <input v-model="twoFactorCode" class="input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" autofocus />
                </label>
                <button type="button" class="btn-primary mt-4 w-full sm:w-auto" :disabled="twoFactorBusy || twoFactorCode.length !== 6" @click="confirmTwoFactorEnrollment">{{ t('twoFactor.confirm') }}</button>
              </div>
            </div>
          </div>

          <div v-else-if="twoFactorDialogStage === 'recovery'" class="min-w-0">
            <div>
              <p class="text-sm font-semibold uppercase tracking-[0.2em] text-accent-600 dark:text-accent-300">{{ t('twoFactor.title') }}</p>
              <h2 id="two-factor-recovery-title" class="mt-1 text-2xl font-semibold">{{ t('twoFactor.saveRecoveryCodes') }}</h2>
              <p class="mt-3 text-sm leading-6 text-[var(--ui-text-muted)]">{{ t('twoFactor.recoveryCodesOnce') }}</p>
            </div>
            <div class="mt-5 grid gap-2 font-mono text-sm sm:grid-cols-2">
              <code v-for="item in recoveryCodes" :key="item" class="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-panel-muted)] px-3 py-2">{{ item }}</code>
            </div>
            <div class="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button type="button" class="btn-secondary w-full sm:w-auto" @click="copyRecoveryCodes">{{ t('twoFactor.copyCodes') }}</button>
              <button
                type="button"
                class="btn-primary w-full min-w-32 transition disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto"
                :disabled="recoveryCloseBlocked"
                :aria-disabled="recoveryCloseBlocked"
                @click="closeTwoFactorDialog"
              >
                <span aria-live="polite">{{ t('common.close') }}<template v-if="recoveryCloseBlocked"> ({{ recoveryCloseSeconds }})</template></span>
              </button>
            </div>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
