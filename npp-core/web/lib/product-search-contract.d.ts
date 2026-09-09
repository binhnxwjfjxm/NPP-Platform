export const MIN_PRODUCT_SEARCH_LENGTH: number;
export function normalizedProductSearchTerm(value: unknown): string;
export function normalizeProductSearchText(value: unknown): string;
export function productSearchTokens(value: unknown): string[];
export function productSearchMatches(values: readonly unknown[] | unknown, query: unknown): boolean;
