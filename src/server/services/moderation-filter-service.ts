import type { ModerationMatchMode, ModerationRule } from '@/shared/types.js';
import { LiveRepository } from '../repositories/live-repository.js';

// Format controls such as zero-width spaces must not split an otherwise matching
// phrase. This normalization is shared by Live and Boards.
const normalizedText = (value: string) => value.normalize('NFKC').replace(/\p{Cf}/gu, '').trim().replace(/\s+/gu, ' ');
const normalizedMatchText = (value: string) => normalizedText(value).toLocaleLowerCase();
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matchModes = new Set<ModerationMatchMode>(['whole_word', 'contains']);

export const findModerationRuleMatch = (rules: ModerationRule[], text: string) => {
  const normalized = normalizedMatchText(text);
  return rules.find((rule) => {
    const pattern = normalizedMatchText(rule.pattern);
    if (rule.matchMode === 'contains') return normalized.includes(pattern);
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(pattern)}(?=$|[^\\p{L}\\p{N}])`, 'u').test(normalized);
  });
};

export class ModerationFilterService {
  private readonly repository = new LiveRepository();
  private readonly cache = new Map<string, ModerationRule[]>();

  match(userId: string, text: string) {
    let rules = this.cache.get(userId);
    if (!rules) {
      rules = this.repository.listModerationRules(userId);
      this.cache.set(userId, rules);
    }
    return findModerationRuleMatch(rules, text);
  }

  list(userId: string) {
    const rules = this.repository.listModerationRules(userId);
    this.cache.set(userId, rules);
    return rules;
  }

  create(userId: string, pattern: string, matchMode: ModerationMatchMode) {
    const validated = this.validate(pattern, matchMode);
    const result = this.repository.createModerationRule(userId, validated.pattern, validated.matchMode);
    this.cache.delete(userId);
    return result;
  }

  update(userId: string, id: string, pattern: string, matchMode: ModerationMatchMode) {
    const validated = this.validate(pattern, matchMode);
    const result = this.repository.updateModerationRule(id, userId, validated.pattern, validated.matchMode);
    if (!result) throw new Error('Moderation rule not found.');
    this.cache.delete(userId);
    return result;
  }

  delete(userId: string, id: string) {
    if (!this.repository.deleteModerationRule(id, userId)) throw new Error('Moderation rule not found.');
    this.cache.delete(userId);
  }

  private validate(pattern: string, matchMode: ModerationMatchMode) {
    const cleanPattern = normalizedText(String(pattern ?? ''));
    if (!cleanPattern || cleanPattern.length > 120) throw new Error('Rule must contain between 1 and 120 characters.');
    if (!matchModes.has(matchMode)) throw new Error('Invalid match mode.');
    return { pattern: cleanPattern, matchMode };
  }
}
