export const MIN_PRODUCT_SEARCH_LENGTH = 1;

export function normalizedProductSearchTerm(value) {
  const term = String(value ?? '').trim();
  return term.length >= MIN_PRODUCT_SEARCH_LENGTH ? term : '';
}

export function normalizeProductSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

export function productSearchTokens(value) {
  const normalized = normalizeProductSearchText(value);
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

export function productSearchMatches(values, query) {
  const tokens = productSearchTokens(query);
  if (tokens.length === 0) return true;
  const haystack = (Array.isArray(values) ? values : [values])
    .map(normalizeProductSearchText)
    .filter(Boolean)
    .join(' ');
  return tokens.every((token) => haystack.includes(token));
}
