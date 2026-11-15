// @vitest-environment jsdom
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import SettingsPage from './SettingsPage.vue';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock('../lib/api', () => ({ api: apiMock }));
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,qr') }
}));
vi.mock('../composables/usePreferences', () => ({
  usePreferences: () => ({ locale: ref('en'), setLocale: vi.fn(), syncError: ref(null), retry: vi.fn() })
}));
vi.mock('../composables/useDisplayPreferences', () => ({
  useDisplayPreferences: () => ({
    publicLanguagePreference: ref('auto'),
    publicAppearancePreference: ref('system'),
    setPublicDisplayPreferences: vi.fn()
  })
}));
vi.mock('../composables/useTheme', () => ({
  useTheme: () => ({ theme: ref('system'), setTheme: vi.fn() })
}));

const disabledStatus = {
  enabled: false,
  enrollmentAvailable: true,
  recoveryCodesRemaining: 0
};

const buttonWithText = (text: string) => {
  const element = [...document.body.querySelectorAll('button')]
    .find((button) => button.textContent?.trim().startsWith(text));
  if (!element) throw new Error(`Button not found: ${text}`);
  return new DOMWrapper(element);
};

const openEnrollment = async () => {
  await buttonWithText('Set up two-factor authentication').trigger('click');
  await flushPromises();
  await nextTick();
};

describe('SettingsPage two-factor enrollment dialog', () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/sessions') return Promise.resolve([]);
      if (url === '/api/moderation/rules') return Promise.resolve([]);
      if (url === '/api/settings/public-display') return Promise.resolve({ language: 'auto', appearance: 'system' });
      if (url === '/api/settings/two-factor/enrollment') {
        return Promise.resolve({ otpauthUri: 'otpauth://totp/ShortSwitch', manualKey: 'ABCD EFGH' });
      }
      if (url === '/api/settings/two-factor/enrollment/confirm') {
        return Promise.resolve({ enabled: true, recoveryCodes: ['AAAA-BBBB', 'CCCC-DDDD'] });
      }
      if (url === '/api/settings/two-factor' && (!options?.method || options.method === 'GET')) {
        return Promise.resolve({ ...disabledStatus, enabled: url.includes('never') });
      }
      return Promise.resolve({});
    });
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  test('opens setup in a modal and ignores backdrop clicks', async () => {
    const wrapper = mount(SettingsPage, { attachTo: document.body });
    await flushPromises();
    await openEnrollment();

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('ABCD EFGH');
    expect(dialog?.textContent).toContain('6-digit verification code');

    dialog?.parentElement?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    wrapper.unmount();
  });

  test('blocks Close and Escape for five seconds when recovery codes appear', async () => {
    const wrapper = mount(SettingsPage, { attachTo: document.body });
    await flushPromises();
    await openEnrollment();

    const input = document.body.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]');
    expect(input).not.toBeNull();
    if (input) {
      input.value = '123456';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await nextTick();

    vi.useFakeTimers();
    await buttonWithText('Confirm and enable').trigger('click');
    await flushPromises();
    await nextTick();

    expect(document.body.textContent).toContain('AAAA-BBBB');
    const blockedClose = buttonWithText('Close (5)');
    expect(blockedClose.attributes('disabled')).toBeDefined();
    expect(blockedClose.classes()).toEqual(expect.arrayContaining(['disabled:cursor-not-allowed', 'disabled:opacity-45']));
    (blockedClose.element as HTMLButtonElement).click();
    await nextTick();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

    vi.advanceTimersByTime(4_000);
    await nextTick();
    expect(buttonWithText('Close (1)').attributes('disabled')).toBeDefined();

    vi.advanceTimersByTime(1_000);
    await nextTick();
    const close = buttonWithText('Close');
    expect(close.attributes('disabled')).toBeUndefined();
    await close.trigger('click');
    await nextTick();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    wrapper.unmount();
  });
});
