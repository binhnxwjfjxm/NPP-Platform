import { handleInventoryRoutes as handleInventoryCoreRoutes } from './inventory-core.js';
import { handleLogisticsRoutes } from './logistics.js';
import { handleLogisticsDispatchRoutes } from './logistics-dispatch.js';

// Compatibility markers: handleFulfillmentOperationRoutes and handleDeliveryOrderRoutes
// remain owned by inventory-core.js; this wrapper adds Logistics planning and dispatch namespaces.
export async function handleInventoryRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  if (/^\/api\/logistics\/trips\/[^/]+\/dispatch$/.test(pathname)) {
    return handleLogisticsDispatchRoutes(req, res, options);
  }
  if (pathname === '/api/logistics' || pathname.startsWith('/api/logistics/')) {
    return handleLogisticsRoutes(req, res, options);
  }
  return handleInventoryCoreRoutes(req, res, options);
}