import { handleOrderApi } from "./order-api.js";
import { handleRouteApi } from "./route-api.js";
import { handleTransitionalApi as handleBaseTransitionalApi } from "./transitional-api.js";
import { handlePostgresqlCompatibilityApi } from "./postgresql-compatibility-api.js";

async function handleTransitionalApi(req, url, context, config, options) {
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
