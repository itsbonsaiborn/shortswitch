import type { AnalyticsBreakdowns } from '@/shared/types.js';

export type AnalyticsBreakdownRow = {
  category: keyof AnalyticsBreakdowns;
  label: string;
  value: number;
};

export const buildAnalyticsBreakdowns = (rows: AnalyticsBreakdownRow[]): AnalyticsBreakdowns => {
  const grouped = (category: keyof AnalyticsBreakdowns) => rows
    .filter((row) => row.category === category)
    .map((row) => ({ label: row.label, value: Number(row.value) }));
  const mergeBrowserFamilies = (items: Array<{ label: string; value: number }>) => {
    const values = new Map<string, number>();
    for (const item of items) {
      const label = /edg|edge/i.test(item.label)
        ? 'Edge'
        : /firefox/i.test(item.label)
          ? 'Firefox'
          : /chrome|chromium/i.test(item.label)
            ? 'Chrome'
            : /safari/i.test(item.label)
              ? 'Safari'
              : /opera|opr/i.test(item.label)
                ? 'Opera'
                : item.label;
      values.set(label, (values.get(label) ?? 0) + item.value);
    }
    return [...values.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
  };
  return {
    devices: grouped('devices'),
    browsers: mergeBrowserFamilies(grouped('browsers')),
    operatingSystems: grouped('operatingSystems'),
    languages: grouped('languages')
  };
};
