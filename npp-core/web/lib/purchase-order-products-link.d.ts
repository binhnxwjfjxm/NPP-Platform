import type { PurchaseOrderBootstrap } from './purchase-order-bootstrap';

export declare function shouldShowPurchaseOrderProductsCatalogLink(
  state: Pick<PurchaseOrderBootstrap, 'products' | 'errors'>,
): boolean;

export declare function shouldShowPurchaseOrderSkuCatalogLink(args: {
  loadingVariants: boolean;
  variantLookupFailed: boolean;
  skuIssue: string | null;
  currentError: string | null;
}): boolean;
