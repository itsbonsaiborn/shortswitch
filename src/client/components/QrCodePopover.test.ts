// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import QrCodePopover from './QrCodePopover.vue';

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,test-qr')
  }
}));

describe('QrCodePopover', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  test('opens the shared QR popover and closes it on an outside click', async () => {
    const wrapper = mount(QrCodePopover, {
      attachTo: document.body,
      props: {
        url: 'http://localhost:3000/testins',
        slug: 'testins',
        instanceId: 'activity-1'
      }
    });

    await wrapper.get('button[aria-label="Show QR code"]').trigger('click');
    await flushPromises();

    expect(document.body.textContent).toContain('Download QR');
    expect(document.body.querySelector<HTMLImageElement>('img[alt="QR code"]')?.src)
      .toBe('data:image/png;base64,test-qr');

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    expect(document.body.textContent).not.toContain('Download QR');

    wrapper.unmount();
  });
});
