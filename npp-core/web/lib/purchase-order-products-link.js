export function shouldShowPurchaseOrderProductsCatalogLink() {
  // Product eligibility is now resolved through live SKU search inside the editor.
  // The bootstrap intentionally does not preload the full product catalog, so an
  // empty bootstrap products array must not be interpreted as an empty catalog.
  return false;
}

export function shouldShowPurchaseOrderSkuCatalogLink({ loadingVariants, variantLookupFailed, skuIssue, currentError }) {
  return !loadingVariants && !variantLookupFailed && Boolean(skuIssue) && currentError === skuIssue;
}
