import { describe, expect, test } from 'vitest';
import {
  earliestActivityDeadline,
  utcActivityDateTimeToLocalInput,
  zonedActivityDateTimeToUtc
} from './activity-deadline.js';

describe('Activity deadline timezone conversion', () => {
  test('stores Riga winter and summer local times as UTC', () => {
    expect(zonedActivityDateTimeToUtc('2026-11-05T12:00', 'Europe/Riga')).toBe('2026-11-05T10:00:00.000Z');
    expect(zonedActivityDateTimeToUtc('2026-07-05T12:00', 'Europe/Riga')).toBe('2026-07-05T09:00:00.000Z');
    expect(utcActivityDateTimeToLocalInput('2026-11-05T10:00:00.000Z', 'Europe/Riga')).toBe('2026-11-05T12:00');
  });

  test('rejects nonexistent DST minutes and deterministically chooses the earlier repeated minute', () => {
    expect(zonedActivityDateTimeToUtc('2026-03-29T03:30', 'Europe/Riga')).toBeNull();
    expect(zonedActivityDateTimeToUtc('2026-10-25T03:30', 'Europe/Riga')).toBe('2026-10-25T00:30:00.000Z');
  });

  test('selects the earlier effective deadline', () => {
    expect(earliestActivityDeadline('2026-11-05T12:00:00.000Z', '2026-11-05T11:00:00.000Z'))
      .toBe('2026-11-05T11:00:00.000Z');
    expect(earliestActivityDeadline(null, undefined)).toBeNull();
  });
});
