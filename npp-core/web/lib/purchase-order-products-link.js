export function shouldShowPurchaseOrderProductsCatalogLink(state) {
  return state.errors.products === null && state.products.length === 0;
}

export function shouldShowPurchaseOrderSkuCatalogLink({ loadingVariants, variantLookupFailed, skuIssue, currentError }) {
  return !loadingVariants && !variantLookupFailed && Boolean(skuIssue) && currentError === skuIssue;
}
