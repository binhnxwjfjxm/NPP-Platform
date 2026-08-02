import { handleOrderApi } from "./order-api.js";
import { handleRouteApi } from "./route-api.js";
import { handleTransitionalApi } from "./transitional-api.js";

export function createTypedRuntime() {
  return Object.freeze({
    handleOrderApi,
    handleRouteApi,
    handleTransitionalApi,
    proxyToLegacy: false
  });
}
