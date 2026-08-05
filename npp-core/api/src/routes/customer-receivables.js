import { handleCustomerPaymentRoutes } from './customer-payments.js';
import { handleCustomerReceivableCoreRoutes } from './customer-receivables-core.js';

export async function handleCustomerReceivableRoutes(req, res, options) {
  if (await handleCustomerPaymentRoutes(req, res, options)) return true;
  return handleCustomerReceivableCoreRoutes(req, res, options);
}
