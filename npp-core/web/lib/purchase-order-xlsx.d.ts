/// <reference types="node" />

export const PURCHASE_ORDER_XLSX_FILENAME: string;
export const PURCHASE_ORDER_XLSX_MIME: string;
export const PURCHASE_ORDER_XLSX_SHEET: string;
export const PURCHASE_ORDER_XLSX_HEADERS: readonly string[];

export type PurchaseOrderXlsxLimits = Readonly<{
  maxFileBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxUncompressedBytes: number;
  maxRows: number;
  maxColumns: number;
}>;

export const PURCHASE_ORDER_XLSX_LIMITS: PurchaseOrderXlsxLimits;

export function createPurchaseOrderXlsxTemplate(): Buffer;

export function parsePurchaseOrderXlsx(
  buffer: Buffer | Uint8Array | ArrayBuffer,
  limits?: PurchaseOrderXlsxLimits,
): string;

export function purchaseOrderXlsxErrorMessage(error: unknown): string;
