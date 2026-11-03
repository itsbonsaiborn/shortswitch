import ExcelJS from '@excel.js/exceljs';
import { describe, expect, it } from 'vitest';
import { buildActivityResponsesWorkbook, formatActivityResponseForExport, type ActivityResponseExportRow } from './activity-xlsx.js';

const choiceConfig = JSON.stringify({ questionType: 'single_choice', prompt: 'Kur atrodas Rīga?', description: '', options: [{ id: 'lv', label: 'Latvijā' }, { id: 'ee', label: 'Igaunijā' }], shuffleOptions: false });

describe('Activity XLSX export', () => {
  it('renders human-readable answers and protects spreadsheet cells', () => {
    expect(formatActivityResponseForExport(choiceConfig, JSON.stringify({ questionType: 'single_choice', optionId: 'lv' }))).toBe('Latvijā');
    expect(formatActivityResponseForExport(choiceConfig, null)).toBe('');
  });

  it('creates bold headers, bordered question columns and Latvian response data', async () => {
    const source: ActivityResponseExportRow[] = [{
      attemptId: 'attempt-1', participantName: '=HYPERLINK("bad")', startedAt: '2026-11-02T08:00:00.000Z', submittedAt: '2026-11-02T08:05:00.000Z',
      questionId: 'question-1', questionType: 'single_choice', prompt: 'Kur atrodas Rīga?', configJson: choiceConfig,
      answerJson: JSON.stringify({ questionType: 'single_choice', optionId: 'lv' }), awardedUnits: 1000, maximumUnits: 1000,
      attemptScoreUnits: 1000, attemptMaximumScoreUnits: 1000
    }];
    const buffer = await buildActivityResponsesWorkbook(source);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    const workbook = new ExcelJS.Workbook();
    await (workbook as any).xlsx.load(buffer);
    const worksheet = (workbook as any).getWorksheet('Responses');
    expect(worksheet.getCell('A1').font.bold).toBe(true);
    expect(worksheet.getCell('E1').value).toBe('Kur atrodas Rīga?');
    expect(worksheet.getCell('B2').value).toBe('\'=HYPERLINK("bad")');
    expect(worksheet.getCell('E2').value).toBe('Latvijā');
    expect(worksheet.getCell('E2').border.left.style).toBe('medium');
  });
});
