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

export type RetailVersionedDraft = RetailSavedOrderContext & {
  id: string;
  currentVersionNumber: string;
  collectionPolicy?: string;
  note?: string | null;
  documentDiscountReason?: string | null;
  versions?: Array<{ versionNumber: string; revision: string; lines?: RetailSavedLine[] }>;
};
export declare function activeDraftRevision(order: RetailVersionedDraft | null | undefined): string | null;
export declare function sameSavedDraft(
  before: RetailVersionedDraft | null | undefined,
  after: RetailVersionedDraft | null | undefined,
): boolean;

export declare function draftMatchesQueuedIntent(
  saved: (RetailSavedOrderContext & {
    collectionPolicy?: string;
    note?: string | null;
    documentDiscountReason?: string | null;
  }) | null | undefined,
  snapshot: Omit<RetailSavedOrderContext, 'status'> & {
    policy: string;
    note: string;
    documentDiscountReason: string;
    cart: RetailCartLine[];
    manualPrices: Record<string, string>;
  },
  payload: {
    lines: Array<{ variantId: string; manualUnitPriceMinor?: string; expectedSystemUnitPriceMinor?: string }>;
  },
  savedLines: RetailSavedLine[],
): boolean;
