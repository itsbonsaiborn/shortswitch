import { describe, expect, it } from 'vitest';
import { aggregateWordCloud, gradeOpenAnswer, matchesModerationRule, normalizeOpenAnswer } from './activity-text-grading.js';

describe('Activity text grading', () => {
  it('normalizes Latvian Unicode, case, and whitespace only when configured', () => {
    expect(normalizeOpenAnswer('  Tīkla\n  adrese ', { ignoreCase: true, normalizeWhitespace: true })).toBe('tīkla adrese');
    expect(gradeOpenAnswer({ answer: 'TĪKLA   ADRESE', acceptedAnswers: ['tīkla adrese', 'IP adrese'], points: 4, mode: 'normalized', ignoreCase: true, normalizeWhitespace: true })).toEqual({ correct: true, awardedPoints: 4 });
    expect(gradeOpenAnswer({ answer: 'TĪKLA ADRESE', acceptedAnswers: ['tīkla adrese'], points: 4, mode: 'exact', ignoreCase: true, normalizeWhitespace: true }).correct).toBe(false);
  });

  it('aggregates equivalent word-cloud entries without losing display Unicode', () => {
    expect(aggregateWordCloud([
      { text: ' Datortīkli ', participantName: 'Anna' },
      { text: 'DATORTĪKLI', participantName: 'Jānis' },
      { text: 'IP   adrese', participantName: null }
    ])).toEqual({
      totalResponses: 3,
      uniqueResponses: 2,
      items: [
        { text: 'Datortīkli', count: 2, participantNames: ['Anna', 'Jānis'] },
        { text: 'IP adrese', count: 1, participantNames: [] }
      ]
    });
  });

  it('supports contains and Unicode-aware whole-word moderation', () => {
    expect(matchesModerationRule('Gazan67', [{ pattern: '67', matchMode: 'contains' }])).toBe(true);
    expect(matchesModerationRule('slikts vārds!', [{ pattern: 'slikts vārds', matchMode: 'whole_word' }])).toBe(true);
    expect(matchesModerationRule('neslikts', [{ pattern: 'slikts', matchMode: 'whole_word' }])).toBe(false);
  });
});
