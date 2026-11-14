// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import RichTextEditor from './RichTextEditor.vue';

describe('RichTextEditor', () => {
  const selectEditorText = (editor: HTMLElement) => {
    const range = document.createRange();
    const text = editor.firstChild!;
    range.setStart(text, 0);
    range.setEnd(text, text.textContent?.length ?? 0);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  };

  test('formats only an explicitly selected range', async () => {
    const wrapper = mount(RichTextEditor, { attachTo: document.body, props: { modelValue: 'Text' } });
    const editor = wrapper.get('[contenteditable="true"]').element as HTMLElement;
    await wrapper.vm.$nextTick();
    selectEditorText(editor);

    wrapper.findAll('button')[0]!.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe('[b]Text[/b]');
    wrapper.unmount();
  });

  test('does not enable sticky formatting for a collapsed caret', async () => {
    const wrapper = mount(RichTextEditor, { attachTo: document.body, props: { modelValue: 'Text' } });
    const editor = wrapper.get('[contenteditable="true"]').element as HTMLElement;
    await wrapper.vm.$nextTick();
    const range = document.createRange();
    range.setStart(editor.firstChild!, 4);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    wrapper.findAll('button')[0]!.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(editor.innerHTML).toBe('Text');
    wrapper.unmount();
  });

  test('hovering the input never applies formatting', async () => {
    const wrapper = mount(RichTextEditor, { attachTo: document.body, props: { modelValue: 'Text' } });
    const editor = wrapper.get('[contenteditable="true"]');
    await wrapper.vm.$nextTick();

    await editor.trigger('mouseenter');
    await editor.trigger('mousemove');

    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(editor.element.querySelector('strong')).toBeNull();
    expect(editor.element.textContent).toBe('Text');
    wrapper.unmount();
  });

  test('supports Word-style keyboard shortcuts for a selected range', async () => {
    const wrapper = mount(RichTextEditor, { attachTo: document.body, props: { modelValue: 'Text' } });
    const editor = wrapper.get('[contenteditable="true"]');
    await wrapper.vm.$nextTick();
    selectEditorText(editor.element as HTMLElement);

    editor.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe('[b]Text[/b]');
    wrapper.unmount();
  });

  test('shows the active format and toggles it off without nesting tags', async () => {
    const wrapper = mount(RichTextEditor, { attachTo: document.body, props: { modelValue: '[b]Text[/b]' } });
    await wrapper.vm.$nextTick();
    const editor = wrapper.get('[contenteditable="true"]').element as HTMLElement;
    selectEditorText(editor.querySelector('strong') as HTMLElement);
    document.dispatchEvent(new Event('selectionchange'));
    await wrapper.vm.$nextTick();

    const bold = wrapper.findAll('button')[0]!;
    expect(bold.attributes('aria-pressed')).toBe('true');
    bold.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe('Text');
    expect(editor.querySelector('strong')).toBeNull();
    expect(bold.attributes('aria-pressed')).toBe('false');
    wrapper.unmount();
  });
});
