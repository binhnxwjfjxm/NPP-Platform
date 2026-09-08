export type WorkbookXlsxLimits = Readonly<{
  maxSheets: number;
  maxRowsPerSheet: number;
  maxColumns: number;
  maxCells: number;
  maxOutputBytes: number;
}>;

export type WorkbookSheetInput = {
  sheetName?: string;
  headers: Array<string | number | boolean | null | undefined>;
  rows: Array<Array<string | number | boolean | null | undefined>>;
};

export const TABULAR_WORKBOOK_XLSX_MIME: string;
export const TABULAR_WORKBOOK_XLSX_LIMITS: WorkbookXlsxLimits;
export function createTabularWorkbookXlsx(input: WorkbookSheetInput[], limits?: WorkbookXlsxLimits): Buffer;
export function workbookXlsxErrorMessage(error: unknown): string;
