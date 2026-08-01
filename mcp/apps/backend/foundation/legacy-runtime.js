import { handleOrderApi } from "./order-api.js";
import { handleRouteApi } from "./route-api.js";
import { handleTransitionalApi } from "./transitional-api.js";
import { waitForLegacyHealth } from "./gateway.js";

export async function startLegacyRuntime(config) {
  if (!config.legacyRuntime.enabled) return null;
  process.env.HOST = config.internalHost;
  process.env.PORT = String(config.internalPort);
  process.env.CORS_ORIGINS = "http://127.0.0.1";
  process.env.SUPABASE_URL = config.supabaseUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = config.supabaseServiceRoleKey;
  await import("../server.js");
  await waitForLegacyHealth(config);
  return Object.freeze({ handleOrderApi, handleRouteApi, handleTransitionalApi, proxyToLegacy: true });
}
