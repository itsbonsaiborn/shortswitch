<script setup lang="ts">
defineProps<{
  label: string;
  value: string | number;
  hint?: string;
  icon?:
    | 'links'
    | 'clicks'
    | 'pages'
    | 'views'
    | 'visitors'
    | 'referrers'
    | 'devices'
    | 'activities'
    | 'responses'
    | 'active-activities'
    | 'participants'
    | 'approved'
    | 'pending'
    | 'rejected'
    | 'last-response';
}>();
</script>

<template>
  <div class="panel p-5">
    <p class="text-sm text-slate-500 dark:text-slate-400">{{ label }}</p>
    <div class="mt-3 flex items-center gap-3">
      <svg
        v-if="icon === 'links'"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        class="h-8 w-8 shrink-0 text-[var(--ui-accent)]"
        aria-hidden="true"
      >
        <path d="M17.74 2.76a4.32 4.32 0 0 1 0 6.1l-1.53 1.52c-1.12 1.12-2.7 1.47-4.14 1.09l2.62-2.61l.76-.77l.76-.76c.84-.84.84-2.2 0-3.04a2.13 2.13 0 0 0-3.04 0l-.77.76l-3.38 3.38c-.37-1.44-.02-3.02 1.1-4.14l1.52-1.53a4.32 4.32 0 0 1 6.1 0M8.59 13.43l5.34-5.34c.42-.42.42-1.1 0-1.52c-.44-.43-1.13-.39-1.53 0l-5.33 5.34c-.42.42-.42 1.1 0 1.52c.44.43 1.13.39 1.52 0m-.76 2.29l4.14-4.15c.38 1.44.03 3.02-1.09 4.14l-1.52 1.53a4.32 4.32 0 0 1-6.1 0a4.32 4.32 0 0 1 0-6.1l1.53-1.52c1.12-1.12 2.7-1.47 4.14-1.1l-4.14 4.15c-.85.84-.85 2.2 0 3.05c.84.84 2.2.84 3.04 0" />
      </svg>
      <svg
        v-else-if="icon === 'clicks'"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        class="h-8 w-8 shrink-0 text-[var(--ui-accent)]"
        aria-hidden="true"
      >
        <path d="M0 0h20v20H0z" fill="none" />
        <path fill="currentColor" fill-rule="evenodd" d="M6.672 1.911a1 1 0 1 0-1.932.518l.259.966a1 1 0 0 0 1.932-.518zM2.429 4.74a1 1 0 1 0-.517 1.932l.966.259a1 1 0 0 0 .517-1.932zm8.814-.569a1 1 0 0 0-1.415-1.414l-.707.707a1 1 0 1 0 1.415 1.415zm-7.071 7.072l.707-.707A1 1 0 0 0 3.465 9.12l-.708.707a1 1 0 0 0 1.415 1.415m3.2-5.171a1 1 0 0 0-1.3 1.3l4 10a1 1 0 0 0 1.823.075l1.38-2.759l3.018 3.02a1 1 0 0 0 1.414-1.415l-3.019-3.02l2.76-1.379a1 1 0 0 0-.076-1.822z" clip-rule="evenodd" />
      </svg>
      <svg
        v-else-if="icon === 'pages'"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        class="h-8 w-8 shrink-0 text-[var(--ui-accent)]"
        aria-hidden="true"
      >
        <path d="M0 0h20v20H0z" fill="none" />
        <path fill="currentColor" d="M6 2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm1.5 4h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1M7 13.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5m.5-4h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1" />
      </svg>
      <svg
        v-else-if="icon === 'views'"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 32 32"
        class="h-8 w-8 shrink-0 text-[var(--ui-accent)]"
        aria-hidden="true"
      >
        <path d="M0 0h32v32H0z" fill="none" />
        <path fill="currentColor" d="M30.94 15.66A16.69 16.69 0 0 0 16 5A16.69 16.69 0 0 0 1.06 15.66a1 1 0 0 0 0 .68A16.69 16.69 0 0 0 16 27a16.69 16.69 0 0 0 14.94-10.66a1 1 0 0 0 0-.68M16 25c-5.3 0-10.9-3.93-12.93-9C5.1 10.93 10.7 7 16 7s10.9 3.93 12.93 9C26.9 21.07 21.3 25 16 25" />
        <path fill="currentColor" d="M16 10a6 6 0 1 0 6 6a6 6 0 0 0-6-6m0 10a4 4 0 1 1 4-4a4 4 0 0 1-4 4" />
      </svg>
      <svg
        v-else-if="icon === 'referrers'"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        class="h-8 w-8 shrink-0 text-[var(--ui-accent)]"
        aria-hidden="true"
      >
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07L11.8 5" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 1 0 7.07 7.07L12.2 19" />
      </svg>
      <svg
        v-else-if="icon === 'devices'"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        class="h-8 w-8 shrink-0 text-[var(--ui-accent)]"
        aria-hidden="true"
      >
        <path d="M0 0h24v24H0z" fill="none" />
        <g fill="none">
          <path fill="currentColor" d="M1.78 7.65c0-1.88 0-2.82.58-3.41c.59-.59 1.53-.59 3.42-.59h9.93c1.45 0 2.18 0 2.7.36q.28.2.49.5c.36.51.36 1.24.36 2.7v1.35a2 2 0 0 1-1.67 1.83l-.28.08a2 2 0 0 0-1.3 1.38l-.06.27l-.16.85c-.25 1.25-.37 1.87-.76 2.29a2 2 0 0 1-.4.33c-.5.3-1.13.3-2.4.3H5.79c-1.9 0-2.83 0-3.42-.59c-.58-.58-.58-1.52-.58-3.41z" opacity=".2" />
          <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19.26 9.65v-2c0-1.88 0-2.82-.59-3.41c-.58-.59-1.52-.59-3.41-.59H5.78c-1.9 0-2.83 0-3.42.59s-.58 1.53-.58 3.41v4.24c0 1.89 0 2.83.58 3.41c.59.59 1.53.59 3.42.59h9.4m-4.66 4.01v-4.01M7.53 19.9h5.97" />
          <rect width="10.46" height="6.73" x="15.5" y="20.35" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" rx="2" transform="rotate(-90 15.5 20.35)" />
          <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19.5 12.6h-1.28" />
        </g>
      </svg>
      <svg
        v-else-if="icon === 'activities'"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 32 32"
        class="h-8 w-8 shrink-0 text-[var(--ui-accent)]"
        aria-hidden="true"
      >
        <path d="M0 0h32v32H0z" fill="none" />
        <path fill="currentColor" d="M25 30H7c-1.103 0-2-.897-2-2V7c0-1.103.897-2 2-2h3V4c0-1.103.897-2 2-2h8c1.103 0 2 .897 2 2v1h3c1.103 0 2 .897 2 2v21c0 1.103-.897 2-2 2M7 7v21h18V7h-3v3H10V7zm5 1h8V4h-8z" />
      </svg>
      <svg
        v-else-if="icon === 'responses'"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        class="h-8 w-8 shrink-0 text-[var(--ui-accent)]"
        aria-hidden="true"
      >
        <path d="M0 0h16v16H0z" fill="none" />
        <path fill="currentColor" d="M7 14s-1 0-1-1s1-4 5-4s5 3 5 4s-1 1-1 1zm4-6a3 3 0 1 0 0-6a3 3 0 0 0 0 6m-5.784 6A2.24 2.24 0 0 1 5 13c0-1.355.68-2.75 1.936-3.72A6.3 6.3 0 0 0 5 9c-4 0-5 3-5 4s1 1 1 1zM4.5 8a2.5 2.5 0 1 0 0-5a2.5 2.5 0 0 0 0 5" />
      </svg>
      <svg
        v-else-if="icon === 'active-activities'"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 32 32"
        class="h-8 w-8 shrink-0 text-[var(--ui-accent)]"
        aria-hidden="true"
      >
        <path d="M0 0h32v32H0z" fill="none" />
        <path fill="currentColor" d="M25 5h-3V4c0-1.1-.9-2-2-2h-8c-1.1 0-2 .9-2 2v1H7c-1.1 0-2 .9-2 2v21c0 1.1.9 2 2 2h6v-2H7V7h3v3h12V7h3v6h2V7c0-1.1-.9-2-2-2m-5 3h-8V4h8zm3 8c-3.86 0-7 3.14-7 7s3.14 7 7 7s7-3.14 7-7s-3.14-7-7-7m0 12V18c2.76 0 5 2.24 5 5s-2.24 5-5 5" />
      </svg>
      <svg
        v-else-if="icon === 'participants' || icon === 'visitors'"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        class="h-8 w-8 shrink-0 text-[var(--ui-accent)]"
        aria-hidden="true"
      >
        <path d="M0 0h24v24H0z" fill="none" />
        <g fill="none">
          <path fill="currentColor" d="M14.93 18.87h7c-.79-4.54-3.38-7.93-7.35-7.93c-1.42.13-1.36.93-2.67 2.67c-.71.7-1.75 1.39-.62 1.97a13 13 0 0 1 3.64 3.29" opacity=".2" />
          <path fill="currentColor" d="M20.02 6.7a4.88 4.88 0 0 1-5.97 4.74c0-1.95-2.32-4.98-2.32-4.98s-1.45-.22-1.42-.44a4.88 4.88 0 0 1 9.7.67" opacity=".2" />
          <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.47 5.62a4.6 4.6 0 0 1 4.67-3.8a4.88 4.88 0 1 1-1.39 9.54" />
          <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.82 10.28a4.8 4.8 0 0 1-4.8 4.8a4.8 4.8 0 1 1 4.8-4.8" />
          <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16.11 22.18a7.1 7.1 0 0 0-14.2 0m20.36-3.51a7.1 7.1 0 0 0-7.1-7.1c-.63 0-1 .06-1.57.2" />
        </g>
      </svg>
      <svg
        v-else-if="icon === 'approved'"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 2048 2048"
        class="h-8 w-8 shrink-0 text-[var(--ui-accent)]"
        aria-hidden="true"
      >
        <path d="M0 0h2048v2048H0z" fill="none" />
        <path fill="currentColor" d="M1024 0q141 0 272 36t244 104t207 160t161 207t103 245t37 272q0 141-36 272t-104 244t-160 207t-207 161t-245 103t-272 37q-141 0-272-36t-244-104t-207-160t-161-207t-103-245t-37-272q0-141 36-272t104-244t160-207t207-161T752 37t272-37m603 685l-136-136l-659 659l-275-275l-136 136l411 411z" />
      </svg>
      <svg
        v-else-if="icon === 'pending'"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        class="h-8 w-8 shrink-0 text-[var(--ui-accent)]"
        aria-hidden="true"
      >
        <path d="M0 0h24v24H0z" fill="none" />
        <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2M7 13.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5s1.5.67 1.5 1.5s-.67 1.5-1.5 1.5m5 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5s1.5.67 1.5 1.5s-.67 1.5-1.5 1.5m5 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5s1.5.67 1.5 1.5s-.67 1.5-1.5 1.5" />
      </svg>
      <svg
        v-else-if="icon === 'rejected'"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        class="h-8 w-8 shrink-0 text-[var(--ui-accent)]"
        aria-hidden="true"
      >
        <path d="M0 0h24v24H0z" fill="none" />
        <path fill="currentColor" d="M12 2c5.5 0 10 4.5 10 10s-4.5 10-10 10S2 17.5 2 12S6.5 2 12 2m0 2c-1.9 0-3.6.6-4.9 1.7l11.2 11.2c1-1.4 1.7-3.1 1.7-4.9c0-4.4-3.6-8-8-8m4.9 14.3L5.7 7.1C4.6 8.4 4 10.1 4 12c0 4.4 3.6 8 8 8c1.9 0 3.6-.6 4.9-1.7" />
      </svg>
      <svg
        v-else-if="icon === 'last-response'"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 32 32"
        class="h-8 w-8 shrink-0 text-[var(--ui-accent)]"
        aria-hidden="true"
      >
        <path d="M0 0h32v32H0z" fill="none" />
        <path fill="currentColor" d="M16 2C8.4 2 2 8.4 2 16s6.4 14 14 14s14-6.4 14-14S23.6 2 16 2m4.587 20L15 16.41V7h2v8.582l5 5.004z" />
        <path fill="none" d="M20.587 22L15 16.41V7h2v8.582l5 5.005z" />
      </svg>
      <p class="text-3xl font-semibold">{{ value }}</p>
    </div>
    <p v-if="hint" class="mt-2 text-sm text-accent-600 dark:text-accent-300">{{ hint }}</p>
  </div>
</template>
