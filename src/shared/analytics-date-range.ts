export const ANALYTICS_TIME_ZONE = 'Europe/Riga';
export const DEFAULT_ANALYTICS_DATE_PRESET = 'current_week' as const;

export type AnalyticsDatePreset = 'today' | 'current_week' | 'current_month' | 'custom';

export interface AnalyticsDateRangeSelection {
  preset: AnalyticsDatePreset;
  startDate?: string;
  endDate?: string;
}

export interface AnalyticsDateBucket {
  key: string;
  label: string;
}

export interface ResolvedAnalyticsDateRange {
  preset: AnalyticsDatePreset;
  startAt: string;
  endAt: string;
  previousStartAt: string;
  startDate: string;
  endDate: string;
  granularity: AnalyticsDateGranularity;
  buckets: AnalyticsDateBucket[];
}

export type AnalyticsDateGranularity = 'hour' | 'day' | 'week' | 'month';

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ANALYTICS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: ANALYTICS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});
const hourFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: ANALYTICS_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});
const shortDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short'
});
const shortMonthFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  month: 'short',
  year: 'numeric'
});

const partsRecord = (formatter: Intl.DateTimeFormat, value: Date) =>
  Object.fromEntries(formatter.formatToParts(value).map((part) => [part.type, part.value]));

export const formatRigaDateKey = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = partsRecord(dateFormatter, date);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const formatRigaHour = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return Number(partsRecord(dateTimeFormatter, date).hour ?? 0);
};

export const formatRigaWeekday = (value: Date | string) => {
  const key = formatRigaDateKey(value);
  if (!key) return 1;
  const day = new Date(`${key}T00:00:00.000Z`).getUTCDay();
  return ((day + 6) % 7) + 1;
};

export const formatRigaWeekKey = (value: Date | string) => {
  const key = formatRigaDateKey(value);
  return key ? addCalendarDays(key, -(formatRigaWeekday(value) - 1)) : '';
};

export const formatRigaMonthKey = (value: Date | string) => {
  const key = formatRigaDateKey(value);
  return key ? `${key.slice(0, 7)}-01` : '';
};

const isDateKey = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export const addCalendarDays = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const addCalendarMonths = (dateKey: string, months: number) => {
  const date = new Date(`${dateKey.slice(0, 7)}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
};

const calendarDaySpan = (startDate: string, endDate: string) =>
  Math.floor((Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)) / 86_400_000) + 1;

const zonedMidnightToUtc = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const wanted = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  let instant = wanted;
  for (let index = 0; index < 4; index += 1) {
    const parts = partsRecord(dateTimeFormatter, new Date(instant));
    const actual = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    const correction = wanted - actual;
    instant += correction;
    if (correction === 0) break;
  }
  return new Date(instant);
};

const dateLabel = (dateKey: string) => shortDateFormatter.format(new Date(`${dateKey}T00:00:00.000Z`));
const utcHourKey = (date: Date) => `${date.toISOString().slice(0, 13)}:00:00.000Z`;

export const normalizeAnalyticsDateRangeSelection = (value: unknown): AnalyticsDateRangeSelection => {
  if (!value || typeof value !== 'object') return { preset: DEFAULT_ANALYTICS_DATE_PRESET };
  const candidate = value as Partial<AnalyticsDateRangeSelection>;
  if (String(candidate.preset) === 'last_completed_week') return { preset: 'current_week' };
  if (!['today', 'current_week', 'current_month', 'custom'].includes(String(candidate.preset))) {
    return { preset: DEFAULT_ANALYTICS_DATE_PRESET };
  }
  if (candidate.preset !== 'custom') return { preset: candidate.preset } as AnalyticsDateRangeSelection;
  if (!isDateKey(candidate.startDate) || !isDateKey(candidate.endDate)) {
    return { preset: DEFAULT_ANALYTICS_DATE_PRESET };
  }
  return { preset: 'custom', startDate: candidate.startDate, endDate: candidate.endDate };
};

export const analyticsSelectionFromQuery = (query: Record<string, unknown>): AnalyticsDateRangeSelection => {
  const preset = query.datePreset;
  if (preset === 'custom') {
    const selection = normalizeAnalyticsDateRangeSelection({ preset, startDate: query.startDate, endDate: query.endDate });
    if (selection.preset !== 'custom') throw new Error('Custom analytics ranges require valid startDate and endDate values.');
    return selection;
  }
  if (preset === 'last_completed_week') return { preset: 'current_week' };
  if (preset === 'today' || preset === 'current_week' || preset === 'current_month') return { preset };
  if (query.range === 'day') return { preset: 'today' };
  if (query.range === 'month') return { preset: 'current_month' };
  return { preset: DEFAULT_ANALYTICS_DATE_PRESET };
};

export const analyticsDateRangeQuery = (selection: AnalyticsDateRangeSelection) => {
  const normalized = normalizeAnalyticsDateRangeSelection(selection);
  const params = new URLSearchParams({ datePreset: normalized.preset });
  if (normalized.preset === 'custom') {
    params.set('startDate', normalized.startDate!);
    params.set('endDate', normalized.endDate!);
  }
  return params.toString();
};

export const resolveAnalyticsDateRange = (
  selection: AnalyticsDateRangeSelection,
  nowInput: Date = new Date()
): ResolvedAnalyticsDateRange => {
  const normalized = normalizeAnalyticsDateRangeSelection(selection);
  const now = new Date(nowInput);
  if (Number.isNaN(now.getTime())) throw new Error('Invalid analytics reference time.');
  const today = formatRigaDateKey(now);
  let startDate: string;
  let endDate: string;
  let requestedExclusiveEnd: Date;

  if (normalized.preset === 'today') {
    startDate = today;
    endDate = today;
    requestedExclusiveEnd = now;
  } else if (normalized.preset === 'current_week') {
    const day = new Date(`${today}T00:00:00.000Z`).getUTCDay();
    const currentMonday = addCalendarDays(today, -((day + 6) % 7));
    startDate = currentMonday;
    endDate = today;
    requestedExclusiveEnd = now;
  } else if (normalized.preset === 'current_month') {
    startDate = `${today.slice(0, 7)}-01`;
    endDate = today;
    requestedExclusiveEnd = now;
  } else {
    startDate = normalized.startDate!;
    endDate = normalized.endDate!;
    if (startDate > endDate) throw new Error('Custom analytics start date must not be after the end date.');
    requestedExclusiveEnd = zonedMidnightToUtc(addCalendarDays(endDate, 1));
  }

  const start = zonedMidnightToUtc(startDate);
  const end = new Date(Math.min(requestedExclusiveEnd.getTime(), now.getTime()));
  if (start.getTime() >= end.getTime()) throw new Error('Analytics range does not include any elapsed time.');

  const effectiveEndDate = formatRigaDateKey(new Date(Math.max(start.getTime(), end.getTime() - 1)));
  const daySpan = calendarDaySpan(startDate, effectiveEndDate);
  const granularity: AnalyticsDateGranularity = daySpan === 1
    ? 'hour'
    : daySpan <= 31
      ? 'day'
      : daySpan <= 180
        ? 'week'
        : 'month';
  const buckets: AnalyticsDateBucket[] = [];
  if (granularity === 'hour') {
    for (let cursor = start.getTime(); cursor < end.getTime(); cursor += 3_600_000) {
      const date = new Date(cursor);
      buckets.push({ key: utcHourKey(date), label: hourFormatter.format(date) });
    }
  } else if (granularity === 'day') {
    for (let key = startDate; key <= effectiveEndDate; key = addCalendarDays(key, 1)) {
      buckets.push({ key, label: dateLabel(key) });
    }
  } else if (granularity === 'week') {
    for (let key = formatRigaWeekKey(start); key <= effectiveEndDate; key = addCalendarDays(key, 7)) {
      const visibleStart = key < startDate ? startDate : key;
      const weekEnd = addCalendarDays(key, 6);
      const visibleEnd = weekEnd > effectiveEndDate ? effectiveEndDate : weekEnd;
      buckets.push({ key, label: `${dateLabel(visibleStart)} – ${dateLabel(visibleEnd)}` });
    }
  } else {
    for (let key = `${startDate.slice(0, 7)}-01`; key <= effectiveEndDate; key = addCalendarMonths(key, 1)) {
      buckets.push({ key, label: shortMonthFormatter.format(new Date(`${key}T00:00:00.000Z`)) });
    }
  }

  const duration = end.getTime() - start.getTime();
  return {
    preset: normalized.preset,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    previousStartAt: new Date(start.getTime() - duration).toISOString(),
    startDate,
    endDate: effectiveEndDate,
    granularity,
    buckets
  };
};
