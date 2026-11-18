// @vitest-environment jsdom

import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import RemoteBlocklistsSection from './RemoteBlocklistsSection.vue';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../lib/api', () => ({ api: apiMock }));

const source = {
  id: 'source-1',
  url: 'https://raw.githubusercontent.com/school/rules/main/blocked.txt',
  parsingMode: 'smart',
  updateIntervalMinutes: 60,
  enabled: true,
  createdAt: '2026-11-18T08:00:00.000Z',
  updatedAt: '2026-11-18T09:00:00.000Z',
  lastSuccessfulUpdateAt: '2026-11-18T09:00:00.000Z',
  lastCheckedAt: '2026-11-18T10:00:00.000Z',
  ruleCount: 2,
  syncStatus: 'unchanged',
  lastError: null,
  syncing: false
} as const;

const buttonWithText = (text: string) => {
  const element = [...document.body.querySelectorAll('button')]
    .find((button) => button.textContent?.trim().startsWith(text));
  if (!element) throw new Error(`Button not found: ${text}`);
  return new DOMWrapper(element);
};

const buttonWithLabel = (label: string) => {
  const element = document.body.querySelector(`button[aria-label="${label}"]`);
  if (!element) throw new Error(`Button not found: ${label}`);
  return new DOMWrapper(element);
};

describe('RemoteBlocklistsSection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    apiMock.mockReset();
    apiMock.mockImplementation((url: string) => {
      if (url === '/api/moderation/remote-sources') return Promise.resolve([source]);
      if (url.startsWith('/api/moderation/remote-sources/source-1?')) {
        return Promise.resolve({
          source,
          previewLimit: 500,
          rules: [
            { id: 'rule-1', pattern: 'blocked phrase', matchMode: 'contains', position: 0 },
            { id: 'rule-2', pattern: 'word', matchMode: 'whole_word', position: 1 }
          ]
        });
      }
      return Promise.resolve(source);
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('renders synchronization metadata and opens the cached Smart rule preview', async () => {
    const wrapper = mount(RemoteBlocklistsSection, { attachTo: document.body });
    await flushPromises();
    expect(wrapper.text()).toContain('school/rules · blocked.txt');
    expect(wrapper.text()).toContain('Checked · no changes');
    expect(wrapper.text()).toContain('Cached parsed rules');
    expect(wrapper.text()).toContain('2');
    expect(document.body.querySelector('button[aria-label="Disable"]')).not.toBeNull();

    await buttonWithLabel('Edit').trigger('click');
    await flushPromises();
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog).toHaveClass('remote-blocklist-dialog', 'remote-blocklist-dialog--editing');
    expect(dialog?.textContent).toContain('blocked phrase');
    expect(dialog?.textContent).toContain('Contains');
    expect(dialog?.textContent).toContain('Whole word');
    const preview = dialog?.querySelector('[data-remote-rule-preview]');
    expect(preview).toHaveClass('grid', 'grid-cols-1', 'md:grid-cols-2', 'overflow-y-auto', 'overflow-x-hidden');
    expect(preview?.querySelector('.remote-blocklist-rule')).toHaveClass('min-w-0', 'flex-1', 'whitespace-pre-wrap');
    expect(dialog?.querySelector('.remote-blocklist-actions')).not.toBeNull();

    dialog?.parentElement?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    wrapper.unmount();
  });

  test('creates a manual source and refreshes a card without reloading the page', async () => {
    const created = {
      ...source,
      id: 'source-2',
      parsingMode: 'whole',
      updateIntervalMinutes: null,
      ruleCount: 0,
      syncStatus: 'pending',
      lastSuccessfulUpdateAt: null,
      lastCheckedAt: null
    };
    let listCalls = 0;
    apiMock.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/moderation/remote-sources' && options?.method === 'POST') return Promise.resolve(created);
      if (url === '/api/moderation/remote-sources') {
        listCalls += 1;
        return Promise.resolve([source]);
      }
      if (url.endsWith('/sync')) return Promise.resolve({ ...source, syncStatus: 'success' });
      return Promise.resolve(source);
    });
    const wrapper = mount(RemoteBlocklistsSection, { attachTo: document.body });
    await flushPromises();
    await buttonWithText('Add remote blocklist').trigger('click');
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    const urlInput = dialog?.querySelector<HTMLInputElement>('input[type="url"]');
    expect(urlInput).not.toBeNull();
    if (urlInput) {
      urlInput.value = created.url;
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const selects = dialog?.querySelectorAll<HTMLSelectElement>('select');
    if (selects?.[0]) {
      selects[0].value = 'whole';
      selects[0].dispatchEvent(new Event('change', { bubbles: true }));
    }
    const form = dialog?.querySelector('form');
    if (!form) throw new Error('Remote source form not found');
    await new DOMWrapper(form).trigger('submit');
    await flushPromises();
    expect(apiMock).toHaveBeenCalledWith('/api/moderation/remote-sources', expect.objectContaining({ method: 'POST' }));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(wrapper.text()).toContain('Never synchronized');

    await buttonWithLabel('Refresh now').trigger('click');
    await flushPromises();
    expect(apiMock).toHaveBeenCalledWith('/api/moderation/remote-sources/source-2/sync', expect.objectContaining({ method: 'POST' }));
    expect(listCalls).toBeGreaterThan(1);
    wrapper.unmount();
  });

  test('requires confirmation before deleting a source', async () => {
    apiMock.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/moderation/remote-sources' && !options?.method) return Promise.resolve([source]);
      if (url === '/api/moderation/remote-sources/source-1' && options?.method === 'DELETE') return Promise.resolve({ ok: true });
      return Promise.resolve(source);
    });
    const wrapper = mount(RemoteBlocklistsSection, { attachTo: document.body });
    await flushPromises();
    await buttonWithText('Delete').trigger('click');
    expect(document.body.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(apiMock).not.toHaveBeenCalledWith('/api/moderation/remote-sources/source-1', expect.objectContaining({ method: 'DELETE' }));
    const deleteButtons = [...document.body.querySelectorAll('button')].filter((button) => button.textContent?.trim() === 'Delete');
    deleteButtons.at(-1)?.click();
    await flushPromises();
    expect(apiMock).toHaveBeenCalledWith('/api/moderation/remote-sources/source-1', expect.objectContaining({ method: 'DELETE' }));
    expect(wrapper.text()).not.toContain('school/rules · blocked.txt');
    wrapper.unmount();
  });
});
