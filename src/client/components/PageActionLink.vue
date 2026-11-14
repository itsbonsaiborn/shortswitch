<script setup lang="ts">
defineOptions({ inheritAttrs: false });

defineProps<{
  href?: string | null;
  target?: string;
  rel?: string;
}>();
</script>

<template>
  <a
    v-bind="$attrs"
    class="page-action group flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left"
    :href="href || undefined"
    :target="target"
    :rel="rel"
  >
    <slot />
    <svg
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      class="h-5 w-5 shrink-0 opacity-55 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
      viewBox="0 0 24 24"
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 6L6 18M8 6h10v10" />
    </svg>
  </a>
</template>

<style>
.page-action { border:1px solid var(--page-border); border-radius:var(--page-radius); background:var(--page-card); color:var(--page-text); box-shadow:var(--page-shadow); transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease; }
.page-action:hover { transform:translateY(-1px); border-color:var(--page-accent); }
.page-action:focus-visible { outline:3px solid color-mix(in srgb,var(--page-accent) 42%,transparent); outline-offset:2px; }
.page-layout-bold .page-action { border-width:2px; font-size:1.05rem; }
</style>
