<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../lib/api';
import { useToast } from '../composables/useToast';
import type { LinkFormInput, LinkRecord } from '@/shared/types';

const props = defineProps<{
  open: boolean;
  link?: LinkRecord | null;
}>();
const emit = defineEmits<{ close: []; created: [link: LinkRecord]; updated: [link: LinkRecord] }>();

const form = reactive<LinkFormInput>({
  targetUrl: '',
  slug: '',
  comment: '',
  password: '',
  expirationValue: null,
  expirationUnit: 'days'
});

const advanced = ref(false);
const loading = ref(false);
const error = ref('');
const { pushToast } = useToast();
const { t } = useI18n();
const passwordInput = ref('');
const passwordTouched = ref(false);
const expirationTouched = ref(false);
const expirationInput = ref('');
const isEditing = computed(() => Boolean(props.link));

const parseExpirationInput = (value: string) => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  const match = normalized.match(/^(\d+)\s*(minute|minutes|hour|hours|day|days)$/);
  if (!match) {
    throw new Error(t('linkForm.expirationError'));
  }

  const amount = Number(match[1]);
  const rawUnit = match[2];
  const unit =
    rawUnit.startsWith('minute') ? 'minutes' : rawUnit.startsWith('hour') ? 'hours' : 'days';

  return {
    expirationValue: amount,
    expirationUnit: unit as 'minutes' | 'hours' | 'days'
  };
};

const formatExpirationFromLink = (value: string | null | undefined) => {
  if (!value) return '';
  const diffMs = new Date(value).getTime() - Date.now();
  if (diffMs <= 0) return '';
  const minutes = Math.round(diffMs / 60000);
  if (minutes % 1440 === 0) return `${minutes / 1440} days`;
  if (minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} minutes`;
};

const resetForm = () => {
  Object.assign(form, {
    targetUrl: props.link?.targetUrl ?? '',
    slug: props.link?.slug ?? '',
    comment: props.link?.comment ?? '',
    expirationValue: null,
    expirationUnit: 'days'
  });
  passwordInput.value = '';
  passwordTouched.value = false;
  expirationTouched.value = false;
  expirationInput.value = formatExpirationFromLink(props.link?.expiresAt);
  advanced.value = Boolean(props.link?.passwordProtected || props.link?.expiresAt || props.link?.slug);
  error.value = '';
};

watch(
  () => [props.open, props.link] as const,
  ([open]) => {
    if (open) resetForm();
  },
  { immediate: true }
);

const closeOnEscape = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || !props.open) return;
  event.preventDefault();
  emit('close');
};

onMounted(() => document.addEventListener('keydown', closeOnEscape));
onBeforeUnmount(() => document.removeEventListener('keydown', closeOnEscape));

const submit = async () => {
  loading.value = true;
  error.value = '';
  try {
    const parsedExpiration =
      expirationTouched.value && expirationInput.value.trim()
        ? parseExpirationInput(expirationInput.value)
        : null;

    const payload: LinkFormInput = {
      targetUrl: form.targetUrl,
      slug: form.slug,
      comment: form.comment,
      expirationValue: expirationTouched.value ? parsedExpiration?.expirationValue ?? null : undefined,
      expirationUnit: expirationTouched.value ? parsedExpiration?.expirationUnit : undefined,
      password: passwordTouched.value ? passwordInput.value : undefined
    };

    const link = await api<LinkRecord>(isEditing.value ? `/api/links/${props.link!.id}` : '/api/links', {
      method: isEditing.value ? 'PATCH' : 'POST',
      body: JSON.stringify(payload)
    });

    if (isEditing.value) {
      emit('updated', link);
      pushToast({ tone: 'success', title: t('linkForm.updated'), description: t('linkForm.updatedDescription', { slug: link.slug }) });
    } else {
      emit('created', link);
      pushToast({ tone: 'success', title: t('linkForm.created'), description: t('linkForm.createdDescription', { slug: link.slug }) });
    }
    emit('close');
    resetForm();
  } catch (err) {
    error.value = (err as Error).message;
    pushToast({ tone: 'error', title: t(isEditing.value ? 'linkForm.updateFailed' : 'linkForm.createFailed'), description: error.value });
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <Transition
    enter-active-class="transition duration-300 ease-out"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition duration-200 ease-in"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
  <div v-if="props.open" class="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur">
    <div class="panel w-full max-w-2xl p-6">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-sm font-semibold uppercase tracking-[0.25em] text-accent-600 dark:text-accent-300">
            {{ t(isEditing ? 'linkForm.edit' : 'linkForm.new') }}
          </p>
          <h2 class="mt-1 text-2xl font-semibold">
            {{ t(isEditing ? 'linkForm.updateTitle' : 'linkForm.createTitle') }}
          </h2>
        </div>
        <button class="btn-secondary" @click="emit('close')">{{ t('common.close') }}</button>
      </div>

      <div class="mt-6 space-y-4">
        <label class="block">
          <span class="mb-2 block text-sm font-medium">{{ t('linkForm.destination') }}</span>
          <input v-model="form.targetUrl" class="input" :placeholder="t('linkForm.destinationPlaceholder')" />
        </label>

        <button class="text-sm font-medium text-accent-600 dark:text-accent-300" @click="advanced = !advanced">
          {{ t(advanced ? 'linkForm.hide' : 'linkForm.show') }} {{ t('linkForm.advanced') }}
        </button>

        <div v-if="advanced" class="grid gap-4 md:grid-cols-2">
          <label class="block">
            <span class="mb-2 block text-sm font-medium">domain.com/</span>
            <input v-model="form.slug" class="input" :placeholder="t('linkForm.customPath')" />
          </label>
          <label class="block">
            <span class="mb-2 block text-sm font-medium">{{ t('linkForm.passwordProtection') }}</span>
            <input
              v-model="passwordInput"
              class="input"
              type="password"
              :placeholder="t(isEditing ? 'linkForm.passwordKeep' : 'linkForm.passwordNew')"
              @input="passwordTouched = true"
            />
          </label>
          <label class="block md:col-span-2">
            <span class="mb-2 block text-sm font-medium">{{ t('linkForm.comment') }}</span>
            <input v-model="form.comment" class="input" :placeholder="t('linkForm.commentPlaceholder')" />
          </label>
          <label class="block md:col-span-2">
            <span class="mb-2 block text-sm font-medium">{{ t('linkForm.expiration') }}</span>
            <input
              v-model="expirationInput"
              class="input"
              type="text"
              :placeholder="t('linkForm.expirationPlaceholder')"
              @input="expirationTouched = true"
            />
          </label>
        </div>

        <p v-if="error" class="rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-300">{{ error }}</p>

        <div class="flex justify-end">
          <button class="btn-primary" :disabled="loading" @click="submit">
            {{ loading ? (isEditing ? t('common.saving') : t('linkForm.creating')) : (isEditing ? t('linkForm.saveChanges') : t('linkForm.create')) }}
          </button>
        </div>
      </div>
    </div>
  </div>
  </Transition>
</template>
