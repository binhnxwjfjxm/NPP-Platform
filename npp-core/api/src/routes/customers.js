import { handleCustomerBulkRoutes } from './customer-bulk.js';
import { handleCustomerProfileRoutes } from './customer-profile.js';
import { handleCustomerRoutes as handleExistingCustomerRoutes } from './customers-existing.js';

export async function handleCustomerRoutes(req, res, options) {
  if (await handleCustomerBulkRoutes(req, res, options)) return true;
  if (await handleCustomerProfileRoutes(req, res, options)) return true;
  return handleExistingCustomerRoutes(req, res, options);
}
