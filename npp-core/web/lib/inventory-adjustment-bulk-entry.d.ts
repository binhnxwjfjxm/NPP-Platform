export type BulkInventoryAdjustmentInputRow = Readonly<{
  lineNumber: number;
  sku: string;
  actualQuantity: string;
  locationCode: string;
  lotCode: string;
}>;

export const MAX_BULK_INVENTORY_ADJUSTMENT_ROWS: number;
export function parseBulkInventoryAdjustmentSheet(sheet: string[][]): BulkInventoryAdjustmentInputRow[];
export function bulkInventoryAdjustmentTemplateCsv(): string;