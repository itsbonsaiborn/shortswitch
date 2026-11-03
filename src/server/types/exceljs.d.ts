declare module '@excel.js/exceljs' {
  interface Worksheet {
    columns: Array<Record<string, unknown>>;
    columnCount: number;
    autoFilter: unknown;
    addRow(value: Record<string, unknown>): unknown;
    eachRow(callback: (row: any, rowNumber: number) => void): void;
    getColumn(index: number): { letter: string; numFmt: string };
  }

  class Workbook {
    creator: string;
    created: Date;
    xlsx: { writeBuffer(): Promise<Buffer> };
    addWorksheet(name: string, options?: Record<string, unknown>): Worksheet;
  }

  const ExcelJS: { Workbook: typeof Workbook };
  export default ExcelJS;
}
