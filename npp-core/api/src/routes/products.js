import { handleProductRoutes as handleProductMasterRoutes } from './products-core.js';
import { handleProductInventoryPolicyRoutes } from './product-inventory-policy.js';

export async function handleProductRoutes(req, res, options) {
  if (await handleProductInventoryPolicyRoutes(req, res, options)) return true;
  return handleProductMasterRoutes(req, res, options);
}
