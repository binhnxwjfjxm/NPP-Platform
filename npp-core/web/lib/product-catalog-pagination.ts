import 'server-only';
import { listProducts, ProductGatewayError } from './product-gateway';

const PRODUCT_PAGE_SIZE = 1000;
const MAX_PRODUCT_OFFSET = 10000;

export async function listAllProducts<T>(
  requestId: string,
  sourceParams = new URLSearchParams(),
): Promise<T[]> {
  const baseParams = new URLSearchParams(sourceParams);
  baseParams.delete('limit');
  baseParams.delete('offset');

  const products: T[] = [];
  for (let offset = 0; offset <= MAX_PRODUCT_OFFSET; offset += PRODUCT_PAGE_SIZE) {
    const pageParams = new URLSearchParams(baseParams);
    pageParams.set('limit', String(PRODUCT_PAGE_SIZE));
    pageParams.set('offset', String(offset));

    const page = await listProducts<T>(requestId, pageParams);
    products.push(...page);
    if (page.length < PRODUCT_PAGE_SIZE) return products;
  }

  throw new ProductGatewayError(
    'PRODUCT_CATALOG_PAGE_LIMIT_REACHED',
    'Danh mục sản phẩm vượt phạm vi tải an toàn',
    503,
    true,
    { maxOffset: MAX_PRODUCT_OFFSET },
  );
}
