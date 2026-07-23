import { loadEnvFile } from "node:process";
import { loadFoundationConfig, publicFoundationConfig } from "./foundation/config.js";
import { createFoundationGateway, waitForLegacyHealth } from "./foundation/gateway.js";

try {
  loadEnvFile(".env");
} catch {}

const config = loadFoundationConfig(process.env);

// MCP v1 remains unchanged and is reachable only through the public foundation gateway.
process.env.HOST = config.internalHost;
process.env.PORT = String(config.internalPort);
process.env.CORS_ORIGINS = "http://127.0.0.1";

await import("./server.js");
await waitForLegacyHealth(config);

const gateway = createFoundationGateway(config);
gateway.listen(config.publicPort, config.publicHost, () => {
  console.log(JSON.stringify({
    event: "foundation_gateway_ready",
    ...publicFoundationConfig(config)
  }));
});

function shutdown(signal) {
  console.log(JSON.stringify({ event: "foundation_gateway_shutdown", signal }));
  gateway.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
