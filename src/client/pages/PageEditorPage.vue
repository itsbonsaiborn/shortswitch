<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import type { LinkRecord, LiveActivitySummary, PageBlock, PageBlockType, PageDetail, PageInput, PageLayout, PageNestedBlock, PageTheme } from '@/shared/types';
import { api } from '../lib/api';
import { useToast } from '../composables/useToast';
import PageBlockIcon from '../components/PageBlockIcon.vue';
import LiveActivityPicker from '../components/LiveActivityPicker.vue';
import PageNestedBlockEditor from '../components/PageNestedBlockEditor.vue';
import PageRenderer from '../components/PageRenderer.vue';

type EditorBlock = PageInput['blocks'][number] & { id: string };
const route = useRoute();
const router = useRouter();
const { pushToast } = useToast();
const pageId = computed(() => route.params.id ? String(route.params.id) : null);
const loading = ref(true);
const saving = ref(false);
const loadError = ref('');
const initialized = ref(false);
const savedSnapshot = ref('');
const tab = ref<'general' | 'content' | 'design' | 'seo'>('general');
const previewWidth = ref<'mobile' | 'desktop'>('desktop');
const mobileMode = ref<'edit' | 'preview'>('edit');
const draggedIndex = ref<number | null>(null);
const draggedNewType = ref<PageBlockType | null>(null);
const editingBlockId = ref<string | null>(null);
const links = ref<LinkRecord[]>([]);
const activities = ref<LiveActivitySummary[]>([]);
const resourceSearch = reactive<Record<string, string>>({});
const publicUrl = ref('');
const displayUrl = (url: string) => url.replace(/^https?:\/\//i, '');

const form = reactive<PageInput>({
  title: '', slug: '', description: '', emoji: '✦', avatarUrl: '',
  theme: 'classic_cream', layout: 'classic', status: 'draft', seoTitle: '', seoDescription: '', blocks: []
});

const themes: Array<{ value: PageTheme; label: string; colors: string[] }> = [
  { value: 'classic_cream', label: 'Classic Cream', colors: ['#f7f0df', '#c7662e', '#28211b'] },
  { value: 'forest_dark', label: 'Forest Dark', colors: ['#14211b', '#9db55f', '#f0f4e8'] },
  { value: 'soft_lavender', label: 'Soft Lavender', colors: ['#f1edfa', '#8067b1', '#302842'] },
  { value: 'ocean_blue', label: 'Ocean Blue', colors: ['#eaf5f8', '#287d91', '#18333c'] },
  { value: 'minimal_light', label: 'Minimal Light', colors: ['#f8f8f6', '#2f6f62', '#1f1f1d'] }
];
const layouts: Array<{ value: PageLayout; label: string; description: string }> = [
  { value: 'classic', label: 'Classic', description: 'Rounded cards with subtle depth.' },
  { value: 'minimal', label: 'Minimal', description: 'Clean lines and almost no shadow.' },
  { value: 'soft', label: 'Soft', description: 'Generous radius and gentle forms.' },
  { value: 'bold', label: 'Bold', description: 'Strong borders and larger actions.' }
];
const blockLabels: Record<PageBlockType, string> = {
  heading: 'Heading', text: 'Text', link: 'Link', existing_link: 'ShortSwitch Link', live_activity: 'Live Activity',
  email: 'Email', divider: 'Divider', spacer: 'Spacer', image: 'Image URL', double: 'Double'
};
const defaultConfig = (type: PageBlockType) => {
  if (type === 'heading') return { text: 'Section heading', alignment: 'left' as const, size: 'medium' as const };
  if (type === 'text') return { text: 'Add your text here.', alignment: 'left' as const };
  if (type === 'link') return { title: 'New link', url: 'https://example.com', subtitle: '', emoji: '↗', openInNewTab: true };
  if (type === 'existing_link') return { title: 'Short link', resourceId: links.value[0]?.id ?? '', subtitle: '', emoji: '↗', openInNewTab: false };
  if (type === 'live_activity') return { title: 'Join Live', resourceId: activities.value[0]?.id ?? '', subtitle: '', emoji: '◉', openInNewTab: true };
  if (type === 'email') return { label: 'Email me', email: 'hello@example.com', style: 'button' as const };
  if (type === 'divider') return { style: 'solid' as const, spacing: 'medium' as const };
  if (type === 'spacer') return { spacing: 'medium' as const };
  if (type === 'image') return { url: 'https://example.com/image.jpg', alt: 'Image description', caption: '', alignment: 'center' as const };
  return {
    children: [
      { id: crypto.randomUUID(), type: 'link' as const, config: { title: 'First link', url: 'https://example.com', subtitle: '', emoji: '↗', openInNewTab: true }, visible: true },
      { id: crypto.randomUUID(), type: 'link' as const, config: { title: 'Second link', url: 'https://example.com', subtitle: '', emoji: '↗', openInNewTab: true }, visible: true }
    ]
  };
};

const serializableForm = computed(() => ({ ...form, blocks: form.blocks.map(({ id, type, config, visible }) => ({ id, type, config, visible })) }));
const currentSnapshot = computed(() => JSON.stringify(serializableForm.value));
const dirty = computed(() => initialized.value && currentSnapshot.value !== savedSnapshot.value);
const editorBlocks = computed(() => form.blocks as EditorBlock[]);
const editingBlock = computed(() => editorBlocks.value.find((block) => block.id === editingBlockId.value) ?? null);
const hydratePreviewBlock = (block: EditorBlock | PageNestedBlock, position: number): PageBlock => {
  let href: string | null | undefined;
  let available: boolean | undefined;
  if (block.type === 'existing_link') {
    const linked = links.value.find((item) => item.id === block.config.resourceId);
    href = linked?.shortUrl ?? null;
    available = Boolean(linked);
  } else if (block.type === 'live_activity') {
    const activity = activities.value.find((item) => item.id === block.config.resourceId);
    href = activity?.publicUrl ?? null;
    available = Boolean(activity);
  }
  const config = block.type === 'double'
    ? { ...block.config, children: (block.config.children ?? []).map((child, index) => hydratePreviewBlock(child, index)) }
    : block.config;
  return { ...block, config, position, createdAt: '', updatedAt: '', ...(href !== undefined ? { href, available } : {}) } as PageBlock;
};
const previewPage = computed<PageDetail>(() => ({
  id: pageId.value ?? 'preview', slug: form.slug || 'preview', publicUrl: '#', title: form.title || 'Untitled Page',
  description: form.description || null, emoji: form.emoji || null, avatarUrl: form.avatarUrl || null,
  theme: form.theme, layout: form.layout, status: form.status, seoTitle: form.seoTitle || null, seoDescription: form.seoDescription || null,
  blockCount: form.blocks.length, totalViews: 0, uniqueVisitors: 0, totalLinkClicks: 0,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  blocks: editorBlocks.value.map(hydratePreviewBlock)
}));
const filteredLinks = (blockId: string) => {
  const query = (resourceSearch[blockId] || '').toLowerCase();
  return links.value.filter((item) => !query || item.slug.toLowerCase().includes(query) || item.targetUrl.toLowerCase().includes(query)).slice(0, 30);
};
const assignPage = (page: PageDetail) => {
  publicUrl.value = page.publicUrl;
  Object.assign(form, {
    title: page.title, slug: page.slug, description: page.description ?? '', emoji: page.emoji ?? '', avatarUrl: page.avatarUrl ?? '',
    theme: page.theme, layout: page.layout, status: page.status, seoTitle: page.seoTitle ?? '', seoDescription: page.seoDescription ?? '',
    blocks: page.blocks.map((block) => ({ id: block.id, type: block.type, config: { ...block.config }, visible: block.visible }))
  });
};
const load = async () => {
  loading.value = true;
  loadError.value = '';
  try {
    const [linkData, liveData, page] = await Promise.all([
      api<LinkRecord[]>('/api/links'), api<LiveActivitySummary[]>('/api/live'),
      pageId.value ? api<PageDetail>(`/api/pages/${pageId.value}`) : Promise.resolve(null)
    ]);
    links.value = linkData; activities.value = liveData;
    if (page) assignPage(page);
    savedSnapshot.value = currentSnapshot.value;
    initialized.value = true;
  } catch (error) {
    loadError.value = (error as Error).message || 'Could not load the Page editor.';
    pushToast({ tone: 'error', title: 'Could not load Page', description: loadError.value });
  } finally { loading.value = false; }
};
const insertBlock = (type: PageBlockType, index = form.blocks.length, openEditor = false) => {
  const block = { id: crypto.randomUUID(), type, config: defaultConfig(type), visible: true } as EditorBlock;
  form.blocks.splice(index, 0, block);
  tab.value = 'content';
  if (openEditor) editingBlockId.value = block.id;
};
const addBlock = (type: PageBlockType) => insertBlock(type, form.blocks.length, true);
const removeBlock = (index: number) => { if (window.confirm('Delete this block?')) form.blocks.splice(index, 1); };
const moveBlock = (from: number, to: number) => {
  if (to < 0 || to > form.blocks.length || from === to) return;
  const [block] = form.blocks.splice(from, 1); form.blocks.splice(to, 0, block);
};
const dropBlock = (to: number) => {
  if (draggedNewType.value) insertBlock(draggedNewType.value, to);
  else if (draggedIndex.value !== null) moveBlock(draggedIndex.value, to);
  draggedIndex.value = null;
  draggedNewType.value = null;
};
const dropAtEnd = () => dropBlock(form.blocks.length);
const blockDetailLines = (block: EditorBlock) => {
  if (block.type === 'double') return [
    (block.config.children ?? []).map((child) => blockLabels[child.type]).join(' + ') || 'Two empty columns',
    'Two blocks in one row'
  ];
  if (block.type === 'heading' || block.type === 'text') return [block.config.text || 'Empty content'];
  if (block.type === 'link') return [block.config.title || 'Untitled link', block.config.url || 'No URL'];
  if (block.type === 'existing_link') {
    const linked = links.value.find((item) => item.id === block.config.resourceId);
    return [block.config.title || 'ShortSwitch Link', linked?.shortUrl || 'No Link selected'];
  }
  if (block.type === 'live_activity') {
    const activity = activities.value.find((item) => item.id === block.config.resourceId);
    return [block.config.title || 'Live Activity', activity ? `${activity.title} · /${activity.slug}` : 'No Live Activity selected'];
  }
  if (block.type === 'email') return [block.config.label || 'Email', block.config.email || 'No address'];
  if (block.type === 'image') return [block.config.alt || 'Image', block.config.url || 'No image URL'];
  return [block.type === 'divider' ? `${block.config.style || 'Solid'} divider` : `${block.config.spacing || 'Medium'} space`];
};
const blockAccentClass = (type: PageBlockType) => `page-block-accent-${type}`;
const save = async () => {
  saving.value = true;
  try {
    const payload = JSON.stringify(serializableForm.value);
    const page = pageId.value
      ? await api<PageDetail>(`/api/pages/${pageId.value}`, { method: 'PATCH', body: payload })
      : await api<PageDetail>('/api/pages', { method: 'POST', body: payload });
    assignPage(page);
    savedSnapshot.value = currentSnapshot.value;
    pushToast({ tone: 'success', title: pageId.value ? 'Page saved' : 'Page created', description: page.publicUrl });
    if (!pageId.value) await router.replace(`/app/pages/${page.id}`);
  } catch (error) {
    pushToast({ tone: 'error', title: 'Could not save Page', description: (error as Error).message });
  } finally { saving.value = false; }
};
const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty.value) { event.preventDefault(); event.returnValue = ''; } };
onBeforeRouteLeave(() => !dirty.value || window.confirm('You have unsaved Page changes. Leave without saving?'));
onMounted(() => { window.addEventListener('beforeunload', beforeUnload); void load(); });
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload));
watch(() => route.params.id, () => { if (route.name) void load(); });
</script>

<template>
  <div v-if="loading" class="panel py-20 text-center text-[var(--ui-text-muted)]">Loading editor…</div>
  <div v-else-if="loadError" class="panel px-6 py-16 text-center">
    <h2 class="text-xl font-semibold">Page editor unavailable</h2>
    <p class="mx-auto mt-2 max-w-md text-sm text-[var(--ui-text-muted)]">{{ loadError }}</p>
    <button class="btn-primary mt-5" @click="router.push('/app/pages')">Back to Pages</button>
  </div>
  <div v-else class="space-y-4">
    <section class="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div class="min-w-0">
        <div class="flex items-center gap-2"><h2 class="truncate text-xl font-semibold">{{ pageId ? 'Edit Page' : 'Create Page' }}</h2><span v-if="dirty" class="rounded-full bg-[var(--ui-pill-bg)] px-2.5 py-1 text-xs text-[var(--ui-text-muted)]">Unsaved changes</span></div>
        <a v-if="publicUrl" :href="publicUrl" target="_blank" rel="noopener noreferrer" class="mt-1 block truncate text-sm text-[var(--ui-accent)] hover:underline">{{ displayUrl(publicUrl) }}</a>
        <p v-else class="mt-1 truncate text-sm text-[var(--ui-text-muted)]">{{ form.slug ? `The Page will use /${form.slug}` : 'A random slug will be generated' }}</p>
      </div>
      <div class="flex gap-2"><button class="btn-secondary" @click="router.push('/app/pages')">Back</button><button class="btn-primary" :disabled="saving || !dirty" @click="save">{{ saving ? 'Saving…' : 'Save Changes' }}</button></div>
    </section>

    <div class="flex gap-2 lg:hidden">
      <button class="btn-secondary flex-1" :class="mobileMode === 'edit' ? 'ring-2 ring-[var(--ui-accent)]' : ''" @click="mobileMode = 'edit'">Edit</button>
      <button class="btn-secondary flex-1" :class="mobileMode === 'preview' ? 'ring-2 ring-[var(--ui-accent)]' : ''" @click="mobileMode = 'preview'">Preview</button>
    </div>

    <div class="grid min-w-0 gap-4 lg:grid-cols-[minmax(440px,1.05fr)_minmax(380px,.95fr)]">
      <section class="panel min-w-0 p-4 sm:p-6" :class="mobileMode === 'edit' ? 'block' : 'hidden lg:block'">
        <div class="mb-6 grid grid-cols-4 gap-2" role="tablist" aria-label="Page editor sections">
          <button v-for="item in ['general','content','design','seo'] as const" :key="item" class="rounded-xl px-2 py-2.5 text-sm font-medium capitalize" :class="tab === item ? 'bg-[var(--ui-accent)] text-[var(--ui-accent-contrast)]' : 'bg-[var(--ui-panel-muted)]'" @click="tab = item">{{ item === 'seo' ? 'SEO' : item }}</button>
        </div>

        <div v-if="tab === 'general'" class="grid gap-4 sm:grid-cols-2">
          <label class="sm:col-span-2"><span class="mb-2 block text-sm font-medium">Title</span><input v-model="form.title" class="input px-4 py-3" maxlength="120" /></label>
          <label><span class="mb-2 block text-sm font-medium">Custom slug <span class="font-normal text-[var(--ui-text-muted)]">(optional)</span></span><input v-model="form.slug" class="input px-4 py-3" maxlength="64" placeholder="Random when blank" /></label>
          <label><span class="mb-2 block text-sm font-medium">Status</span><select v-model="form.status" class="input px-4 py-3"><option value="draft">Draft</option><option value="published">Published</option><option value="disabled">Disabled</option></select></label>
          <label class="sm:col-span-2"><span class="mb-2 block text-sm font-medium">Description</span><textarea v-model="form.description" class="input min-h-28 px-4 py-3" maxlength="1000" /></label>
          <label><span class="mb-2 block text-sm font-medium">Emoji / icon</span><input v-model="form.emoji" class="input px-4 py-3" maxlength="16" /></label>
          <label><span class="mb-2 block text-sm font-medium">External avatar URL</span><input v-model="form.avatarUrl" class="input px-4 py-3" type="url" placeholder="https://…" /></label>
        </div>

        <div v-else-if="tab === 'content'" class="space-y-5">
          <div><h3 class="text-lg font-semibold">Page blocks</h3><p class="mt-1 text-sm text-[var(--ui-text-muted)]">Add, edit and reorder the content of your page.</p></div>

          <div class="app-scrollbar max-h-[52vh] space-y-2 overflow-y-auto pr-1" @dragover.prevent @drop.stop="dropAtEnd">
            <p v-if="!form.blocks.length" class="panel-muted px-5 py-10 text-center text-sm text-[var(--ui-text-muted)]">No blocks yet. Add or drag the first block below.</p>
            <article
              v-for="(block, index) in editorBlocks" :key="block.id" draggable="true"
              class="block-editor-card flex min-w-0 items-center gap-3 rounded-2xl border p-3 transition-opacity"
              :class="[blockAccentClass(block.type), block.visible ? '' : 'opacity-55']"
              @dragstart="draggedIndex = index; draggedNewType = null"
              @dragend="draggedIndex = null"
              @dragover.prevent
              @drop.stop="dropBlock(index)"
            >
              <span class="drag-handle cursor-grab text-[var(--ui-text-muted)]" title="Drag to reorder" aria-label="Drag block">⠿</span>
              <span class="block-editor-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"><PageBlockIcon :type="block.type" /></span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2"><p class="text-sm font-semibold">{{ blockLabels[block.type] }}</p><span v-if="!block.visible" class="rounded-full bg-[var(--ui-pill-bg)] px-2 py-0.5 text-[10px]">Hidden</span></div>
                <p v-for="(line, lineIndex) in blockDetailLines(block)" :key="lineIndex" class="mt-0.5 truncate text-xs text-[var(--ui-text-muted)]">{{ line }}</p>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <button class="icon-button !h-9 !w-9" :aria-label="block.visible ? 'Hide block' : 'Show block'" @click="block.visible = !block.visible">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M21.257 10.962c.474.62.474 1.457 0 2.076C19.764 14.987 16.182 19 12 19s-7.764-4.013-9.257-5.962a1.69 1.69 0 0 1 0-2.076C4.236 9.013 7.818 5 12 5s7.764 4.013 9.257 5.962"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
                <button class="icon-button !h-9 !w-9" aria-label="Edit block" @click="editingBlockId = block.id">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m16.475 5.408l2.117 2.117m-.756-3.982L12.109 9.27a2.1 2.1 0 0 0-.58 1.082L11 13l2.648-.53c.41-.082.786-.283 1.082-.579l5.727-5.727a1.853 1.853 0 1 0-2.621-2.621"/><path d="M19 15v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3"/></g></svg>
                </button>
                <button class="icon-button !h-9 !w-9 text-[#AF3029] dark:text-[#F89A8A]" aria-label="Delete block" @click="removeBlock(index)">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>
                </button>
              </div>
              <span class="drag-handle hidden cursor-grab text-[var(--ui-text-muted)] sm:block" title="Drag to reorder" aria-hidden="true">⠿</span>
            </article>
          </div>

          <section class="panel-muted p-4" @dragover.prevent @drop.stop="dropAtEnd">
            <h3 class="font-semibold">Add new block</h3>
            <p class="mt-1 text-xs text-[var(--ui-text-muted)]">Click to add at the end, or drag a block into the list.</p>
            <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <button
                v-for="(label, type) in blockLabels" :key="type" draggable="true"
                class="block-palette-button flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition hover:-translate-y-0.5"
                :class="blockAccentClass(type)"
                @dragstart="draggedNewType = type; draggedIndex = null"
                @dragend="draggedNewType = null"
                @click="addBlock(type)"
              ><PageBlockIcon :type="type" /><span class="truncate">{{ label }}</span></button>
            </div>
          </section>
        </div>

        <div v-else-if="tab === 'design'" class="space-y-7">
          <div><h3 class="font-semibold">Theme</h3><div class="mt-3 grid gap-3 sm:grid-cols-2"><button v-for="theme in themes" :key="theme.value" class="rounded-2xl border p-4 text-left" :class="form.theme === theme.value ? 'border-[var(--ui-accent)] ring-2 ring-[var(--ui-accent)]/20' : 'border-[var(--ui-border)]'" @click="form.theme = theme.value"><span class="flex gap-1"><span v-for="color in theme.colors" :key="color" class="h-7 flex-1 rounded-lg" :style="{ background: color }" /></span><span class="mt-3 block text-sm font-semibold">{{ theme.label }}</span></button></div></div>
          <div><h3 class="font-semibold">Layout</h3><div class="mt-3 grid gap-3 sm:grid-cols-2"><button v-for="layout in layouts" :key="layout.value" class="rounded-2xl border p-4 text-left" :class="form.layout === layout.value ? 'border-[var(--ui-accent)] ring-2 ring-[var(--ui-accent)]/20' : 'border-[var(--ui-border)]'" @click="form.layout = layout.value"><span class="font-semibold">{{ layout.label }}</span><span class="mt-1 block text-xs text-[var(--ui-text-muted)]">{{ layout.description }}</span></button></div></div>
        </div>

        <div v-else class="grid gap-4">
          <p class="text-sm text-[var(--ui-text-muted)]">Optional sharing metadata. When blank, Page title and description are used.</p>
          <label><span class="mb-2 block text-sm font-medium">SEO / sharing title</span><input v-model="form.seoTitle" class="input px-4 py-3" maxlength="120" /></label>
          <label><span class="mb-2 block text-sm font-medium">SEO / sharing description</span><textarea v-model="form.seoDescription" class="input min-h-28 px-4 py-3" maxlength="300" /></label>
        </div>
      </section>

      <aside class="panel min-w-0 p-3 sm:p-5 lg:sticky lg:top-4 lg:h-[calc(100dvh-2rem)]" :class="mobileMode === 'preview' ? 'block' : 'hidden lg:block'">
        <div class="mb-3 flex items-center justify-between gap-3"><p class="text-sm font-semibold">Live Preview</p><div class="flex gap-1"><button class="rounded-lg px-3 py-1.5 text-xs" :class="previewWidth === 'mobile' ? 'bg-[var(--ui-accent)] text-[var(--ui-accent-contrast)]' : 'bg-[var(--ui-panel-muted)]'" @click="previewWidth = 'mobile'">Mobile</button><button class="rounded-lg px-3 py-1.5 text-xs" :class="previewWidth === 'desktop' ? 'bg-[var(--ui-accent)] text-[var(--ui-accent-contrast)]' : 'bg-[var(--ui-panel-muted)]'" @click="previewWidth = 'desktop'">Desktop</button></div></div>
        <div
          class="app-scrollbar mx-auto h-[calc(100dvh-8rem)] min-h-[390px] overflow-y-auto overflow-x-hidden rounded-[1.75rem] border border-[var(--ui-border)] bg-[var(--ui-panel-muted)] shadow-inner transition-[max-width] duration-300"
          :class="previewWidth === 'mobile' ? 'max-w-[390px]' : 'max-w-full'"
        >
          <PageRenderer :page="previewPage" preview />
        </div>
      </aside>
    </div>

    <Teleport to="body">
      <div v-if="editingBlock" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" :aria-label="`Edit ${blockLabels[editingBlock.type]} block`" @click.self="editingBlockId = null">
        <section class="panel app-scrollbar max-h-[90dvh] w-full max-w-2xl overflow-y-auto p-5 shadow-2xl sm:p-6">
          <div class="flex items-center gap-3 border-b border-[var(--ui-border)] pb-4">
            <span class="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ui-border)] bg-[var(--ui-panel-muted)] text-[var(--ui-accent)]"><PageBlockIcon :type="editingBlock.type" /></span>
            <div><h3 class="text-lg font-semibold">Edit {{ blockLabels[editingBlock.type] }}</h3><p class="text-xs text-[var(--ui-text-muted)]">Changes are reflected in Live Preview immediately.</p></div>
            <button class="icon-button ml-auto" aria-label="Close block editor" @click="editingBlockId = null">×</button>
          </div>

          <div class="mt-5 grid gap-4 sm:grid-cols-2">
            <template v-if="editingBlock.type === 'heading'">
              <label class="sm:col-span-2"><span class="field-label">Text</span><input v-model="editingBlock.config.text" class="input px-3 py-2" maxlength="160" /></label>
              <label><span class="field-label">Alignment</span><select v-model="editingBlock.config.alignment" class="input px-3 py-2"><option>left</option><option>center</option><option>right</option></select></label>
              <label><span class="field-label">Size</span><select v-model="editingBlock.config.size" class="input px-3 py-2"><option>small</option><option>medium</option><option>large</option></select></label>
            </template>
            <template v-else-if="editingBlock.type === 'text'">
              <label class="sm:col-span-2"><span class="field-label">Text</span><textarea v-model="editingBlock.config.text" class="input min-h-36 px-3 py-2" maxlength="4000" /></label>
              <label><span class="field-label">Alignment</span><select v-model="editingBlock.config.alignment" class="input px-3 py-2"><option>left</option><option>center</option><option>right</option></select></label>
            </template>
            <template v-else-if="editingBlock.type === 'link'">
              <label><span class="field-label">Title</span><input v-model="editingBlock.config.title" class="input px-3 py-2" maxlength="120" /></label>
              <label><span class="field-label">Emoji</span><input v-model="editingBlock.config.emoji" class="input px-3 py-2" maxlength="16" /></label>
              <label class="sm:col-span-2"><span class="field-label">URL</span><input v-model="editingBlock.config.url" class="input px-3 py-2" type="url" /></label>
              <label class="sm:col-span-2"><span class="field-label">Subtitle</span><input v-model="editingBlock.config.subtitle" class="input px-3 py-2" maxlength="240" /></label>
              <label class="flex items-center gap-2 text-sm"><input v-model="editingBlock.config.openInNewTab" type="checkbox" /> Open in new tab</label>
            </template>
            <template v-else-if="editingBlock.type === 'existing_link'">
              <label class="sm:col-span-2"><span class="field-label">Search Links</span><input v-model="resourceSearch[editingBlock.id]" class="input px-3 py-2" placeholder="Slug or destination" /></label>
              <label class="sm:col-span-2"><span class="field-label">ShortSwitch Link</span><select v-model="editingBlock.config.resourceId" class="input px-3 py-2"><option value="">Select a Link</option><option v-for="link in filteredLinks(editingBlock.id)" :key="link.id" :value="link.id">/{{ link.slug }} · {{ link.targetUrl }}</option></select></label>
              <label><span class="field-label">Button title</span><input v-model="editingBlock.config.title" class="input px-3 py-2" maxlength="120" /></label>
              <label><span class="field-label">Emoji</span><input v-model="editingBlock.config.emoji" class="input px-3 py-2" maxlength="16" /></label>
              <label class="sm:col-span-2"><span class="field-label">Subtitle</span><input v-model="editingBlock.config.subtitle" class="input px-3 py-2" maxlength="240" /></label>
            </template>
            <template v-else-if="editingBlock.type === 'live_activity'">
              <LiveActivityPicker v-model="editingBlock.config.resourceId" :activities="activities" class="sm:col-span-2" />
              <label><span class="field-label">Button title</span><input v-model="editingBlock.config.title" class="input px-3 py-2" maxlength="120" /></label>
              <label><span class="field-label">Emoji</span><input v-model="editingBlock.config.emoji" class="input px-3 py-2" maxlength="16" /></label>
              <label class="sm:col-span-2"><span class="field-label">Subtitle</span><input v-model="editingBlock.config.subtitle" class="input px-3 py-2" maxlength="240" /></label>
            </template>
            <template v-else-if="editingBlock.type === 'email'">
              <label><span class="field-label">Label</span><input v-model="editingBlock.config.label" class="input px-3 py-2" maxlength="120" /></label>
              <label><span class="field-label">Email</span><input v-model="editingBlock.config.email" class="input px-3 py-2" type="email" /></label>
              <label><span class="field-label">Style</span><select v-model="editingBlock.config.style" class="input px-3 py-2"><option value="button">Button</option><option value="text">Text</option></select></label>
            </template>
            <template v-else-if="editingBlock.type === 'divider'">
              <label><span class="field-label">Style</span><select v-model="editingBlock.config.style" class="input px-3 py-2"><option>solid</option><option>dashed</option><option>dotted</option></select></label>
              <label><span class="field-label">Spacing</span><select v-model="editingBlock.config.spacing" class="input px-3 py-2"><option>small</option><option>medium</option><option>large</option></select></label>
            </template>
            <template v-else-if="editingBlock.type === 'spacer'">
              <label><span class="field-label">Spacing</span><select v-model="editingBlock.config.spacing" class="input px-3 py-2"><option>small</option><option>medium</option><option>large</option></select></label>
            </template>
            <template v-else-if="editingBlock.type === 'image'">
              <label class="sm:col-span-2"><span class="field-label">HTTPS image URL</span><input v-model="editingBlock.config.url" class="input px-3 py-2" type="url" /></label>
              <label class="sm:col-span-2"><span class="field-label">Alt text</span><input v-model="editingBlock.config.alt" class="input px-3 py-2" maxlength="300" /></label>
              <label><span class="field-label">Caption</span><input v-model="editingBlock.config.caption" class="input px-3 py-2" maxlength="500" /></label>
              <label><span class="field-label">Alignment</span><select v-model="editingBlock.config.alignment" class="input px-3 py-2"><option>left</option><option>center</option><option>right</option></select></label>
            </template>
            <template v-else-if="editingBlock.type === 'double'">
              <p class="sm:col-span-2 text-sm text-[var(--ui-text-muted)]">Choose and configure two blocks. They are displayed side by side in one row; nested Double blocks are intentionally not allowed.</p>
              <div class="sm:col-span-2 grid gap-3 xl:grid-cols-2">
                <PageNestedBlockEditor
                  v-for="(child, childIndex) in editingBlock.config.children" :key="child.id"
                  :block="child" :column="childIndex + 1" :links="links" :activities="activities" :labels="blockLabels"
                />
              </div>
            </template>
          </div>
          <div class="mt-6 flex justify-end"><button class="btn-primary" @click="editingBlockId = null">Done</button></div>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.field-label { display:block; margin-bottom:.4rem; font-size:.75rem; color:var(--ui-text-muted); }
.drag-handle { font-size:1.25rem; letter-spacing:-.18em; transform:rotate(90deg); }
.block-editor-card { border-color:color-mix(in srgb,var(--block-accent) 34%,var(--ui-border)); background:color-mix(in srgb,var(--block-accent) 7%,var(--ui-panel)); border-left-width:4px; border-left-color:var(--block-accent); }
.block-editor-icon { color:var(--block-accent); border-color:color-mix(in srgb,var(--block-accent) 35%,var(--ui-border)); background:color-mix(in srgb,var(--block-accent) 11%,var(--ui-panel)); }
.block-palette-button { color:var(--ui-text); border-color:color-mix(in srgb,var(--block-accent) 30%,var(--ui-border)); background:color-mix(in srgb,var(--block-accent) 7%,var(--ui-panel)); }
.block-palette-button:hover { color:var(--block-accent); border-color:var(--block-accent); }
.page-block-accent-heading { --block-accent:#ad8301; }
.page-block-accent-text { --block-accent:#205ea6; }
.page-block-accent-link { --block-accent:#24837b; }
.page-block-accent-existing_link { --block-accent:#3aa99f; }
.page-block-accent-live_activity { --block-accent:#8b7ec8; }
.page-block-accent-email { --block-accent:#ce5d97; }
.page-block-accent-divider { --block-accent:#878580; }
.page-block-accent-spacer { --block-accent:#66800b; }
.page-block-accent-image { --block-accent:#bc5215; }
.page-block-accent-double { --block-accent:#5e409d; }
</style>
