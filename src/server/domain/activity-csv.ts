const formulaPrefix = /^[\s]*[=+\-@]/u;

export const escapeActivityCsvCell = (value: unknown) => {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = formulaPrefix.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
};

export const activityCsvRow = (values: unknown[]) => `${values.map(escapeActivityCsvCell).join(',')}\r\n`;

export const ACTIVITY_CSV_BOM = '\uFEFF';
