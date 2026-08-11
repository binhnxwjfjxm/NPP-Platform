export const TABULAR_XLSX_MIME: string;
export const TABULAR_XLSX_LIMITS: Readonly<{
  maxFileBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxUncompressedBytes: number;
  maxRows: number;
  maxColumns: number;
}>;
export function createTabularXlsx(input: { sheetName?: string; headers: string[]; rows: Array<Array<string | number | boolean | null | undefined>> }, limits?: typeof TABULAR_XLSX_LIMITS): Buffer;
export function parseTabularXlsx(buffer: Buffer | Uint8Array | ArrayBuffer, limits?: typeof TABULAR_XLSX_LIMITS): string[][];
export function tabularXlsxErrorMessage(error: unknown): string;
