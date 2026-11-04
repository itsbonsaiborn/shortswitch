import { nextTick, onBeforeUnmount, ref, type Ref } from 'vue';

interface PointerReorderOptions {
  container: Ref<HTMLElement | null>;
  getIds: () => string[];
  setIds: (ids: string[]) => void;
  itemSelector?: string;
  itemDataKey?: string;
  handleSelector?: string;
  ghostClass?: string;
  placeholderClass?: string;
}

interface DragSession {
  pointerId: number;
  itemId: string;
  initialIds: string[];
  currentIds: string[];
  ghost: HTMLElement;
  handle: HTMLElement;
  offsetX: number;
  offsetY: number;
  width: number;
  lastClientY: number;
  scrollContainer: HTMLElement | null;
  bodyCursor: string;
  bodyUserSelect: string;
}

export const usePointerReorder = (options: PointerReorderOptions) => {
  const itemSelector = options.itemSelector ?? '[data-reorder-item]';
  const itemDataKey = options.itemDataKey ?? 'reorderItem';
  const handleSelector = options.handleSelector ?? '[data-reorder-handle]';
  const ghostClass = options.ghostClass ?? 'activity-question-item-ghost';
  const placeholderClass = options.placeholderClass ?? 'activity-question-item-placeholder';
  const draggingId = ref('');
  let session: DragSession | null = null;
  let autoScrollFrame: number | null = null;

  const itemId = (element: HTMLElement) => element.dataset[itemDataKey] ?? '';
  const findScrollContainer = (element: HTMLElement) => {
    let parent = element.parentElement;
    while (parent && parent !== document.body) {
      const overflow = window.getComputedStyle(parent).overflowY;
      if ((overflow === 'auto' || overflow === 'scroll') && parent.scrollHeight > parent.clientHeight) return parent;
      parent = parent.parentElement;
    }
    return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
  };
  const captureRects = () => {
    const rects = new Map<string, DOMRect>();
    options.container.value?.querySelectorAll<HTMLElement>(itemSelector).forEach((element) => {
      const id = itemId(element);
      if (id) rects.set(id, element.getBoundingClientRect());
    });
    return rects;
  };
  const animatePositions = async (before: Map<string, DOMRect>) => {
    await nextTick();
    options.container.value?.querySelectorAll<HTMLElement>(itemSelector).forEach((element) => {
      const id = itemId(element);
      const previous = id ? before.get(id) : undefined;
      if (!previous || id === draggingId.value) return;
      const current = element.getBoundingClientRect();
      const deltaY = previous.top - current.top;
      if (Math.abs(deltaY) < 1 || typeof element.animate !== 'function') return;
      element.getAnimations?.().forEach((animation) => animation.cancel());
      element.animate(
        [{ transform: `translateY(${deltaY}px)` }, { transform: 'translateY(0)' }],
        { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' }
      );
    });
  };
  const setDraggedPosition = (targetIndex: number) => {
    if (!session) return;
    const currentIndex = session.currentIds.indexOf(session.itemId);
    const nextIndex = Math.max(0, Math.min(targetIndex, session.currentIds.length - 1));
    if (currentIndex < 0 || currentIndex === nextIndex) return;
    const before = captureRects();
    const next = [...session.currentIds];
    next.splice(currentIndex, 1);
    next.splice(nextIndex, 0, session.itemId);
    session.currentIds = next;
    options.setIds([...next]);
    void animatePositions(before);
  };
  const updateDraggedPosition = (clientY: number) => {
    if (!session || !options.container.value) return;
    const cards = [...options.container.value.querySelectorAll<HTMLElement>(itemSelector)]
      .filter((element) => itemId(element) !== session?.itemId);
    let targetIndex = cards.length;
    for (let index = 0; index < cards.length; index += 1) {
      const rect = cards[index].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) { targetIndex = index; break; }
    }
    setDraggedPosition(targetIndex);
  };
  const positionGhost = (clientX: number, clientY: number) => {
    if (!session) return;
    const left = Math.min(Math.max(clientX - session.offsetX, 8), Math.max(window.innerWidth - session.width - 8, 8));
    session.ghost.style.left = `${left}px`;
    session.ghost.style.top = `${clientY - session.offsetY}px`;
  };
  const runAutoScroll = () => {
    if (!session) return;
    const container = session.scrollContainer;
    const rect = container && container !== document.scrollingElement
      ? container.getBoundingClientRect()
      : { top: 0, bottom: window.innerHeight, height: window.innerHeight };
    const edge = Math.min(72, rect.height / 4);
    let speed = 0;
    if (session.lastClientY < rect.top + edge) speed = -Math.ceil(((rect.top + edge - session.lastClientY) / edge) * 14);
    else if (session.lastClientY > rect.bottom - edge) speed = Math.ceil(((session.lastClientY - (rect.bottom - edge)) / edge) * 14);
    if (speed && container) {
      const previous = container.scrollTop;
      container.scrollTop += speed;
      if (previous !== container.scrollTop) updateDraggedPosition(session.lastClientY);
    }
    autoScrollFrame = window.requestAnimationFrame(runAutoScroll);
  };
  const onDragMove = (event: PointerEvent) => {
    if (!session || event.pointerId !== session.pointerId) return;
    event.preventDefault();
    session.lastClientY = event.clientY;
    positionGhost(event.clientX, event.clientY);
    updateDraggedPosition(event.clientY);
  };
  const finish = (commit: boolean) => {
    const active = session;
    if (!active) return;
    if (!commit) options.setIds([...active.initialIds]);
    active.ghost.remove();
    if (active.handle.hasPointerCapture?.(active.pointerId)) active.handle.releasePointerCapture(active.pointerId);
    document.body.style.cursor = active.bodyCursor;
    document.body.style.userSelect = active.bodyUserSelect;
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragEnd);
    document.removeEventListener('pointercancel', onDragCancel);
    document.removeEventListener('keydown', onDragKeydown);
    if (autoScrollFrame !== null) window.cancelAnimationFrame(autoScrollFrame);
    autoScrollFrame = null;
    session = null;
    draggingId.value = '';
    void nextTick(() => options.container.value?.querySelector<HTMLElement>(`${handleSelector}[data-reorder-handle="${active.itemId}"]`)?.focus());
  };
  function onDragEnd(event: PointerEvent) { if (session?.pointerId === event.pointerId) finish(true); }
  function onDragCancel(event: PointerEvent) { if (session?.pointerId === event.pointerId) finish(false); }
  function onDragKeydown(event: KeyboardEvent) { if (event.key === 'Escape' && session) { event.preventDefault(); finish(false); } }
  const startDrag = (event: PointerEvent, id: string) => {
    if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0) || session) return;
    const handle = event.currentTarget as HTMLElement;
    const card = handle.closest<HTMLElement>(itemSelector);
    if (!card) return;
    event.preventDefault();
    event.stopPropagation();
    const ids = options.getIds();
    if (!ids.includes(id)) return;
    const rect = card.getBoundingClientRect();
    const ghost = card.cloneNode(true) as HTMLElement;
    ghost.classList.remove(placeholderClass);
    ghost.classList.add(ghostClass);
    ghost.setAttribute('aria-hidden', 'true');
    ghost.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]').forEach((element) => { element.tabIndex = -1; });
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    document.body.appendChild(ghost);
    session = {
      pointerId: event.pointerId,
      itemId: id,
      initialIds: [...ids],
      currentIds: [...ids],
      ghost,
      handle,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      lastClientY: event.clientY,
      scrollContainer: findScrollContainer(card),
      bodyCursor: document.body.style.cursor,
      bodyUserSelect: document.body.style.userSelect
    };
    draggingId.value = id;
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    handle.setPointerCapture?.(event.pointerId);
    positionGhost(event.clientX, event.clientY);
    document.addEventListener('pointermove', onDragMove, { passive: false });
    document.addEventListener('pointerup', onDragEnd);
    document.addEventListener('pointercancel', onDragCancel);
    document.addEventListener('keydown', onDragKeydown);
    autoScrollFrame = window.requestAnimationFrame(runAutoScroll);
  };

  onBeforeUnmount(() => finish(false));
  return { draggingId, startDrag, cancelDrag: () => finish(false) };
};
