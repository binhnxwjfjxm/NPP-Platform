import { handleInventoryRoutes as handleInventoryCoreRoutes } from './inventory-core.js';
import { handleLogisticsRoutes } from './logistics.js';
import { handleLogisticsAttemptRoutes } from './logistics-attempts.js';
import { handleLogisticsDispatchRoutes } from './logistics-dispatch.js';
import { handleLogisticsDriverRoutes } from './logistics-driver.js';
import { handleLogisticsPodRoutes } from './logistics-pod.js';
import { handleLogisticsReconciliationRoutes } from './logistics-reconciliation.js';

// Compatibility markers: handleFulfillmentOperationRoutes and handleDeliveryOrderRoutes
// remain owned by inventory-core.js; this wrapper adds Logistics namespaces.
export async function handleInventoryRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  if (/^\/api\/logistics\/driver\/trips\/[^/]+\/assignments\/[^/]+\/attempts\/[^/]+\/pod$/.test(pathname)
      || /^\/api\/logistics\/trips\/[^/]+\/attempts\/[^/]+\/pod$/.test(pathname)) {
    return handleLogisticsPodRoutes(req, res, options);
  }
  if (pathname === '/api/logistics/driver/trips'
      || pathname.startsWith('/api/logistics/driver/trips/')) {
    return handleLogisticsDriverRoutes(req, res, options);
  }
  if (/^\/api\/logistics\/trips\/[^/]+\/attempts$/.test(pathname)) {
    return handleLogisticsAttemptRoutes(req, res, options);
  }
  if (/^\/api\/logistics\/trips\/[^/]+\/dispatch$/.test(pathname)) {
    return handleLogisticsDispatchRoutes(req, res, options);
  }
  if (/^\/api\/logistics\/trips\/[^/]+\/(reconciliation|return-receipts|close)$/.test(pathname)) {
    return handleLogisticsReconciliationRoutes(req, res, options);
  }
  if (pathname === '/api/logistics' || pathname.startsWith('/api/logistics/')) {
    return handleLogisticsRoutes(req, res, options);
  }
  return handleInventoryCoreRoutes(req, res, options);
}
