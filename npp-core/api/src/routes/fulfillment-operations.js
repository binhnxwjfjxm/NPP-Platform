import { handleFulfillmentOperationRoutes as handleThroughLaneC } from './fulfillment-operations-through-lane-c.js';
import { handleFulfillmentReversalRoutes } from './fulfillment-reversal.js';

export async function handleFulfillmentOperationRoutes(req, res, options) {
  if (await handleFulfillmentReversalRoutes(req, res, options)) return true;
  return handleThroughLaneC(req, res, options);
}
