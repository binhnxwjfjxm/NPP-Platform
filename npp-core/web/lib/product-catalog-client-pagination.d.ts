export const PRODUCT_CATALOG_PAGE_SIZE: number;
export const PRODUCT_CATALOG_MAX_OFFSET: number;
export function collectAllProductPages<T>(
  loadPage: (page: { limit: number; offset: number }) => Promise<T[]>,
): Promise<T[]>;
