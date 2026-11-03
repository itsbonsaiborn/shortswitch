// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActivitySupportedAnswer } from '@/shared/activity-types';
import { useActivityAutosave } from './useActivityAutosave';

describe('useActivityAutosave', () => {
  beforeEach(() => vi.useFakeTimers());

  test('debounces changes and reuses the same revision after a network failure', async () => {
    const save = vi.fn<(_: string, __: ActivitySupportedAnswer, ___: number) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true });
    let autosave!: ReturnType<typeof useActivityAutosave>;
    const wrapper = mount(defineComponent({
      setup() { autosave = useActivityAutosave(save, 100); return () => null; }
    }));
    autosave.schedule('q1', { questionType: 'open_answer', text: 'Draft' });
    await vi.advanceTimersByTimeAsync(100);
    expect(autosave.states.q1).toBe('error');
    expect(save).toHaveBeenNthCalledWith(1, 'q1', { questionType: 'open_answer', text: 'Draft' }, 1);

    await autosave.retry('q1');
    expect(autosave.states.q1).toBe('saved');
    expect(save).toHaveBeenNthCalledWith(2, 'q1', { questionType: 'open_answer', text: 'Draft' }, 1);
    wrapper.unmount();
  });

  test('flushes immediately before navigation', async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    let autosave!: ReturnType<typeof useActivityAutosave>;
    const wrapper = mount(defineComponent({ setup() { autosave = useActivityAutosave(save, 10_000); return () => null; } }));
    autosave.schedule('q1', { questionType: 'single_choice', optionId: 'a' });
    expect(await autosave.flushAll(['q1'])).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(autosave.states.q1).toBe('saved');
    wrapper.unmount();
  });

  test('autosaves the latest multiple-choice selection set', async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    let autosave!: ReturnType<typeof useActivityAutosave>;
    const wrapper = mount(defineComponent({ setup() { autosave = useActivityAutosave(save, 100); return () => null; } }));
    autosave.schedule('q-choice', { questionType: 'multiple_choice', optionIds: ['a'] });
    autosave.schedule('q-choice', { questionType: 'multiple_choice', optionIds: ['a', 'c'] });
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('q-choice', { questionType: 'multiple_choice', optionIds: ['a', 'c'] }, 2);
    wrapper.unmount();
  });

  test('autosaves the latest Word Cloud response collection', async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    let autosave!: ReturnType<typeof useActivityAutosave>;
    const wrapper = mount(defineComponent({ setup() { autosave = useActivityAutosave(save, 100); return () => null; } }));
    autosave.schedule('q-cloud', { questionType: 'word_cloud', responses: ['Datortīkli'] });
    autosave.schedule('q-cloud', { questionType: 'word_cloud', responses: ['Datortīkli', 'IP adrese'] });
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('q-cloud', { questionType: 'word_cloud', responses: ['Datortīkli', 'IP adrese'] }, 2);
    wrapper.unmount();
  });
});
