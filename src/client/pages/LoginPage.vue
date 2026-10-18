<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAppConfig } from '../composables/useAppConfig';
import { useAuth } from '../composables/useAuth';
import { useI18n } from 'vue-i18n';

const router = useRouter();
const { appName, loadAppConfig } = useAppConfig();
const { login } = useAuth();
const { t } = useI18n();
const form = reactive({ email: '', password: '' });
const loading = ref(false);
const error = ref('');

const submit = async () => {
  loading.value = true;
  error.value = '';
  try {
    await login(form.email, form.password);
    await router.push('/app/links');
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
};

loadAppConfig();
</script>

<template>
  <div class="flex min-h-screen items-center justify-center p-4">
    <div class="panel w-full max-w-md p-8 md:p-10">
      <div class="flex flex-col items-center text-center">
        <img
          src="/icons/icon-192.png"
          alt=""
          class="h-auto max-h-16 w-auto max-w-[8rem] object-contain"
        />
        <p class="mt-5 text-sm font-semibold uppercase tracking-[0.35em] text-accent-600 dark:text-accent-300">
          {{ appName }}
        </p>
        <h2 class="mt-3 text-3xl font-semibold">{{ t('auth.title') }}</h2>
        <p class="mt-2 text-sm text-[var(--ui-text-muted)]">{{ t('auth.description') }}</p>
      </div>

      <form class="mt-8 space-y-4" @submit.prevent="submit">
        <label class="block">
          <span class="mb-2 block text-sm font-medium">{{ t('auth.email') }}</span>
          <input v-model="form.email" class="input" type="email" :placeholder="t('auth.email')" />
        </label>
        <label class="block">
          <span class="mb-2 block text-sm font-medium">{{ t('auth.password') }}</span>
          <input v-model="form.password" class="input" type="password" :placeholder="t('auth.password')" />
        </label>
        <p v-if="error" class="rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-300">{{ error }}</p>
        <button type="submit" class="btn-primary w-full" :disabled="loading">
          {{ loading ? t('auth.signingIn') : t('auth.signIn') }}
        </button>
      </form>
    </div>
  </div>
</template>
