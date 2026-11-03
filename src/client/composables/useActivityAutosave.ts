import { onBeforeUnmount, reactive } from 'vue';
import type { ActivitySupportedAnswer } from '@/shared/activity-types';

export type ActivitySaveState = 'idle' | 'saving' | 'saved' | 'error';

export const useActivityAutosave = (
  save: (questionBlockId: string, answer: ActivitySupportedAnswer, clientRevision: number) => Promise<unknown>,
  delay = 700
) => {
  const states = reactive<Record<string, ActivitySaveState>>({});
  const revisions = new Map<string, number>();
  const pending = new Map<string, { answer: ActivitySupportedAnswer; revision: number }>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const seed = (questionBlockId: string, revision: number) => revisions.set(questionBlockId, revision);
  const flush = async (questionBlockId: string) => {
    const item = pending.get(questionBlockId);
    if (!item) return true;
    const timer = timers.get(questionBlockId);
    if (timer) clearTimeout(timer);
    timers.delete(questionBlockId);
    states[questionBlockId] = 'saving';
    try {
      await save(questionBlockId, item.answer, item.revision);
      if (pending.get(questionBlockId) === item) pending.delete(questionBlockId);
      states[questionBlockId] = pending.has(questionBlockId) ? 'idle' : 'saved';
      return true;
    } catch {
      states[questionBlockId] = 'error';
      return false;
    }
  };
  const schedule = (questionBlockId: string, answer: ActivitySupportedAnswer) => {
    const revision = (revisions.get(questionBlockId) ?? 0) + 1;
    revisions.set(questionBlockId, revision);
    pending.set(questionBlockId, { answer, revision });
    states[questionBlockId] = 'idle';
    const current = timers.get(questionBlockId);
    if (current) clearTimeout(current);
    timers.set(questionBlockId, setTimeout(() => void flush(questionBlockId), delay));
  };
  const flushAll = async (questionBlockIds?: string[]) => {
    const ids = questionBlockIds ?? [...pending.keys()];
    const results = await Promise.all(ids.map((id) => flush(id)));
    return results.every(Boolean);
  };
  const retry = (questionBlockId: string) => flush(questionBlockId);
  onBeforeUnmount(() => timers.forEach((timer) => clearTimeout(timer)));
  return { states, seed, schedule, flush, flushAll, retry };
};
