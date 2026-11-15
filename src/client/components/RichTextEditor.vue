<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { renderRichTextHtml } from '@/shared/rich-text';

const props = withDefaults(defineProps<{
  modelValue: string;
  maxLength?: number;
  minHeightClass?: string;
  ariaLabel?: string;
  placeholder?: string;
  required?: boolean;
}>(), { maxLength: 4000, minHeightClass: 'min-h-32', ariaLabel: '', placeholder: '', required: false });
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const { t } = useI18n();
const editor = ref<HTMLElement | null>(null);
let lastAccepted = props.modelValue;

const wrappers: Record<string, [string, string]> = {
  B: ['[b]', '[/b]'], STRONG: ['[b]', '[/b]'], I: ['[i]', '[/i]'], EM: ['[i]', '[/i]'],
  U: ['[u]', '[/u]'], S: ['[s]', '[/s]'], STRIKE: ['[s]', '[/s]'],
  SUP: ['[sup]', '[/sup]'], SUB: ['[sub]', '[/sub]']
};
type FormatCommand = 'bold' | 'italic' | 'underline' | 'strikeThrough' | 'superscript' | 'subscript';
const commandTags: Record<FormatCommand, keyof HTMLElementTagNameMap> = {
  bold: 'strong', italic: 'em', underline: 'u', strikeThrough: 's', superscript: 'sup', subscript: 'sub'
};
const commandState = ref<Record<FormatCommand, boolean>>({
  bold: false, italic: false, underline: false, strikeThrough: false, superscript: false, subscript: false
});

const serializeNode = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof HTMLElement)) return '';
  if (node.tagName === 'BR') return '\n';
  const content = [...node.childNodes].map(serializeNode).join('');
  const wrapper = wrappers[node.tagName];
  if (wrapper) return `${wrapper[0]}${content}${wrapper[1]}`;
  if (node.tagName === 'DIV' || node.tagName === 'P') return `${content}\n`;
  return content;
};

const serialize = () => editor.value
  ? [...editor.value.childNodes].map(serializeNode).join('').replace(/\n+$/, '')
  : '';

const normalizeNestedScripts = () => {
  if (!editor.value) return;
  ['sup sup', 'sub sub'].forEach((selector) => {
    [...editor.value!.querySelectorAll(selector)].reverse().forEach((wrapper) => wrapper.replaceWith(...wrapper.childNodes));
  });
};

const removeEmptyScriptWrappers = () => {
  if (!editor.value) return;
  editor.value.querySelectorAll('sup, sub').forEach((wrapper) => {
    if (!(wrapper.textContent ?? '') && !wrapper.querySelector('br')) wrapper.remove();
  });
};

const sync = (value: string) => {
  if (!editor.value) return;
  editor.value.innerHTML = renderRichTextHtml(value);
  normalizeNestedScripts();
};

const onInput = () => {
  const value = serialize();
  if (value.length > props.maxLength) {
    sync(lastAccepted);
    return;
  }
  lastAccepted = value;
  emit('update:modelValue', value);
};

const editorRange = () => {
  const selection = window.getSelection();
  if (!editor.value || !selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentNode
    : range.commonAncestorContainer;
  return container && editor.value.contains(container) ? { selection, range } : null;
};

const formatWrapperForNode = (name: FormatCommand, node: Node, outermost = false) => {
  const tag = commandTags[name].toUpperCase();
  let element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  let match: HTMLElement | null = null;
  while (element && element !== editor.value) {
    if (element.tagName === tag || name === 'bold' && element.tagName === 'B' || name === 'italic' && element.tagName === 'I' || name === 'strikeThrough' && element.tagName === 'STRIKE') {
      match = element as HTMLElement;
      if (!outermost) break;
    }
    element = element.parentElement;
  }
  return match;
};

const formatWrapperForRange = (name: FormatCommand, range: Range) => {
  const start = formatWrapperForNode(name, range.startContainer);
  const end = formatWrapperForNode(name, range.endContainer);
  return start && start === end ? start : null;
};

const rangeContainsFormat = (name: FormatCommand, range: Range) => {
  if (formatWrapperForNode(name, range.startContainer) || formatWrapperForNode(name, range.endContainer)) return true;
  return Boolean(range.cloneContents().querySelector(commandTags[name]));
};

const restoreSelectionBetween = (start: HTMLElement, end: HTMLElement, selection: Selection) => {
  const range = document.createRange();
  range.setStartAfter(start);
  range.setEndBefore(end);
  selection.removeAllRanges();
  selection.addRange(range);
  start.remove();
  end.remove();
};

const removeFormatFromRange = (name: FormatCommand, active: NonNullable<ReturnType<typeof editorRange>>) => {
  const startWrapper = formatWrapperForNode(name, active.range.startContainer, true);
  const fragment = active.range.extractContents();
  [...fragment.querySelectorAll(commandTags[name])].reverse().forEach((wrapper) => wrapper.replaceWith(...wrapper.childNodes));

  const selectionStart = document.createElement('span');
  const selectionEnd = document.createElement('span');
  selectionStart.hidden = true;
  selectionEnd.hidden = true;
  const payload = document.createDocumentFragment();
  payload.append(selectionStart, fragment, selectionEnd);

  if (startWrapper?.isConnected) {
    const splitMarker = document.createElement('span');
    active.range.insertNode(splitMarker);
    const trailingWrapper = startWrapper.cloneNode(false) as HTMLElement;
    let trailingNode = splitMarker.nextSibling;
    while (trailingNode) {
      const next = trailingNode.nextSibling;
      trailingWrapper.append(trailingNode);
      trailingNode = next;
    }
    splitMarker.remove();
    const parent = startWrapper.parentNode;
    if (!parent) return;
    const reference = startWrapper.nextSibling;
    parent.insertBefore(payload, reference);
    if ((trailingWrapper.textContent ?? '') || trailingWrapper.querySelector('br')) parent.insertBefore(trailingWrapper, reference);
    if (!(startWrapper.textContent ?? '') && !startWrapper.querySelector('br')) startWrapper.remove();
  } else {
    active.range.insertNode(payload);
  }

  restoreSelectionBetween(selectionStart, selectionEnd, active.selection);
  removeEmptyScriptWrappers();
};

const wrapRange = (name: FormatCommand, active: NonNullable<ReturnType<typeof editorRange>>) => {
  const wrapper = document.createElement(commandTags[name]);
  wrapper.append(active.range.extractContents());
  active.range.insertNode(wrapper);
  const selected = document.createRange();
  selected.selectNodeContents(wrapper);
  active.selection.removeAllRanges();
  active.selection.addRange(selected);
};

const updateCommandState = () => {
  const active = editorRange();
  (Object.keys(commandState.value) as FormatCommand[]).forEach((name) => {
    if (!active) {
      commandState.value[name] = false;
      return;
    }
    const wrapperActive = Boolean(formatWrapperForRange(name, active.range));
    if (name === 'superscript' || name === 'subscript') {
      commandState.value[name] = rangeContainsFormat(name, active.range);
      return;
    }
    try {
      commandState.value[name] = (typeof document.queryCommandState === 'function' && document.queryCommandState(name))
        || wrapperActive;
    } catch {
      commandState.value[name] = wrapperActive;
    }
  });
};

const applyDomCommand = (name: FormatCommand, active: NonNullable<ReturnType<typeof editorRange>>) => {
  if (name === 'superscript' || name === 'subscript') {
    if (rangeContainsFormat(name, active.range)) {
      removeFormatFromRange(name, active);
    } else {
      const oppositeName: FormatCommand = name === 'superscript' ? 'subscript' : 'superscript';
      if (rangeContainsFormat(oppositeName, active.range)) {
        removeFormatFromRange(oppositeName, active);
        const restored = editorRange();
        if (!restored || restored.range.collapsed) return;
        wrapRange(name, restored);
      } else {
        wrapRange(name, active);
      }
    }
    onInput();
    updateCommandState();
    return;
  }
  const existingWrapper = formatWrapperForRange(name, active.range);
  let selected = document.createRange();
  if (existingWrapper) {
    const parent = existingWrapper.parentNode;
    const first = existingWrapper.firstChild;
    const last = existingWrapper.lastChild;
    if (!parent || !first || !last) return;
    while (existingWrapper.firstChild) parent.insertBefore(existingWrapper.firstChild, existingWrapper);
    existingWrapper.remove();
    selected.setStartBefore(first);
    selected.setEndAfter(last);
  } else {
    wrapRange(name, active);
    onInput();
    updateCommandState();
    return;
  }
  active.selection.removeAllRanges();
  active.selection.addRange(selected);
  onInput();
  updateCommandState();
};

const command = (name: FormatCommand) => {
  const active = editorRange();
  if (!active || active.range.collapsed) return;
  if (name === 'superscript' || name === 'subscript' || typeof document.execCommand !== 'function') {
    applyDomCommand(name, active);
    return;
  }
  document.execCommand(name, false);
  onInput();
  updateCommandState();
};

const onKeydown = (event: KeyboardEvent) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();
  let action: FormatCommand | null = null;
  if (key === 'b') action = 'bold';
  else if (key === 'i') action = 'italic';
  else if (key === 'u') action = 'underline';
  else if (key === 'x' && event.shiftKey) action = 'strikeThrough';
  else if ((key === '=' || key === '+') && event.shiftKey) action = 'superscript';
  else if (key === '=' && !event.shiftKey) action = 'subscript';
  if (!action) return;
  event.preventDefault();
  command(action);
};

const onPaste = (event: ClipboardEvent) => {
  event.preventDefault();
  const active = editorRange();
  if (!active) return;
  const text = event.clipboardData?.getData('text/plain') ?? '';
  const fragment = document.createDocumentFragment();
  const nodes: Node[] = [];
  text.split('\n').forEach((line, index) => {
    if (index) nodes.push(document.createElement('br'));
    if (line) nodes.push(document.createTextNode(line));
  });
  nodes.forEach((node) => fragment.append(node));
  active.range.deleteContents();
  active.range.insertNode(fragment);
  const last = nodes.at(-1);
  if (last) {
    active.range.setStartAfter(last);
    active.range.collapse(true);
    active.selection.removeAllRanges();
    active.selection.addRange(active.range);
  }
  onInput();
};

watch(() => props.modelValue, (value) => {
  if (value === lastAccepted) return;
  lastAccepted = value;
  if (document.activeElement !== editor.value) void nextTick(() => sync(value));
});
onMounted(() => {
  sync(props.modelValue);
  document.addEventListener('selectionchange', updateCommandState);
});
onBeforeUnmount(() => document.removeEventListener('selectionchange', updateCommandState));
</script>

<template>
  <div class="rich-text-editor overflow-hidden rounded-xl border border-[var(--ui-border)] bg-[var(--ui-panel)] focus-within:border-[var(--ui-accent)]">
    <div class="flex flex-wrap gap-1 border-b border-[var(--ui-border)] bg-[var(--ui-panel-muted)] p-1.5" role="toolbar" :aria-label="t('richText.toolbar')">
      <button class="rich-text-tool font-bold" :class="{ 'rich-text-tool-active': commandState.bold }" type="button" :aria-pressed="commandState.bold" :title="`${t('richText.bold')} · Ctrl+B`" :aria-label="t('richText.bold')" @mousedown.prevent @click="command('bold')">B</button>
      <button class="rich-text-tool italic" :class="{ 'rich-text-tool-active': commandState.italic }" type="button" :aria-pressed="commandState.italic" :title="`${t('richText.italic')} · Ctrl+I`" :aria-label="t('richText.italic')" @mousedown.prevent @click="command('italic')">I</button>
      <button class="rich-text-tool underline" :class="{ 'rich-text-tool-active': commandState.underline }" type="button" :aria-pressed="commandState.underline" :title="`${t('richText.underline')} · Ctrl+U`" :aria-label="t('richText.underline')" @mousedown.prevent @click="command('underline')">U</button>
      <button class="rich-text-tool line-through" :class="{ 'rich-text-tool-active': commandState.strikeThrough }" type="button" :aria-pressed="commandState.strikeThrough" :title="`${t('richText.strike')} · Ctrl+Shift+X`" :aria-label="t('richText.strike')" @mousedown.prevent @click="command('strikeThrough')">S</button>
      <button class="rich-text-tool" :class="{ 'rich-text-tool-active': commandState.superscript }" type="button" :aria-pressed="commandState.superscript" :title="`${t('richText.superscript')} · Ctrl+Shift+=`" :aria-label="t('richText.superscript')" @mousedown.prevent @click="command('superscript')">x<sup>2</sup></button>
      <button class="rich-text-tool" :class="{ 'rich-text-tool-active': commandState.subscript }" type="button" :aria-pressed="commandState.subscript" :title="`${t('richText.subscript')} · Ctrl+=`" :aria-label="t('richText.subscript')" @mousedown.prevent @click="command('subscript')">x<sub>2</sub></button>
    </div>
    <div
      ref="editor"
      class="rich-text-input px-3 py-2 text-sm leading-6 outline-none"
      :class="minHeightClass"
      contenteditable="true"
      role="textbox"
      aria-multiline="true"
      :aria-label="ariaLabel"
      :aria-required="required"
      :data-placeholder="placeholder"
      @input="onInput"
      @keydown="onKeydown"
      @keyup="updateCommandState"
      @mouseup="updateCommandState"
      @paste="onPaste"
    />
  </div>
</template>

<style scoped>
.rich-text-tool{display:inline-flex;height:2rem;min-width:2rem;align-items:center;justify-content:center;border-radius:.55rem;padding:0 .45rem;color:var(--ui-text-muted);transition:background-color .15s ease,color .15s ease}
.rich-text-tool:hover,.rich-text-tool:focus-visible{background:var(--ui-accent-soft);color:var(--ui-accent);outline:none}
.rich-text-tool-active{background:var(--ui-accent-soft);color:var(--ui-accent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ui-accent) 30%,transparent)}
.rich-text-input{font-style:normal;font-weight:400;text-decoration:none}
.rich-text-input:empty::before{content:attr(data-placeholder);color:var(--ui-text-muted);pointer-events:none}
.rich-text-input strong,.rich-text-input b{font-weight:700}
.rich-text-input em,.rich-text-input i{font-style:italic}
.rich-text-input u{text-decoration:underline}
.rich-text-input s,.rich-text-input strike{text-decoration:line-through}
.rich-text-input sup,.rich-text-input sub{font-size:.72em;line-height:0}
@media(prefers-reduced-motion:reduce){.rich-text-tool{transition:none}}
</style>
