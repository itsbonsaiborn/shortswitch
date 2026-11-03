<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import type { Activity, ActivityAdminAttempt, ActivityAdminAttemptDetail, ActivityAdminResults, ActivityBackgroundPattern, ActivityLayout, ActivityPublishValidation, ActivityQuestionType, ActivitySettings, ActivityTheme, PublishedActivityVersion } from '@/shared/activity-types';
import { isValidActivityTimeZone, utcActivityDateTimeToLocalInput, zonedActivityDateTimeToUtc } from '@/shared/activity-deadline';
import { api } from '../lib/api';
import { activityAnswerRows as answerRows, formatActivityNumber, formatActivityPercent, formatActivityScorePercent } from '../lib/activity-results';
import { useToast } from '../composables/useToast';
import ActivityImageLabelingEditor from '../components/ActivityImageLabelingEditor.vue';
import ActivityBlockIcon from '../components/ActivityBlockIcon.vue';
import ActivityMoveArrow from '../components/ActivityMoveArrow.vue';
import QrCodePopover from '../components/QrCodePopover.vue';
import {
  createContentBlock,
  createQuestionBlock,
  createSlide,
  duplicateSlide,
  editorId,
  hasQuestionBlock,
  moveById,
  normalizePositions,
  validateEditorDraft,
  type AdminBlock,
  type AdminQuestionBlock,
  type AdminSlide
} from '../lib/activity-editor';

interface ActivityDetailResponse {
  activity: Activity;
  draft: { activityId: string; revision: number; slides: AdminSlide[]; createdAt: string; updatedAt: string };
  versions: Array<{ id: string; versionNumber: number; publishedAt: string }>;
}

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const { pushToast } = useToast();
const activityId = ref(typeof route.params.id === 'string' ? route.params.id : '');
const loading = ref(Boolean(activityId.value));
const saving = ref(false);
const publishing = ref(false);
const loadError = ref('');
const revision = ref(0);
const savedSnapshot = ref('');
const publishedVersion = ref<number | null>(null);
const publicUrl = ref('');
const copiedPublicUrl = ref(false);
let copiedPublicUrlTimer: number | undefined;
const lifecycleState = ref<Activity['lifecycleState']>('draft');
const publishConfirmation = ref(false);
const publishValidation = ref<ActivityPublishValidation | null>(null);
const adminAttempts = ref<ActivityAdminAttempt[]>([]);
const activityResults = ref<ActivityAdminResults | null>(null);
const attemptSearch = ref('');
const attemptStatus = ref<'all' | 'submitted' | 'expired'>('all');
const attemptGradingState = ref<'all' | 'submitted' | 'expired' | 'awaiting_manual_grading' | 'fully_graded'>('all');
const attemptPage = ref(1);
const selectedAttemptDetail = ref<ActivityAdminAttemptDetail | null>(null);
const gradingAttempt = ref(false);
const manualGrades = reactive<Record<string, { points: string; feedback: string }>>({});
const extendingAttemptId = ref('');
const activeTab = ref<'general' | 'content' | 'design' | 'settings' | 'results'>('content');
const selectedSlideId = ref('');
const selectedBlockId = ref('');
const questionToAdd = ref<ActivityQuestionType>('single_choice');
const draggedSlideId = ref('');
const draggedBlockId = ref('');
const slideList = ref<HTMLElement | null>(null);
const blockList = ref<HTMLElement | null>(null);
const slideDragOrderIds = ref<string[] | null>(null);
const dragOrderIds = ref<string[] | null>(null);
const blockPicker = ref<{ index: number; top: number; left: number; maxHeight: number } | null>(null);
const blockPickerSearch = ref('');
const blockMenu = ref<{ id: string; top: number; left: number } | null>(null);
const dialog = ref<{ kind: 'delete-slide' | 'replace-question' | 'delete-block'; id: string; questionType?: ActivityQuestionType } | null>(null);

const settings = reactive<ActivitySettings>({
  title: '', description: '', slug: '', status: 'closed', identityMode: 'anonymous',
  requiredAnswerBehavior: 'require_all', navigationPolicy: 'linear', resultVisibility: 'after_submission',
  feedbackPolicy: 'points_per_question',
  theme: 'minimal_light', layout: 'classic', backgroundPattern: 'none', patternIntensity: 35,
  gradingEnabled: true, defaultQuestionPoints: 1,
  maximumAttempts: 1, attemptTimeLimitSeconds: null, availabilityStartAt: null, submissionDeadlineAt: null,
  submissionDeadlineTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  lowTimeWarningSeconds: 300, shuffleQuestionOptions: false, shuffleSlides: false, allowBackNavigation: true
});
const slides = ref<AdminSlide[]>([createSlide(0)]);
selectedSlideId.value = slides.value[0].id;

const questionTypes: ActivityQuestionType[] = ['single_choice', 'multiple_choice', 'open_answer', 'word_cloud', 'ordering', 'matching', 'image_labeling'];
const questionLabels = computed<Record<ActivityQuestionType, string>>(() => Object.fromEntries(
  questionTypes.map((type) => [type, t(`activityQuestionTypes.${type}`)])
) as Record<ActivityQuestionType, string>);
const tabs = ['general', 'content', 'design', 'settings', 'results'] as const;
const activityThemes = computed<Array<{ value: ActivityTheme; label: string; colors: string[] }>>(() => [
  { value: 'classic_cream', label: t('activityDesign.themes.classicCream'), colors: ['#f7f0df', '#c7662e', '#28211b'] },
  { value: 'forest_dark', label: t('activityDesign.themes.forestDark'), colors: ['#14211b', '#9db55f', '#f0f4e8'] },
  { value: 'soft_lavender', label: t('activityDesign.themes.softLavender'), colors: ['#f1edfa', '#8067b1', '#302842'] },
  { value: 'ocean_blue', label: t('activityDesign.themes.oceanBlue'), colors: ['#eaf5f8', '#287d91', '#18333c'] },
  { value: 'minimal_light', label: t('activityDesign.themes.minimalLight'), colors: ['#f8f8f6', '#2f6f62', '#1f1f1d'] }
]);
const activityLayouts = computed<Array<{ value: ActivityLayout; label: string; sample: string }>>(() => [
  { value: 'classic', label: t('activityDesign.layouts.classic'), sample: 'rounded-xl shadow-sm' },
  { value: 'minimal', label: t('activityDesign.layouts.minimal'), sample: 'rounded-md' },
  { value: 'soft', label: t('activityDesign.layouts.soft'), sample: 'rounded-3xl shadow-md' },
  { value: 'bold', label: t('activityDesign.layouts.bold'), sample: 'rounded-lg shadow-[4px_4px_0_var(--ui-border)]' }
]);
const activityPatterns: Array<{ value: ActivityBackgroundPattern; labelKey: string }> = [
  { value: 'none', labelKey: 'pages.patternNone' },
  { value: 'dots', labelKey: 'pages.patternDots' },
  { value: 'grid', labelKey: 'pages.patternGrid' },
  { value: 'soft_glow', labelKey: 'pages.patternSoftGlow' },
  { value: 'crosses', labelKey: 'pages.patternCrosses' }
];
const selectedSlide = computed(() => slides.value.find((slide) => slide.id === selectedSlideId.value) ?? null);
const editorSlides = computed(() => {
  if (!slideDragOrderIds.value) return slides.value;
  const byId = new Map(slides.value.map((slide) => [slide.id, slide]));
  return slideDragOrderIds.value.map((id) => byId.get(id)).filter((slide): slide is AdminSlide => Boolean(slide));
});
const editorBlocks = computed(() => {
  const blocks = selectedSlide.value?.blocks ?? [];
  if (!dragOrderIds.value) return blocks;
  const byId = new Map(blocks.map((block) => [block.id, block]));
  return dragOrderIds.value.map((id) => byId.get(id)).filter((block): block is AdminBlock => Boolean(block));
});
const selectedBlock = computed<AdminBlock | null>(() => selectedSlide.value?.blocks.find((block) => block.id === selectedBlockId.value) ?? null);
const questionBlock = computed(() => selectedBlock.value?.type === 'question' ? selectedBlock.value as AdminQuestionBlock : null);
const questionConfig = computed<any>(() => questionBlock.value?.config ?? null);
const answerKey = computed<any>(() => questionBlock.value?.answerKey ?? null);
const snapshot = computed(() => JSON.stringify({ settings, slides: slides.value }));
const dirty = computed(() => Boolean(savedSnapshot.value) && savedSnapshot.value !== snapshot.value);
const timeLimitMinutes = computed({
  get: () => settings.attemptTimeLimitSeconds === null ? 20 : settings.attemptTimeLimitSeconds / 60,
  set: (minutes: number) => { settings.attemptTimeLimitSeconds = Math.max(1, Math.round(Number(minutes) || 1)) * 60; }
});
const warningMinutes = computed({
  get: () => settings.lowTimeWarningSeconds === null ? 5 : settings.lowTimeWarningSeconds / 60,
  set: (minutes: number) => { settings.lowTimeWarningSeconds = Math.max(1, Math.round(Number(minutes) || 1)) * 60; }
});
const deadlineLocalValue = computed(() => utcActivityDateTimeToLocalInput(settings.submissionDeadlineAt, settings.submissionDeadlineTimezone));
const availabilityLocalValue = computed(() => utcActivityDateTimeToLocalInput(settings.availabilityStartAt, settings.submissionDeadlineTimezone));
const setAvailabilityLocal = (value: string) => {
  if (!value) { settings.availabilityStartAt = null; return; }
  const utc = zonedActivityDateTimeToUtc(value, settings.submissionDeadlineTimezone);
  if (!utc) { pushToast({ tone: 'error', title: t('activitiesEditor.invalidDeadline') }); return; }
  settings.availabilityStartAt = utc;
};
const toggleAvailability = (enabled: boolean) => {
  settings.availabilityStartAt = enabled ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : null;
};
const setDeadlineLocal = (value: string) => {
  if (!value) { settings.submissionDeadlineAt = null; return; }
  const utc = zonedActivityDateTimeToUtc(value, settings.submissionDeadlineTimezone);
  if (!utc) {
    pushToast({ tone: 'error', title: t('activitiesEditor.invalidDeadline') });
    return;
  }
  settings.submissionDeadlineAt = utc;
};
const toggleTimeLimit = (enabled: boolean) => { settings.attemptTimeLimitSeconds = enabled ? Math.max(60, settings.attemptTimeLimitSeconds ?? 20 * 60) : null; };
const toggleGlobalDeadline = (enabled: boolean) => {
  if (!enabled) { settings.submissionDeadlineAt = null; return; }
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  settings.submissionDeadlineAt = tomorrow.toISOString();
};
const toggleLowTimeWarning = (enabled: boolean) => { settings.lowTimeWarningSeconds = enabled ? Math.max(60, settings.lowTimeWarningSeconds ?? 5 * 60) : null; };
const deadlinePreview = computed(() => {
  const individual = settings.attemptTimeLimitSeconds ? t('activitiesEditor.previewIndividual', { minutes: Math.round(settings.attemptTimeLimitSeconds / 60) }) : t('activitiesEditor.noIndividualLimit');
  const global = settings.submissionDeadlineAt && isValidActivityTimeZone(settings.submissionDeadlineTimezone)
    ? t('activitiesEditor.previewGlobal', { deadline: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: settings.submissionDeadlineTimezone }).format(new Date(settings.submissionDeadlineAt)), timezone: settings.submissionDeadlineTimezone })
    : settings.submissionDeadlineAt ? t('activitiesEditor.invalidDeadline') : t('activitiesEditor.noGlobalDeadline');
  return `${individual} · ${global}`;
});
const formatAttemptDate = (value: string | null) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const loadAttempts = async () => {
  if (!activityId.value) { adminAttempts.value = []; activityResults.value = null; return; }
  const query = new URLSearchParams({
    page: String(attemptPage.value),
    pageSize: '20',
    search: attemptSearch.value,
    status: attemptStatus.value,
    gradingState: attemptGradingState.value
  });
  activityResults.value = await api<ActivityAdminResults>(`/api/activities/${activityId.value}/results?${query}`);
  attemptPage.value = activityResults.value.pagination.page;
  adminAttempts.value = activityResults.value.attempts;
};
const applyAttemptFilters = async () => { attemptPage.value = 1; await loadAttempts(); };
const changeAttemptPage = async (delta: number) => {
  if (!activityResults.value) return;
  attemptPage.value = Math.min(activityResults.value.pagination.totalPages || 1, Math.max(1, attemptPage.value + delta));
  await loadAttempts();
};
const formatPercent = formatActivityPercent;
const formatAttemptScorePercent = formatActivityScorePercent;
const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
};
const attemptExportUrl = computed(() => activityId.value ? `/api/activities/${activityId.value}/exports/attempts.csv` : '#');
const responseExportUrl = computed(() => activityId.value ? `/api/activities/${activityId.value}/exports/responses.csv` : '#');
const responseXlsxExportUrl = computed(() => activityId.value ? `/api/activities/${activityId.value}/exports/responses.xlsx` : '#');
const loadAttemptDetail = async (attemptId: string) => {
  if (!activityId.value) return;
  selectedAttemptDetail.value = await api<ActivityAdminAttemptDetail>(`/api/activities/${activityId.value}/attempts/${attemptId}`);
  for (const response of selectedAttemptDetail.value.responses) {
    manualGrades[response.questionBlockId] = {
      points: String(response.awardedPoints ?? 0),
      feedback: response.teacherFeedback
    };
  }
};
const gradeManualResponse = async (questionBlockId: string) => {
  if (!activityId.value || !selectedAttemptDetail.value) return;
  const draft = manualGrades[questionBlockId];
  gradingAttempt.value = true;
  try {
    selectedAttemptDetail.value = await api<ActivityAdminAttemptDetail>(
      `/api/activities/${activityId.value}/attempts/${selectedAttemptDetail.value.id}/responses/${questionBlockId}/grade`,
      { method: 'POST', body: JSON.stringify({ awardedPoints: Number(draft?.points), teacherFeedback: draft?.feedback ?? '' }) }
    );
    await loadAttempts();
    pushToast({ tone: 'success', title: t('activitiesEditor.gradeSaved') });
  } catch (error) { pushToast({ tone: 'error', title: t('activitiesEditor.gradeFailed'), description: (error as Error).message }); }
  finally { gradingAttempt.value = false; }
};
const moderateAttemptResponse = async (questionBlockId: string, status: 'approved' | 'rejected') => {
  if (!activityId.value || !selectedAttemptDetail.value) return;
  gradingAttempt.value = true;
  try {
    selectedAttemptDetail.value = await api<ActivityAdminAttemptDetail>(
      `/api/activities/${activityId.value}/attempts/${selectedAttemptDetail.value.id}/responses/${questionBlockId}/moderate`,
      { method: 'POST', body: JSON.stringify({ status }) }
    );
    await loadAttempts();
    pushToast({ tone: 'success', title: t(status === 'approved' ? 'activityModeration.responseApproved' : 'activityModeration.responseRejected') });
  } catch (error) { pushToast({ tone: 'error', title: t('activityModeration.moderationFailed'), description: (error as Error).message }); }
  finally { gradingAttempt.value = false; }
};
const releaseAttemptResults = async () => {
  if (!activityId.value || !selectedAttemptDetail.value) return;
  gradingAttempt.value = true;
  try {
    selectedAttemptDetail.value = await api<ActivityAdminAttemptDetail>(
      `/api/activities/${activityId.value}/attempts/${selectedAttemptDetail.value.id}/release-results`,
      { method: 'POST', body: '{}' }
    );
    await loadAttempts();
    pushToast({ tone: 'success', title: t('activitiesEditor.resultsReleased') });
  } catch (error) { pushToast({ tone: 'error', title: t('activitiesEditor.releaseFailed'), description: (error as Error).message }); }
  finally { gradingAttempt.value = false; }
};
const extendAttempt = async (attempt: ActivityAdminAttempt) => {
  const raw = window.prompt(t('activitiesEditor.extensionPrompt'), '10');
  if (!raw) return;
  extendingAttemptId.value = attempt.id;
  try {
    const updated = await api<ActivityAdminAttempt>(`/api/activities/${activityId.value}/attempts/${attempt.id}/extend`, { method: 'POST', body: JSON.stringify({ additionalMinutes: Number(raw) }) });
    const index = adminAttempts.value.findIndex((item) => item.id === updated.id);
    if (index >= 0) adminAttempts.value[index] = updated;
    pushToast({ tone: 'success', title: t('activitiesEditor.deadlineExtended') });
  } catch (error) { pushToast({ tone: 'error', title: t('activitiesEditor.extensionFailed'), description: (error as Error).message }); }
  finally { extendingAttemptId.value = ''; }
};
const validationErrors = computed(() => validateEditorDraft(slides.value));
const slideQuestion = (slide: AdminSlide) => slide.blocks.find((block) => block.type === 'question') as AdminQuestionBlock | undefined;
const blockLabel = (block: AdminBlock) => block.type === 'question' ? questionLabels.value[block.questionType] : block.type[0].toUpperCase() + block.type.slice(1);
const blockSummary = (block: AdminBlock) => {
  if (block.type === 'heading' || block.type === 'text') return block.config.text;
  if (block.type === 'image') return block.config.caption || block.config.alt;
  if (block.type === 'divider') return `${block.config.style} divider`;
  return block.config.prompt;
};
type ActivityBlockPickerType = 'heading' | 'text' | 'image' | 'divider' | ActivityQuestionType;
const blockAccentForType = (type: ActivityBlockPickerType) => ({
  heading: '#5285C5', text: '#8064BD', image: '#D87962', divider: '#A3A7AD',
  single_choice: '#238B83', multiple_choice: '#5285C5', open_answer: '#8064BD',
  word_cloud: '#C99522', ordering: '#D87962', matching: '#238B83', image_labeling: '#8064BD'
}[type]);
const blockAccent = (block: AdminBlock) => blockAccentForType(block.type === 'question' ? block.questionType : block.type);
const blockPickerItems = computed(() => [
  { type: 'heading' as const, label: 'Heading' },
  { type: 'text' as const, label: 'Text' },
  { type: 'image' as const, label: 'Image' },
  { type: 'divider' as const, label: 'Divider' },
  ...questionTypes.map((type) => ({ type, label: questionLabels.value[type] }))
].filter((item) => item.label.toLocaleLowerCase().includes(blockPickerSearch.value.trim().toLocaleLowerCase())));
const normalize = () => { slides.value = normalizePositions(slides.value); };
const selectSlide = (id: string) => { selectedSlideId.value = id; selectedBlockId.value = ''; };

const addSlide = () => {
  const slide = createSlide(slides.value.length);
  slides.value.push(slide);
  selectSlide(slide.id);
};
const copySlide = (slide: AdminSlide) => {
  const copy = duplicateSlide(slide);
  copy.title = `${slide.title || 'Slide'} copy`;
  const index = slides.value.findIndex((item) => item.id === slide.id);
  slides.value.splice(index + 1, 0, copy);
  normalize();
  selectSlide(copy.id);
};
const moveSlide = (id: string, direction: -1 | 1) => {
  const index = slides.value.findIndex((slide) => slide.id === id);
  if (index < 0) return;
  slides.value = normalizePositions(moveById(slides.value, id, index + direction));
  void nextTick(() => document.querySelector<HTMLElement>(`[data-slide-id="${id}"]`)?.focus());
};
const addContent = (type: 'heading' | 'text' | 'image' | 'divider', index = selectedSlide.value?.blocks.length ?? 0) => {
  if (!selectedSlide.value) return;
  const block = createContentBlock(type);
  selectedSlide.value.blocks.splice(index, 0, block);
  selectedBlockId.value = block.id;
};
const addQuestion = (type = questionToAdd.value, index = selectedSlide.value?.blocks.length ?? 0) => {
  if (!selectedSlide.value) return;
  if (hasQuestionBlock(selectedSlide.value)) {
    const current = slideQuestion(selectedSlide.value);
    if (current) dialog.value = { kind: 'replace-question', id: current.id, questionType: type };
    return;
  }
  const block = createQuestionBlock(type, settings.defaultQuestionPoints);
  selectedSlide.value.blocks.splice(index, 0, block);
  selectedBlockId.value = block.id;
};
const moveBlock = (id: string, direction: -1 | 1) => {
  if (!selectedSlide.value) return;
  const index = selectedSlide.value.blocks.findIndex((block) => block.id === id);
  selectedSlide.value.blocks = moveById(selectedSlide.value.blocks, id, index + direction);
};
const openBlockPicker = (event: MouseEvent, index: number) => {
  const anchor = event.currentTarget as HTMLElement;
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(420, window.innerWidth - 24);
  const wantedHeight = 410;
  const below = window.innerHeight - rect.bottom - 12;
  const above = rect.top - 12;
  const openAbove = below < Math.min(wantedHeight, 300) && above > below;
  const maxHeight = Math.max(220, Math.min(wantedHeight, openAbove ? above : below));
  const top = openAbove ? Math.max(12, rect.top - maxHeight - 8) : Math.min(window.innerHeight - maxHeight - 12, rect.bottom + 8);
  const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12));
  blockPickerSearch.value = '';
  blockPicker.value = { index, top, left, maxHeight };
};
const closeBlockPicker = () => { blockPicker.value = null; blockPickerSearch.value = ''; };
const openBlockMenu = (event: MouseEvent, id: string) => {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const width = 180;
  const height = 54;
  blockMenu.value = {
    id,
    left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
    top: rect.bottom + height + 12 <= window.innerHeight ? rect.bottom + 6 : Math.max(12, rect.top - height - 6)
  };
};
const closeBlockMenu = () => { blockMenu.value = null; };
const chooseBlock = (type: ActivityBlockPickerType) => {
  const index = blockPicker.value?.index ?? selectedSlide.value?.blocks.length ?? 0;
  closeBlockPicker();
  if (['heading', 'text', 'image', 'divider'].includes(type)) addContent(type as 'heading' | 'text' | 'image' | 'divider', index);
  else addQuestion(type as ActivityQuestionType, index);
};
const onDocumentPointerDown = (event: PointerEvent) => {
  const target = event.target as HTMLElement | null;
  if (blockPicker.value && !target?.closest('[data-activity-block-picker], [data-activity-add-block]')) closeBlockPicker();
  if (blockMenu.value && !target?.closest('[data-activity-block-menu], [data-activity-block-menu-trigger]')) closeBlockMenu();
};
type SlideDragSession = {
  pointerId: number;
  slideId: string;
  ghost: HTMLElement;
  handle: HTMLElement;
  offsetX: number;
  offsetY: number;
  width: number;
  lastClientY: number;
  bodyCursor: string;
  bodyUserSelect: string;
};
let slideDragSession: SlideDragSession | null = null;
let slideAutoScrollFrame: number | null = null;
let suppressSlideClickUntil = 0;
const captureSlideRects = () => {
  const rects = new Map<string, DOMRect>();
  slideList.value?.querySelectorAll<HTMLElement>('[data-activity-slide-id]').forEach((element) => {
    const id = element.dataset.activitySlideId;
    if (id) rects.set(id, element.getBoundingClientRect());
  });
  return rects;
};
const animateSlidePositions = async (before: Map<string, DOMRect>) => {
  await nextTick();
  slideList.value?.querySelectorAll<HTMLElement>('[data-activity-slide-id]').forEach((element) => {
    const id = element.dataset.activitySlideId;
    const previous = id ? before.get(id) : undefined;
    if (!previous || id === draggedSlideId.value) return;
    const current = element.getBoundingClientRect();
    const deltaY = previous.top - current.top;
    if (Math.abs(deltaY) < 1) return;
    element.getAnimations().forEach((animation) => animation.cancel());
    element.animate([{ transform: `translateY(${deltaY}px)` }, { transform: 'translateY(0)' }], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' });
  });
};
const setDraggedSlidePosition = (targetIndex: number) => {
  const order = slideDragOrderIds.value;
  const session = slideDragSession;
  if (!order || !session) return;
  const currentIndex = order.indexOf(session.slideId);
  const nextIndex = Math.max(0, Math.min(targetIndex, order.length - 1));
  if (currentIndex < 0 || currentIndex === nextIndex) return;
  const before = captureSlideRects();
  const next = [...order];
  next.splice(currentIndex, 1);
  next.splice(nextIndex, 0, session.slideId);
  slideDragOrderIds.value = next;
  void animateSlidePositions(before);
};
const updateDraggedSlidePosition = (clientY: number) => {
  const session = slideDragSession;
  if (!session || !slideList.value) return;
  const cards = [...slideList.value.querySelectorAll<HTMLElement>('[data-activity-slide-id]')]
    .filter((element) => element.dataset.activitySlideId !== session.slideId);
  let targetIndex = cards.length;
  for (let index = 0; index < cards.length; index += 1) {
    const rect = cards[index].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) { targetIndex = index; break; }
  }
  setDraggedSlidePosition(targetIndex);
};
const positionSlideGhost = (clientX: number, clientY: number) => {
  const session = slideDragSession;
  if (!session) return;
  const left = Math.min(Math.max(clientX - session.offsetX, 8), Math.max(window.innerWidth - session.width - 8, 8));
  session.ghost.style.left = `${left}px`;
  session.ghost.style.top = `${clientY - session.offsetY}px`;
};
const runSlideAutoScroll = () => {
  const session = slideDragSession;
  const container = slideList.value;
  if (!session || !container) return;
  const rect = container.getBoundingClientRect();
  const edge = Math.min(64, rect.height / 4);
  let speed = 0;
  if (session.lastClientY < rect.top + edge) speed = -Math.ceil(((rect.top + edge - session.lastClientY) / edge) * 14);
  else if (session.lastClientY > rect.bottom - edge) speed = Math.ceil(((session.lastClientY - (rect.bottom - edge)) / edge) * 14);
  if (speed && container.scrollHeight > container.clientHeight) {
    const previous = container.scrollTop;
    container.scrollTop += speed;
    if (previous !== container.scrollTop) updateDraggedSlidePosition(session.lastClientY);
  }
  slideAutoScrollFrame = window.requestAnimationFrame(runSlideAutoScroll);
};
const onSlideDragMove = (event: PointerEvent) => {
  const session = slideDragSession;
  if (!session || event.pointerId !== session.pointerId) return;
  event.preventDefault();
  session.lastClientY = event.clientY;
  positionSlideGhost(event.clientX, event.clientY);
  updateDraggedSlidePosition(event.clientY);
};
const finishSlideDrag = (commit: boolean) => {
  const session = slideDragSession;
  if (!session) return;
  const targetIndex = slideDragOrderIds.value?.indexOf(session.slideId) ?? -1;
  const sourceIndex = slides.value.findIndex((slide) => slide.id === session.slideId);
  if (commit && sourceIndex >= 0 && targetIndex >= 0) slides.value = normalizePositions(moveById(slides.value, session.slideId, targetIndex));
  slideDragOrderIds.value = null;
  draggedSlideId.value = '';
  suppressSlideClickUntil = performance.now() + 250;
  session.ghost.remove();
  if (session.handle.hasPointerCapture?.(session.pointerId)) session.handle.releasePointerCapture(session.pointerId);
  document.body.style.cursor = session.bodyCursor;
  document.body.style.userSelect = session.bodyUserSelect;
  document.removeEventListener('pointermove', onSlideDragMove);
  document.removeEventListener('pointerup', onSlideDragEnd);
  document.removeEventListener('pointercancel', onSlideDragCancel);
  document.removeEventListener('keydown', onSlideDragKeydown);
  if (slideAutoScrollFrame !== null) window.cancelAnimationFrame(slideAutoScrollFrame);
  slideAutoScrollFrame = null;
  slideDragSession = null;
  void nextTick(() => slideList.value?.querySelector<HTMLElement>(`[data-activity-slide-drag-handle="${session.slideId}"]`)?.focus());
};
function onSlideDragEnd(event: PointerEvent) { if (slideDragSession?.pointerId === event.pointerId) finishSlideDrag(true); }
function onSlideDragCancel(event: PointerEvent) { if (slideDragSession?.pointerId === event.pointerId) finishSlideDrag(false); }
function onSlideDragKeydown(event: KeyboardEvent) { if (event.key === 'Escape' && slideDragSession) { event.preventDefault(); finishSlideDrag(false); } }
const startSlideDrag = (event: PointerEvent, slideId: string) => {
  if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0) || slideDragSession) return;
  const handle = event.currentTarget as HTMLElement;
  const card = handle.closest<HTMLElement>('[data-activity-slide-id]');
  if (!card) return;
  event.preventDefault();
  event.stopPropagation();
  const rect = card.getBoundingClientRect();
  const ghost = card.cloneNode(true) as HTMLElement;
  ghost.classList.remove('activity-slide-placeholder');
  ghost.classList.add('activity-slide-ghost');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]').forEach((element) => { element.tabIndex = -1; });
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  document.body.appendChild(ghost);
  slideDragSession = {
    pointerId: event.pointerId, slideId, ghost, handle,
    offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top,
    width: rect.width, lastClientY: event.clientY,
    bodyCursor: document.body.style.cursor, bodyUserSelect: document.body.style.userSelect
  };
  draggedSlideId.value = slideId;
  slideDragOrderIds.value = slides.value.map((slide) => slide.id);
  document.body.style.cursor = 'grabbing';
  document.body.style.userSelect = 'none';
  handle.setPointerCapture?.(event.pointerId);
  positionSlideGhost(event.clientX, event.clientY);
  document.addEventListener('pointermove', onSlideDragMove, { passive: false });
  document.addEventListener('pointerup', onSlideDragEnd);
  document.addEventListener('pointercancel', onSlideDragCancel);
  document.addEventListener('keydown', onSlideDragKeydown);
  slideAutoScrollFrame = window.requestAnimationFrame(runSlideAutoScroll);
};
const selectSlideFromCard = (id: string) => {
  if (performance.now() < suppressSlideClickUntil) return;
  selectSlide(id);
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
  blockList.value?.querySelectorAll<HTMLElement>('[data-activity-block-id]').forEach((element) => {
    const id = element.dataset.activityBlockId;
    if (id) rects.set(id, element.getBoundingClientRect());
  });
  return rects;
};
const animateBlockPositions = async (before: Map<string, DOMRect>) => {
  await nextTick();
  blockList.value?.querySelectorAll<HTMLElement>('[data-activity-block-id]').forEach((element) => {
    const id = element.dataset.activityBlockId;
    const previous = id ? before.get(id) : undefined;
    if (!previous || id === draggedBlockId.value) return;
    const current = element.getBoundingClientRect();
    const deltaY = previous.top - current.top;
    if (Math.abs(deltaY) < 1) return;
    element.getAnimations().forEach((animation) => animation.cancel());
    element.animate([{ transform: `translateY(${deltaY}px)` }, { transform: 'translateY(0)' }], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' });
  });
};
const setDraggedBlockPosition = (targetIndex: number) => {
  const order = dragOrderIds.value;
  const session = blockDragSession;
  if (!order || !session) return;
  const currentIndex = order.indexOf(session.blockId);
  const nextIndex = Math.max(0, Math.min(targetIndex, order.length - 1));
  if (currentIndex < 0 || currentIndex === nextIndex) return;
  const before = captureBlockRects();
  const next = [...order];
  next.splice(currentIndex, 1);
  next.splice(nextIndex, 0, session.blockId);
  dragOrderIds.value = next;
  void animateBlockPositions(before);
};
const updateDraggedBlockPosition = (clientY: number) => {
  const session = blockDragSession;
  if (!session || !blockList.value) return;
  const cards = [...blockList.value.querySelectorAll<HTMLElement>('[data-activity-block-id]')]
    .filter((element) => element.dataset.activityBlockId !== session.blockId);
  let targetIndex = cards.length;
  for (let index = 0; index < cards.length; index += 1) {
    const rect = cards[index].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) { targetIndex = index; break; }
  }
  setDraggedBlockPosition(targetIndex);
};
const positionBlockGhost = (clientX: number, clientY: number) => {
  const session = blockDragSession;
  if (!session) return;
  const left = Math.min(Math.max(clientX - session.offsetX, 8), Math.max(window.innerWidth - session.width - 8, 8));
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
  if (session.lastClientY < rect.top + edge) speed = -Math.ceil(((rect.top + edge - session.lastClientY) / edge) * 14);
  else if (session.lastClientY > rect.bottom - edge) speed = Math.ceil(((session.lastClientY - (rect.bottom - edge)) / edge) * 14);
  if (speed && container.scrollHeight > container.clientHeight) {
    const previous = container.scrollTop;
    container.scrollTop += speed;
    if (previous !== container.scrollTop) updateDraggedBlockPosition(session.lastClientY);
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
  const targetIndex = dragOrderIds.value?.indexOf(session.blockId) ?? -1;
  const sourceIndex = selectedSlide.value?.blocks.findIndex((block) => block.id === session.blockId) ?? -1;
  if (commit && selectedSlide.value && sourceIndex >= 0 && targetIndex >= 0) selectedSlide.value.blocks = moveById(selectedSlide.value.blocks, session.blockId, targetIndex);
  dragOrderIds.value = null;
  draggedBlockId.value = '';
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
  void nextTick(() => blockList.value?.querySelector<HTMLElement>(`[data-activity-drag-handle="${session.blockId}"]`)?.focus());
};
function onBlockDragEnd(event: PointerEvent) { if (blockDragSession?.pointerId === event.pointerId) finishBlockDrag(true); }
function onBlockDragCancel(event: PointerEvent) { if (blockDragSession?.pointerId === event.pointerId) finishBlockDrag(false); }
function onBlockDragKeydown(event: KeyboardEvent) { if (event.key === 'Escape' && blockDragSession) { event.preventDefault(); finishBlockDrag(false); } }
const startBlockDrag = (event: PointerEvent, blockId: string) => {
  if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0) || blockDragSession) return;
  const handle = event.currentTarget as HTMLElement;
  const card = handle.closest<HTMLElement>('[data-activity-block-id]');
  if (!card) return;
  event.preventDefault();
  event.stopPropagation();
  closeBlockPicker();
  const rect = card.getBoundingClientRect();
  const ghost = card.cloneNode(true) as HTMLElement;
  ghost.classList.remove('activity-block-placeholder');
  ghost.classList.add('activity-block-ghost');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]').forEach((element) => { element.tabIndex = -1; });
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  document.body.appendChild(ghost);
  blockDragSession = {
    pointerId: event.pointerId, blockId, ghost, handle,
    offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top,
    width: rect.width, lastClientY: event.clientY,
    bodyCursor: document.body.style.cursor, bodyUserSelect: document.body.style.userSelect
  };
  draggedBlockId.value = blockId;
  dragOrderIds.value = selectedSlide.value?.blocks.map((block) => block.id) ?? [];
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
const openBlockEditor = (blockId: string) => {
  if (performance.now() < suppressBlockClickUntil) return;
  selectedBlockId.value = blockId;
};
const confirmDialog = () => {
  if (!dialog.value) return;
  if (dialog.value.kind === 'delete-slide') {
    slides.value = normalizePositions(slides.value.filter((slide) => slide.id !== dialog.value?.id));
    if (!slides.value.length) slides.value = [createSlide(0)];
    selectSlide(slides.value[0].id);
  } else if (dialog.value.kind === 'delete-block') {
    if (selectedSlide.value) selectedSlide.value.blocks = selectedSlide.value.blocks.filter((block) => block.id !== dialog.value?.id);
    selectedBlockId.value = '';
  } else if (selectedSlide.value && dialog.value.questionType) {
    const index = selectedSlide.value.blocks.findIndex((block) => block.id === dialog.value?.id);
    const replacement = createQuestionBlock(dialog.value.questionType, settings.defaultQuestionPoints);
    if (index >= 0) selectedSlide.value.blocks.splice(index, 1, replacement);
    selectedBlockId.value = replacement.id;
  }
  dialog.value = null;
};

const addChoice = (collection: Array<{ id: string; label: string }>, label = 'New option') => {
  if (collection.length >= 50) return;
  collection.push({ id: editorId('option'), label });
};
const moveChoice = (collection: Array<{ id: string; label: string }>, id: string, direction: -1 | 1) => {
  const index = collection.findIndex((item) => item.id === id);
  if (index < 0) return;
  collection.splice(0, collection.length, ...moveById(collection, id, index + direction));
};
const removeChoice = (collection: Array<{ id: string; label: string }>, id: string) => {
  if (collection.length <= 2) return;
  const index = collection.findIndex((item) => item.id === id);
  if (index >= 0) collection.splice(index, 1);
  if (questionBlock.value?.questionType === 'single_choice' && answerKey.value?.correctOptionId === id) {
    answerKey.value.correctOptionId = collection[0]?.id ?? '';
  }
  if (questionBlock.value?.questionType === 'multiple_choice') {
    answerKey.value.correctOptionIds = answerKey.value.correctOptionIds.filter((optionId: string) => optionId !== id);
    questionConfig.value.maximumSelections = Math.min(questionConfig.value.maximumSelections, collection.length);
    questionConfig.value.minimumSelections = Math.min(questionConfig.value.minimumSelections, questionConfig.value.maximumSelections);
  }
};
const orderingEditorItems = computed(() => {
  if (questionBlock.value?.questionType !== 'ordering') return [];
  const byId = new Map(questionConfig.value.items.map((item: { id: string; label: string }) => [item.id, item]));
  return questionBlock.value.answerKey.orderedItemIds.map((id: string) => byId.get(id)).filter(Boolean);
});
const matchingEditorPairs = computed(() => {
  if (questionBlock.value?.questionType !== 'matching') return [];
  const left = new Map(questionConfig.value.leftItems.map((item: { id: string; label: string }) => [item.id, item]));
  const right = new Map(questionConfig.value.rightItems.map((item: { id: string; label: string }) => [item.id, item]));
  return questionBlock.value.answerKey.pairs.map((pair: { leftId: string; rightId: string }) => ({ pair, left: left.get(pair.leftId), right: right.get(pair.rightId) })).filter((entry: any) => entry.left && entry.right);
});
const addOrderingItem = () => {
  if (questionConfig.value.items.length >= 50) return;
  const item = { id: editorId('option'), label: t('activityOrdering.newItem') };
  questionConfig.value.items.push(item);
  questionBlock.value!.answerKey.orderedItemIds.push(item.id);
};
const moveOrderingItem = (id: string, direction: -1 | 1) => {
  const ids = questionBlock.value!.answerKey.orderedItemIds as string[];
  const index = ids.indexOf(id);
  if (index < 0) return;
  const target = Math.max(0, Math.min(index + direction, ids.length - 1));
  const [moved] = ids.splice(index, 1);
  ids.splice(target, 0, moved);
};
const removeOrderingItem = (id: string) => {
  if (questionConfig.value.items.length <= 2) return;
  questionConfig.value.items = questionConfig.value.items.filter((item: { id: string }) => item.id !== id);
  questionBlock.value!.answerKey.orderedItemIds = questionBlock.value!.answerKey.orderedItemIds.filter((itemId: string) => itemId !== id);
};
const addMatchingPair = () => {
  if (questionConfig.value.leftItems.length >= 50) return;
  const left = { id: editorId('match_left'), label: t('activityMatching.newLeft') };
  const right = { id: editorId('match_right'), label: t('activityMatching.newRight') };
  questionConfig.value.leftItems.push(left);
  questionConfig.value.rightItems.push(right);
  questionBlock.value!.answerKey.pairs.push({ leftId: left.id, rightId: right.id });
};
const moveMatchingPair = (leftId: string, direction: -1 | 1) => {
  const pairs = questionBlock.value!.answerKey.pairs as Array<{ leftId: string; rightId: string }>;
  const index = pairs.findIndex((pair) => pair.leftId === leftId);
  if (index < 0) return;
  const target = Math.max(0, Math.min(index + direction, pairs.length - 1));
  if (target === index) return;
  const [pair] = pairs.splice(index, 1);
  pairs.splice(target, 0, pair);
};
const removeMatchingPair = (leftId: string) => {
  if (questionConfig.value.leftItems.length <= 1) return;
  const index = questionConfig.value.leftItems.findIndex((item: { id: string }) => item.id === leftId);
  if (index < 0) return;
  const pair = questionBlock.value!.answerKey.pairs.find((item: { leftId: string; rightId: string }) => item.leftId === leftId);
  const rightId = pair?.rightId;
  questionConfig.value.leftItems = questionConfig.value.leftItems.filter((item: { id: string }) => item.id !== leftId);
  questionConfig.value.rightItems = questionConfig.value.rightItems.filter((item: { id: string }) => item.id !== rightId);
  questionBlock.value!.answerKey.pairs = questionBlock.value!.answerKey.pairs.filter((pair: { leftId: string; rightId: string }) => pair.leftId !== leftId && pair.rightId !== rightId);
};
const acceptedAnswers = computed({
  get: () => answerKey.value?.acceptedAnswers?.join('\n') ?? '',
  set: (value: string) => {
    if (questionBlock.value) questionBlock.value.answerKey = {
      ...(questionBlock.value.answerKey ?? {}),
      acceptedAnswers: value.split('\n').map((item) => item.trim()).filter(Boolean),
      feedback: questionBlock.value.answerKey?.feedback ?? ''
    };
  }
});
const setOpenGradingMode = (mode: 'manual' | 'exact' | 'normalized' | 'ungraded') => {
  if (!questionBlock.value || questionBlock.value.questionType !== 'open_answer') return;
  questionConfig.value.gradingMode = mode;
  questionBlock.value.graded = mode !== 'ungraded';
  if (mode === 'ungraded') questionBlock.value.points = 0;
  else if (questionBlock.value.points < 1) questionBlock.value.points = settings.defaultQuestionPoints;
  if (mode === 'exact' || mode === 'normalized') questionBlock.value.answerKey ??= { acceptedAnswers: ['Answer'], feedback: '' };
};
const setWordCloudGradingMode = (mode: 'ungraded' | 'participation') => {
  if (!questionBlock.value || questionBlock.value.questionType !== 'word_cloud') return;
  questionConfig.value.gradingMode = mode;
  questionBlock.value.graded = mode === 'participation';
  questionBlock.value.points = mode === 'participation' ? Math.max(settings.defaultQuestionPoints, questionBlock.value.points) : 0;
};

const settingsPayload = () => ({ ...settings, slug: settings.slug.trim() || undefined });
const draftPayload = () => slides.value.map((slide) => ({
  id: slide.id, title: slide.title, description: slide.description,
  blocks: slide.blocks.map((block) => block.type === 'question'
    ? { ...block, config: Object.fromEntries(Object.entries(block.config).filter(([key]) => key !== 'questionType')) }
    : block)
}));
const hydrateAdminSlides = (input: AdminSlide[]) => normalizePositions(input.map((slide) => ({
  ...slide,
  description: slide.description ?? '',
  blocks: slide.blocks.map((block) => {
    if (block.type !== 'question') return block;
    const fallback = createQuestionBlock(block.questionType);
    if (block.questionType === 'single_choice') {
      block.config = { ...fallback.config, ...block.config } as typeof block.config;
      block.answerKey = { ...fallback.answerKey, ...(block.answerKey ?? {}) };
    } else if (block.questionType === 'multiple_choice') {
      block.config = { ...fallback.config, ...block.config } as typeof block.config;
      block.answerKey = { ...fallback.answerKey, ...(block.answerKey ?? {}) };
    } else if (block.questionType === 'open_answer' || block.questionType === 'word_cloud' || block.questionType === 'ordering' || block.questionType === 'matching' || block.questionType === 'image_labeling') {
      block.config = { ...fallback.config, ...block.config } as typeof block.config;
      if (block.questionType === 'open_answer') block.answerKey = { ...fallback.answerKey, ...(block.answerKey ?? {}) };
      else if (block.questionType === 'word_cloud') block.answerKey = null;
      else block.answerKey = { ...fallback.answerKey, ...(block.answerKey ?? {}) };
    } else if (!block.answerKey) block.answerKey = fallback.answerKey;
    return block;
  })
})));
const assignResponse = (response: ActivityDetailResponse) => {
  activityId.value = response.activity.id;
  Object.assign(settings, response.activity.settings);
  revision.value = response.draft.revision;
  slides.value = response.draft.slides.length ? hydrateAdminSlides(structuredClone(response.draft.slides)) : [createSlide(0)];
  selectedSlideId.value = slides.value.some((slide) => slide.id === selectedSlideId.value) ? selectedSlideId.value : slides.value[0].id;
  publishedVersion.value = response.activity.publishedVersionNumber;
  publicUrl.value = response.activity.publicUrl;
  lifecycleState.value = response.activity.lifecycleState;
};
const load = async () => {
  if (!activityId.value) { savedSnapshot.value = snapshot.value; loading.value = false; return; }
  loading.value = true;
  try {
    const response = await api<ActivityDetailResponse>(`/api/activities/${activityId.value}`);
    assignResponse(response);
    await loadAttempts();
    savedSnapshot.value = snapshot.value;
  } catch (error) { loadError.value = (error as Error).message; }
  finally { loading.value = false; }
};
const save = async () => {
  if (!settings.title.trim()) { activeTab.value = 'general'; pushToast({ tone: 'error', title: t('activitiesEditor.titleRequired') }); return false; }
  saving.value = true;
  let replaceRouteAfterSave = false;
  try {
    if (!activityId.value) {
      const created = await api<ActivityDetailResponse>('/api/activities', { method: 'POST', body: JSON.stringify({ settings: settingsPayload() }) });
      activityId.value = created.activity.id;
      revision.value = created.draft.revision;
      publicUrl.value = created.activity.publicUrl;
      lifecycleState.value = created.activity.lifecycleState;
      replaceRouteAfterSave = true;
    } else {
      const updated = await api<ActivityDetailResponse>(`/api/activities/${activityId.value}`, { method: 'PATCH', body: JSON.stringify({ expectedRevision: revision.value, settings: settingsPayload() }) });
      revision.value = updated.draft.revision;
      Object.assign(settings, updated.activity.settings);
      publicUrl.value = updated.activity.publicUrl;
      lifecycleState.value = updated.activity.lifecycleState;
    }
    const draft = await api<ActivityDetailResponse['draft']>(`/api/activities/${activityId.value}/draft`, { method: 'PUT', body: JSON.stringify({ expectedRevision: revision.value, slides: draftPayload() }) });
    revision.value = draft.revision;
    slides.value = hydrateAdminSlides(structuredClone(draft.slides));
    savedSnapshot.value = snapshot.value;
    if (replaceRouteAfterSave) await router.replace(`/app/activities/${activityId.value}/edit`);
    pushToast({ tone: 'success', title: t('activitiesEditor.saved'), description: settings.title });
    return true;
  } catch (error) {
    pushToast({ tone: 'error', title: t('activitiesEditor.saveFailed'), description: (error as Error).message });
    return false;
  } finally { saving.value = false; }
};
const requestPublish = async () => {
  const errors = validationErrors.value;
  if (errors.length) { activeTab.value = 'content'; pushToast({ tone: 'error', title: t('activitiesEditor.fixValidation'), description: errors[0] }); return; }
  if (dirty.value && !(await save())) return;
  if (!activityId.value) return;
  try {
    publishValidation.value = await api<ActivityPublishValidation>(`/api/activities/${activityId.value}/publish-validation`);
    if (!publishValidation.value.valid) {
      pushToast({ tone: 'error', title: t('activitiesEditor.fixValidation'), description: publishValidation.value.items.find((item) => !item.valid)?.message });
      return;
    }
    publishConfirmation.value = true;
  } catch (error) { pushToast({ tone: 'error', title: t('activitiesEditor.publishFailed'), description: (error as Error).message }); }
};
const publish = async () => {
  if (!activityId.value) return;
  publishing.value = true;
  try {
    const version = await api<PublishedActivityVersion>(`/api/activities/${activityId.value}/publish`, { method: 'POST', body: JSON.stringify({ expectedRevision: revision.value }) });
    publishedVersion.value = version.versionNumber;
    lifecycleState.value = settings.status === 'active' ? 'published' : 'disabled';
    publishConfirmation.value = false;
    pushToast({ tone: 'success', title: t('activitiesEditor.published'), description: `Version ${version.versionNumber}` });
  } catch (error) { pushToast({ tone: 'error', title: t('activitiesEditor.publishFailed'), description: (error as Error).message }); }
  finally { publishing.value = false; }
};
const copyPublicUrl = async () => {
  if (!publicUrl.value) return;
  await navigator.clipboard.writeText(publicUrl.value);
  copiedPublicUrl.value = true;
  if (copiedPublicUrlTimer) window.clearTimeout(copiedPublicUrlTimer);
  copiedPublicUrlTimer = window.setTimeout(() => { copiedPublicUrl.value = false; }, 1_400);
  pushToast({ tone: 'success', title: t('activitiesPublishing.linkCopied'), description: publicUrl.value });
};
const openPreview = async () => {
  const previewWindow = window.open('about:blank', '_blank');
  if (previewWindow) previewWindow.opener = null;
  if ((!activityId.value || dirty.value) && !(await save())) { previewWindow?.close(); return; }
  if (!activityId.value) { previewWindow?.close(); return; }
  const url = `/app/activities/${activityId.value}/preview`;
  if (previewWindow) previewWindow.location.href = url;
  else window.open(url, '_blank', 'noopener,noreferrer');
};
const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty.value) { event.preventDefault(); event.returnValue = ''; } };
const onKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return;
  if (selectedAttemptDetail.value) selectedAttemptDetail.value = null;
  else if (dialog.value) dialog.value = null;
  else if (publishConfirmation.value && !publishing.value) publishConfirmation.value = false;
  else if (blockPicker.value) closeBlockPicker();
  else if (blockMenu.value) closeBlockMenu();
  else if (selectedBlockId.value) selectedBlockId.value = '';
};
onBeforeRouteLeave(() => !dirty.value || window.confirm(t('activitiesEditor.leaveConfirm')));
onMounted(() => { window.addEventListener('beforeunload', beforeUnload); document.addEventListener('keydown', onKeydown); document.addEventListener('pointerdown', onDocumentPointerDown); void load(); });
onBeforeUnmount(() => { if (slideDragSession) finishSlideDrag(false); if (blockDragSession) finishBlockDrag(false); if (copiedPublicUrlTimer) window.clearTimeout(copiedPublicUrlTimer); window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('keydown', onKeydown); document.removeEventListener('pointerdown', onDocumentPointerDown); });
</script>

<template>
  <div v-if="loading" class="panel py-20 text-center text-[var(--ui-text-muted)]">{{ t('activitiesEditor.loading') }}</div>
  <div v-else-if="loadError" class="panel p-10 text-center"><h2 class="text-xl font-semibold">{{ t('activitiesEditor.unavailable') }}</h2><p class="mt-2 text-sm text-[var(--ui-text-muted)]">{{ loadError }}</p><button class="btn-secondary mt-5" @click="router.push('/app/live')">{{ t('activitiesEditor.back') }}</button></div>
  <div v-else class="space-y-4">
    <section class="panel flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><h2 class="truncate text-xl font-semibold">{{ activityId ? t('activitiesEditor.editActivity') : t('activitiesEditor.createActivity') }}</h2><span v-if="dirty" class="rounded-full bg-[var(--ui-pill-bg)] px-2.5 py-1 text-xs text-[var(--ui-text-muted)]">{{ t('activitiesEditor.unsaved') }}</span><span class="rounded-full bg-[var(--ui-pill-bg)] px-2.5 py-1 text-xs font-medium text-[var(--ui-text-muted)]">{{ t(`activitiesPublishing.lifecycle.${lifecycleState}`) }}</span><span v-if="publishedVersion" class="rounded-full bg-[var(--ui-accent-soft)] px-2.5 py-1 text-xs text-[var(--ui-accent)]">v{{ publishedVersion }}</span></div><a v-if="publicUrl" :href="publicUrl" target="_blank" rel="noopener noreferrer" class="mt-1 block truncate text-sm text-[var(--ui-text-muted)] hover:text-[var(--ui-accent)]">{{ publicUrl.replace(/^https?:\/\//, '') }}</a><p v-else class="mt-1 text-sm text-[var(--ui-text-muted)]">{{ t('activitiesEditor.draftDescription') }}</p></div>
      <div class="flex flex-wrap items-center gap-2"><template v-if="publicUrl"><button class="icon-button h-10 w-10" :aria-label="copiedPublicUrl ? t('common.copied') : t('activitiesPublishing.copyLink')" :title="copiedPublicUrl ? t('common.copied') : t('activitiesPublishing.copyLink')" @click="copyPublicUrl"><svg v-if="!copiedPublicUrl" xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg></button><QrCodePopover :url="publicUrl" :slug="settings.slug" :instance-id="activityId" /></template><button class="icon-button h-10 w-10 disabled:cursor-not-allowed disabled:opacity-40" :disabled="saving" :aria-label="t('activitiesEditor.preview')" :title="t('activitiesEditor.preview')" @click="openPreview"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 48 48"><path d="M0 0h48v48H0z" fill="none"/><defs><mask id="activity-preview-eye"><g fill="none" stroke-linejoin="round" stroke-width="4"><path fill="#fff" stroke="#fff" d="M24 36c11.046 0 20-12 20-12s-8.954-12-20-12S4 24 4 24s8.954 12 20 12Z"/><path fill="#000" stroke="#000" d="M24 29a5 5 0 1 0 0-10a5 5 0 0 0 0 10Z"/></g></mask></defs><path fill="currentColor" d="M0 0h48v48H0z" mask="url(#activity-preview-eye)"/></svg></button><button class="btn-secondary h-10 disabled:cursor-not-allowed disabled:opacity-40" :disabled="saving || !dirty" @click="save">{{ saving ? t('common.saving') : t('common.save') }}</button><button class="btn-primary h-10 disabled:cursor-not-allowed disabled:opacity-40" :disabled="publishing || saving" @click="requestPublish">{{ publishing ? t('activitiesEditor.publishing') : publishedVersion ? t('activitiesPublishing.republish') : t('activitiesEditor.publish') }}</button></div>
    </section>

    <div class="min-w-0">
      <section class="panel min-w-0 p-4 sm:p-6">
        <div class="flex gap-1 overflow-x-auto border-b border-[var(--ui-border)]" role="tablist" :aria-label="t('activitiesEditor.tabs')"><button v-for="tab in tabs" :key="tab" class="rounded-t-xl px-4 py-3 text-sm font-medium capitalize" :class="activeTab === tab ? 'bg-[var(--ui-accent-soft)] text-[var(--ui-accent)]' : 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'" role="tab" :aria-selected="activeTab === tab" @click="activeTab = tab">{{ tab === 'results' ? t('activityResults.title') : t(`activitiesEditor.${tab}`) }}</button></div>

        <div v-if="activeTab === 'general'" class="mt-6 grid gap-5 sm:grid-cols-2">
          <label class="sm:col-span-2"><span class="label">{{ t('activitiesEditor.title') }}</span><input v-model="settings.title" class="input mt-2" maxlength="120" /></label>
          <label class="sm:col-span-2"><span class="label">{{ t('activitiesEditor.description') }}</span><textarea v-model="settings.description" class="input mt-2 min-h-28" maxlength="1000"></textarea></label>
          <label><span class="label">{{ t('activitiesEditor.slug') }}</span><input v-model="settings.slug" class="input mt-2" maxlength="128" :placeholder="t('activitiesEditor.randomSlug')" /></label>
          <label><span class="label">{{ t('activitiesEditor.status') }}</span><select v-model="settings.status" class="input mt-2"><option value="closed">{{ t('common.closed') }}</option><option value="active">{{ t('common.active') }}</option></select></label>
        </div>

        <div v-else-if="activeTab === 'content'" class="mt-5 grid min-h-[620px] gap-4 xl:h-[calc(100dvh-18rem)] xl:grid-cols-[240px_minmax(0,1fr)]">
          <aside class="flex min-h-0 flex-col rounded-3xl border border-[var(--ui-border)] bg-[var(--ui-panel-muted)] p-3">
            <div class="flex items-center justify-between"><h3 class="font-semibold">{{ t('activitiesEditor.slides') }}</h3><button class="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--ui-accent)] text-white" :aria-label="t('activitiesEditor.addSlide')" @click="addSlide"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2.25" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button></div>
            <div ref="slideList" class="app-scrollbar mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
              <article v-for="(slide, index) in editorSlides" :key="slide.id" :data-slide-id="slide.id" :data-activity-slide-id="slide.id" tabindex="0" class="activity-slide-card group rounded-2xl border p-3 transition-colors" :class="draggedSlideId === slide.id ? 'activity-slide-placeholder' : selectedSlideId === slide.id ? 'border-[var(--ui-accent)] bg-[var(--ui-panel)]' : 'border-[var(--ui-border)] hover:border-[var(--ui-accent)]'" @click="selectSlideFromCard(slide.id)" @keydown.alt.up.prevent="moveSlide(slide.id, -1)" @keydown.alt.down.prevent="moveSlide(slide.id, 1)">
                <div class="flex items-start gap-2"><button type="button" class="activity-drag-handle mt-0.5 flex h-7 w-7 shrink-0 touch-none items-center justify-center rounded text-[var(--ui-text-muted)]" :data-activity-slide-drag-handle="slide.id" :aria-label="t('activityEditorEnhancements.moveBlock')" @click.stop @pointerdown="startSlideDrag($event, slide.id)" @keydown.up.prevent="moveSlide(slide.id, -1)" @keydown.down.prevent="moveSlide(slide.id, 1)"><span aria-hidden="true">⠿</span></button><div class="min-w-0 flex-1"><p class="truncate text-sm font-semibold">{{ index + 1 }}. {{ slide.title || t('activitiesEditor.untitledSlide') }}</p><p class="mt-1 truncate text-xs text-[var(--ui-text-muted)]">{{ slideQuestion(slide) ? `${questionLabels[slideQuestion(slide)!.questionType]} · ${formatActivityNumber(slideQuestion(slide)!.points)} pt` : t('activitiesEditor.contentSlide') }}</p></div></div>
                <div class="mt-2 flex justify-end gap-1 opacity-70 group-hover:opacity-100"><button class="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[var(--ui-panel-muted)] disabled:opacity-30" :disabled="index === 0" :aria-label="t('activitiesEditor.moveUp')" @click.stop="moveSlide(slide.id, -1)"><ActivityMoveArrow direction="up" /></button><button class="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[var(--ui-panel-muted)] disabled:opacity-30" :disabled="index === slides.length - 1" :aria-label="t('activitiesEditor.moveDown')" @click.stop="moveSlide(slide.id, 1)"><ActivityMoveArrow direction="down" /></button><button class="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[var(--ui-panel-muted)]" :aria-label="t('activitiesEditor.duplicate')" @click.stop="copySlide(slide)"><svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0h24v24H0z" fill="none"/><path fill="currentColor" d="M11 10H9v3H6v2h3v3h2v-3h3v-2h-3z"/><path fill="currentColor" d="M4 22h12c1.103 0 2-.897 2-2V8c0-1.103-.897-2-2-2H4c-1.103 0-2 .897-2 2v12c0 1.103.897 2 2 2M4 8h12l.002 12H4z"/><path fill="currentColor" d="M20 2H8v2h12v12h2V4c0-1.103-.897-2-2-2"/></svg></button><button class="flex h-8 w-8 items-center justify-center rounded-lg text-red-500 hover:bg-red-500/10" :aria-label="t('common.delete')" @click.stop="dialog = { kind: 'delete-slide', id: slide.id }"><svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 512 512" aria-hidden="true"><path d="M0 0h512v512H0z" fill="none"/><rect width="448" height="80" x="32" y="48" fill="currentColor" rx="32" ry="32"/><path fill="currentColor" d="M74.45 160a8 8 0 0 0-8 8.83l26.31 252.56a1.5 1.5 0 0 0 0 .22A48 48 0 0 0 140.45 464h231.09a48 48 0 0 0 47.67-42.39v-.21l26.27-252.57a8 8 0 0 0-8-8.83Zm248.86 180.69a16 16 0 1 1-22.63 22.62L256 318.63l-44.69 44.68a16 16 0 0 1-22.63-22.62L233.37 296l-44.69-44.69a16 16 0 0 1 22.63-22.62L256 273.37l44.68-44.68a16 16 0 0 1 22.63 22.62L278.62 296Z"/></svg></button></div>
              </article>
            </div>
          </aside>

          <div v-if="selectedSlide" class="min-w-0 space-y-4">
            <div class="grid gap-3 sm:grid-cols-2"><label><span class="label">{{ t('activitiesEditor.slideTitle') }}</span><input v-model="selectedSlide.title" class="input mt-2" maxlength="200" /></label><label><span class="label">{{ t('activitiesEditor.slideDescription') }}</span><input v-model="selectedSlide.description" class="input mt-2" maxlength="1000" /></label></div>
            <div ref="blockList" class="app-scrollbar max-h-[min(58vh,680px)] space-y-2 overflow-y-auto pr-1" aria-live="polite">
              <template v-for="(block, index) in editorBlocks" :key="block.id">
                <article :data-activity-block-id="block.id" class="activity-block-card rounded-2xl border bg-[var(--ui-panel)] p-3" :class="draggedBlockId === block.id ? 'activity-block-placeholder' : ''" :style="{ '--activity-block-accent': blockAccent(block) }" @click="openBlockEditor(block.id)">
                  <div class="flex items-center gap-3">
                    <button type="button" class="activity-drag-handle flex h-10 w-7 shrink-0 touch-none items-center justify-center rounded-lg text-[var(--ui-text-muted)]" :data-activity-drag-handle="block.id" :aria-label="t('activityEditorEnhancements.moveBlock')" @click.stop @pointerdown="startBlockDrag($event, block.id)" @keydown.up.prevent="moveBlock(block.id, -1)" @keydown.down.prevent="moveBlock(block.id, 1)"><span aria-hidden="true">⠿</span></button>
                    <span class="activity-block-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"><ActivityBlockIcon class="h-5 w-5" :type="block.type === 'question' ? block.questionType : block.type" /></span>
                    <div class="min-w-0 flex-1"><p class="text-sm font-semibold">{{ blockLabel(block) }}</p><p class="truncate text-xs text-[var(--ui-text-muted)]">{{ blockSummary(block) }}</p></div>
                    <button type="button" class="btn-secondary px-3 py-2 text-sm" @click.stop="openBlockEditor(block.id)">{{ t('common.edit') }}</button>
                    <button type="button" data-activity-block-menu-trigger class="flex h-9 w-9 items-center justify-center rounded-xl text-lg text-[var(--ui-text-muted)] hover:bg-[var(--ui-panel-muted)]" :aria-label="t('common.actions')" @click.stop="openBlockMenu($event, block.id)">⋯</button>
                  </div>
                </article>
                <div v-if="index < editorBlocks.length - 1" class="group flex h-5 items-center justify-center"><button type="button" data-activity-add-block class="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--ui-border)] bg-[var(--ui-panel)] text-sm text-[var(--ui-accent)] opacity-0 transition group-hover:opacity-100 focus:opacity-100 max-md:opacity-100" :aria-label="t('activitiesEditor.addBlock')" @click="openBlockPicker($event, index + 1)">+</button></div>
              </template>
              <div v-if="!editorBlocks.length" class="rounded-2xl border border-dashed border-[var(--ui-border)] p-8 text-center"><p class="text-sm text-[var(--ui-text-muted)]">{{ t('activitiesEditor.noBlocks') }}</p><button type="button" data-activity-add-block class="btn-primary mt-4" @click="openBlockPicker($event, 0)">+ {{ t('activityEditorEnhancements.addFirstBlock') }}</button></div>
            </div>
            <button v-if="editorBlocks.length" type="button" data-activity-add-block class="btn-secondary w-full justify-center" @click="openBlockPicker($event, editorBlocks.length)">+ {{ t('activitiesEditor.addBlock') }}</button>

            <Teleport to="body">
            <div v-if="selectedBlock" class="fixed inset-0 z-[130] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" :aria-label="t('activitiesEditor.editBlock', { type: blockLabel(selectedBlock) })">
              <section class="panel max-h-[min(92dvh,980px)] w-full max-w-6xl overflow-hidden p-0">
              <div class="flex items-center justify-between border-b border-[var(--ui-border)] px-5 py-4"><div><h3 class="font-semibold">{{ t('activitiesEditor.editBlock', { type: blockLabel(selectedBlock) }) }}</h3><span v-if="questionBlock" class="text-xs text-[var(--ui-text-muted)]">{{ t('activitiesEditor.answerKeyPrivate') }}</span></div><button type="button" class="btn-secondary" @click="selectedBlockId = ''">{{ t('common.close') }}</button></div>
              <div class="app-scrollbar max-h-[calc(min(92dvh,980px)-74px)] overflow-y-auto p-5 sm:p-6">
              <template v-if="selectedBlock.type === 'heading'"><label><span class="label">Text</span><input v-model="selectedBlock.config.text" class="input mt-2" /></label><label class="mt-3 block"><span class="label">Level</span><select v-model="selectedBlock.config.level" class="input mt-2"><option :value="1">H1</option><option :value="2">H2</option><option :value="3">H3</option></select></label></template>
              <label v-else-if="selectedBlock.type === 'text'"><span class="label">Text</span><textarea v-model="selectedBlock.config.text" class="input mt-2 min-h-32"></textarea></label>
              <template v-else-if="selectedBlock.type === 'image'"><label><span class="label">HTTPS URL</span><input v-model="selectedBlock.config.url" class="input mt-2" /></label><label class="mt-3 block"><span class="label">Alt text</span><input v-model="selectedBlock.config.alt" class="input mt-2" /></label><label class="mt-3 block"><span class="label">Caption</span><input v-model="selectedBlock.config.caption" class="input mt-2" /></label></template>
              <label v-else-if="selectedBlock.type === 'divider'"><span class="label">Style</span><select v-model="selectedBlock.config.style" class="input mt-2"><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label>
              <template v-else-if="questionBlock">
                <div class="grid gap-3 sm:grid-cols-3"><label class="sm:col-span-2"><span class="label">{{ questionBlock.questionType === 'single_choice' || questionBlock.questionType === 'multiple_choice' ? t('activityChoices.title') : t('activitiesEditor.prompt') }}</span><textarea v-model="questionConfig.prompt" class="input mt-2 min-h-24" maxlength="1000"></textarea></label><div class="space-y-3 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-panel)] p-3"><p class="text-xs font-semibold uppercase tracking-wide text-[var(--ui-text-muted)]">{{ t('activityEditorEnhancements.scoring') }}</p><label><span class="label">{{ t('activitiesEditor.points') }}</span><input v-model.number="questionBlock.points" type="number" min="0" max="1000" class="input mt-2" :disabled="!settings.gradingEnabled || !questionBlock.graded || questionBlock.questionType === 'open_answer' && questionConfig.gradingMode === 'ungraded' || questionBlock.questionType === 'word_cloud' && questionConfig.gradingMode === 'ungraded'" /></label><label v-if="questionBlock.questionType !== 'open_answer' && questionBlock.questionType !== 'word_cloud'" class="flex items-center gap-2 text-sm"><input v-model="questionBlock.graded" type="checkbox" :disabled="!settings.gradingEnabled" />{{ t('activitiesEditor.graded') }}</label><p v-if="!settings.gradingEnabled" class="text-xs text-[var(--ui-text-muted)]">{{ t('activityEditorEnhancements.gradingDisabledHint') }}</p><label class="flex items-center gap-2 text-sm"><input v-model="questionBlock.required" type="checkbox" />{{ t('activitiesEditor.required') }}</label></div></div>
                <template v-if="questionBlock.questionType === 'single_choice' || questionBlock.questionType === 'multiple_choice'">
                  <label class="mt-4 block"><span class="label">{{ t('activityChoices.description') }}</span><textarea v-model="questionConfig.description" class="input mt-2 min-h-20" maxlength="2000"></textarea></label>
                  <div class="mt-4 space-y-2">
                    <div v-for="(option, optionIndex) in questionConfig.options" :key="option.id" class="flex items-center gap-2 rounded-2xl border p-2 transition-colors" :class="(questionBlock.questionType === 'single_choice' ? answerKey.correctOptionId === option.id : answerKey.correctOptionIds.includes(option.id)) ? 'border-[var(--ui-accent)] bg-[var(--ui-accent-soft)]' : 'border-[var(--ui-border)] bg-[var(--ui-panel)]'">
                      <label class="flex shrink-0 cursor-pointer items-center gap-2 rounded-xl px-2 py-1 text-xs font-medium" :title="t('activitiesEditor.correctAnswer')"><input v-if="questionBlock.questionType === 'single_choice'" v-model="answerKey.correctOptionId" type="radio" :value="option.id" :name="`${questionBlock.id}-correct`" :disabled="!settings.gradingEnabled || !questionBlock.graded" /><input v-else type="checkbox" :checked="answerKey.correctOptionIds.includes(option.id)" :disabled="!settings.gradingEnabled || !questionBlock.graded" @change="answerKey.correctOptionIds = ($event.target as HTMLInputElement).checked ? [...answerKey.correctOptionIds, option.id] : answerKey.correctOptionIds.filter((id: string) => id !== option.id)" /><span class="hidden sm:inline">{{ t('activitiesEditor.correctAnswer') }}</span></label>
                      <input v-model="option.label" class="input min-w-0 flex-1" maxlength="160" :aria-label="`${t('activityChoices.option')} ${optionIndex + 1}`" />
                      <button type="button" class="rounded-lg px-2 py-1 disabled:opacity-30" :disabled="optionIndex === 0" :aria-label="t('activityChoices.moveOptionUp')" @click="moveChoice(questionConfig.options, option.id, -1)">↑</button>
                      <button type="button" class="rounded-lg px-2 py-1 disabled:opacity-30" :disabled="optionIndex === questionConfig.options.length - 1" :aria-label="t('activityChoices.moveOptionDown')" @click="moveChoice(questionConfig.options, option.id, 1)">↓</button>
                      <button type="button" class="rounded-lg px-2 py-1 text-red-500 disabled:opacity-30" :disabled="questionConfig.options.length <= 2" :aria-label="t('activityChoices.deleteOption')" @click="removeChoice(questionConfig.options, option.id)">×</button>
                    </div>
                    <div class="flex items-center justify-between gap-3"><button type="button" class="btn-secondary px-3 py-2 text-sm" :disabled="questionConfig.options.length >= 50" @click="addChoice(questionConfig.options)">+ {{ t('activityChoices.addOption') }}</button><span class="text-xs text-[var(--ui-text-muted)]">{{ t('activityChoices.optionLimit') }}</span></div>
                  </div>
                  <label class="mt-4 flex items-center gap-3 rounded-2xl border border-[var(--ui-border)] p-3"><input v-model="questionConfig.shuffleOptions" type="checkbox" /><span class="text-sm">{{ t('activityChoices.shuffle') }}</span></label>
                  <div v-if="questionBlock.questionType === 'multiple_choice'" class="mt-3 grid gap-3 sm:grid-cols-3"><label><span class="label">{{ t('activityChoices.minimum') }}</span><input v-model.number="questionConfig.minimumSelections" type="number" min="1" :max="questionConfig.options.length" class="input mt-2" /></label><label><span class="label">{{ t('activityChoices.maximum') }}</span><input v-model.number="questionConfig.maximumSelections" type="number" min="1" :max="questionConfig.options.length" class="input mt-2" /></label><label><span class="label">{{ t('activityChoices.gradingMode') }}</span><select v-model="questionConfig.gradingMode" class="input mt-2"><option value="all_or_nothing">{{ t('activityChoices.allOrNothing') }}</option><option value="partial">{{ t('activityChoices.partialCredit') }}</option></select></label></div>
                  <p v-if="questionBlock.questionType === 'multiple_choice' && questionConfig.gradingMode === 'partial'" class="mt-2 text-xs leading-5 text-[var(--ui-text-muted)]">{{ t('activityChoices.partialFormula') }}</p>
                  <label v-if="questionBlock.graded" class="mt-4 block"><span class="label">{{ t('activityChoices.feedback') }}</span><textarea v-model="answerKey.feedback" class="input mt-2 min-h-20" maxlength="2000"></textarea><span class="mt-1 block text-xs text-[var(--ui-text-muted)]">{{ t('activityChoices.feedbackHint') }}</span></label>
                </template>
                <template v-else-if="questionBlock.questionType === 'open_answer'">
                  <label class="mt-4 block"><span class="label">{{ t('activityTextQuestions.instructions') }}</span><textarea v-model="questionConfig.instructions" class="input mt-2 min-h-20" maxlength="2000"></textarea></label>
                  <div class="mt-3 grid gap-3 sm:grid-cols-3"><label><span class="label">{{ t('activityTextQuestions.responseMode') }}</span><select v-model="questionConfig.responseMode" class="input mt-2"><option value="single_line">{{ t('activityTextQuestions.singleLine') }}</option><option value="multiline">{{ t('activityTextQuestions.multiline') }}</option></select></label><label><span class="label">{{ t('activityTextQuestions.minimumLength') }}</span><input v-model.number="questionConfig.minimumLength" type="number" min="0" :max="questionConfig.maximumLength" class="input mt-2" /></label><label><span class="label">{{ t('activityTextQuestions.maximumLength') }}</span><input v-model.number="questionConfig.maximumLength" type="number" min="1" max="5000" class="input mt-2" /></label></div>
                  <label class="mt-3 block"><span class="label">{{ t('activityTextQuestions.gradingMode') }}</span><select :value="questionConfig.gradingMode" class="input mt-2" @change="setOpenGradingMode(($event.target as HTMLSelectElement).value as any)"><option value="manual">{{ t('activityTextQuestions.manual') }}</option><option value="exact">{{ t('activityTextQuestions.exact') }}</option><option value="normalized">{{ t('activityTextQuestions.normalized') }}</option><option value="ungraded">{{ t('activityTextQuestions.ungraded') }}</option></select></label>
                  <template v-if="questionConfig.gradingMode === 'exact' || questionConfig.gradingMode === 'normalized'"><label class="mt-3 block"><span class="label">{{ t('activitiesEditor.acceptedAnswers') }}</span><textarea v-model="acceptedAnswers" class="input mt-2 min-h-24"></textarea><span class="mt-1 block text-xs text-[var(--ui-text-muted)]">{{ t('activityTextQuestions.oneVariantPerLine') }}</span></label><div v-if="questionConfig.gradingMode === 'normalized'" class="mt-3 flex flex-wrap gap-4"><label class="flex items-center gap-2 text-sm"><input v-model="questionConfig.ignoreCase" type="checkbox" />{{ t('activityTextQuestions.ignoreCase') }}</label><label class="flex items-center gap-2 text-sm"><input v-model="questionConfig.normalizeWhitespace" type="checkbox" />{{ t('activityTextQuestions.normalizeWhitespace') }}</label></div></template>
                  <label v-if="questionConfig.gradingMode !== 'ungraded'" class="mt-3 block"><span class="label">{{ t('activityChoices.feedback') }}</span><textarea v-model="questionBlock.answerKey.feedback" class="input mt-2 min-h-20" maxlength="2000"></textarea></label>
                </template>
                <template v-else-if="questionBlock.questionType === 'word_cloud'">
                  <label class="mt-4 block"><span class="label">{{ t('activityTextQuestions.instructions') }}</span><textarea v-model="questionConfig.instructions" class="input mt-2 min-h-20" maxlength="2000"></textarea></label>
                  <div class="mt-3 grid gap-3 sm:grid-cols-3"><label><span class="label">{{ t('activityTextQuestions.maximumLength') }}</span><input v-model.number="questionConfig.maximumLength" type="number" min="1" max="500" class="input mt-2" /></label><label><span class="label">{{ t('activityTextQuestions.maximumResponses') }}</span><input v-model.number="questionConfig.maximumResponses" type="number" min="1" max="20" class="input mt-2" :disabled="!questionConfig.allowMultipleResponses" /></label><label><span class="label">{{ t('activityTextQuestions.gradingMode') }}</span><select :value="questionConfig.gradingMode" class="input mt-2" @change="setWordCloudGradingMode(($event.target as HTMLSelectElement).value as any)"><option value="ungraded">{{ t('activityTextQuestions.ungraded') }}</option><option value="participation">{{ t('activityTextQuestions.participation') }}</option></select></label></div>
                  <div class="mt-3 grid gap-3 sm:grid-cols-2"><label class="flex items-center gap-2 text-sm"><input v-model="questionConfig.allowMultipleResponses" type="checkbox" @change="!questionConfig.allowMultipleResponses && (questionConfig.maximumResponses = 1)" />{{ t('activityTextQuestions.allowMultiple') }}</label><label class="flex items-center gap-2 text-sm"><input v-model="questionConfig.showResults" type="checkbox" />{{ t('activityTextQuestions.showResults') }}</label><label class="flex items-center gap-2 text-sm"><input v-model="questionConfig.showParticipantNames" type="checkbox" />{{ t('activityTextQuestions.showNames') }}</label><label><span class="label">{{ t('activityTextQuestions.moderation') }}</span><select v-model="questionConfig.moderationMode" class="input mt-2"><option value="off">{{ t('activityTextQuestions.moderationOff') }}</option><option value="filter_only">{{ t('activityTextQuestions.filterOnly') }}</option><option value="review_all">{{ t('activityTextQuestions.reviewAll') }}</option></select></label></div>
                </template>
                <template v-else-if="questionBlock.questionType === 'ordering'">
                  <div class="mt-4 flex flex-wrap items-center gap-4"><label class="flex items-center gap-2 text-sm"><input v-model="questionConfig.shuffleItems" type="checkbox" />{{ t('activityOrdering.shuffle') }}</label><label><span class="label">{{ t('activityOrdering.gradingMode') }}</span><select v-model="questionConfig.gradingMode" class="input mt-2"><option value="all_or_nothing">{{ t('activityChoices.allOrNothing') }}</option><option value="partial">{{ t('activityChoices.partialCredit') }}</option></select></label></div>
                  <p class="mt-3 text-xs text-[var(--ui-text-muted)]">{{ t('activityOrdering.canonicalHint') }}</p>
                  <div class="mt-3 space-y-2"><div v-for="(item, itemIndex) in orderingEditorItems" :key="item.id" class="flex items-center gap-2 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-panel)] p-2"><span class="w-6 text-center text-sm font-semibold text-[var(--ui-accent)]">{{ itemIndex + 1 }}</span><input v-model="item.label" class="input min-w-0 flex-1" maxlength="160" /><button type="button" class="flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-30" :disabled="itemIndex === 0" :aria-label="t('activityOrdering.moveUp', { item: item.label })" @click="moveOrderingItem(item.id, -1)"><ActivityMoveArrow direction="up" /></button><button type="button" class="flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-30" :disabled="itemIndex === orderingEditorItems.length - 1" :aria-label="t('activityOrdering.moveDown', { item: item.label })" @click="moveOrderingItem(item.id, 1)"><ActivityMoveArrow direction="down" /></button><button type="button" class="rounded-lg px-2 py-1 text-red-500 disabled:opacity-30" :disabled="orderingEditorItems.length <= 2" @click="removeOrderingItem(item.id)">×</button></div><button type="button" class="btn-secondary px-3 py-2 text-sm" :disabled="orderingEditorItems.length >= 50" @click="addOrderingItem">+ {{ t('activityOrdering.addItem') }}</button></div>
                  <label class="mt-4 block"><span class="label">{{ t('activityChoices.feedback') }}</span><textarea v-model="questionBlock.answerKey.feedback" class="input mt-2 min-h-20" maxlength="2000"></textarea></label>
                </template>
                <template v-else-if="questionBlock.questionType === 'matching'">
                  <div class="mt-4 flex flex-wrap gap-4"><label class="flex items-center gap-2 text-sm"><input v-model="questionConfig.shuffleLeftItems" type="checkbox" />{{ t('activityMatching.shuffleLeft') }}</label><label class="flex items-center gap-2 text-sm"><input v-model="questionConfig.shuffleRightItems" type="checkbox" />{{ t('activityMatching.shuffleRight') }}</label><label><span class="label">{{ t('activityMatching.gradingMode') }}</span><select v-model="questionConfig.gradingMode" class="input mt-2"><option value="all_or_nothing">{{ t('activityChoices.allOrNothing') }}</option><option value="partial">{{ t('activityChoices.partialCredit') }}</option></select></label></div>
                  <p class="mt-3 text-xs text-[var(--ui-text-muted)]">{{ t('activityMatching.pairsHint') }}</p>
                  <div class="mt-3 space-y-2"><div v-for="(entry, pairIndex) in matchingEditorPairs" :key="entry.left.id" class="grid items-center gap-2 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-panel)] p-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]"><input v-model="entry.left.label" class="input min-w-0" maxlength="160" :aria-label="t('activityMatching.leftLabel')" /><span class="text-center text-[var(--ui-accent)]">↔</span><input v-model="entry.right.label" class="input min-w-0" maxlength="160" :aria-label="t('activityMatching.rightLabel')" /><div class="flex"><button type="button" class="rounded-lg px-2 py-1 disabled:opacity-30" :disabled="pairIndex === 0" @click="moveMatchingPair(entry.left.id, -1)">↑</button><button type="button" class="rounded-lg px-2 py-1 disabled:opacity-30" :disabled="pairIndex === matchingEditorPairs.length - 1" @click="moveMatchingPair(entry.left.id, 1)">↓</button><button type="button" class="rounded-lg px-2 py-1 text-red-500 disabled:opacity-30" :disabled="matchingEditorPairs.length <= 1" @click="removeMatchingPair(entry.left.id)">×</button></div></div><button type="button" class="btn-secondary px-3 py-2 text-sm" :disabled="matchingEditorPairs.length >= 50" @click="addMatchingPair">+ {{ t('activityMatching.addPair') }}</button></div>
                  <label class="mt-4 block"><span class="label">{{ t('activityChoices.feedback') }}</span><textarea v-model="questionBlock.answerKey.feedback" class="input mt-2 min-h-20" maxlength="2000"></textarea></label>
                </template>
                <ActivityImageLabelingEditor v-else-if="questionBlock.questionType === 'image_labeling'" :config="questionConfig" :answer-key="answerKey" />
              </template>
              </div>
              </section>
            </div>
            </Teleport>
            <ul v-if="validationErrors.length" class="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300"><li v-for="error in validationErrors" :key="error">• {{ error }}</li></ul>
          </div>
        </div>

        <div v-else-if="activeTab === 'design'" class="mt-6 space-y-6">
          <section><h3 class="font-semibold">{{ t('activityDesign.theme') }}</h3><p class="mt-1 text-sm text-[var(--ui-text-muted)]">{{ t('activityDesign.themeHint') }}</p><div class="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><button v-for="theme in activityThemes" :key="theme.value" type="button" class="rounded-2xl border p-4 text-left transition" :class="settings.theme === theme.value ? 'border-[var(--ui-accent)] ring-2 ring-[var(--ui-accent)]/20' : 'border-[var(--ui-border)] hover:border-[var(--ui-accent)]'" @click="settings.theme = theme.value"><span class="flex gap-1"><span v-for="color in theme.colors" :key="color" class="h-8 flex-1 rounded-lg" :style="{ background: color }"></span></span><span class="mt-3 block text-sm font-semibold">{{ theme.label }}</span></button></div></section>
          <section><h3 class="font-semibold">{{ t('activityDesign.layout') }}</h3><p class="mt-1 text-sm text-[var(--ui-text-muted)]">{{ t('activityDesign.layoutHint') }}</p><div class="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><button v-for="layout in activityLayouts" :key="layout.value" type="button" class="rounded-2xl border p-4 text-left transition" :class="settings.layout === layout.value ? 'border-[var(--ui-accent)] ring-2 ring-[var(--ui-accent)]/20' : 'border-[var(--ui-border)] hover:border-[var(--ui-accent)]'" @click="settings.layout = layout.value"><span class="block h-16 border border-[var(--ui-border)] bg-[var(--ui-panel-muted)]" :class="layout.sample"></span><span class="mt-3 block text-sm font-semibold">{{ layout.label }}</span></button></div></section>
          <section><h3 class="font-semibold">{{ t('pages.backgroundPattern') }}</h3><p class="mt-1 text-sm text-[var(--ui-text-muted)]">{{ t('pages.backgroundPatternDescription') }}</p><div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3"><button v-for="pattern in activityPatterns" :key="pattern.value" type="button" class="rounded-2xl border p-3 text-left transition" :class="settings.backgroundPattern === pattern.value ? 'border-[var(--ui-accent)] ring-2 ring-[var(--ui-accent)]/20' : 'border-[var(--ui-border)] hover:border-[var(--ui-accent)]'" @click="settings.backgroundPattern = pattern.value"><span class="pattern-swatch block h-14 overflow-hidden rounded-xl bg-[var(--ui-panel-muted)]" :class="`pattern-swatch-${pattern.value}`"></span><span class="mt-2 block text-sm font-semibold">{{ t(pattern.labelKey) }}</span></button></div><label class="mt-5 block"><span class="flex items-center justify-between text-sm font-medium"><span>{{ t('pages.patternIntensity') }}</span><span>{{ settings.patternIntensity }}%</span></span><input v-model.number="settings.patternIntensity" class="mt-3 w-full accent-[var(--ui-accent)]" type="range" min="0" max="100" step="5" :disabled="settings.backgroundPattern === 'none'" /></label></section>
        </div>

        <div v-else class="mt-6 grid gap-5 sm:grid-cols-2">
          <template v-if="activeTab === 'settings'">
          <label><span class="label">{{ t('activitiesEditor.identity') }}</span><select v-model="settings.identityMode" class="input mt-2"><option value="anonymous">Anonymous</option><option value="named">Named</option></select></label>
          <label><span class="label">{{ t('activitiesEditor.navigation') }}</span><select v-model="settings.navigationPolicy" class="input mt-2"><option value="linear">Linear</option><option value="free">Free navigation</option></select></label>
          <label><span class="label">{{ t('activitiesEditor.answers') }}</span><select v-model="settings.requiredAnswerBehavior" class="input mt-2"><option value="require_all">Require all</option><option value="allow_incomplete">Allow incomplete</option></select></label>
          <label><span class="label">{{ t('activitiesEditor.results') }}</span><select v-model="settings.resultVisibility" class="input mt-2"><option value="never">{{ t('activitiesEditor.resultsNever') }}</option><option value="after_submission">{{ t('activitiesEditor.resultsAfterSubmission') }}</option><option value="after_close">{{ t('activitiesEditor.resultsAfterClose') }}</option></select></label>
          <label><span class="label">{{ t('activitiesEditor.feedbackPolicy') }}</span><select v-model="settings.feedbackPolicy" class="input mt-2"><option value="none">{{ t('activitiesEditor.feedbackNone') }}</option><option value="total_points">{{ t('activitiesEditor.feedbackTotal') }}</option><option value="points_per_question">{{ t('activitiesEditor.feedbackPerQuestion') }}</option><option value="correct_answers">{{ t('activitiesEditor.feedbackCorrectAnswers') }}</option><option value="manual_release">{{ t('activitiesEditor.feedbackManualRelease') }}</option></select></label>
          <div class="rounded-2xl border border-[var(--ui-border)] p-4"><label class="flex items-center gap-3 text-sm font-medium"><input v-model="settings.gradingEnabled" type="checkbox" />{{ t('activityEditorEnhancements.enableGrading') }}</label><p class="mt-2 text-xs leading-5 text-[var(--ui-text-muted)]">{{ t('activityEditorEnhancements.enableGradingHint') }}</p></div>
          <label><span class="label">{{ t('activityEditorEnhancements.defaultQuestionPoints') }}</span><input v-model.number="settings.defaultQuestionPoints" class="input mt-2" type="number" min="1" max="1000" /><span class="mt-1 block text-xs text-[var(--ui-text-muted)]">{{ t('activityEditorEnhancements.defaultQuestionPointsHint') }}</span></label>
          <label><span class="label">{{ t('activitiesEditor.maximumAttempts') }}</span><input v-model.number="settings.maximumAttempts" class="input mt-2" type="number" min="1" max="100" /></label>
          <div class="rounded-2xl border border-[var(--ui-border)] p-4"><label class="flex items-center gap-3 text-sm font-medium"><input type="checkbox" :checked="settings.attemptTimeLimitSeconds !== null" @change="toggleTimeLimit(($event.target as HTMLInputElement).checked)" />{{ t('activitiesEditor.enableTimeLimit') }}</label><label v-if="settings.attemptTimeLimitSeconds !== null" class="mt-3 block"><span class="label">{{ t('activitiesEditor.durationMinutes') }}</span><input v-model.number="timeLimitMinutes" class="input mt-2" type="number" min="1" max="10080" /></label></div>
          <div class="rounded-2xl border border-[var(--ui-border)] p-4"><label class="flex items-center gap-3 text-sm font-medium"><input type="checkbox" :checked="settings.lowTimeWarningSeconds !== null" @change="toggleLowTimeWarning(($event.target as HTMLInputElement).checked)" />{{ t('activitiesEditor.enableWarning') }}</label><label v-if="settings.lowTimeWarningSeconds !== null" class="mt-3 block"><span class="label">{{ t('activitiesEditor.warningMinutes') }}</span><input v-model.number="warningMinutes" class="input mt-2" type="number" min="1" max="60" /></label></div>
          <div class="space-y-3 rounded-2xl border border-[var(--ui-border)] p-4 sm:col-span-2"><label class="flex items-center gap-3 text-sm font-medium"><input type="checkbox" :checked="settings.availabilityStartAt !== null" @change="toggleAvailability(($event.target as HTMLInputElement).checked)" />{{ t('activitiesPublishing.enableAvailability') }}</label><label v-if="settings.availabilityStartAt !== null"><span class="label">{{ t('activitiesPublishing.availabilityStart') }}</span><input :value="availabilityLocalValue" class="input mt-2" type="datetime-local" @change="setAvailabilityLocal(($event.target as HTMLInputElement).value)" /></label></div>
          <div class="space-y-3 rounded-2xl border border-[var(--ui-border)] p-4 sm:col-span-2"><label class="flex items-center gap-3 text-sm font-medium"><input type="checkbox" :checked="settings.submissionDeadlineAt !== null" @change="toggleGlobalDeadline(($event.target as HTMLInputElement).checked)" />{{ t('activitiesEditor.enableGlobalDeadline') }}</label><template v-if="settings.submissionDeadlineAt !== null"><div class="grid gap-3 sm:grid-cols-2"><label><span class="label">{{ t('activitiesEditor.deadline') }}</span><input :value="deadlineLocalValue" class="input mt-2" type="datetime-local" @change="setDeadlineLocal(($event.target as HTMLInputElement).value)" /></label><label><span class="label">{{ t('activitiesEditor.timezone') }}</span><input v-model.trim="settings.submissionDeadlineTimezone" class="input mt-2" list="activity-timezones" maxlength="100" /><datalist id="activity-timezones"><option value="Europe/Riga" /><option value="UTC" /><option value="Europe/London" /><option value="America/New_York" /><option value="Asia/Tokyo" /></datalist></label></div><p class="text-xs text-[var(--ui-text-muted)]">{{ t('activitiesEditor.utcStorage', { value: settings.submissionDeadlineAt }) }}</p></template></div>
          <div class="rounded-2xl bg-[var(--ui-panel-muted)] p-4 text-sm sm:col-span-2"><strong>{{ t('activitiesEditor.effectiveBehavior') }}</strong><p class="mt-1 leading-6 text-[var(--ui-text-muted)]">{{ deadlinePreview }}</p><p class="mt-1 text-xs text-[var(--ui-text-muted)]">{{ t('activitiesEditor.earlierWins') }}</p></div>
          <label class="sm:col-span-2 flex items-center gap-3 rounded-2xl border border-[var(--ui-border)] p-4"><input v-model="settings.shuffleQuestionOptions" type="checkbox" /><span>{{ t('activitiesEditor.shuffleOptions') }}</span></label>
          <label class="flex items-center gap-3 rounded-2xl border border-[var(--ui-border)] p-4"><input v-model="settings.shuffleSlides" type="checkbox" /><span>{{ t('activityNavigation.shuffleSlides') }}</span></label>
          <label class="flex items-center gap-3 rounded-2xl border border-[var(--ui-border)] p-4"><input v-model="settings.allowBackNavigation" type="checkbox" /><span>{{ t('activityNavigation.allowBackNavigation') }}</span></label>
          </template>
          <section v-if="activeTab === 'results' && activityId && activityResults" class="space-y-4 sm:col-span-2">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 class="font-semibold">{{ t('activityResults.title') }}</h3><p class="text-xs text-[var(--ui-text-muted)]">{{ t('activityResults.description') }}</p></div><div class="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap"><a class="btn-secondary justify-center px-3 py-2 text-center text-sm" :href="attemptExportUrl">{{ t('activityResults.exportAttempts') }}</a><a class="btn-secondary justify-center px-3 py-2 text-center text-sm" :href="responseExportUrl">{{ t('activityResults.exportResponses') }}</a><a class="btn-secondary justify-center px-3 py-2 text-center text-sm" :href="responseXlsxExportUrl">{{ t('activityResults.exportResponsesXlsx') }}</a></div></div>
            <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><article v-for="metric in [
              [t('activityResults.totalAttempts'), activityResults.overview.totalAttempts],
              [t('activityResults.submitted'), activityResults.overview.submittedAttempts],
              [t('activityResults.expired'), activityResults.overview.expiredAttempts],
              [t('activityResults.awaiting'), activityResults.overview.awaitingManualGrading],
              [t('activityResults.averageScore'), formatActivityNumber(activityResults.overview.averageScore)],
              [t('activityResults.medianScore'), formatActivityNumber(activityResults.overview.medianScore)],
              [t('activityResults.averagePercent'), activityResults.overview.averagePercentage === null ? '—' : formatPercent(activityResults.overview.averagePercentage)],
              [t('activityResults.completion'), formatPercent(activityResults.overview.completionRate)]
            ]" :key="String(metric[0])" class="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-panel-muted)] p-4"><p class="text-xs text-[var(--ui-text-muted)]">{{ metric[0] }}</p><p class="mt-2 text-xl font-semibold">{{ metric[1] }}</p></article></div>
            <div v-if="activityResults.questions.length" class="space-y-2 sm:hidden"><article v-for="question in activityResults.questions" :key="question.questionId" class="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-panel-muted)] p-4"><strong class="break-words text-sm">{{ question.prompt }}</strong><p class="mt-1 text-xs text-[var(--ui-text-muted)]">{{ t(`activityQuestionTypes.${question.questionType}`) }}</p><dl class="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt class="text-xs text-[var(--ui-text-muted)]">{{ t('activityResults.answered') }}</dt><dd class="mt-1 font-semibold">{{ question.answered }}</dd></div><div><dt class="text-xs text-[var(--ui-text-muted)]">{{ t('activityResults.unanswered') }}</dt><dd class="mt-1 font-semibold">{{ question.unanswered }}</dd></div><div><dt class="text-xs text-[var(--ui-text-muted)]">{{ t('activityResults.correctness') }}</dt><dd class="mt-1 font-semibold">{{ formatPercent(question.correctnessRate) }}</dd></div><div><dt class="text-xs text-[var(--ui-text-muted)]">{{ t('activityResults.averageAward') }}</dt><dd class="mt-1 font-semibold">{{ formatActivityNumber(question.averageAwardedPoints) }} / {{ formatActivityNumber(question.maximumPoints) }}</dd></div></dl></article></div>
            <div v-if="activityResults.questions.length" class="hidden overflow-x-auto rounded-2xl border border-[var(--ui-border)] sm:block"><table class="w-full min-w-[760px] text-left text-sm"><thead class="bg-[var(--ui-panel-muted)] text-xs text-[var(--ui-text-muted)]"><tr><th class="p-3">{{ t('activityResults.question') }}</th><th class="p-3">{{ t('activityResults.answered') }}</th><th class="p-3">{{ t('activityResults.unanswered') }}</th><th class="p-3">{{ t('activityResults.correct') }}</th><th class="p-3">{{ t('activityResults.correctness') }}</th><th class="p-3">{{ t('activityResults.averageAward') }}</th></tr></thead><tbody><tr v-for="question in activityResults.questions" :key="question.questionId" class="border-t border-[var(--ui-border)]"><td class="p-3"><strong>{{ question.prompt }}</strong><p class="text-xs text-[var(--ui-text-muted)]">{{ t(`activityQuestionTypes.${question.questionType}`) }}</p></td><td class="p-3">{{ question.answered }}</td><td class="p-3">{{ question.unanswered }}</td><td class="p-3">{{ question.fullyCorrect }}</td><td class="p-3">{{ formatPercent(question.correctnessRate) }}</td><td class="p-3">{{ formatActivityNumber(question.averageAwardedPoints) }} / {{ formatActivityNumber(question.maximumPoints) }}</td></tr></tbody></table></div>
            <div v-if="activityResults.wordClouds.length" class="grid gap-3 xl:grid-cols-2"><article v-for="cloud in activityResults.wordClouds" :key="cloud.questionId" class="rounded-2xl border border-[var(--ui-border)] p-4"><div class="flex items-start justify-between gap-3"><div><h4 class="font-semibold">{{ cloud.prompt }}</h4><p class="text-xs text-[var(--ui-text-muted)]">{{ t('activityResults.wordCloudSummary', { total: cloud.totalResponses, unique: cloud.uniqueResponses }) }}</p></div></div><div class="mt-3 flex flex-wrap gap-2"><span v-for="item in cloud.items" :key="item.text" class="rounded-full bg-[var(--ui-accent-soft)] px-3 py-1 text-sm text-[var(--ui-accent)]">{{ item.text }} · {{ item.count }}</span></div></article></div>
            <div class="grid gap-2 rounded-2xl border border-[var(--ui-border)] p-3 md:grid-cols-[minmax(0,1fr)_180px_220px_auto]"><input v-model="attemptSearch" class="input" :placeholder="t('activityResults.search')" @keyup.enter="applyAttemptFilters" /><select v-model="attemptStatus" class="input" @change="applyAttemptFilters"><option value="all">{{ t('activityResults.allStatuses') }}</option><option value="submitted">{{ t('activityResults.submitted') }}</option><option value="expired">{{ t('activityResults.expired') }}</option></select><select v-model="attemptGradingState" class="input" @change="applyAttemptFilters"><option value="all">{{ t('activityResults.allGradingStates') }}</option><option value="awaiting_manual_grading">{{ t('activityResults.awaiting') }}</option><option value="fully_graded">{{ t('activityResults.fullyGraded') }}</option><option value="expired">{{ t('activityResults.expired') }}</option></select><button type="button" class="btn-secondary" @click="applyAttemptFilters">{{ t('common.search') }}</button></div>
            <div class="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between"><span class="text-[var(--ui-text-muted)]">{{ t('activityResults.filteredCount', { count: activityResults.pagination.totalItems }) }}</span><div class="flex flex-wrap items-center justify-between gap-2 sm:justify-end"><button class="btn-secondary px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40" :disabled="attemptPage <= 1" @click="changeAttemptPage(-1)">{{ t('common.previous') }}</button><span>{{ t('common.page', { current: activityResults.pagination.page, total: activityResults.pagination.totalPages || 1 }) }}</span><button class="btn-secondary px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40" :disabled="attemptPage >= activityResults.pagination.totalPages" @click="changeAttemptPage(1)">{{ t('common.next') }}</button></div></div>
          </section>
          <section v-if="activeTab === 'results' && activityId" class="min-w-0 sm:col-span-2"><div class="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 class="font-semibold">{{ t('activitiesEditor.attempts') }}</h3><p class="text-xs text-[var(--ui-text-muted)]">{{ t('activitiesEditor.attemptDeadlineDetails') }}</p></div><button type="button" class="btn-secondary w-full px-3 py-2 text-sm sm:w-auto" @click="loadAttempts">{{ t('common.refresh') }}</button></div><div v-if="!adminAttempts.length" class="rounded-2xl border border-dashed border-[var(--ui-border)] p-5 text-sm text-[var(--ui-text-muted)]">{{ t('activitiesEditor.noAttempts') }}</div><div v-else class="space-y-2"><article v-for="item in adminAttempts" :key="item.id" class="grid min-w-0 gap-3 rounded-2xl border border-[var(--ui-border)] p-4 text-sm sm:grid-cols-[minmax(0,1fr)_auto]"><div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><strong class="min-w-0 break-words">{{ item.participantName || t('activitiesEditor.anonymousParticipant') }}</strong><span class="rounded-full bg-[var(--ui-pill-bg)] px-2 py-0.5 text-xs">{{ item.status }}</span><span class="rounded-full bg-[var(--ui-accent-soft)] px-2 py-0.5 text-xs text-[var(--ui-accent)]">{{ t(`activityGradingStates.${item.gradingState}`) }}</span></div><p class="mt-2 break-words text-xs font-medium">{{ formatActivityNumber(item.score) }} / {{ formatActivityNumber(item.maximumScore) }} · {{ formatAttemptScorePercent(item.score, item.maximumScore) }} · {{ t('activitiesEditor.pendingManual', { count: item.pendingManualGrading }) }}</p><dl class="mt-2 grid min-w-0 gap-x-4 gap-y-1 text-xs text-[var(--ui-text-muted)] sm:grid-cols-2"><div class="min-w-0 break-words"><dt class="inline font-medium">{{ t('activitiesEditor.started') }}:</dt> <dd class="inline">{{ formatAttemptDate(item.startedAt) }}</dd></div><div class="min-w-0 break-words"><dt class="inline font-medium">{{ t('activitiesEditor.effectiveDeadline') }}:</dt> <dd class="inline">{{ formatAttemptDate(item.effectiveDeadlineAt) }}</dd></div><div class="min-w-0 break-words"><dt class="inline font-medium">{{ t('activitiesEditor.individualDeadline') }}:</dt> <dd class="inline">{{ formatAttemptDate(item.individualDeadlineAt) }}</dd></div><div class="min-w-0 break-words"><dt class="inline font-medium">{{ t('activitiesEditor.globalDeadline') }}:</dt> <dd class="inline">{{ formatAttemptDate(item.globalDeadlineAt) }}</dd></div></dl></div><div class="grid gap-2 sm:flex sm:flex-wrap sm:items-center"><button type="button" class="btn-secondary w-full px-3 py-2 sm:w-auto" @click="loadAttemptDetail(item.id)">{{ t('activitiesEditor.reviewAttempt') }}</button><button v-if="item.status === 'in_progress' && item.individualDeadlineAt" type="button" class="btn-secondary w-full px-3 py-2 sm:w-auto" :disabled="extendingAttemptId === item.id" @click="extendAttempt(item)">{{ t('activitiesEditor.extend') }}</button></div></article></div>
          </section>
        </div>
      </section>

    </div>

    <Teleport to="body">
      <div v-if="blockPicker" data-activity-block-picker class="fixed z-[145] w-[min(420px,calc(100vw-24px))] overflow-y-auto rounded-3xl border border-[var(--ui-border)] bg-[var(--ui-panel)] p-3 shadow-2xl" :style="{ top: `${blockPicker.top}px`, left: `${blockPicker.left}px`, maxHeight: `${blockPicker.maxHeight}px` }" role="dialog" :aria-label="t('activitiesEditor.addBlock')">
        <input v-model="blockPickerSearch" class="input mb-3" type="search" :placeholder="t('activityEditorEnhancements.searchBlocks')" autofocus />
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3"><button v-for="item in blockPickerItems" :key="item.type" type="button" class="activity-block-picker-item flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border p-3 text-center text-sm transition" :style="{ '--activity-block-accent': blockAccentForType(item.type) }" @click="chooseBlock(item.type)"><span class="activity-block-icon flex h-9 w-9 items-center justify-center rounded-xl"><ActivityBlockIcon class="h-5 w-5" :type="item.type" /></span><span>{{ item.label }}</span></button></div>
        <p v-if="!blockPickerItems.length" class="p-6 text-center text-sm text-[var(--ui-text-muted)]">{{ t('common.noMatches') }}</p>
      </div>
      <div v-if="blockMenu" data-activity-block-menu class="fixed z-[146] w-44 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-panel)] p-2 shadow-xl" :style="{ top: `${blockMenu.top}px`, left: `${blockMenu.left}px` }"><button type="button" class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-red-500 hover:bg-red-500/10" @click="dialog = { kind: 'delete-block', id: blockMenu.id }; closeBlockMenu()">{{ t('common.delete') }}</button></div>
      <div v-if="selectedAttemptDetail" class="fixed inset-0 z-[155] flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-labelledby="activity-attempt-result-title">
        <section class="panel flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden sm:max-h-[min(90dvh,900px)]">
          <header class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--ui-border)] px-5 py-4 sm:px-6">
            <div>
              <h3 id="activity-attempt-result-title" class="text-lg font-semibold">{{ selectedAttemptDetail.participantName || t('activitiesEditor.anonymousParticipant') }}</h3>
              <p class="mt-1 text-xs text-[var(--ui-text-muted)]">{{ t(`activityGradingStates.${selectedAttemptDetail.gradingState}`) }} · {{ formatActivityNumber(selectedAttemptDetail.score) }} / {{ formatActivityNumber(selectedAttemptDetail.maximumScore) }} · {{ formatAttemptScorePercent(selectedAttemptDetail.score, selectedAttemptDetail.maximumScore) }}</p>
            </div>
            <div class="flex gap-2">
              <button v-if="settings.feedbackPolicy === 'manual_release' && !selectedAttemptDetail.resultsReleasedAt && !['in_progress','submitted','awaiting_manual_grading'].includes(selectedAttemptDetail.gradingState)" type="button" class="btn-primary px-3 py-2 text-sm" :disabled="gradingAttempt" @click="releaseAttemptResults">{{ t('activitiesEditor.releaseResults') }}</button>
              <button type="button" class="btn-secondary px-3 py-2 text-sm" @click="selectedAttemptDetail = null">{{ t('common.close') }}</button>
            </div>
          </header>
          <div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            <div class="space-y-3">
              <article v-for="response in selectedAttemptDetail.responses" :key="response.questionBlockId" class="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-panel-muted)] p-4">
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div><p class="font-medium">{{ response.prompt }}</p><p class="mt-1 text-xs text-[var(--ui-text-muted)]">{{ t(`activityQuestionTypes.${response.questionType}`) }} · {{ formatActivityNumber(response.awardedPoints) }} / {{ formatActivityNumber(response.maximumPoints) }}</p></div>
                  <span class="rounded-full bg-[var(--ui-pill-bg)] px-2.5 py-1 text-xs text-[var(--ui-text-muted)]">{{ response.gradingStatus }}</span>
                </div>
                <div class="mt-3 rounded-xl bg-[var(--ui-panel)] p-3">
                  <p class="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ui-text-muted)]">{{ t('liveAdmin.answer') }}</p>
                  <p v-if="!answerRows(response).length" class="text-sm text-[var(--ui-text-muted)]">—</p>
                  <p v-else-if="response.questionType === 'open_answer'" class="whitespace-pre-wrap break-words text-sm leading-6">{{ answerRows(response)[0].value }}</p>
                  <div v-else-if="['single_choice','multiple_choice','word_cloud'].includes(response.questionType)" class="flex flex-wrap gap-2"><span v-for="(row, index) in answerRows(response)" :key="`${response.questionBlockId}-${index}`" class="rounded-full bg-[var(--ui-accent-soft)] px-3 py-1.5 text-sm text-[var(--ui-accent)]">{{ row.value }}</span></div>
                  <div v-else class="space-y-2"><div v-for="(row, index) in answerRows(response)" :key="`${response.questionBlockId}-${index}`" class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-lg border border-[var(--ui-border)] px-3 py-2 text-sm"><strong class="text-[var(--ui-text-muted)]">{{ row.label }}</strong><span class="break-words">{{ row.value }}</span></div></div>
                </div>
                <div v-if="response.answer && response.maximumPoints > 0 && (response.gradingStatus === 'manual_review' || response.gradingStatus === 'graded')" class="mt-3 grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_auto]"><label><span class="label">{{ t('activitiesEditor.awardedPoints') }}</span><input v-model="manualGrades[response.questionBlockId].points" class="input mt-1" type="number" min="0" :max="response.maximumPoints" step="0.1" /></label><label><span class="label">{{ t('activitiesEditor.teacherFeedback') }}</span><input v-model="manualGrades[response.questionBlockId].feedback" class="input mt-1" maxlength="4000" /></label><button type="button" class="btn-primary self-end px-3 py-2" :disabled="gradingAttempt" @click="gradeManualResponse(response.questionBlockId)">{{ t('activitiesEditor.saveGrade') }}</button></div>
                <div v-if="response.questionType === 'word_cloud' && response.moderationStatus === 'pending'" class="mt-3"><p v-if="response.moderationReason" class="mb-2 text-xs text-[var(--ui-text-muted)]">{{ response.moderationReason }}</p><div class="flex flex-wrap gap-2"><button type="button" class="btn-primary px-3 py-2 text-sm" :disabled="gradingAttempt" @click="moderateAttemptResponse(response.questionBlockId, 'approved')">{{ t('activityModeration.approveResponse') }}</button><button type="button" class="btn-secondary px-3 py-2 text-sm" :disabled="gradingAttempt" @click="moderateAttemptResponse(response.questionBlockId, 'rejected')">{{ t('activityModeration.rejectResponse') }}</button></div></div>
                <p v-else-if="response.teacherFeedback" class="mt-3 text-sm text-[var(--ui-text-muted)]">{{ response.teacherFeedback }}</p>
              </article>
            </div>
            <dl class="mt-4 grid gap-3 rounded-2xl border border-[var(--ui-border)] p-4 text-sm sm:grid-cols-2 xl:grid-cols-4"><div><dt class="text-xs text-[var(--ui-text-muted)]">{{ t('activityResults.startedAt') }}</dt><dd class="mt-1 font-medium">{{ formatAttemptDate(selectedAttemptDetail.startedAt) }}</dd></div><div><dt class="text-xs text-[var(--ui-text-muted)]">{{ t('activityResults.submittedAt') }}</dt><dd class="mt-1 font-medium">{{ formatAttemptDate(selectedAttemptDetail.submittedAt) }}</dd></div><div><dt class="text-xs text-[var(--ui-text-muted)]">{{ t('activityResults.submissionReason') }}</dt><dd class="mt-1 font-medium">{{ selectedAttemptDetail.submissionReason || '—' }}</dd></div><div><dt class="text-xs text-[var(--ui-text-muted)]">{{ t('activityResults.duration') }}</dt><dd class="mt-1 font-medium">{{ formatDuration(selectedAttemptDetail.durationSeconds) }}</dd></div></dl>
          </div>
        </section>
      </div>
    </Teleport>

    <div v-if="dialog" class="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" :aria-labelledby="'activity-dialog-title'">
      <div class="panel w-full max-w-md p-6"><h3 id="activity-dialog-title" class="text-lg font-semibold">{{ dialog.kind === 'replace-question' ? t('activitiesEditor.replaceQuestion') : t('activitiesEditor.confirmDelete') }}</h3><p class="mt-2 text-sm text-[var(--ui-text-muted)]">{{ dialog.kind === 'replace-question' ? t('activitiesEditor.replaceQuestionDescription') : t('activitiesEditor.deleteDescription') }}</p><div class="mt-6 flex justify-end gap-2"><button class="btn-secondary" @click="dialog = null">{{ t('common.cancel') }}</button><button class="btn-primary" @click="confirmDialog">{{ dialog.kind === 'replace-question' ? t('activitiesEditor.replace') : t('common.delete') }}</button></div></div>
    </div>
    <div v-if="publishConfirmation" class="fixed inset-0 z-[125] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="publish-confirm-title">
      <div class="panel w-full max-w-lg p-6"><h3 id="publish-confirm-title" class="text-lg font-semibold">{{ publishedVersion ? t('activitiesPublishing.confirmRepublishTitle') : t('activitiesPublishing.confirmPublishTitle') }}</h3><p class="mt-2 text-sm leading-6 text-[var(--ui-text-muted)]">{{ t('activitiesPublishing.confirmPublishDescription', { version: (publishedVersion ?? 0) + 1 }) }}</p><ul class="mt-4 space-y-2" :aria-label="t('activitiesPublishing.confirmPublishTitle')"><li v-for="item in publishValidation?.items" :key="item.code" class="flex items-start gap-2 rounded-xl bg-[var(--ui-panel-muted)] px-3 py-2 text-sm"><span :class="item.valid ? 'text-[var(--ui-accent)]' : 'text-red-500'">{{ item.valid ? '✓' : '!' }}</span><span>{{ t(`activitiesPublishing.checklist.${item.code}`) }}</span></li></ul><div class="mt-6 flex justify-end gap-2"><button class="btn-secondary" :disabled="publishing" @click="publishConfirmation = false">{{ t('common.cancel') }}</button><button class="btn-primary" :disabled="publishing" @click="publish">{{ publishing ? t('activitiesEditor.publishing') : t('activitiesPublishing.confirmPublish') }}</button></div></div>
    </div>
  </div>
</template>

<style scoped>
.activity-block-card {
  --activity-block-accent: var(--ui-accent);
  border-color: color-mix(in srgb, var(--activity-block-accent) 38%, var(--ui-border));
  border-left-width: 4px;
  border-left-color: var(--activity-block-accent);
  background: color-mix(in srgb, var(--activity-block-accent) 6%, var(--ui-panel));
  transition: border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease;
}
.activity-block-card:hover {
  border-color: color-mix(in srgb, var(--activity-block-accent) 65%, var(--ui-border));
  background: color-mix(in srgb, var(--activity-block-accent) 10%, var(--ui-panel));
}
.activity-block-icon { color:var(--activity-block-accent); background:color-mix(in srgb,var(--activity-block-accent) 14%,transparent); }
.activity-block-picker-item {
  --activity-block-accent: var(--ui-accent);
  border-color: color-mix(in srgb, var(--activity-block-accent) 38%, var(--ui-border));
  background: color-mix(in srgb, var(--activity-block-accent) 6%, var(--ui-panel));
}
.activity-block-picker-item:hover,
.activity-block-picker-item:focus-visible {
  border-color: var(--activity-block-accent);
  background: color-mix(in srgb, var(--activity-block-accent) 12%, var(--ui-panel));
  outline: none;
}
.pattern-swatch { color:var(--ui-accent); background-color:var(--ui-panel-muted); }
.pattern-swatch-dots { background-image:radial-gradient(currentColor 1.3px,transparent 1.3px); background-size:12px 12px; }
.pattern-swatch-grid { background-image:linear-gradient(currentColor 1px,transparent 1px),linear-gradient(90deg,currentColor 1px,transparent 1px); background-size:14px 14px; }
.pattern-swatch-soft_glow { background-image:radial-gradient(circle at 25% 30%,currentColor 0,transparent 42%),radial-gradient(circle at 85% 75%,currentColor 0,transparent 38%); opacity:.65; }
.pattern-swatch-crosses { background-image:linear-gradient(90deg,transparent 5px,currentColor 5px 9px,transparent 9px),linear-gradient(transparent 5px,currentColor 5px 9px,transparent 9px); background-size:18px 18px; background-position:0 7px,7px 0; opacity:.65; }
.activity-drag-handle {
  cursor: grab;
}
.activity-drag-handle:active {
  cursor: grabbing;
}
.activity-block-placeholder,
.activity-slide-placeholder {
  border-style: dashed;
  border-color: var(--ui-accent);
  background: var(--ui-accent-soft);
  color: transparent;
  box-shadow: none;
}
.activity-block-placeholder *,
.activity-slide-placeholder * {
  visibility: hidden;
}
:global(.activity-block-ghost),
:global(.activity-slide-ghost) {
  position: fixed !important;
  z-index: 200 !important;
  margin: 0 !important;
  opacity: 1 !important;
  pointer-events: none !important;
  transform: scale(1.015) rotate(.25deg);
  border-radius: 1rem;
  border: 1px solid var(--ui-accent);
  background: var(--ui-panel);
  box-shadow: 0 22px 52px rgb(0 0 0 / .24);
}
@media (prefers-reduced-motion: reduce) {
  .activity-block-card,
  .activity-slide-card { transition: none; }
  :global(.activity-block-ghost),
  :global(.activity-slide-ghost) { transform: none; }
}
</style>
