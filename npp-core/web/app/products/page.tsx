import ProductWorkspace from './product-workspace';
import type { Product, ProductBrand, ProductCategory } from '../../lib/product-types';
import {
  listProductCategories,
  listProductBrands,
  listProducts,
  normalizeProductGatewayError,
  resolveProductRequestId,
} from '../../lib/product-gateway';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  const requestId = resolveProductRequestId(null);
  let initialProducts: Product[] = [];
  let initialCategories: ProductCategory[] = [];
  let initialBrands: ProductBrand[] = [];
  let initialError: string | null = null;

  try {
    [initialProducts, initialCategories, initialBrands] = await Promise.all([
      listProducts<Product>(requestId, new URLSearchParams({ limit: '1000' })),
      listProductCategories<ProductCategory>(requestId, new URLSearchParams({ limit: '1000' })),
      listProductBrands<ProductBrand>(requestId, new URLSearchParams({ limit: '1000' })),
    ]);
  } catch (error) {
    initialError = normalizeProductGatewayError(error).publicMessage;
  }

  return (
    <ProductWorkspace
      initialProducts={initialProducts}
      initialCategories={initialCategories}
      initialBrands={initialBrands}
      initialError={initialError}
    />
  );
}
