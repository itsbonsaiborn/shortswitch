<script setup lang="ts">
import { useToast } from '../composables/useToast';

const { toasts, removeToast } = useToast();

const toastClass = (tone: 'success' | 'error') =>
  tone === 'success'
    ? 'border-transparent bg-[#E8F3E6] text-[#66800B] shadow-[0_10px_24px_-16px_rgba(102,128,11,0.42)] ring-1 ring-[#66800B]/10 dark:bg-[#1B2B29] dark:text-[#BEC97E] dark:ring-[#BEC97E]/10'
    : 'border-transparent bg-[#FCE8DB] text-[#AF3029] shadow-[0_10px_24px_-16px_rgba(175,48,41,0.38)] ring-1 ring-[#AF3029]/10 dark:bg-[#321F1C] dark:text-[#F89A8A] dark:ring-[#F89A8A]/10';
</script>

<template>
  <Teleport to="body">
    <div class="pointer-events-none fixed inset-x-0 top-4 z-[90] flex justify-center px-4">
      <div class="flex w-full max-w-[22rem] flex-col items-center gap-3">
        <TransitionGroup
          enter-active-class="transition duration-300 ease-out"
          enter-from-class="-translate-y-3 opacity-0"
          enter-to-class="translate-y-0 opacity-100"
          leave-active-class="transition duration-200 ease-in"
          leave-from-class="opacity-100"
          leave-to-class="-translate-y-2 opacity-0"
        >
          <button
            v-for="toast in toasts.items"
            :key="toast.id"
            class="pointer-events-auto w-full rounded-[1.6rem] border px-5 py-3.5 text-center backdrop-blur-xl"
            :class="toastClass(toast.tone)"
            @click="removeToast(toast.id)"
          >
            <p class="text-sm font-semibold">{{ toast.title }}</p>
            <p v-if="toast.description" class="mt-1 text-[13px] opacity-90">{{ toast.description }}</p>
          </button>
        </TransitionGroup>
      </div>
    </div>
  </Teleport>
</template>
