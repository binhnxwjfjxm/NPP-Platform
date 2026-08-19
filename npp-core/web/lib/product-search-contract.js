export const MIN_PRODUCT_SEARCH_LENGTH = 1;

export function normalizedProductSearchTerm(value) {
  const term = String(value ?? '').trim();
  return term.length >= MIN_PRODUCT_SEARCH_LENGTH ? term : '';
}
