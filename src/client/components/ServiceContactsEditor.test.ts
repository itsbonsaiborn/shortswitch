// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import type { ServiceContactConfig } from '@/shared/types';
import ServiceContactsEditor from './ServiceContactsEditor.vue';

const config: ServiceContactConfig = { blocks: [
  { id: 'heading', type: 'heading', titleEn: 'Contacts', titleLv: 'Kontakti' },
  { id: 'form', type: 'contact_form', titleEn: 'Contact form', titleLv: 'Saziņas forma', descriptionEn: 'Later', descriptionLv: 'Vēlāk' }
] };

describe('ServiceContactsEditor', () => {
  test('offers responsive preview and accessible ordering without removing the controlled form', async () => {
    const wrapper = mount(ServiceContactsEditor, { props: { modelValue: config } });
    expect(wrapper.findAll('button[aria-label="Delete"]')).toHaveLength(1);
    expect(wrapper.text()).toContain('Live preview');

    await wrapper.findAll('button[aria-label="Move down"]')[0]!.trigger('click');
    const moved = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as ServiceContactConfig;
    expect(moved.blocks.map((block) => block.id)).toEqual(['form', 'heading']);

    const mobile = wrapper.findAll('button').find((button) => button.text() === 'Mobile');
    expect(mobile).toBeTruthy();
    await mobile!.trigger('click');
    expect(wrapper.findAll('div').some((element) => element.classes().includes('max-w-[390px]'))).toBe(true);
    wrapper.unmount();
  });
});
