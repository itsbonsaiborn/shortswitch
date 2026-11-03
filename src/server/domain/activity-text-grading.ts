export interface OpenAnswerGradeInput {
  answer: string;
  acceptedAnswers: string[];
  points: number;
  mode: 'exact' | 'normalized';
  ignoreCase: boolean;
  normalizeWhitespace: boolean;
}

export const normalizeOpenAnswer = (
  value: string,
  options: { ignoreCase: boolean; normalizeWhitespace: boolean }
) => {
  let normalized = value.normalize('NFKC');
  if (options.normalizeWhitespace) normalized = normalized.trim().replace(/\s+/gu, ' ');
  if (options.ignoreCase) normalized = normalized.toLowerCase();
  return normalized;
};

export const gradeOpenAnswer = (input: OpenAnswerGradeInput) => {
  const normalize = input.mode === 'exact'
    ? (value: string) => value
    : (value: string) => normalizeOpenAnswer(value, input);
  const correct = input.acceptedAnswers.some((accepted) => normalize(accepted) === normalize(input.answer));
  return { correct, awardedPoints: correct ? input.points : 0 };
};

export const normalizeWordCloudText = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ');

export interface WordCloudAggregateInput {
  text: string;
  participantName: string | null;
}

export const aggregateWordCloud = (responses: WordCloudAggregateInput[], limit = 150) => {
  const entries = new Map<string, { text: string; count: number; participantNames: Set<string> }>();
  for (const response of responses) {
    const text = normalizeWordCloudText(response.text);
    if (!text) continue;
    const key = text.toLowerCase();
    const entry = entries.get(key) ?? { text, count: 0, participantNames: new Set<string>() };
    entry.count += 1;
    if (response.participantName) entry.participantNames.add(response.participantName);
    entries.set(key, entry);
  }
  const sorted = [...entries.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
  return {
    totalResponses: sorted.reduce((sum, entry) => sum + entry.count, 0),
    uniqueResponses: sorted.length,
    items: sorted.slice(0, limit).map((entry) => ({
      text: entry.text,
      count: entry.count,
      participantNames: [...entry.participantNames]
    }))
  };
};

export interface ModerationRuleInput {
  pattern: string;
  matchMode: 'whole_word' | 'contains';
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const normalizeModerationText = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();

export const matchesModerationRule = (text: string, rules: ModerationRuleInput[]) => {
  const candidate = normalizeModerationText(text);
  return rules.some((rule) => {
    const pattern = normalizeModerationText(rule.pattern);
    if (!pattern) return false;
    if (rule.matchMode === 'contains') return candidate.includes(pattern);
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegex(pattern)}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(candidate);
  });
};
