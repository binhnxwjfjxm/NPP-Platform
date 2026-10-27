export type RetailSavedLine = {
  variantId: string;
  quantity: string;
  taxMode: 'EXCLUSIVE' | 'INCLUSIVE';
  taxRate: string;
  priceSource?: 'PRICE_ENGINE' | 'MANUAL_OVERRIDE';
  unitPrice: string;
};
export type RetailCartLine = {
  id: string;
  quantity: string;
  taxMode: 'EXCLUSIVE' | 'INCLUSIVE';
  taxRate: string;
};
export type RetailSavedOrderContext = {
  status: string;
  warehouseId: string;
  customerMode: 'WALK_IN' | 'EXISTING';
  customerId: string;
  documentDiscountMode?: 'NONE' | 'TOTAL_AMOUNT' | 'PERCENT';
  documentDiscountValue?: string;
};
export declare function checkoutLinesMatch(
  savedLines: RetailSavedLine[] | null | undefined,
  cartLines: RetailCartLine[],
  manualPrices?: Record<string, string>,
): boolean;
export declare function projectedRetailDraftTotal(
  subtotal: number,
  discountMode: 'NONE' | 'TOTAL_AMOUNT' | 'PERCENT',
  discountValue: string,
): number;
export declare function draftMatchesRetailContext(
  order: RetailSavedOrderContext | null | undefined,
  context: {
    warehouseId: string;
    customerMode: 'WALK_IN' | 'EXISTING';
    customerId: string;
    documentDiscountMode: 'NONE' | 'TOTAL_AMOUNT' | 'PERCENT';
    documentDiscountValue: string;
  },
): boolean;
