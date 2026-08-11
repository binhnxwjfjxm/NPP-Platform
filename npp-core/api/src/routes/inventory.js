import { handleInventoryRoutes as handleInventoryCoreRoutes } from './inventory-core.js';
import { handleInventoryTransferRoutes } from './inventory-transfers.js';
import { handleInventoryTransferReceiptRoutes } from './inventory-transfer-receipts.js';
import { handleInventoryStocktakeRoutes } from './inventory-stocktakes.js';
import { handleInventoryAdjustmentRoutes } from './inventory-adjustments.js';
import { handleInventoryCostingRoutes } from './inventory-costing.js';
import { handleInventoryCostingPeriodRoutes } from './inventory-costing-periods.js';
import { handleInventoryTrackingPolicyCandidateRoutes } from './inventory-tracking-policy-candidates.js';
import { handleOpeningBalanceOperatorRoutes } from './opening-balance-operator.js';
import { handleCodDriverRoutes } from './cod-driver.js';
import { handleLogisticsRoutes } from './logistics.js';
import { handleLogisticsAttemptRoutes } from './logistics-attempts.js';
import { handleLogisticsDispatchRoutes } from './logistics-dispatch.js';
import { handleLogisticsDriverRoutes } from './logistics-driver.js';
import { handleLogisticsPodRoutes } from './logistics-pod.js';
import { handleLogisticsReconciliationRoutes } from './logistics-reconciliation.js';
import { handleWarehouseSelectorRoutes } from './warehouse-selectors.js';

// Compatibility markers: handleFulfillmentOperationRoutes and handleDeliveryOrderRoutes
// remain owned by inventory-core.js; this wrapper adds transfer, stocktake, adjustment and Logistics namespaces.
export async function handleInventoryRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  if (pathname === '/api/inventory/tracking-policies/candidates') {
    return handleInventoryTrackingPolicyCandidateRoutes(req, res, options);
  }
  if (pathname.startsWith('/api/inventory/opening-balances/operator/')) {
    return handleOpeningBalanceOperatorRoutes(req, res, options);
  }
  if (pathname === '/api/inventory/costing' || pathname.startsWith('/api/inventory/costing/')) {
    if (await handleInventoryCostingPeriodRoutes(req, res, options)) return true;
    return handleInventoryCostingRoutes(req, res, options);
  }
  if (pathname === '/api/inventory/adjustments' || pathname.startsWith('/api/inventory/adjustments/')) {
    return handleInventoryAdjustmentRoutes(req, res, options);
  }
  if (pathname === '/api/inventory/stocktakes/warehouses') {
    return handleWarehouseSelectorRoutes(req, res, options);
  }
  if (pathname === '/api/inventory/stocktakes' || pathname.startsWith('/api/inventory/stocktakes/')) {
    return handleInventoryStocktakeRoutes(req, res, options);
  }
  if (pathname === '/api/inventory/transfers' || pathname.startsWith('/api/inventory/transfers/')) {
    if (await handleInventoryTransferReceiptRoutes(req, res, options)) return true;
    return handleInventoryTransferRoutes(req, res, options);
  }
  if (/^\/api\/logistics\/driver\/trips\/[^/]+\/assignments\/[^/]+\/attempts\/[^/]+\/pod$/.test(pathname)
      || /^\/api\/logistics\/trips\/[^/]+\/attempts\/[^/]+\/pod$/.test(pathname)) {
    return handleLogisticsPodRoutes(req, res, options);
  }
  if (/^\/api\/logistics\/driver\/trips\/[^/]+\/(cod|cod-handovers)$/.test(pathname)
      || /^\/api\/logistics\/driver\/trips\/[^/]+\/assignments\/[^/]+\/cod-collections$/.test(pathname)) {
    return handleCodDriverRoutes(req, res, options);
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
  if (pathname === '/api/logistics/warehouses') {
    return handleWarehouseSelectorRoutes(req, res, options);
  }
  if (pathname === '/api/logistics' || pathname.startsWith('/api/logistics/')) {
    return handleLogisticsRoutes(req, res, options);
  }
  return handleInventoryCoreRoutes(req, res, options);
}
