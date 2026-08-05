import { handleCustomerReturnCreditRoutes } from './customer-return-credits.js';
import { handleCustomerPaymentRoutes } from './customer-payments.js';
import { handleCustomerReceivableCoreRoutes } from './customer-receivables-core.js';

export async function handleCustomerReceivableRoutes(req, res, options) {
  if (await handleCustomerReturnCreditRoutes(req, res, options)) return true;
  if (await handleCustomerPaymentRoutes(req, res, options)) return true;
  return handleCustomerReceivableCoreRoutes(req, res, options);
}
