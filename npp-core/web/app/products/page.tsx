import ProductWorkspace from './product-workspace';
import ProductInventoryPolicyPanel from './product-inventory-policy-panel';
import type { Product, ProductBrand, ProductCategory, UnitOfMeasure } from '../../lib/product-types';
import {
  listProductCategories,
  listProductBrands,
  listProducts,
  listUnits,
  normalizeProductGatewayError,
  resolveProductRequestId,
} from '../../lib/product-gateway';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  const requestId = resolveProductRequestId(null);
  let initialProducts: Product[] = [];
  let initialCategories: ProductCategory[] = [];
  let initialBrands: ProductBrand[] = [];
  let initialUnits: UnitOfMeasure[] = [];
  let initialError: string | null = null;

  try {
    [initialProducts, initialCategories, initialBrands, initialUnits] = await Promise.all([
      listProducts<Product>(requestId, new URLSearchParams({ limit: '1000' })),
      listProductCategories<ProductCategory>(requestId, new URLSearchParams({ limit: '1000' })),
      listProductBrands<ProductBrand>(requestId, new URLSearchParams({ limit: '1000' })),
      listUnits<UnitOfMeasure>(requestId, new URLSearchParams({ limit: '1000' })),
    ]);
  } catch (error) {
    initialError = normalizeProductGatewayError(error).publicMessage;
  }

  return (
    <>
      <ProductWorkspace
        initialProducts={initialProducts}
        initialCategories={initialCategories}
        initialBrands={initialBrands}
        initialUnits={initialUnits}
        initialError={initialError}
      />
      <ProductInventoryPolicyPanel />
    </>
  );
}
