<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
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
    throw new Error('Expiration must look like "2 minutes", "2 hours", or "2 days".');
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
      pushToast({ tone: 'success', title: 'Link updated', description: `${link.slug} was saved successfully.` });
    } else {
      emit('created', link);
      pushToast({ tone: 'success', title: 'Link created', description: `${link.slug} is ready to share.` });
    }
    emit('close');
    resetForm();
  } catch (err) {
    error.value = (err as Error).message;
    pushToast({ tone: 'error', title: isEditing.value ? 'Failed to update link' : 'Failed to create link', description: error.value });
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
  <div v-if="props.open" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur" @click.self="emit('close')">
    <div class="panel w-full max-w-2xl p-6">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-sm font-semibold uppercase tracking-[0.25em] text-accent-600 dark:text-accent-300">
            {{ isEditing ? 'Edit Link' : 'New Link' }}
          </p>
          <h2 class="mt-1 text-2xl font-semibold">
            {{ isEditing ? 'Update link settings' : 'Create a fast, tracked short link' }}
          </h2>
        </div>
        <button class="btn-secondary" @click="emit('close')">Close</button>
      </div>

      <div class="mt-6 space-y-4">
        <label class="block">
          <span class="mb-2 block text-sm font-medium">Destination URL</span>
          <input v-model="form.targetUrl" class="input" placeholder="Enter destination URL" />
        </label>

        <button class="text-sm font-medium text-accent-600 dark:text-accent-300" @click="advanced = !advanced">
          {{ advanced ? 'Hide' : 'Show' }} advanced options
        </button>

        <div v-if="advanced" class="grid gap-4 md:grid-cols-2">
          <label class="block">
            <span class="mb-2 block text-sm font-medium">domain.com/</span>
            <input v-model="form.slug" class="input" placeholder="Custom path" />
          </label>
          <label class="block">
            <span class="mb-2 block text-sm font-medium">Password protection</span>
            <input
              v-model="passwordInput"
              class="input"
              type="password"
              :placeholder="isEditing ? 'Leave blank to keep current password' : 'Enter password if needed'"
              @input="passwordTouched = true"
            />
          </label>
          <label class="block md:col-span-2">
            <span class="mb-2 block text-sm font-medium">Comment</span>
            <input v-model="form.comment" class="input" placeholder="Add an optional note for this link" />
          </label>
          <label class="block md:col-span-2">
            <span class="mb-2 block text-sm font-medium">Expiration</span>
            <input
              v-model="expirationInput"
              class="input"
              type="text"
              placeholder="Enter expiration like 2 minutes, 2 hours, or 2 days"
              @input="expirationTouched = true"
            />
          </label>
        </div>

        <p v-if="error" class="rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-300">{{ error }}</p>

        <div class="flex justify-end">
          <button class="btn-primary" :disabled="loading" @click="submit">
            {{ loading ? (isEditing ? 'Saving...' : 'Creating...') : (isEditing ? 'Save changes' : 'Create link') }}
          </button>
        </div>
      </div>
    </div>
  </div>
  </Transition>
</template>
