<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import type { LinkRecord, LiveActivitySummary, PageBackgroundPattern, PageBlock, PageBlockType, PageDetail, PageInput, PageLayout, PageNestedBlock, PageNestedBlockType, PageTheme } from '@/shared/types';
import { useI18n } from 'vue-i18n';
import { api } from '../lib/api';
import { useToast } from '../composables/useToast';
import LinkPicker from '../components/LinkPicker.vue';
import PageBlockIcon from '../components/PageBlockIcon.vue';
import LiveActivityPicker from '../components/LiveActivityPicker.vue';
import PageRenderer from '../components/PageRenderer.vue';

type EditorBlock = PageInput['blocks'][number] & { id: string };
const route = useRoute();
const router = useRouter();
const { pushToast } = useToast();
const { t } = useI18n();
const pageId = computed(() => route.params.id ? String(route.params.id) : null);
const loading = ref(true);
const saving = ref(false);
const loadError = ref('');
const initialized = ref(false);
const savedSnapshot = ref('');
const tab = ref<'general' | 'content' | 'design' | 'seo'>('general');
const previewWidth = ref<'mobile' | 'desktop'>('desktop');
const mobileMode = ref<'edit' | 'preview'>('edit');
const editingBlockId = ref<string | null>(null);
const editingNestedBlockId = ref<string | null>(null);
const editorWorkspace = ref<HTMLElement | null>(null);
const workspacePanelHeight = ref<string>();
const blockList = ref<HTMLElement | null>(null);
const previewPanel = ref<HTMLElement | null>(null);
const activePreviewBlockId = ref<string | null>(null);
const highlightedEditorBlockId = ref<string | null>(null);
const draggingBlockId = ref<string | null>(null);
const dragOrderIds = ref<string[] | null>(null);
const reorderAnnouncement = ref('');
const activeBlockMenuId = ref<string | null>(null);
const activeBlockMenuAnchor = ref<HTMLElement | null>(null);
const activeBlockMenuStyle = ref<Record<string, string>>({});
const activeAddPosition = ref<number | null>(null);
const activeDoubleSlot = ref<{ parentId: string; childId: string } | null>(null);
const addBlockAnchor = ref<HTMLElement | null>(null);
const addBlockPopover = ref<HTMLElement | null>(null);
const addBlockPopoverStyle = ref<Record<string, string>>({});
const blockTypeSearch = ref('');
const links = ref<LinkRecord[]>([]);
const activities = ref<LiveActivitySummary[]>([]);
const publicUrl = ref('');
const displayUrl = (url: string) => url.replace(/^https?:\/\//i, '');

const form = reactive<PageInput>({
  title: '', slug: '', description: '', emoji: '✦', avatarUrl: '',
  theme: 'classic_cream', layout: 'classic', backgroundPattern: 'none', patternIntensity: 35,
  status: 'draft', seoTitle: '', seoDescription: '', blocks: []
});

const themes = computed<Array<{ value: PageTheme; label: string; colors: string[] }>>(() => [
  { value: 'classic_cream', label: t('design.classicCream'), colors: ['#f7f0df', '#c7662e', '#28211b'] },
  { value: 'forest_dark', label: t('design.forestDark'), colors: ['#14211b', '#9db55f', '#f0f4e8'] },
  { value: 'soft_lavender', label: t('design.softLavender'), colors: ['#f1edfa', '#8067b1', '#302842'] },
  { value: 'ocean_blue', label: t('design.oceanBlue'), colors: ['#eaf5f8', '#287d91', '#18333c'] },
  { value: 'minimal_light', label: t('design.minimalLight'), colors: ['#f8f8f6', '#2f6f62', '#1f1f1d'] }
]);
const layouts = computed<Array<{ value: PageLayout; label: string; description: string }>>(() => [
  { value: 'classic', label: t('design.classic'), description: t('design.classicDescription') },
  { value: 'minimal', label: t('design.minimal'), description: t('design.minimalDescription') },
  { value: 'soft', label: t('design.soft'), description: t('design.softDescription') },
  { value: 'bold', label: t('design.bold'), description: t('design.boldDescription') }
]);
const patterns: Array<{ value: PageBackgroundPattern; labelKey: string }> = [
  { value: 'none', labelKey: 'pages.patternNone' },
  { value: 'dots', labelKey: 'pages.patternDots' },
  { value: 'grid', labelKey: 'pages.patternGrid' },
  { value: 'soft_glow', labelKey: 'pages.patternSoftGlow' },
  { value: 'crosses', labelKey: 'pages.patternCrosses' }
];
const blockLabels = computed<Record<PageBlockType, string>>(() => ({
  heading: t('blocks.heading'), text: t('blocks.text'), link: t('blocks.link'), existing_link: t('blocks.existingLink'),
  live_activity: t('blocks.liveActivity'), email: t('blocks.email'), divider: t('blocks.divider'),
  spacer: t('blocks.spacer'), image: t('blocks.image'), double: t('blocks.double')
}));
const filteredBlockTypes = computed(() => {
  const query = blockTypeSearch.value.trim().toLocaleLowerCase();
  return (Object.entries(blockLabels.value) as Array<[PageBlockType, string]>).filter(([, label]) =>
    !query || label.toLocaleLowerCase().includes(query)
  );
});
const pickerBlockTypes = computed(() => activeDoubleSlot.value
  ? filteredBlockTypes.value.filter(([type]) => type !== 'double')
  : filteredBlockTypes.value);
const DOUBLE_PLACEHOLDER_PREFIX = 'double-slot-';
const isDoublePlaceholder = (block: PageNestedBlock) => block.id.startsWith(DOUBLE_PLACEHOLDER_PREFIX) && !block.visible;
const createDoublePlaceholder = (): PageNestedBlock => ({
  id: `${DOUBLE_PLACEHOLDER_PREFIX}${crypto.randomUUID()}`,
  type: 'spacer',
  config: { spacing: 'small' },
  visible: false
});
const defaultConfig = (type: PageBlockType) => {
  if (type === 'heading') return { text: t('editor.defaultSectionHeading'), alignment: 'left' as const, size: 'medium' as const };
  if (type === 'text') return { text: t('editor.defaultText'), alignment: 'left' as const };
  if (type === 'link') return { title: t('editor.defaultNewLink'), url: 'https://example.com', subtitle: '', emoji: '↗', openInNewTab: true };
  if (type === 'existing_link') return { title: t('editor.defaultShortLink'), resourceId: links.value[0]?.id ?? '', subtitle: '', emoji: '↗', openInNewTab: false };
  if (type === 'live_activity') return { title: t('editor.defaultJoinLive'), resourceId: activities.value[0]?.id ?? '', subtitle: '', emoji: '◉', openInNewTab: true };
  if (type === 'email') return { label: t('editor.defaultEmail'), email: 'hello@example.com', style: 'button' as const };
  if (type === 'divider') return { style: 'solid' as const, spacing: 'medium' as const };
  if (type === 'spacer') return { spacing: 'medium' as const };
  if (type === 'image') return { url: 'https://example.com/image.jpg', alt: t('editor.defaultImageDescription'), caption: '', alignment: 'center' as const };
  return {
    children: [createDoublePlaceholder(), createDoublePlaceholder()]
  };
};

const serializableForm = computed(() => ({ ...form, blocks: form.blocks.map(({ id, type, config, visible }) => ({ id, type, config, visible })) }));
const currentSnapshot = computed(() => JSON.stringify(serializableForm.value));
const dirty = computed(() => initialized.value && currentSnapshot.value !== savedSnapshot.value);
const editorBlocks = computed(() => form.blocks as EditorBlock[]);
const displayedBlocks = computed(() => {
  if (!dragOrderIds.value) return editorBlocks.value;
  const byId = new Map(editorBlocks.value.map((block) => [block.id, block]));
  return dragOrderIds.value.map((id) => byId.get(id)).filter((block): block is EditorBlock => Boolean(block));
});
const editingOwnerBlock = computed(() => editorBlocks.value.find((block) => block.id === editingBlockId.value) ?? null);
const editingBlock = computed<EditorBlock | PageNestedBlock | null>(() => {
  const owner = editingOwnerBlock.value;
  if (!owner) return null;
  if (!editingNestedBlockId.value) return owner.type === 'double' ? null : owner;
  if (owner.type !== 'double') return null;
  return (owner.config.children ?? []).find((child) => child.id === editingNestedBlockId.value) ?? null;
});
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
  id: pageId.value ?? 'preview', slug: form.slug || 'preview', publicUrl: '#', title: form.title || t('editor.untitledPage'),
  description: form.description || null, emoji: form.emoji || null, avatarUrl: form.avatarUrl || null,
  theme: form.theme, layout: form.layout, backgroundPattern: form.backgroundPattern,
  patternIntensity: form.patternIntensity, status: form.status, seoTitle: form.seoTitle || null, seoDescription: form.seoDescription || null,
  blockCount: form.blocks.length, totalViews: 0, uniqueVisitors: 0, totalLinkClicks: 0,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  blocks: editorBlocks.value.map(hydratePreviewBlock)
}));
const assignPage = (page: PageDetail) => {
  publicUrl.value = page.publicUrl;
  Object.assign(form, {
    title: page.title, slug: page.slug, description: page.description ?? '', emoji: page.emoji ?? '', avatarUrl: page.avatarUrl ?? '',
    theme: page.theme, layout: page.layout, backgroundPattern: page.backgroundPattern ?? 'none',
    patternIntensity: page.patternIntensity ?? 35, status: page.status, seoTitle: page.seoTitle ?? '', seoDescription: page.seoDescription ?? '',
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
    loadError.value = (error as Error).message || t('errors.load');
    pushToast({ tone: 'error', title: t('notices.pageLoadFailed'), description: loadError.value });
  } finally { loading.value = false; }
};
const insertBlock = (type: PageBlockType, index = form.blocks.length, openEditor = false) => {
  const block = { id: crypto.randomUUID(), type, config: defaultConfig(type), visible: true } as EditorBlock;
  form.blocks.splice(index, 0, block);
  tab.value = 'content';
  if (openEditor) openBlockEditor(block.id);
};
const removeBlock = (index: number) => { if (window.confirm(t('editor.deleteConfirm'))) form.blocks.splice(index, 1); };
const moveBlock = (from: number, to: number) => {
  if (to < 0 || to > form.blocks.length || from === to) return;
  const [block] = form.blocks.splice(from, 1); form.blocks.splice(to, 0, block);
};
const blockDetailLines = (block: EditorBlock) => {
  if (block.type === 'double') return [
    (block.config.children ?? []).map((child) => isDoublePlaceholder(child) ? t('editor.emptyContent') : blockLabels.value[child.type]).join(' + ') || t('editor.twoEmptyColumns'),
    t('editor.twoBlocksOneRow')
  ];
  if (block.type === 'heading' || block.type === 'text') return [block.config.text || t('editor.emptyContent')];
  if (block.type === 'link') return [block.config.title || t('pages.untitledLink'), block.config.url || t('editor.noUrl')];
  if (block.type === 'existing_link') {
    const linked = links.value.find((item) => item.id === block.config.resourceId);
    return [block.config.title || t('blocks.existingLink'), linked?.shortUrl || t('editor.noLinkSelected')];
  }
  if (block.type === 'live_activity') {
    const activity = activities.value.find((item) => item.id === block.config.resourceId);
    return [block.config.title || t('blocks.liveActivity'), activity ? `${activity.title} · /${activity.slug}` : t('editor.noLiveSelected')];
  }
  if (block.type === 'email') return [block.config.label || t('blocks.email'), block.config.email || t('editor.noAddress')];
  if (block.type === 'image') return [block.config.alt || t('blocks.image'), block.config.url || t('editor.noImageUrl')];
  return [block.type === 'divider'
    ? t('editor.dividerSummary', { style: t(`options.${block.config.style || 'solid'}`) })
    : t('editor.spacerSummary', { spacing: t(`options.${block.config.spacing || 'medium'}`) })];
};
const blockAccentClass = (type: PageBlockType) => `page-block-accent-${type}`;
const openBlockEditor = (blockId: string) => {
  if (draggingBlockId.value || performance.now() < suppressBlockClickUntil) return;
  const block = editorBlocks.value.find((item) => item.id === blockId);
  if (!block || block.type === 'double') return;
  activeBlockMenuId.value = null;
  editingNestedBlockId.value = null;
  editingBlockId.value = blockId;
};
const openNestedBlockEditor = (parentId: string, childId: string) => {
  if (draggingBlockId.value || performance.now() < suppressBlockClickUntil) return;
  const parent = editorBlocks.value.find((item) => item.id === parentId);
  const child = parent?.type === 'double'
    ? (parent.config.children ?? []).find((item) => item.id === childId)
    : null;
  if (!child || isDoublePlaceholder(child)) return;
  activeBlockMenuId.value = null;
  editingBlockId.value = parentId;
  editingNestedBlockId.value = childId;
};
const closeBlockEditor = () => {
  editingBlockId.value = null;
  editingNestedBlockId.value = null;
};
const ownerBlockForPreviewId = (blockId: string) => editorBlocks.value.find((block) =>
  block.id === blockId || (block.type === 'double' && (block.config.children ?? []).some((child) => child.id === blockId))
) ?? null;
const findBlockElement = (container: HTMLElement | null, attribute: 'pageBlockId' | 'editorBlockId' | 'nestedBlockEditorId', blockId: string) => {
  if (!container) return null;
  return [...container.querySelectorAll<HTMLElement>('[data-page-block-id], [data-editor-block-id], [data-nested-block-editor-id]')]
    .find((element) => element.dataset[attribute] === blockId) ?? null;
};
const scrollElementWithin = (container: HTMLElement | null, element: HTMLElement | null) => {
  if (!container || !element) return;
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const padding = 12;
  if (elementRect.top >= containerRect.top + padding && elementRect.bottom <= containerRect.bottom - padding) return;
  const delta = elementRect.top < containerRect.top + padding
    ? elementRect.top - containerRect.top - padding
    : elementRect.bottom - containerRect.bottom + padding;
  container.scrollTo({ top: container.scrollTop + delta, behavior: 'smooth' });
};
const scrollPreviewToBlock = async (blockId: string) => {
  await nextTick();
  scrollElementWithin(previewPanel.value, findBlockElement(previewPanel.value, 'pageBlockId', blockId));
};
const scrollEditorToBlock = async (blockId: string) => {
  await nextTick();
  scrollElementWithin(blockList.value, findBlockElement(blockList.value, 'editorBlockId', blockId));
};
const enterEditorBlock = (blockId: string) => {
  if (draggingBlockId.value) return;
  activePreviewBlockId.value = blockId;
  void scrollPreviewToBlock(blockId);
};
const leaveEditorBlock = (event: PointerEvent | FocusEvent, blockId: string) => {
  if ((event.currentTarget as HTMLElement | null)?.contains(event.relatedTarget as Node | null)) return;
  if (highlightedEditorBlockId.value === blockId) highlightedEditorBlockId.value = null;
  if (ownerBlockForPreviewId(activePreviewBlockId.value ?? '')?.id === blockId) activePreviewBlockId.value = null;
};
const enterPreviewBlock = (blockId: string) => {
  const owner = ownerBlockForPreviewId(blockId);
  if (!owner) return;
  activePreviewBlockId.value = blockId;
  highlightedEditorBlockId.value = owner.id;
  void scrollEditorToBlock(owner.id);
};
const leavePreviewBlock = (blockId: string) => {
  if (activePreviewBlockId.value !== blockId) return;
  activePreviewBlockId.value = null;
  highlightedEditorBlockId.value = null;
};
const activatePreviewBlock = async (blockId: string) => {
  const owner = ownerBlockForPreviewId(blockId);
  if (!owner) return;
  activePreviewBlockId.value = blockId;
  highlightedEditorBlockId.value = owner.id;
  tab.value = 'content';
  await scrollEditorToBlock(owner.id);
  if (blockId === owner.id) openBlockEditor(owner.id);
  else openNestedBlockEditor(owner.id, blockId);
};
const buildBlockMenuStyle = (anchor: HTMLElement | null) => {
  if (!anchor || typeof window === 'undefined') return {};
  const rect = anchor.getBoundingClientRect();
  const menuWidth = 190;
  const menuHeight = 104;
  const gap = 8;
  const left = Math.min(Math.max(rect.right - menuWidth, gap), Math.max(window.innerWidth - menuWidth - gap, gap));
  const fitsBelow = rect.bottom + gap + menuHeight <= window.innerHeight - gap;
  const top = fitsBelow ? rect.bottom + gap : rect.top - menuHeight - gap;
  return {
    position: 'fixed',
    left: `${left}px`,
    top: `${Math.max(top, gap)}px`,
    width: `${menuWidth}px`,
    maxWidth: `calc(100vw - ${gap * 2}px)`,
    zIndex: '120'
  };
};
const closeBlockMenu = (restoreFocus = false) => {
  activeBlockMenuId.value = null;
  if (restoreFocus) activeBlockMenuAnchor.value?.focus({ preventScroll: true });
};
const toggleBlockMenu = async (event: MouseEvent, blockId: string) => {
  if (activeBlockMenuId.value === blockId) {
    closeBlockMenu();
    return;
  }
  activeBlockMenuAnchor.value = event.currentTarget as HTMLElement;
  activeBlockMenuStyle.value = buildBlockMenuStyle(activeBlockMenuAnchor.value);
  activeBlockMenuId.value = blockId;
  await nextTick();
  document.querySelector<HTMLElement>('[data-block-menu-panel] button')?.focus({ preventScroll: true });
};
const syncBlockMenu = () => {
  if (activeBlockMenuId.value) activeBlockMenuStyle.value = buildBlockMenuStyle(activeBlockMenuAnchor.value);
};
const closeBlockMenuFromOutside = (event: MouseEvent) => {
  if ((event.target as HTMLElement | null)?.closest('[data-block-menu]')) return;
  closeBlockMenu();
};
const toggleBlockVisibility = (block: EditorBlock) => {
  block.visible = !block.visible;
  closeBlockMenu();
};
const removeBlockFromMenu = (index: number) => {
  closeBlockMenu();
  removeBlock(index);
};
const buildAddBlockPopoverStyle = (anchor: HTMLElement | null, popoverHeight = 410) => {
  if (!anchor || typeof window === 'undefined') return {};
  const rect = anchor.getBoundingClientRect();
  const gap = 10;
  const viewport = window.visualViewport;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportWidth = viewport?.width ?? document.documentElement.clientWidth;
  const viewportHeight = viewport?.height ?? document.documentElement.clientHeight;
  const viewportRight = viewportLeft + viewportWidth;
  const viewportBottom = viewportTop + viewportHeight;
  const width = Math.min(360, viewportWidth - gap * 2);
  const centeredLeft = rect.left + rect.width / 2 - width / 2;
  const left = Math.min(Math.max(centeredLeft, viewportLeft + gap), viewportRight - width - gap);
  const availableBelow = Math.max(0, viewportBottom - rect.bottom - gap);
  const availableAbove = Math.max(0, rect.top - viewportTop - gap);
  const requiredHeight = Math.min(popoverHeight, 440);
  const fitsBelow = availableBelow >= requiredHeight;
  const fitsAbove = availableAbove >= requiredHeight;
  const placeBelow = fitsBelow || (!fitsAbove && availableBelow >= availableAbove);
  const availableHeight = placeBelow ? availableBelow : availableAbove;
  const maxHeight = Math.max(0, Math.min(440, availableHeight, viewportHeight - gap * 2));
  const renderedHeight = Math.min(popoverHeight, maxHeight);
  const desiredTop = placeBelow ? rect.bottom + gap : rect.top - renderedHeight - gap;
  const top = Math.min(
    Math.max(desiredTop, viewportTop + gap),
    Math.max(viewportBottom - renderedHeight - gap, viewportTop + gap)
  );
  return {
    position: 'fixed',
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    maxHeight: `${maxHeight}px`,
    transformOrigin: placeBelow ? 'top center' : 'bottom center',
    zIndex: '125'
  };
};
const closeAddBlockPopover = (restoreFocus = false) => {
  activeAddPosition.value = null;
  activeDoubleSlot.value = null;
  blockTypeSearch.value = '';
  if (restoreFocus) addBlockAnchor.value?.focus({ preventScroll: true });
};
const openAddBlockPopover = async (event: MouseEvent, position: number) => {
  if (activeAddPosition.value === position && addBlockAnchor.value === event.currentTarget) {
    closeAddBlockPopover(true);
    return;
  }
  closeBlockMenu();
  activeDoubleSlot.value = null;
  addBlockAnchor.value = event.currentTarget as HTMLElement;
  blockTypeSearch.value = '';
  activeAddPosition.value = position;
  addBlockPopoverStyle.value = buildAddBlockPopoverStyle(addBlockAnchor.value);
  await nextTick();
  const height = addBlockPopover.value?.scrollHeight ?? 410;
  addBlockPopoverStyle.value = buildAddBlockPopoverStyle(addBlockAnchor.value, height);
  addBlockPopover.value?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
};
const openDoubleSlotPopover = async (event: MouseEvent, parentId: string, childId: string) => {
  const sameTarget = activeDoubleSlot.value?.parentId === parentId
    && activeDoubleSlot.value.childId === childId
    && addBlockAnchor.value === event.currentTarget;
  if (sameTarget) {
    closeAddBlockPopover(true);
    return;
  }
  closeBlockMenu();
  activeAddPosition.value = null;
  activeDoubleSlot.value = { parentId, childId };
  addBlockAnchor.value = event.currentTarget as HTMLElement;
  blockTypeSearch.value = '';
  addBlockPopoverStyle.value = buildAddBlockPopoverStyle(addBlockAnchor.value);
  await nextTick();
  const height = addBlockPopover.value?.scrollHeight ?? 410;
  addBlockPopoverStyle.value = buildAddBlockPopoverStyle(addBlockAnchor.value, height);
  addBlockPopover.value?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
};
const addBlockAtPosition = (type: PageBlockType) => {
  if (activeDoubleSlot.value) {
    if (type === 'double') return;
    const target = activeDoubleSlot.value;
    const parent = editorBlocks.value.find((block) => block.id === target.parentId);
    const child = parent?.type === 'double'
      ? (parent.config.children ?? []).find((item) => item.id === target.childId)
      : null;
    closeAddBlockPopover();
    if (!parent || !child) return;
    child.id = crypto.randomUUID();
    child.type = type as PageNestedBlockType;
    child.config = defaultConfig(type);
    child.visible = true;
    openNestedBlockEditor(parent.id, child.id);
    return;
  }
  if (activeAddPosition.value === null) return;
  const position = activeAddPosition.value;
  closeAddBlockPopover();
  insertBlock(type, position, type !== 'double');
};
const syncAddBlockPopover = () => {
  if (activeAddPosition.value === null && !activeDoubleSlot.value) return;
  addBlockPopoverStyle.value = buildAddBlockPopoverStyle(
    addBlockAnchor.value,
    addBlockPopover.value?.scrollHeight ?? 410
  );
};
const closeAddBlockPopoverFromOutside = (event: MouseEvent) => {
  if ((event.target as HTMLElement | null)?.closest('[data-add-block-popover]')) return;
  closeAddBlockPopover();
};
type BlockDragSession = {
  pointerId: number;
  blockId: string;
  ghost: HTMLElement;
  handle: HTMLElement;
  offsetX: number;
  offsetY: number;
  width: number;
  lastClientY: number;
  bodyCursor: string;
  bodyUserSelect: string;
};
let blockDragSession: BlockDragSession | null = null;
let blockAutoScrollFrame: number | null = null;
let suppressBlockClickUntil = 0;

const captureBlockRects = () => {
  const rects = new Map<string, DOMRect>();
  blockList.value?.querySelectorAll<HTMLElement>('[data-editor-block-id]').forEach((element) => {
    const id = element.dataset.editorBlockId;
    if (id) rects.set(id, element.getBoundingClientRect());
  });
  return rects;
};
const animateBlockPositions = async (before: Map<string, DOMRect>) => {
  await nextTick();
  blockList.value?.querySelectorAll<HTMLElement>('[data-editor-block-id]').forEach((element) => {
    const id = element.dataset.editorBlockId;
    const previous = id ? before.get(id) : undefined;
    if (!previous || id === draggingBlockId.value) return;
    const current = element.getBoundingClientRect();
    const deltaY = previous.top - current.top;
    if (Math.abs(deltaY) < 1) return;
    element.getAnimations().forEach((animation) => animation.cancel());
    element.animate(
      [{ transform: `translateY(${deltaY}px)` }, { transform: 'translateY(0)' }],
      { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' }
    );
  });
};
const setDraggedBlockPosition = (targetIndex: number) => {
  const order = dragOrderIds.value;
  const session = blockDragSession;
  if (!order || !session) return;
  const currentIndex = order.indexOf(session.blockId);
  const nextIndex = Math.max(0, Math.min(targetIndex, order.length - 1));
  if (currentIndex === -1 || currentIndex === nextIndex) return;
  const before = captureBlockRects();
  const nextOrder = [...order];
  nextOrder.splice(currentIndex, 1);
  nextOrder.splice(nextIndex, 0, session.blockId);
  dragOrderIds.value = nextOrder;
  void animateBlockPositions(before);
};
const updateDraggedBlockPosition = (clientY: number) => {
  const session = blockDragSession;
  if (!session || !blockList.value) return;
  const otherCards = [...blockList.value.querySelectorAll<HTMLElement>('[data-editor-block-id]')]
    .filter((element) => element.dataset.editorBlockId !== session.blockId);
  let targetIndex = otherCards.length;
  for (let index = 0; index < otherCards.length; index += 1) {
    const rect = otherCards[index].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      targetIndex = index;
      break;
    }
  }
  setDraggedBlockPosition(targetIndex);
};
const positionBlockGhost = (clientX: number, clientY: number) => {
  const session = blockDragSession;
  if (!session) return;
  const gap = 8;
  const left = Math.min(
    Math.max(clientX - session.offsetX, gap),
    Math.max(window.innerWidth - session.width - gap, gap)
  );
  session.ghost.style.left = `${left}px`;
  session.ghost.style.top = `${clientY - session.offsetY}px`;
};
const runBlockAutoScroll = () => {
  const session = blockDragSession;
  const container = blockList.value;
  if (!session || !container) return;
  const rect = container.getBoundingClientRect();
  const edge = Math.min(64, rect.height / 4);
  let speed = 0;
  if (session.lastClientY < rect.top + edge) {
    speed = -Math.ceil(((rect.top + edge - session.lastClientY) / edge) * 14);
  } else if (session.lastClientY > rect.bottom - edge) {
    speed = Math.ceil(((session.lastClientY - (rect.bottom - edge)) / edge) * 14);
  }
  if (speed && container.scrollHeight > container.clientHeight) {
    const previousScrollTop = container.scrollTop;
    container.scrollTop += speed;
    if (container.scrollTop !== previousScrollTop) updateDraggedBlockPosition(session.lastClientY);
  }
  blockAutoScrollFrame = window.requestAnimationFrame(runBlockAutoScroll);
};
const onBlockDragMove = (event: PointerEvent) => {
  const session = blockDragSession;
  if (!session || event.pointerId !== session.pointerId) return;
  event.preventDefault();
  session.lastClientY = event.clientY;
  positionBlockGhost(event.clientX, event.clientY);
  updateDraggedBlockPosition(event.clientY);
};
const finishBlockDrag = (commit: boolean) => {
  const session = blockDragSession;
  if (!session) return;
  const before = captureBlockRects();
  const targetIndex = dragOrderIds.value?.indexOf(session.blockId) ?? -1;
  const sourceIndex = form.blocks.findIndex((block) => block.id === session.blockId);
  if (commit && sourceIndex !== -1 && targetIndex !== -1) moveBlock(sourceIndex, targetIndex);
  dragOrderIds.value = null;
  draggingBlockId.value = null;
  suppressBlockClickUntil = performance.now() + 250;
  session.ghost.remove();
  if (session.handle.hasPointerCapture?.(session.pointerId)) session.handle.releasePointerCapture(session.pointerId);
  document.body.style.cursor = session.bodyCursor;
  document.body.style.userSelect = session.bodyUserSelect;
  document.removeEventListener('pointermove', onBlockDragMove);
  document.removeEventListener('pointerup', onBlockDragEnd);
  document.removeEventListener('pointercancel', onBlockDragCancel);
  document.removeEventListener('keydown', onBlockDragKeydown);
  if (blockAutoScrollFrame !== null) window.cancelAnimationFrame(blockAutoScrollFrame);
  blockAutoScrollFrame = null;
  blockDragSession = null;
  void animateBlockPositions(before);
  void nextTick(() => {
    blockList.value?.querySelector<HTMLElement>(`[data-drag-handle-for="${session.blockId}"]`)?.focus();
  });
};
function onBlockDragEnd(event: PointerEvent) {
  if (blockDragSession && event.pointerId === blockDragSession.pointerId) finishBlockDrag(true);
}
function onBlockDragCancel(event: PointerEvent) {
  if (blockDragSession && event.pointerId === blockDragSession.pointerId) finishBlockDrag(false);
}
function onBlockDragKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !blockDragSession) return;
  event.preventDefault();
  finishBlockDrag(false);
}
const startBlockDrag = (event: PointerEvent, blockId: string) => {
  if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0) || blockDragSession) return;
  const handle = event.currentTarget as HTMLElement;
  const card = handle.closest<HTMLElement>('[data-editor-block-id]');
  if (!card) return;
  event.preventDefault();
  event.stopPropagation();
  closeBlockMenu();
  closeAddBlockPopover();
  activePreviewBlockId.value = null;
  highlightedEditorBlockId.value = null;
  const rect = card.getBoundingClientRect();
  const ghost = card.cloneNode(true) as HTMLElement;
  ghost.classList.remove('block-drag-placeholder', 'block-editor-card-hidden');
  ghost.classList.add('block-drag-ghost');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]').forEach((element) => {
    element.tabIndex = -1;
  });
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  document.body.appendChild(ghost);
  blockDragSession = {
    pointerId: event.pointerId,
    blockId,
    ghost,
    handle,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    width: rect.width,
    lastClientY: event.clientY,
    bodyCursor: document.body.style.cursor,
    bodyUserSelect: document.body.style.userSelect
  };
  draggingBlockId.value = blockId;
  dragOrderIds.value = editorBlocks.value.map((block) => block.id);
  document.body.style.cursor = 'grabbing';
  document.body.style.userSelect = 'none';
  handle.setPointerCapture?.(event.pointerId);
  positionBlockGhost(event.clientX, event.clientY);
  document.addEventListener('pointermove', onBlockDragMove, { passive: false });
  document.addEventListener('pointerup', onBlockDragEnd);
  document.addEventListener('pointercancel', onBlockDragCancel);
  document.addEventListener('keydown', onBlockDragKeydown);
  blockAutoScrollFrame = window.requestAnimationFrame(runBlockAutoScroll);
};
const reorderBlockWithKeyboard = (event: KeyboardEvent, blockId: string) => {
  const currentIndex = form.blocks.findIndex((block) => block.id === blockId);
  if (currentIndex === -1) return;
  let targetIndex = currentIndex;
  if (event.key === 'ArrowUp') targetIndex = Math.max(0, currentIndex - 1);
  else if (event.key === 'ArrowDown') targetIndex = Math.min(form.blocks.length - 1, currentIndex + 1);
  else if (event.key === 'Home') targetIndex = 0;
  else if (event.key === 'End') targetIndex = form.blocks.length - 1;
  else return;
  event.preventDefault();
  event.stopPropagation();
  if (targetIndex === currentIndex) return;
  const before = captureBlockRects();
  const block = form.blocks[currentIndex] as EditorBlock;
  moveBlock(currentIndex, targetIndex);
  reorderAnnouncement.value = t('blockReorder.moved', {
    type: blockLabels.value[block.type],
    position: targetIndex + 1,
    total: form.blocks.length
  });
  void animateBlockPositions(before);
  void nextTick(() => {
    blockList.value?.querySelector<HTMLElement>(`[data-drag-handle-for="${blockId}"]`)?.focus();
  });
};
const save = async () => {
  saving.value = true;
  try {
    const payload = JSON.stringify(serializableForm.value);
    const page = pageId.value
      ? await api<PageDetail>(`/api/pages/${pageId.value}`, { method: 'PATCH', body: payload })
      : await api<PageDetail>('/api/pages', { method: 'POST', body: payload });
    assignPage(page);
    savedSnapshot.value = currentSnapshot.value;
    pushToast({ tone: 'success', title: t(pageId.value ? 'notices.pageSaved' : 'notices.pageCreated'), description: page.publicUrl });
    if (!pageId.value) await router.replace(`/app/pages/${page.id}`);
  } catch (error) {
    pushToast({ tone: 'error', title: t('notices.pageSaveFailed'), description: (error as Error).message });
  } finally { saving.value = false; }
};
const syncWorkspacePanelHeight = () => {
  const workspace = editorWorkspace.value;
  if (!workspace || !window.matchMedia('(min-width: 1024px)').matches) {
    workspacePanelHeight.value = undefined;
    return;
  }
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const documentTop = workspace.getBoundingClientRect().top + window.scrollY;
  const sidebarBottom = viewportHeight - 16;
  const available = sidebarBottom - documentTop;
  workspacePanelHeight.value = `${Math.floor(Math.max(320, Math.min(viewportHeight - 32, available)))}px`;
};
const closeBlockEditorOnEscape = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || !editingBlock.value || blockDragSession) return;
  event.preventDefault();
  closeBlockEditor();
};
const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty.value) { event.preventDefault(); event.returnValue = ''; } };
onBeforeRouteLeave(() => !dirty.value || window.confirm(t('editor.leaveConfirm')));
onMounted(() => {
  window.addEventListener('beforeunload', beforeUnload);
  window.addEventListener('resize', syncBlockMenu);
  window.addEventListener('scroll', syncBlockMenu, true);
  document.addEventListener('click', closeBlockMenuFromOutside);
  window.addEventListener('resize', syncAddBlockPopover);
  window.addEventListener('scroll', syncAddBlockPopover, true);
  window.addEventListener('resize', syncWorkspacePanelHeight);
  window.visualViewport?.addEventListener('resize', syncAddBlockPopover);
  window.visualViewport?.addEventListener('scroll', syncAddBlockPopover);
  window.visualViewport?.addEventListener('resize', syncWorkspacePanelHeight);
  document.addEventListener('click', closeAddBlockPopoverFromOutside);
  document.addEventListener('keydown', closeBlockEditorOnEscape);
  void load();
});
onBeforeUnmount(() => {
  if (blockDragSession) finishBlockDrag(false);
  window.removeEventListener('beforeunload', beforeUnload);
  window.removeEventListener('resize', syncBlockMenu);
  window.removeEventListener('scroll', syncBlockMenu, true);
  document.removeEventListener('click', closeBlockMenuFromOutside);
  window.removeEventListener('resize', syncAddBlockPopover);
  window.removeEventListener('scroll', syncAddBlockPopover, true);
  window.removeEventListener('resize', syncWorkspacePanelHeight);
  window.visualViewport?.removeEventListener('resize', syncAddBlockPopover);
  window.visualViewport?.removeEventListener('scroll', syncAddBlockPopover);
  window.visualViewport?.removeEventListener('resize', syncWorkspacePanelHeight);
  document.removeEventListener('click', closeAddBlockPopoverFromOutside);
  document.removeEventListener('keydown', closeBlockEditorOnEscape);
});
watch(() => route.params.id, () => { if (route.name) void load(); });
watch(loading, () => void nextTick(syncWorkspacePanelHeight), { flush: 'post' });
watch(blockTypeSearch, () => void nextTick(syncAddBlockPopover), { flush: 'post' });
</script>

<template>
  <div v-if="loading" class="panel py-20 text-center text-[var(--ui-text-muted)]">{{ t('editor.loading') }}</div>
  <div v-else-if="loadError" class="panel px-6 py-16 text-center">
    <h2 class="text-xl font-semibold">{{ t('editor.unavailable') }}</h2>
    <p class="mx-auto mt-2 max-w-md text-sm text-[var(--ui-text-muted)]">{{ loadError }}</p>
    <button class="btn-primary mt-5" @click="router.push('/app/pages')">{{ t('editor.backToPages') }}</button>
  </div>
  <div v-else class="space-y-4 [overflow-anchor:none]">
    <section class="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div class="min-w-0">
        <div class="flex items-center gap-2"><h2 class="truncate text-xl font-semibold">{{ t(pageId ? 'editor.editPage' : 'editor.createPage') }}</h2><span v-if="dirty" class="rounded-full bg-[var(--ui-pill-bg)] px-2.5 py-1 text-xs text-[var(--ui-text-muted)]">{{ t('editor.unsaved') }}</span></div>
        <a v-if="publicUrl" :href="publicUrl" target="_blank" rel="noopener noreferrer" class="mt-1 block truncate text-sm text-[var(--ui-accent)] hover:underline">{{ displayUrl(publicUrl) }}</a>
        <p v-else class="mt-1 truncate text-sm text-[var(--ui-text-muted)]">{{ form.slug ? t('editor.pageWillUse', { slug: form.slug }) : t('editor.randomSlugGenerated') }}</p>
      </div>
      <div class="flex gap-2"><button class="btn-secondary" @click="router.push('/app/pages')">{{ t('editor.back') }}</button><button class="btn-primary" :disabled="saving || !dirty" @click="save">{{ saving ? t('common.saving') : t('editor.saveChanges') }}</button></div>
    </section>

    <div class="flex gap-2 lg:hidden">
      <button class="btn-secondary flex-1" :class="mobileMode === 'edit' ? 'ring-2 ring-[var(--ui-accent)]' : ''" @click="mobileMode = 'edit'">{{ t('common.edit') }}</button>
      <button class="btn-secondary flex-1" :class="mobileMode === 'preview' ? 'ring-2 ring-[var(--ui-accent)]' : ''" @click="mobileMode = 'preview'">{{ t('editor.preview') }}</button>
    </div>

    <div ref="editorWorkspace" class="grid min-w-0 gap-4 lg:grid-cols-[minmax(440px,1.05fr)_minmax(380px,.95fr)]">
      <section
        class="panel min-w-0 flex-col p-4 sm:p-6 lg:sticky lg:top-4"
        :class="[mobileMode === 'edit' ? 'flex' : 'hidden lg:flex', tab === 'content' ? 'lg:overflow-hidden' : 'lg:overflow-y-auto']"
        :style="{ height: workspacePanelHeight }"
      >
        <div class="mb-6 grid grid-cols-4 gap-2" role="tablist" :aria-label="t('editor.sections')">
          <button v-for="item in ['general','content','design','seo'] as const" :key="item" class="rounded-xl px-2 py-2.5 text-sm font-medium" :class="tab === item ? 'bg-[var(--ui-accent)] text-[var(--ui-accent-contrast)]' : 'bg-[var(--ui-panel-muted)]'" @click="tab = item">{{ t(`pages.${item}`) }}</button>
        </div>

        <div v-if="tab === 'general'" class="grid gap-4 sm:grid-cols-2">
          <label class="sm:col-span-2"><span class="mb-2 block text-sm font-medium">{{ t('common.title') }}</span><input v-model="form.title" class="input px-4 py-3" maxlength="120" /></label>
          <label><span class="mb-2 block text-sm font-medium">{{ t('editor.customSlug') }} <span class="font-normal text-[var(--ui-text-muted)]">({{ t('editor.optional') }})</span></span><input v-model="form.slug" class="input px-4 py-3" maxlength="64" :placeholder="t('editor.randomSlug')" /></label>
          <label><span class="mb-2 block text-sm font-medium">{{ t('editor.status') }}</span><select v-model="form.status" class="input px-4 py-3"><option value="draft">{{ t('common.draft') }}</option><option value="published">{{ t('common.published') }}</option><option value="disabled">{{ t('common.disabled') }}</option></select></label>
          <label class="sm:col-span-2"><span class="mb-2 block text-sm font-medium">{{ t('editor.description') }}</span><textarea v-model="form.description" class="input min-h-28 px-4 py-3" maxlength="1000" /></label>
          <label><span class="mb-2 block text-sm font-medium">{{ t('editor.emoji') }}</span><input v-model="form.emoji" class="input px-4 py-3" maxlength="16" /></label>
          <label><span class="mb-2 block text-sm font-medium">{{ t('editor.avatarUrl') }}</span><input v-model="form.avatarUrl" class="input px-4 py-3" type="url" placeholder="https://…" /></label>
        </div>

        <div v-else-if="tab === 'content'" class="flex min-h-0 flex-1 flex-col gap-5">
          <div><h3 class="text-lg font-semibold">{{ t('editor.pageBlocks') }}</h3><p class="mt-1 text-sm text-[var(--ui-text-muted)]">{{ t('editor.pageBlocksDescription') }}</p></div>

          <div ref="blockList" class="app-scrollbar min-h-0 p-1 lg:flex-1 lg:overflow-y-auto" :class="draggingBlockId ? 'block-list-dragging' : ''">
            <div v-if="!form.blocks.length" class="panel-muted flex min-h-36 items-center justify-center px-5 py-8">
              <button class="btn-secondary add-block-button" data-add-block-popover aria-haspopup="dialog" aria-controls="page-block-picker" :aria-expanded="activeAddPosition === 0" @click.stop="openAddBlockPopover($event, 0)">
                <span aria-hidden="true">+</span><span>{{ t('blockAdd.addFirstBlock') }}</span>
              </button>
            </div>
            <template v-for="(block, index) in displayedBlocks" :key="block.id">
            <article
              class="block-editor-card group flex min-w-0 flex-wrap items-center gap-2.5 rounded-2xl border px-2.5 py-2 transition"
              :class="[blockAccentClass(block.type), block.type === 'double' ? 'cursor-default' : 'cursor-pointer', block.visible ? '' : 'block-editor-card-hidden', draggingBlockId === block.id ? 'block-drag-placeholder' : '', highlightedEditorBlockId === block.id ? 'block-editor-card-linked' : '']"
              :data-editor-block-id="block.id"
              @click="openBlockEditor(block.id)"
              @pointerenter="enterEditorBlock(block.id)"
              @pointerleave="leaveEditorBlock($event, block.id)"
              @focusin="enterEditorBlock(block.id)"
              @focusout="leaveEditorBlock($event, block.id)"
            >
              <button
                class="drag-handle flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-[var(--ui-text-muted)] hover:bg-[var(--ui-panel-muted)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ui-accent)] active:cursor-grabbing"
                type="button"
                :data-drag-handle-for="block.id"
                :title="t('blockReorder.handle')"
                :aria-label="t('blockReorder.handle')"
                @click.stop.prevent
                @pointerdown="startBlockDrag($event, block.id)"
                @keydown="reorderBlockWithKeyboard($event, block.id)"
              ><span aria-hidden="true">⠿</span></button>
              <button class="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none disabled:cursor-default" :disabled="block.type === 'double'" :aria-label="block.type === 'double' ? blockLabels[block.type] : t('editor.editType', { type: blockLabels[block.type] })" @click.stop="openBlockEditor(block.id)">
                <span class="block-editor-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border"><PageBlockIcon :type="block.type" /></span>
                <span class="min-w-0 flex-1">
                  <span class="flex min-w-0 items-center gap-2"><span class="truncate text-sm font-semibold">{{ blockLabels[block.type] }}</span><span v-if="!block.visible" class="shrink-0 rounded-full bg-[var(--ui-pill-bg)] px-2 py-0.5 text-[10px] font-medium">{{ t('editor.hidden') }}</span></span>
                  <span class="mt-0.5 block truncate text-xs text-[var(--ui-text-muted)]">{{ blockDetailLines(block).join(' · ') }}</span>
                </span>
              </button>
              <div class="flex shrink-0 items-center gap-1">
                <button v-if="block.type !== 'double'" class="icon-button !h-8 !w-8" :aria-label="t('editor.editBlock')" :title="t('editor.editBlock')" @click.stop="openBlockEditor(block.id)">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m16.475 5.408l2.117 2.117m-.756-3.982L12.109 9.27a2.1 2.1 0 0 0-.58 1.082L11 13l2.648-.53c.41-.082.786-.283 1.082-.579l5.727-5.727a1.853 1.853 0 1 0-2.621-2.621"/><path d="M19 15v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3"/></g></svg>
                </button>
                <div data-block-menu>
                  <button class="icon-button !h-8 !w-8" :aria-label="t('common.actions')" :title="t('common.actions')" aria-haspopup="menu" :aria-expanded="activeBlockMenuId === block.id" @click.stop="toggleBlockMenu($event, block.id)">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
                  </button>
                  <Teleport to="body">
                    <Transition enter-active-class="transition duration-150 ease-out" enter-from-class="scale-95 opacity-0" enter-to-class="scale-100 opacity-100" leave-active-class="transition duration-100 ease-in" leave-from-class="scale-100 opacity-100" leave-to-class="scale-95 opacity-0">
                      <div v-if="activeBlockMenuId === block.id" data-block-menu data-block-menu-panel role="menu" class="origin-top-right rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-dropdown-bg)] p-2 ring-1 ring-black/5 backdrop-blur-xl dark:ring-white/5" :style="activeBlockMenuStyle" @click.stop @keydown.esc.stop="closeBlockMenu(true)">
                        <button role="menuitem" class="block-menu-action" @click="toggleBlockVisibility(block)">{{ block.visible ? t('editor.hideBlock') : t('editor.showBlock') }}</button>
                        <button role="menuitem" class="block-menu-action block-menu-action-danger" @click="removeBlockFromMenu(index)">{{ t('editor.deleteBlock') }}</button>
                      </div>
                    </Transition>
                  </Teleport>
                </div>
              </div>
              <div v-if="block.type === 'double'" class="double-slot-grid grid w-full basis-full grid-cols-2 gap-2 sm:pl-8">
                <button
                  v-for="child in block.config.children"
                  :key="child.id"
                  type="button"
                  class="double-slot-button flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-xl border px-2 py-2 text-xs font-medium transition-colors"
                  :class="isDoublePlaceholder(child) ? 'double-slot-button-empty' : blockAccentClass(child.type)"
                  :aria-expanded="isDoublePlaceholder(child) && activeDoubleSlot?.childId === child.id"
                  :aria-label="isDoublePlaceholder(child) ? t('blockAdd.chooseBlockType') : t('editor.editType', { type: blockLabels[child.type] })"
                  @click.stop="isDoublePlaceholder(child) ? openDoubleSlotPopover($event, block.id, child.id) : openNestedBlockEditor(block.id, child.id)"
                >
                  <template v-if="isDoublePlaceholder(child)"><span class="text-lg leading-none" aria-hidden="true">+</span><span>{{ t('blockAdd.addBlock') }}</span></template>
                  <template v-else><PageBlockIcon :type="child.type" /><span class="truncate">{{ blockLabels[child.type] }}</span></template>
                </button>
              </div>
            </article>
              <div v-if="index < displayedBlocks.length - 1" class="block-insert-row">
                <span class="block-insert-line" aria-hidden="true" />
                <button class="block-insert-button" data-add-block-popover :class="activeAddPosition === index + 1 ? 'block-insert-button-active' : ''" :aria-label="t('blockAdd.addBlock')" aria-haspopup="dialog" aria-controls="page-block-picker" :aria-expanded="activeAddPosition === index + 1" @click.stop="openAddBlockPopover($event, index + 1)">+</button>
                <span class="block-insert-line" aria-hidden="true" />
              </div>
            </template>
            <div v-if="form.blocks.length" class="mt-2 flex justify-center">
              <button class="btn-secondary add-block-button" data-add-block-popover aria-haspopup="dialog" aria-controls="page-block-picker" :aria-expanded="activeAddPosition === form.blocks.length" @click.stop="openAddBlockPopover($event, form.blocks.length)">
                <span aria-hidden="true">+</span><span>{{ t('blockAdd.addBlock') }}</span>
              </button>
            </div>
            <p class="sr-only" aria-live="polite" aria-atomic="true">{{ reorderAnnouncement }}</p>
          </div>

          <Teleport to="body">
            <Transition enter-active-class="transition duration-150 ease-out" enter-from-class="scale-95 opacity-0" enter-to-class="scale-100 opacity-100" leave-active-class="transition duration-100 ease-in" leave-from-class="scale-100 opacity-100" leave-to-class="scale-95 opacity-0">
              <section
                v-if="activeAddPosition !== null || activeDoubleSlot"
                id="page-block-picker"
                ref="addBlockPopover"
                data-add-block-popover
                class="app-scrollbar origin-top overflow-y-auto rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-dropdown-bg)] p-3 ring-1 ring-black/5 backdrop-blur-xl dark:ring-white/5"
                :style="addBlockPopoverStyle"
                role="dialog"
                :aria-label="t('blockAdd.chooseBlockType')"
                @click.stop
                @keydown.esc.stop="closeAddBlockPopover(true)"
              >
                <label class="sr-only" for="page-block-type-search">{{ t('blockAdd.searchBlockTypes') }}</label>
                <input id="page-block-type-search" v-model="blockTypeSearch" class="input px-3 py-2 text-sm" type="search" :placeholder="t('blockAdd.searchBlockTypes')" autocomplete="off" />
                <div v-if="pickerBlockTypes.length" class="mt-3 grid grid-cols-2 gap-2">
                  <button
                    v-for="([type, label]) in pickerBlockTypes"
                    :key="type"
                    class="block-palette-button flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition hover:-translate-y-0.5"
                    :class="blockAccentClass(type)"
                    @click="addBlockAtPosition(type)"
                  ><PageBlockIcon :type="type" /><span class="truncate">{{ label }}</span></button>
                </div>
                <p v-else class="px-3 py-8 text-center text-sm text-[var(--ui-text-muted)]">{{ t('blockAdd.noMatchingBlockTypes') }}</p>
              </section>
            </Transition>
          </Teleport>
        </div>

        <div v-else-if="tab === 'design'" class="space-y-7">
          <div><h3 class="font-semibold">{{ t('pages.theme') }}</h3><div class="mt-3 grid gap-3 sm:grid-cols-2"><button v-for="theme in themes" :key="theme.value" type="button" class="rounded-2xl border p-4 text-left" :class="form.theme === theme.value ? 'border-[var(--ui-accent)] ring-2 ring-[var(--ui-accent)]/20' : 'border-[var(--ui-border)]'" @click="form.theme = theme.value"><span class="flex gap-1"><span v-for="color in theme.colors" :key="color" class="h-7 flex-1 rounded-lg" :style="{ background: color }" /></span><span class="mt-3 block text-sm font-semibold">{{ theme.label }}</span></button></div></div>
          <div><h3 class="font-semibold">{{ t('pages.layout') }}</h3><div class="mt-3 grid gap-3 sm:grid-cols-2"><button v-for="layout in layouts" :key="layout.value" type="button" class="rounded-2xl border p-4 text-left" :class="form.layout === layout.value ? 'border-[var(--ui-accent)] ring-2 ring-[var(--ui-accent)]/20' : 'border-[var(--ui-border)]'" @click="form.layout = layout.value"><span class="font-semibold">{{ layout.label }}</span><span class="mt-1 block text-xs text-[var(--ui-text-muted)]">{{ layout.description }}</span></button></div></div>
          <div>
            <h3 class="font-semibold">{{ t('pages.backgroundPattern') }}</h3>
            <p class="mt-1 text-xs text-[var(--ui-text-muted)]">{{ t('pages.backgroundPatternDescription') }}</p>
            <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <button v-for="pattern in patterns" :key="pattern.value" type="button" class="rounded-2xl border p-3 text-left" :class="form.backgroundPattern === pattern.value ? 'border-[var(--ui-accent)] ring-2 ring-[var(--ui-accent)]/20' : 'border-[var(--ui-border)]'" @click="form.backgroundPattern = pattern.value">
                <span class="pattern-swatch block h-14 overflow-hidden rounded-xl bg-[var(--ui-panel-muted)]" :class="`pattern-swatch-${pattern.value}`" />
                <span class="mt-2 block text-sm font-semibold">{{ t(pattern.labelKey) }}</span>
              </button>
            </div>
            <label class="mt-5 block">
              <span class="flex items-center justify-between text-sm font-medium"><span>{{ t('pages.patternIntensity') }}</span><span>{{ form.patternIntensity }}%</span></span>
              <input v-model.number="form.patternIntensity" class="mt-3 w-full accent-[var(--ui-accent)]" type="range" min="0" max="100" step="5" :disabled="form.backgroundPattern === 'none'" />
            </label>
          </div>
        </div>

        <div v-else class="grid gap-4">
          <p class="text-sm text-[var(--ui-text-muted)]">{{ t('editor.sharingDescription') }}</p>
          <label><span class="mb-2 block text-sm font-medium">{{ t('editor.seoTitle') }}</span><input v-model="form.seoTitle" class="input px-4 py-3" maxlength="120" /></label>
          <label><span class="mb-2 block text-sm font-medium">{{ t('editor.seoDescription') }}</span><textarea v-model="form.seoDescription" class="input min-h-28 px-4 py-3" maxlength="300" /></label>
        </div>
      </section>

      <aside
        class="panel min-w-0 flex-col overflow-hidden p-3 sm:p-5 lg:sticky lg:top-4"
        :class="mobileMode === 'preview' ? 'flex' : 'hidden lg:flex'"
        :style="{ height: workspacePanelHeight }"
      >
        <div class="mb-3 flex items-center justify-between gap-3"><p class="text-sm font-semibold">{{ t('pages.livePreview') }}</p><div class="flex gap-1"><button class="rounded-lg px-3 py-1.5 text-xs" :class="previewWidth === 'mobile' ? 'bg-[var(--ui-accent)] text-[var(--ui-accent-contrast)]' : 'bg-[var(--ui-panel-muted)]'" @click="previewWidth = 'mobile'">{{ t('pages.mobile') }}</button><button class="rounded-lg px-3 py-1.5 text-xs" :class="previewWidth === 'desktop' ? 'bg-[var(--ui-accent)] text-[var(--ui-accent-contrast)]' : 'bg-[var(--ui-panel-muted)]'" @click="previewWidth = 'desktop'">{{ t('pages.desktop') }}</button></div></div>
        <div
          ref="previewPanel"
          class="app-scrollbar mx-auto h-[calc(100dvh-8rem)] min-h-[390px] w-full overflow-y-auto overflow-x-hidden rounded-[1.75rem] border border-[var(--ui-border)] bg-[var(--ui-panel-muted)] shadow-inner transition-[max-width] duration-300 lg:h-auto lg:min-h-0 lg:flex-1"
          :class="previewWidth === 'mobile' ? 'max-w-[390px]' : 'max-w-full'"
        >
          <PageRenderer
            :page="previewPage"
            preview
            editor-interactive
            :active-block-id="activePreviewBlockId"
            @preview-block-enter="enterPreviewBlock"
            @preview-block-leave="leavePreviewBlock"
            @preview-block-activate="activatePreviewBlock"
          />
        </div>
      </aside>
    </div>

    <Teleport to="body">
      <div v-if="editingBlock" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" :aria-label="t('editor.editType', { type: blockLabels[editingBlock.type] })">
        <section class="panel app-scrollbar max-h-[90dvh] w-full max-w-2xl overflow-y-auto p-5 shadow-2xl sm:p-6">
          <div class="flex items-center gap-3 border-b border-[var(--ui-border)] pb-4">
            <span class="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ui-border)] bg-[var(--ui-panel-muted)] text-[var(--ui-accent)]"><PageBlockIcon :type="editingBlock.type" /></span>
            <div><h3 class="text-lg font-semibold">{{ t('editor.editType', { type: blockLabels[editingBlock.type] }) }}</h3><p class="text-xs text-[var(--ui-text-muted)]">{{ t('editor.liveChanges') }}</p></div>
            <button class="btn-secondary ml-auto" @click="closeBlockEditor">{{ t('common.close') }}</button>
          </div>

          <div class="mt-5 grid gap-4 sm:grid-cols-2">
            <template v-if="editingBlock.type === 'heading'">
              <label class="sm:col-span-2"><span class="field-label">{{ t('editor.text') }}</span><input v-model="editingBlock.config.text" class="input px-3 py-2" maxlength="160" /></label>
              <label><span class="field-label">{{ t('editor.alignment') }}</span><select v-model="editingBlock.config.alignment" class="input px-3 py-2"><option value="left">{{ t('options.left') }}</option><option value="center">{{ t('options.center') }}</option><option value="right">{{ t('options.right') }}</option></select></label>
              <label><span class="field-label">{{ t('editor.size') }}</span><select v-model="editingBlock.config.size" class="input px-3 py-2"><option value="small">{{ t('options.small') }}</option><option value="medium">{{ t('options.medium') }}</option><option value="large">{{ t('options.large') }}</option></select></label>
            </template>
            <template v-else-if="editingBlock.type === 'text'">
              <label class="sm:col-span-2"><span class="field-label">{{ t('editor.text') }}</span><textarea v-model="editingBlock.config.text" class="input min-h-36 px-3 py-2" maxlength="4000" /></label>
              <label><span class="field-label">{{ t('editor.alignment') }}</span><select v-model="editingBlock.config.alignment" class="input px-3 py-2"><option value="left">{{ t('options.left') }}</option><option value="center">{{ t('options.center') }}</option><option value="right">{{ t('options.right') }}</option></select></label>
            </template>
            <template v-else-if="editingBlock.type === 'link'">
              <label><span class="field-label">{{ t('common.title') }}</span><input v-model="editingBlock.config.title" class="input px-3 py-2" maxlength="120" /></label>
              <label><span class="field-label">{{ t('editor.emoji') }}</span><input v-model="editingBlock.config.emoji" class="input px-3 py-2" maxlength="16" /></label>
              <label class="sm:col-span-2"><span class="field-label">{{ t('editor.url') }}</span><input v-model="editingBlock.config.url" class="input px-3 py-2" type="url" /></label>
              <label class="sm:col-span-2"><span class="field-label">{{ t('editor.subtitle') }}</span><input v-model="editingBlock.config.subtitle" class="input px-3 py-2" maxlength="240" /></label>
              <label class="flex items-center gap-2 text-sm"><input v-model="editingBlock.config.openInNewTab" type="checkbox" /> {{ t('editor.openNewTab') }}</label>
            </template>
            <template v-else-if="editingBlock.type === 'existing_link'">
              <LinkPicker v-model="editingBlock.config.resourceId" :links="links" class="sm:col-span-2" />
              <label><span class="field-label">{{ t('editor.buttonTitle') }}</span><input v-model="editingBlock.config.title" class="input px-3 py-2" maxlength="120" /></label>
              <label><span class="field-label">{{ t('editor.emoji') }}</span><input v-model="editingBlock.config.emoji" class="input px-3 py-2" maxlength="16" /></label>
              <label class="sm:col-span-2"><span class="field-label">{{ t('editor.subtitle') }}</span><input v-model="editingBlock.config.subtitle" class="input px-3 py-2" maxlength="240" /></label>
            </template>
            <template v-else-if="editingBlock.type === 'live_activity'">
              <LiveActivityPicker v-model="editingBlock.config.resourceId" :activities="activities" class="sm:col-span-2" />
              <label><span class="field-label">{{ t('editor.buttonTitle') }}</span><input v-model="editingBlock.config.title" class="input px-3 py-2" maxlength="120" /></label>
              <label><span class="field-label">{{ t('editor.emoji') }}</span><input v-model="editingBlock.config.emoji" class="input px-3 py-2" maxlength="16" /></label>
              <label class="sm:col-span-2"><span class="field-label">{{ t('editor.subtitle') }}</span><input v-model="editingBlock.config.subtitle" class="input px-3 py-2" maxlength="240" /></label>
            </template>
            <template v-else-if="editingBlock.type === 'email'">
              <label><span class="field-label">{{ t('editor.label') }}</span><input v-model="editingBlock.config.label" class="input px-3 py-2" maxlength="120" /></label>
              <label><span class="field-label">{{ t('editor.email') }}</span><input v-model="editingBlock.config.email" class="input px-3 py-2" type="email" /></label>
              <label><span class="field-label">{{ t('editor.style') }}</span><select v-model="editingBlock.config.style" class="input px-3 py-2"><option value="button">{{ t('options.button') }}</option><option value="text">{{ t('options.text') }}</option></select></label>
            </template>
            <template v-else-if="editingBlock.type === 'divider'">
              <label><span class="field-label">{{ t('editor.style') }}</span><select v-model="editingBlock.config.style" class="input px-3 py-2"><option value="solid">{{ t('options.solid') }}</option><option value="dashed">{{ t('options.dashed') }}</option><option value="dotted">{{ t('options.dotted') }}</option></select></label>
              <label><span class="field-label">{{ t('editor.spacing') }}</span><select v-model="editingBlock.config.spacing" class="input px-3 py-2"><option value="small">{{ t('options.small') }}</option><option value="medium">{{ t('options.medium') }}</option><option value="large">{{ t('options.large') }}</option></select></label>
            </template>
            <template v-else-if="editingBlock.type === 'spacer'">
              <label><span class="field-label">{{ t('editor.spacing') }}</span><select v-model="editingBlock.config.spacing" class="input px-3 py-2"><option value="small">{{ t('options.small') }}</option><option value="medium">{{ t('options.medium') }}</option><option value="large">{{ t('options.large') }}</option></select></label>
            </template>
            <template v-else-if="editingBlock.type === 'image'">
              <label class="sm:col-span-2"><span class="field-label">{{ t('editor.imageUrl') }}</span><input v-model="editingBlock.config.url" class="input px-3 py-2" type="url" /></label>
              <label class="sm:col-span-2"><span class="field-label">{{ t('editor.altText') }}</span><input v-model="editingBlock.config.alt" class="input px-3 py-2" maxlength="300" /></label>
              <label><span class="field-label">{{ t('editor.caption') }}</span><input v-model="editingBlock.config.caption" class="input px-3 py-2" maxlength="500" /></label>
              <label><span class="field-label">{{ t('editor.alignment') }}</span><select v-model="editingBlock.config.alignment" class="input px-3 py-2"><option value="left">{{ t('options.left') }}</option><option value="center">{{ t('options.center') }}</option><option value="right">{{ t('options.right') }}</option></select></label>
            </template>
          </div>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.pattern-swatch { color: var(--ui-accent); background-color: var(--ui-panel-muted); }
.pattern-swatch-dots { background-image: radial-gradient(currentColor 1.3px, transparent 1.3px); background-size: 12px 12px; }
.pattern-swatch-grid { background-image: linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px); background-size: 14px 14px; }
.pattern-swatch-soft_glow { background-image: radial-gradient(circle at 25% 30%, currentColor 0, transparent 42%), radial-gradient(circle at 85% 75%, currentColor 0, transparent 38%); opacity: .65; }
.pattern-swatch-crosses { background-image: linear-gradient(90deg, transparent 5px, currentColor 5px 9px, transparent 9px), linear-gradient(transparent 5px, currentColor 5px 9px, transparent 9px); background-size: 18px 18px; background-position: 0 7px, 7px 0; opacity: .65; }
</style>

<style scoped>
.field-label { display:block; margin-bottom:.4rem; font-size:.75rem; color:var(--ui-text-muted); }
.drag-handle > span { display:block; font-size:1.25rem; letter-spacing:-.18em; transform:rotate(90deg); }
.block-editor-card { border-color:color-mix(in srgb,var(--block-accent) 34%,var(--ui-border)); background:color-mix(in srgb,var(--block-accent) 7%,var(--ui-panel)); border-left-width:4px; border-left-color:var(--block-accent); }
.block-editor-card:hover { border-color:color-mix(in srgb,var(--block-accent) 62%,var(--ui-border)); background:color-mix(in srgb,var(--block-accent) 10%,var(--ui-panel)); }
.block-editor-card:active { background:color-mix(in srgb,var(--block-accent) 13%,var(--ui-panel)); }
.block-editor-card-linked { outline:2px solid color-mix(in srgb,var(--block-accent) 78%,transparent); outline-offset:2px; }
.block-editor-card-hidden { opacity:.62; border-style:dashed; }
.block-editor-card-hidden:hover, .block-editor-card-hidden:focus-within { opacity:.82; }
.block-list-dragging .block-editor-card { pointer-events:none; }
.block-list-dragging .block-insert-row, .block-list-dragging .add-block-button { pointer-events:none; opacity:0; }
.block-drag-placeholder { position:relative; opacity:1 !important; border:2px dashed var(--ui-accent) !important; background:color-mix(in srgb,var(--ui-accent) 8%,var(--ui-panel)) !important; box-shadow:none !important; transform:none !important; }
.block-drag-placeholder > * { visibility:hidden; }
.block-drag-ghost { position:fixed !important; z-index:200; margin:0 !important; pointer-events:none !important; opacity:1 !important; cursor:grabbing !important; box-shadow:0 18px 45px rgb(0 0 0 / .2),0 4px 12px rgb(0 0 0 / .12); transform:scale(1.025) !important; transform-origin:center; transition:none !important; }
:global(.dark) .block-drag-ghost { box-shadow:0 20px 50px rgb(0 0 0 / .48),0 4px 14px rgb(0 0 0 / .3); }
.block-editor-icon { color:var(--block-accent); border-color:color-mix(in srgb,var(--block-accent) 35%,var(--ui-border)); background:color-mix(in srgb,var(--block-accent) 11%,var(--ui-panel)); }
.double-slot-button { border-color:color-mix(in srgb,var(--block-accent) 30%,var(--ui-border)); background:color-mix(in srgb,var(--block-accent) 6%,var(--ui-panel)); color:var(--block-accent); }
.double-slot-button:hover, .double-slot-button:focus-visible { border-color:var(--block-accent); background:color-mix(in srgb,var(--block-accent) 12%,var(--ui-panel)); outline:none; }
.double-slot-button-empty { --block-accent:var(--ui-accent); border-style:dashed; }
.block-menu-action { display:flex; width:100%; align-items:center; border-radius:.75rem; border:1px solid transparent; padding:.65rem .8rem; text-align:left; font-size:.8125rem; transition:background-color .15s,border-color .15s,color .15s; }
.block-menu-action:hover, .block-menu-action:focus-visible { border-color:var(--ui-border); background:var(--ui-panel-muted); outline:none; }
.block-menu-action-danger { color:#AF3029; }
.block-menu-action-danger:hover, .block-menu-action-danger:focus-visible { border-color:color-mix(in srgb,#AF3029 25%,transparent); background:#FCE8DB; }
:global(.dark) .block-menu-action-danger { color:#F89A8A; }
:global(.dark) .block-menu-action-danger:hover, :global(.dark) .block-menu-action-danger:focus-visible { background:#321F1C; }
.add-block-button { display:inline-flex; align-items:center; justify-content:center; gap:.45rem; min-height:2.35rem; padding:.5rem .9rem; font-size:.8125rem; }
.add-block-button > span:first-child { font-size:1.1rem; line-height:1; }
.block-insert-row { display:flex; min-height:1.35rem; align-items:center; justify-content:center; gap:.4rem; }
.block-insert-line { height:1px; flex:1; background:var(--ui-border); opacity:0; transition:opacity .15s; }
.block-insert-button { display:flex; height:1.25rem; width:1.25rem; flex:none; align-items:center; justify-content:center; border:1px solid var(--ui-border); border-radius:999px; background:var(--ui-panel); color:var(--ui-text-muted); font-size:.875rem; line-height:1; opacity:0; transform:scale(.82); transition:opacity .15s,transform .15s,border-color .15s,color .15s,background-color .15s; }
.block-insert-row:hover .block-insert-line, .block-insert-row:focus-within .block-insert-line { opacity:.75; }
.block-insert-row:hover .block-insert-button, .block-insert-row:focus-within .block-insert-button, .block-insert-button-active { opacity:1; transform:scale(1); }
.block-insert-button:hover, .block-insert-button:focus-visible, .block-insert-button-active { border-color:var(--ui-accent); background:var(--ui-accent); color:var(--ui-accent-contrast); outline:none; }
@media (hover:none), (pointer:coarse) {
  .block-insert-line { opacity:.55; }
  .block-insert-button { opacity:1; transform:scale(1); }
}
.block-palette-button { color:var(--ui-text); border-color:color-mix(in srgb,var(--block-accent) 30%,var(--ui-border)); background:color-mix(in srgb,var(--block-accent) 7%,var(--ui-panel)); }
.block-palette-button:hover, .block-palette-button:focus-visible { color:var(--block-accent); border-color:var(--block-accent); outline:2px solid color-mix(in srgb,var(--block-accent) 35%,transparent); outline-offset:1px; }
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
