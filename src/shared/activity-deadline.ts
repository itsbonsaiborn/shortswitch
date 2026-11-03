const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

interface DateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatter = (timeZone: string) => new Intl.DateTimeFormat('en-CA-u-ca-iso8601', {
  timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

const partsAt = (timestamp: number, timeZone: string): DateTimeParts => {
  const values = Object.fromEntries(
    formatter(timeZone).formatToParts(new Date(timestamp)).map((part) => [part.type, part.value])
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
};

const parseLocal = (value: string): DateTimeParts | null => {
  const match = localDateTimePattern.exec(value);
  if (!match) return null;
  const result = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5])
  };
  const check = new Date(Date.UTC(result.year, result.month - 1, result.day, result.hour, result.minute));
  return check.getUTCFullYear() === result.year
    && check.getUTCMonth() === result.month - 1
    && check.getUTCDate() === result.day
    && result.hour <= 23
    && result.minute <= 59
    ? result
    : null;
};

const sameParts = (left: DateTimeParts, right: DateTimeParts) =>
  left.year === right.year && left.month === right.month && left.day === right.day
  && left.hour === right.hour && left.minute === right.minute;

export const isValidActivityTimeZone = (timeZone: string) => {
  try {
    formatter(timeZone).format(new Date(0));
    return true;
  } catch {
    return false;
  }
};

/**
 * Converts a timezone-local minute to UTC. Ambiguous fall-back minutes resolve
 * to the earlier occurrence; nonexistent spring-forward minutes are rejected.
 */
export const zonedActivityDateTimeToUtc = (localDateTime: string, timeZone: string): string | null => {
  const desired = parseLocal(localDateTime);
  if (!desired || !isValidActivityTimeZone(timeZone)) return null;
  const desiredUtcShape = Date.UTC(desired.year, desired.month - 1, desired.day, desired.hour, desired.minute);
  let candidate = desiredUtcShape;
  for (let index = 0; index < 4; index += 1) {
    const observed = partsAt(candidate, timeZone);
    const observedUtcShape = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute);
    candidate += desiredUtcShape - observedUtcShape;
  }
  const matches: number[] = [];
  for (let timestamp = candidate - 3 * 60 * 60 * 1000; timestamp <= candidate + 3 * 60 * 60 * 1000; timestamp += 60_000) {
    if (sameParts(partsAt(timestamp, timeZone), desired)) matches.push(timestamp);
  }
  return matches.length ? new Date(Math.min(...matches)).toISOString() : null;
};

export const utcActivityDateTimeToLocalInput = (utcDateTime: string | null, timeZone: string) => {
  if (!utcDateTime || !isValidActivityTimeZone(timeZone)) return '';
  const timestamp = Date.parse(utcDateTime);
  if (!Number.isFinite(timestamp)) return '';
  const value = partsAt(timestamp, timeZone);
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${value.year}-${pad(value.month)}-${pad(value.day)}T${pad(value.hour)}:${pad(value.minute)}`;
};

export const earliestActivityDeadline = (...values: Array<string | null | undefined>) => {
  const timestamps = values
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  return timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null;
};
