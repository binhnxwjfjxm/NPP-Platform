import type { PurchaseOrderSkuSearchOption } from './purchase-order-types';

export const MIN_PURCHASE_ORDER_SKU_SEARCH_LENGTH: number;
export const PURCHASE_ORDER_SKU_FILTERS: Readonly<{
  eligible: 'eligible';
  setup: 'setup';
  all: 'all';
}>;
export const PURCHASE_ORDER_BULK_TEMPLATE_FILENAME: string;
export const PURCHASE_ORDER_BULK_TEMPLATE_MIME: string;

export type PurchaseOrderSkuFilter = typeof PURCHASE_ORDER_SKU_FILTERS[keyof typeof PURCHASE_ORDER_SKU_FILTERS];

export function normalizePurchaseOrderSkuSearchFailure(error: unknown): Readonly<{
  code: string;
  message: string;
  statusCode: number;
  retryable: boolean;
}>;

export function filterPurchaseOrderSkuOptions(
  options: readonly PurchaseOrderSkuSearchOption[],
  filter?: PurchaseOrderSkuFilter,
): PurchaseOrderSkuSearchOption[];

export function groupPurchaseOrderSkuOptions(options: readonly PurchaseOrderSkuSearchOption[]): Array<{
  productId: string;
  productCode: string;
  productName: string;
  options: PurchaseOrderSkuSearchOption[];
}>;

export function purchaseOrderBulkTemplate(): string;
