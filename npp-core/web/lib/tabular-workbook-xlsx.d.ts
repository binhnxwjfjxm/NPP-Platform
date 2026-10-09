export type WorkbookXlsxLimits = Readonly<{
  maxSheets: number;
  maxRowsPerSheet: number;
  maxColumns: number;
  maxCells: number;
  maxOutputBytes: number;
}>;

export type WorkbookNumericCell = Readonly<{ value: number; format: 'currency' | 'percent' }>;
export type WorkbookCell = string | number | boolean | null | undefined | WorkbookNumericCell;

export type WorkbookSheetInput = {
  sheetName?: string;
  headers: Array<string | number | boolean | null | undefined>;
  rows: Array<Array<WorkbookCell>>;
};

export const TABULAR_WORKBOOK_XLSX_MIME: string;
export const TABULAR_WORKBOOK_XLSX_LIMITS: WorkbookXlsxLimits;
export function createTabularWorkbookXlsx(input: WorkbookSheetInput[], limits?: WorkbookXlsxLimits): Buffer;
export function workbookXlsxErrorMessage(error: unknown): string;
