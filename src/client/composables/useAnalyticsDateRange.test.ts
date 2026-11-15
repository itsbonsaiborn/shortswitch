// @vitest-environment jsdom
import { nextTick } from 'vue';
import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('useAnalyticsDateRange', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.resetModules();
  });

  test('shares selection and persists its preset for a refreshed module', async () => {
    const firstModule = await import('./useAnalyticsDateRange');
    const first = firstModule.useAnalyticsDateRange();
    expect(first.selection.value).toEqual({ preset: 'current_week' });

    first.selectPreset('current_month');
    await nextTick();
    expect(JSON.parse(sessionStorage.getItem('shortswitch.analyticsDateRange.v1') ?? '{}')).toEqual({ preset: 'current_month' });
    expect(firstModule.useAnalyticsDateRange().selection.value).toEqual({ preset: 'current_month' });

    vi.resetModules();
    const refreshedModule = await import('./useAnalyticsDateRange');
    expect(refreshedModule.useAnalyticsDateRange().selection.value).toEqual({ preset: 'current_month' });
  });

  test('persists custom dates and generates the shared API query', async () => {
    const dateRange = (await import('./useAnalyticsDateRange')).useAnalyticsDateRange();
    dateRange.selectCustomRange('2026-10-24', '2026-10-26');
    await nextTick();

    expect(dateRange.query.value).toBe('datePreset=custom&startDate=2026-10-24&endDate=2026-10-26');
    expect(JSON.parse(sessionStorage.getItem('shortswitch.analyticsDateRange.v1') ?? '{}')).toEqual({
      preset: 'custom',
      startDate: '2026-10-24',
      endDate: '2026-10-26'
    });
  });
});
