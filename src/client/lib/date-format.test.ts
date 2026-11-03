import { describe, expect, it } from 'vitest';
import { formatCardDate } from './date-format';

describe('formatCardDate', () => {
  it('uses an unambiguous day-month-year card stamp', () => {
    expect(formatCardDate(new Date(2026, 10, 2, 12, 0, 0))).toBe('02-11-2026');
  });

  it('handles invalid values without throwing', () => {
    expect(formatCardDate('not-a-date')).toBe('—');
  });
});
