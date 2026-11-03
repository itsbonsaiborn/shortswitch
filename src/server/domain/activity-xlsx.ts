import ExcelJS from '@excel.js/exceljs';
import type { ActivityQuestionPublicConfig, ActivitySupportedAnswer } from '../../shared/activity-types.js';

export interface ActivityResponseExportRow {
  attemptId: string;
  participantName: string | null;
  startedAt: string;
  submittedAt: string | null;
  questionId: string;
  questionType: string;
  prompt: string;
  configJson: string;
  answerJson: string | null;
  awardedUnits: number | null;
  maximumUnits: number;
  attemptScoreUnits: number | null;
  attemptMaximumScoreUnits: number;
}

const spreadsheetText = (value: unknown) => {
  const text = String(value ?? '');
  return /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
};

const oneDecimal = (value: number) => (Math.round(value * 10) / 10).toFixed(1);

const parseJson = <T>(value: string | null): T | null => {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
};

export const formatActivityResponseForExport = (configJson: string, answerJson: string | null) => {
  const config = parseJson<ActivityQuestionPublicConfig>(configJson);
  const answer = parseJson<ActivitySupportedAnswer>(answerJson);
  if (!config || !answer) return '';
  switch (answer.questionType) {
    case 'single_choice': {
      if (config.questionType !== 'single_choice') return '';
      return config.options.find((option) => option.id === answer.optionId)?.label ?? '';
    }
    case 'multiple_choice': {
      if (config.questionType !== 'multiple_choice') return '';
      return answer.optionIds.map((id) => config.options.find((option) => option.id === id)?.label ?? id).join('; ');
    }
    case 'open_answer':
      if (config.questionType !== 'open_answer') return '';
      return answer.text;
    case 'word_cloud':
      if (config.questionType !== 'word_cloud') return '';
      return ('responses' in answer ? answer.responses : [answer.text]).join('; ');
    case 'ordering': {
      if (config.questionType !== 'ordering') return '';
      return answer.orderedItemIds.map((id) => config.items.find((item) => item.id === id)?.label ?? id).join(' → ');
    }
    case 'matching': {
      if (config.questionType !== 'matching') return '';
      const left = new Map(config.leftItems.map((item) => [item.id, item.label]));
      const right = new Map(config.rightItems.map((item) => [item.id, item.label]));
      return answer.pairs.map((pair) => `${left.get(pair.leftId) ?? pair.leftId} → ${right.get(pair.rightId) ?? pair.rightId}`).join('; ');
    }
    case 'image_labeling': {
      if (config.questionType !== 'image_labeling') return '';
      const labels = new Map(config.labels.map((item) => [item.id, item.label]));
      const markers = new Map(config.markers.map((item, index) => [item.id, index + 1]));
      return answer.assignments.map((item) => `${markers.get(item.markerId) ?? item.markerId}: ${labels.get(item.labelId) ?? item.labelId}`).join('; ');
    }
  }
};

export const buildActivityResponsesWorkbook = async (source: Iterable<ActivityResponseExportRow>) => {
  const rows = [...source];
  const questions = new Map<string, string>();
  for (const row of rows) if (!questions.has(row.questionId)) questions.set(row.questionId, row.prompt || row.questionType);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ShortSwitch';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet('Responses', { views: [{ state: 'frozen', ySplit: 1 }] });
  worksheet.columns = [
    { header: 'Timestamp', key: 'timestamp', width: 21 },
    { header: 'User', key: 'user', width: 24 },
    { header: 'Completion %', key: 'completion', width: 15 },
    { header: 'Points', key: 'points', width: 16 },
    ...[...questions].map(([id, prompt]) => ({ header: spreadsheetText(prompt), key: `question:${id}`, width: 34 }))
  ];

  const attempts = new Map<string, Record<string, string | number | Date>>();
  for (const row of rows) {
    let target = attempts.get(row.attemptId);
    if (!target) {
      const timestamp = new Date(row.submittedAt ?? row.startedAt);
      const maximum = Number(row.attemptMaximumScoreUnits || 0);
      const score = Number(row.attemptScoreUnits || 0);
      target = {
        timestamp: Number.isNaN(timestamp.getTime()) ? spreadsheetText(row.submittedAt ?? row.startedAt) : timestamp,
        user: spreadsheetText(row.participantName?.trim() || 'Anonymous'),
        completion: maximum > 0 ? Math.round((score / maximum) * 1000) / 10 : 0,
        points: `${oneDecimal(score / 1000)} / ${oneDecimal(maximum / 1000)}`
      };
      attempts.set(row.attemptId, target);
    }
    target[`question:${row.questionId}`] = spreadsheetText(formatActivityResponseForExport(row.configJson, row.answerJson));
  }
  for (const attempt of attempts.values()) worksheet.addRow(attempt);

  const thin = { style: 'thin' as const, color: { argb: 'FFA3A7AD' } };
  const medium = { style: 'medium' as const, color: { argb: 'FF238B83' } };
  worksheet.eachRow((row: any, rowNumber: number) => {
    row.height = rowNumber === 1 ? 24 : 34;
    row.eachCell({ includeEmpty: true }, (cell: any, columnNumber: number) => {
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = {
        top: rowNumber === 1 ? medium : thin,
        left: columnNumber >= 5 ? medium : thin,
        bottom: rowNumber === 1 ? medium : thin,
        right: columnNumber >= 5 ? medium : thin
      };
      if (rowNumber === 1) {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF238B83' } };
      }
    });
  });
  worksheet.getColumn(1).numFmt = 'dd-mm-yyyy hh:mm';
  worksheet.getColumn(3).numFmt = '0.0"%"';
  worksheet.autoFilter = { from: 'A1', to: `${worksheet.getColumn(worksheet.columnCount).letter}1` };
  return Buffer.from(await workbook.xlsx.writeBuffer());
};
