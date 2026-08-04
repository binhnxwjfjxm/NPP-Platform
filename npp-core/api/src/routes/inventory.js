import { handleInventoryRoutes as handleInventoryCoreRoutes } from './inventory-core.js';
import { handleLogisticsRoutes } from './logistics.js';

// Compatibility marker: handleFulfillmentOperationRoutes remains owned by inventory-core.js.
export async function handleInventoryRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  if (pathname === '/api/logistics' || pathname.startsWith('/api/logistics/')) {
    return handleLogisticsRoutes(req, res, options);
  }
  return handleInventoryCoreRoutes(req, res, options);
}
