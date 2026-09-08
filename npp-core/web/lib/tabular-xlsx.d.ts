export type TabularXlsxLimits = Readonly<{
  maxFileBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxUncompressedBytes: number;
  maxRows: number;
  maxColumns: number;
}>;

export type TabularXlsxInput = {
  sheetName?: string;
  headers: Array<string | number | boolean | null | undefined>;
  rows: Array<Array<string | number | boolean | null | undefined>>;
};

export const TABULAR_XLSX_MIME: string;
export const TABULAR_XLSX_LIMITS: TabularXlsxLimits;

export function createTabularXlsx(
  input: TabularXlsxInput,
  limits?: TabularXlsxLimits,
): Buffer;

export function parseTabularXlsx(
  buffer: Buffer | Uint8Array,
  limits?: TabularXlsxLimits,
  expectedHeaders?: readonly string[],
): string[][];

export function tabularXlsxErrorMessage(error: unknown): string;
