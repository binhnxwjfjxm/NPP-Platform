import { handleOrderApi } from "./order-api.js";
import { handleRouteApi } from "./route-api.js";
import { handleCoreSalesApi } from "./core-sales-api.js";
import { handleCustomerVerificationApi } from "./customer-verification-api.js";
import { handleManagementProposalApi } from "./management-proposal-api.js";
import { handleTransitionalApi as handleBaseTransitionalApi } from "./transitional-api.js";
import { handlePostgresqlCompatibilityApi } from "./postgresql-compatibility-api.js";

async function handleTransitionalApi(req, url, context, config, options) {
  const customerVerification = await handleCustomerVerificationApi(req, url, context, config, options);
  if (customerVerification) return customerVerification;
  const managementProposal = await handleManagementProposalApi(req, url, context, config, options);
  if (managementProposal) return managementProposal;
  const coreSales = await handleCoreSalesApi(req, url, context, config, options);
  if (coreSales) return coreSales;
  const compatibility = await handlePostgresqlCompatibilityApi(req, url, context, config, options);
  if (compatibility) return compatibility;
  return handleBaseTransitionalApi(req, url, context, config, options);
}

export function createTypedRuntime() {
  return Object.freeze({
    handleOrderApi,
    handleRouteApi,
    handleTransitionalApi,
    proxyToLegacy: false
  });
}
