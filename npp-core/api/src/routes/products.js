import { handleProductRoutes as handleProductMasterRoutes } from './products-core.js';
import { handleProductInventoryPolicyRoutes } from './product-inventory-policy.js';
import { handleProductImageRoutes } from './product-images.js';
import { handleProductSalesOrderLocalCatalogRoutes } from './product-sales-order-local-catalog.js';

export async function handleProductRoutes(req, res, options) {
  if (await handleProductSalesOrderLocalCatalogRoutes(req, res, options)) return true;
  if (await handleProductImageRoutes(req, res, options)) return true;
  if (await handleProductInventoryPolicyRoutes(req, res, options)) return true;
  return handleProductMasterRoutes(req, res, options);
}