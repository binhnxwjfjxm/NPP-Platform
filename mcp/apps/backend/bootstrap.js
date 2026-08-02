import { loadEnvFile } from "node:process";
import { loadFoundationConfig, publicFoundationConfig } from "./foundation/config.js";
import { createFoundationGateway } from "./foundation/gateway.js";
import { createPersistence } from "./foundation/persistence.js";
import { bindProviderPersistence } from "./foundation/provider-runtime.js";

try { loadEnvFile(".env"); } catch {}

const config = loadFoundationConfig(process.env);
const persistence = await createPersistence(config);
bindProviderPersistence(persistence);

let handlers = null;
if (config.legacyRuntime.enabled) {
  const { startLegacyRuntime } = await import("./foundation/legacy-runtime.js");
  handlers = await startLegacyRuntime(config);
} else {
  const { createTypedRuntime } = await import("./foundation/typed-runtime.js");
  handlers = createTypedRuntime();
}

const gateway = createFoundationGateway(config, { persistence, legacyHandlers: handlers });
gateway.listen(config.publicPort, config.publicHost, () => {
  console.log(JSON.stringify({ event: "foundation_gateway_ready", ...publicFoundationConfig(config) }));
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ event: "foundation_gateway_shutdown", signal }));
  const forceExit = setTimeout(() => process.exit(1), 5000);
  forceExit.unref();
  gateway.close(async () => {
    try {
      await persistence.close();
      clearTimeout(forceExit);
      process.exit(0);
    } catch {
      clearTimeout(forceExit);
      process.exit(1);
    }
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
