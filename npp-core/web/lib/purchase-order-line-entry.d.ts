export type PurchaseOrderDiscountMode = 'TOTAL_AMOUNT' | 'PER_UNIT' | 'PERCENT';
export declare const PURCHASE_ORDER_DISCOUNT_MODES: Readonly<{
  totalAmount: 'TOTAL_AMOUNT';
  perUnit: 'PER_UNIT';
  percent: 'PERCENT';
}>;
export declare function normalizeDecimalForApi(value: unknown): string | null;
export declare function isSafeDecimalIntermediate(value: unknown): boolean;
export declare function decimalToScaled(value: unknown, allowZero?: boolean): bigint | null;
export declare function scaledToDecimal(value: bigint): string;
export declare function multiplyScaled(left: bigint, right: bigint): bigint;
export declare function percentOfScaled(base: bigint, percent: bigint): bigint;
export declare function formatDecimalForInput(value: unknown): string;
export declare function formatDecimalForDisplay(value: unknown): string;
export declare function calculatePurchaseOrderLineFinancials(line: {
  quantity: string;
  unitPrice: string;
  discountMode?: PurchaseOrderDiscountMode;
  discountValue?: string;
  discountAmount?: string;
  taxRate?: string;
  taxAmount?: string;
}): null | Readonly<{
  gross: string;
  discountMode: PurchaseOrderDiscountMode;
  discountValue: string;
  discountAmount: string;
  taxRate: string | null;
  taxAmount: string;
  lineTotal: string;
}>;
export declare function calculatePurchaseOrderDraftTotals(lines: readonly {
  quantity: string;
  unitPrice: string;
  discountMode?: PurchaseOrderDiscountMode;
  discountValue?: string;
  discountAmount?: string;
  taxRate?: string;
  taxAmount?: string;
}[]): Readonly<{
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  lineTotals: readonly string[];
}>;
export declare function parsePurchaseOrderPasteGrid(text: string): ReadonlyArray<Readonly<{
  rowNumber: number;
  sku: string;
  quantity: string;
  unitPrice: string;
  discountMode: PurchaseOrderDiscountMode;
  discountValue: string;
  taxRate: string;
  note: string;
  errors: readonly string[];
}>>;
