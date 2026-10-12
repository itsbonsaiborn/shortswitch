<script setup lang="ts">
import type { PageBlockType } from '@/shared/types';

defineProps<{ type: PageBlockType }>();
</script>

<template>
  <svg v-if="type === 'heading'" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 448 512"><path d="M0 0h448v512H0z" fill="none"/><path fill="currentColor" d="M0 64c0-17.7 14.3-32 32-32h96c17.7 0 32 14.3 32 32s-14.3 32-32 32h-16v112h224V96h-16c-17.7 0-32-14.3-32-32s14.3-32 32-32h96c17.7 0 32 14.3 32 32s-14.3 32-32 32h-16v320h16c17.7 0 32 14.3 32 32s-14.3 32-32 32h-96c-17.7 0-32-14.3-32-32s14.3-32 32-32h16V272H112v144h16c17.7 0 32 14.3 32 32s-14.3 32-32 32H32c-17.7 0-32-14.3-32-32s14.3-32 32-32h16V96H32C14.3 96 0 81.7 0 64"/></svg>
  <svg v-else-if="type === 'text'" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M3 6h18M3 12h10M3 18h15"/></svg>
  <svg v-else-if="type === 'link' || type === 'existing_link'" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M13.544 10.456a4.37 4.37 0 0 0-6.176 0l-3.089 3.088a4.367 4.367 0 1 0 6.177 6.177L12 18.177"/><path d="M10.456 13.544a4.37 4.37 0 0 0 6.176 0l3.089-3.088a4.367 4.367 0 1 0-6.177-6.177L12 5.823"/></g></svg>
  <svg v-else-if="type === 'email'" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 32 32"><path d="M0 0h32v32H0z" fill="none"/><path fill="currentColor" d="M28 6H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2m-2.2 2L16 14.78L6.2 8ZM4 24V8.91l11.43 7.91a1 1 0 0 0 1.14 0L28 8.91V24Z"/></svg>
  <svg v-else-if="type === 'divider'" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><path fill="currentColor" d="M21 11a1 1 0 1 1 0 2H3a1 1 0 1 1 0-2z"/></svg>
  <svg v-else-if="type === 'image'" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M2 6a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z"/><circle cx="8.5" cy="8.5" r="2.5"/><path d="M14.526 12.621L6 22h12.133A3.867 3.867 0 0 0 22 18.133V18c0-.466-.175-.645-.49-.99l-4.03-4.395a2 2 0 0 0-2.954.006"/></g></svg>
  <svg v-else-if="type === 'spacer'" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 12 12"><path d="M0 0h12v12H0z" fill="none"/><path fill="currentColor" d="M3.354 4.354a.5.5 0 1 1-.708-.708l2.5-2.5a.5.5 0 0 1 .708 0l2.5 2.5a.5.5 0 1 1-.708.708L6 2.707v6.586l1.646-1.647a.5.5 0 1 1 .708.708l-2.5 2.5a.5.5 0 0 1-.708 0l-2.5-2.5a.5.5 0 1 1 .708-.708L5 9.293V2.707z"/></svg>
  <svg v-else-if="type === 'double'" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 2048 2048"><path d="M0 0h2048v2048H0z" fill="none"/><path fill="currentColor" d="M0 1792V256h896v1536zM128 384v1280h640V384zm896-128h896v1536h-896zm768 1408V384h-640v1280z"/></svg>
  <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/></svg>
</template>
