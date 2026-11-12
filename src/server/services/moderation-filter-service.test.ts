// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { findModerationRuleMatch } from './moderation-filter-service.js';

const rules = [
  { id: 'one', userId: 'user', pattern: 'slikts vārds', matchMode: 'contains' as const, createdAt: '', updatedAt: '' },
  { id: 'two', userId: 'user', pattern: 'kaķis', matchMode: 'whole_word' as const, createdAt: '', updatedAt: '' }
];

describe('shared moderation word matching', () => {
  test('normalizes Unicode, case and repeated whitespace for Live and Boards', () => {
    expect(findModerationRuleMatch(rules, 'Te ir SLIKTS   VĀRDS!')?.id).toBe('one');
    expect(findModerationRuleMatch(rules, 'Te ir slikts\u200B vārds!')?.id).toBe('one');
    expect(findModerationRuleMatch(rules, 'Mans kaķis guļ.')?.id).toBe('two');
  });

  test('keeps whole-word matching from rejecting a longer Latvian word', () => {
    expect(findModerationRuleMatch(rules, 'kaķisks')).toBeUndefined();
  });
});
