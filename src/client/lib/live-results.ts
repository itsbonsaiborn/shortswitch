import type { LiveResultsDelta, LiveResultsSnapshot } from '@/shared/types';

const wordKey = (text: string) => text.normalize('NFKC').toLocaleLowerCase();

export const applyLiveResultsDelta = (
  current: LiveResultsSnapshot,
  delta: LiveResultsDelta
): LiveResultsSnapshot | null => {
  if (delta.baseRevision !== current.revision || delta.revision <= current.revision) return null;
  const next: LiveResultsSnapshot = {
    ...current,
    revision: delta.revision,
    status: delta.status ?? current.status,
    publicResults: delta.publicResults ?? current.publicResults,
    responseCount: delta.responseCount ?? current.responseCount,
    uniqueParticipantCount: delta.uniqueParticipantCount ?? current.uniqueParticipantCount,
    openAnswerTotal: delta.openAnswerTotal ?? current.openAnswerTotal,
    wordCloudTotal: delta.wordCloudTotal ?? current.wordCloudTotal,
    choices: delta.choices ?? current.choices,
    scale: delta.scale === undefined ? current.scale : delta.scale
  };

  if (delta.openAnswers) {
    const answers = new Map(current.openAnswers.map((answer) => [answer.id, answer]));
    for (const id of delta.openAnswers.removeIds) answers.delete(id);
    for (const answer of delta.openAnswers.upsert) answers.set(answer.id, answer);
    next.openAnswers = [...answers.values()].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
    );
  }

  if (delta.wordCloud) {
    const words = new Map(current.wordCloud.map((word) => [wordKey(word.text), word]));
    for (const key of delta.wordCloud.removeKeys) words.delete(key);
    for (const word of delta.wordCloud.upsert) words.set(wordKey(word.text), word);
    next.wordCloud = [...words.values()].sort((left, right) =>
      right.count - left.count || left.text.localeCompare(right.text)
    );
  }

  return next;
};
