import { handlePayableRoutes } from './payables.js';
import { handleSupplierReturnRoutes as handleSupplierReturnCoreRoutes } from './supplier-returns-core.js';

export async function handleSupplierReturnRoutes(req, res, options) {
  if (await handlePayableRoutes(req, res, options)) return true;
  return handleSupplierReturnCoreRoutes(req, res, options);
}
