import { handleDocumentNumberingRoutes } from './document-numbering.js';
import { handleProductUnitRoutes as handleProductUnitCoreRoutes } from './product-units-core.js';

export async function handleProductUnitRoutes(req, res, options) {
  if (await handleDocumentNumberingRoutes(req, res, options)) return true;
  return handleProductUnitCoreRoutes(req, res, options);
}
