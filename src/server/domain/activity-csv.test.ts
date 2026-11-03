import { describe, expect, it } from 'vitest';
import { ACTIVITY_CSV_BOM, activityCsvRow, escapeActivityCsvCell } from './activity-csv.js';

describe('Activity CSV safety', () => {
  it('preserves UTF-8 text and escapes delimiters, quotes and newlines', () => {
    expect(ACTIVITY_CSV_BOM).toBe('\uFEFF');
    expect(activityCsvRow(['Jānis, Bērziņš', 'Viņš teica "jā"', 'Rīga\nLatvija']))
      .toBe('"Jānis, Bērziņš","Viņš teica ""jā""","Rīga\nLatvija"\r\n');
  });

  it.each(['=2+2', '+SUM(A1:A2)', '-1+2', '@IMPORT', '  =HYPERLINK("x")'])(
    'neutralizes spreadsheet formula input %s',
    (value) => expect(escapeActivityCsvCell(value)).toBe(`"'${value.replaceAll('"', '""')}"`)
  );
});
