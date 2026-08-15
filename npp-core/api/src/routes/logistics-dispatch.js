import { handleLogisticsDispatchRoutes as handleThroughLaneC } from './logistics-dispatch-through-lane-c.js';
import { handleLogisticsRecoveryRoutes } from './logistics-recovery.js';

export async function handleLogisticsDispatchRoutes(req, res, options) {
  if (await handleLogisticsRecoveryRoutes(req, res, options)) return true;
  return handleThroughLaneC(req, res, options);
}
