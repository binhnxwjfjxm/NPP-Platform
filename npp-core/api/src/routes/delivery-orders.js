import { handleDeliveryOrderRoutes as handleThroughLaneC } from './delivery-orders-through-lane-c.js';
import { handleDeliveryOrderReversalRoutes } from './delivery-order-reversal.js';

export async function handleDeliveryOrderRoutes(req, res, options) {
  if (await handleDeliveryOrderReversalRoutes(req, res, options)) return true;
  return handleThroughLaneC(req, res, options);
}
