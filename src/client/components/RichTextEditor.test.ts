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

  test.each([
    { tag: 'sup', marker: 'sup', button: 4 },
    { tag: 'sub', marker: 'sub', button: 5 }
  ])('toggles $tag formatting off and back on without nesting', async ({ tag, marker, button }) => {
    const wrapper = mount(RichTextEditor, { attachTo: document.body, props: { modelValue: `[${marker}]Text[/${marker}]` } });
    await wrapper.vm.$nextTick();
    const editor = wrapper.get('[contenteditable="true"]').element as HTMLElement;
    const tool = wrapper.findAll('button')[button]!;
    selectEditorText(editor.querySelector(tag) as HTMLElement);
    document.dispatchEvent(new Event('selectionchange'));
    await wrapper.vm.$nextTick();

    expect(tool.attributes('aria-pressed')).toBe('true');
    tool.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe('Text');
    expect(editor.querySelector(tag)).toBeNull();

    tool.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe(`[${marker}]Text[/${marker}]`);
    expect(editor.querySelectorAll(tag)).toHaveLength(1);
    wrapper.unmount();
  });

  test('tracks the selected script format and replaces the opposite format', async () => {
    const wrapper = mount(RichTextEditor, { attachTo: document.body, props: { modelValue: '[sup]Up[/sup] plain [sub]down[/sub]' } });
    await wrapper.vm.$nextTick();
    const editor = wrapper.get('[contenteditable="true"]').element as HTMLElement;
    const superscript = wrapper.findAll('button')[4]!;
    const subscript = wrapper.findAll('button')[5]!;

    selectEditorText(editor.querySelector('sup') as HTMLElement);
    document.dispatchEvent(new Event('selectionchange'));
    await wrapper.vm.$nextTick();
    expect(superscript.attributes('aria-pressed')).toBe('true');
    expect(subscript.attributes('aria-pressed')).toBe('false');

    const plainText = editor.childNodes[1]!;
    const plainRange = document.createRange();
    plainRange.setStart(plainText, 1);
    plainRange.setEnd(plainText, 6);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(plainRange);
    document.dispatchEvent(new Event('selectionchange'));
    await wrapper.vm.$nextTick();
    expect(superscript.attributes('aria-pressed')).toBe('false');
    expect(subscript.attributes('aria-pressed')).toBe('false');

    selectEditorText(editor.querySelector('sup') as HTMLElement);
    document.dispatchEvent(new Event('selectionchange'));
    await wrapper.vm.$nextTick();
    subscript.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(editor.querySelector('sup')).toBeNull();
    expect(editor.querySelectorAll('sub')).toHaveLength(2);
    expect(editor.querySelector('sub sub')).toBeNull();
    expect(superscript.attributes('aria-pressed')).toBe('false');
    expect(subscript.attributes('aria-pressed')).toBe('true');
    wrapper.unmount();
  });

  test('removes script formatting from a mixed plain and formatted selection without nesting', async () => {
    const wrapper = mount(RichTextEditor, {
      attachTo: document.body,
      props: { modelValue: 'Cookie-based auth with [sup]server-side session[/sup]' }
    });
    await wrapper.vm.$nextTick();
    const editor = wrapper.get('[contenteditable="true"]').element as HTMLElement;
    const plain = editor.firstChild!;
    const formatted = editor.querySelector('sup')!.firstChild!;
    const range = document.createRange();
    range.setStart(plain, (plain.textContent ?? '').indexOf('with'));
    range.setEnd(formatted, formatted.textContent?.length ?? 0);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await wrapper.vm.$nextTick();

    const superscript = wrapper.findAll('button')[4]!;
    expect(superscript.attributes('aria-pressed')).toBe('true');
    superscript.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe('Cookie-based auth with server-side session');
    expect(editor.querySelector('sup')).toBeNull();

    superscript.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe('Cookie-based auth [sup]with server-side session[/sup]');
    expect(editor.querySelectorAll('sup')).toHaveLength(1);
    expect(editor.querySelector('sup sup')).toBeNull();

    superscript.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe('Cookie-based auth with server-side session');
    expect(editor.querySelector('sup')).toBeNull();
    wrapper.unmount();
  });

  test('normalizes legacy nested script tags when loading content', async () => {
    const wrapper = mount(RichTextEditor, {
      attachTo: document.body,
      props: { modelValue: '[sub]with [sub]server-side session[/sub][/sub]' }
    });
    await wrapper.vm.$nextTick();
    const editor = wrapper.get('[contenteditable="true"]').element as HTMLElement;
    expect(editor.querySelectorAll('sub')).toHaveLength(1);
    expect(editor.querySelector('sub sub')).toBeNull();
    wrapper.unmount();
  });
});
