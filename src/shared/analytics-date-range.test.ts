import { describe, expect, test } from 'vitest';
import { analyticsSelectionFromQuery, resolveAnalyticsDateRange } from './analytics-date-range.js';

describe('analytics date ranges', () => {
  test('defaults to the current Monday-to-now Riga calendar week', () => {
    const range = resolveAnalyticsDateRange({ preset: 'current_week' }, new Date('2026-11-14T10:00:00.000Z'));
    expect(range.startDate).toBe('2026-11-09');
    expect(range.endDate).toBe('2026-11-14');
    expect(range.startAt).toBe('2026-11-08T22:00:00.000Z');
    expect(range.endAt).toBe('2026-11-14T10:00:00.000Z');
    expect(range.buckets).toHaveLength(6);
  });

  test('maps the previous completed-week identifier to the current-week preset', () => {
    expect(analyticsSelectionFromQuery({ datePreset: 'last_completed_week' })).toEqual({ preset: 'current_week' });
  });

  test('uses the current moment as the exclusive month end', () => {
    const now = new Date('2026-11-14T10:34:56.000Z');
    const range = resolveAnalyticsDateRange({ preset: 'current_month' }, now);
    expect(range.startAt).toBe('2026-10-31T22:00:00.000Z');
    expect(range.endAt).toBe(now.toISOString());
    expect(range.endDate).toBe('2026-11-14');
  });

  test('respects Riga daylight-saving changes at calendar boundaries', () => {
    const range = resolveAnalyticsDateRange(
      { preset: 'custom', startDate: '2026-10-25', endDate: '2026-10-25' },
      new Date('2026-11-01T12:00:00.000Z')
    );
    expect(range.startAt).toBe('2026-10-24T21:00:00.000Z');
    expect(range.endAt).toBe('2026-10-25T22:00:00.000Z');
    expect(Date.parse(range.endAt) - Date.parse(range.startAt)).toBe(25 * 3_600_000);
    expect(range.granularity).toBe('hour');
    expect(range.buckets).toHaveLength(25);
  });

  test('uses inclusive custom dates and an exclusive UTC end', () => {
    const range = resolveAnalyticsDateRange(
      { preset: 'custom', startDate: '2026-03-28', endDate: '2026-03-30' },
      new Date('2026-04-01T12:00:00.000Z')
    );
    expect(range.startAt).toBe('2026-03-27T22:00:00.000Z');
    expect(range.endAt).toBe('2026-03-30T21:00:00.000Z');
    expect(range.buckets.map((bucket) => bucket.key)).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);
    expect(range.granularity).toBe('day');
  });

  test('selects daily, weekly and monthly aggregation from the calendar span', () => {
    const now = new Date('2026-12-31T12:00:00.000Z');
    const daily = resolveAnalyticsDateRange(
      { preset: 'custom', startDate: '2026-01-01', endDate: '2026-01-31' },
      now
    );
    const weekly = resolveAnalyticsDateRange(
      { preset: 'custom', startDate: '2026-01-01', endDate: '2026-02-15' },
      now
    );
    const monthly = resolveAnalyticsDateRange(
      { preset: 'custom', startDate: '2026-01-01', endDate: '2026-07-31' },
      now
    );

    expect(daily.granularity).toBe('day');
    expect(daily.buckets).toHaveLength(31);
    expect(weekly.granularity).toBe('week');
    expect(weekly.buckets[0]?.key).toBe('2025-12-29');
    expect(weekly.buckets.at(-1)?.key).toBe('2026-02-09');
    expect(monthly.granularity).toBe('month');
    expect(monthly.buckets.map((bucket) => bucket.key)).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
      '2026-05-01',
      '2026-06-01',
      '2026-07-01'
    ]);
  });
});
