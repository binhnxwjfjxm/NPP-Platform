export const PRODUCT_CATALOG_PAGE_SIZE = 1000;
export const PRODUCT_CATALOG_MAX_OFFSET = 10000;

export async function collectAllProductPages(loadPage) {
  const products = [];
  for (let offset = 0; offset <= PRODUCT_CATALOG_MAX_OFFSET; offset += PRODUCT_CATALOG_PAGE_SIZE) {
    const page = await loadPage({ limit: PRODUCT_CATALOG_PAGE_SIZE, offset });
    if (!Array.isArray(page)) throw new Error('Phản hồi danh mục sản phẩm không hợp lệ');
    products.push(...page);
    if (page.length < PRODUCT_CATALOG_PAGE_SIZE) return products;
  }
  throw new Error('Danh mục sản phẩm vượt phạm vi tải an toàn');
}
