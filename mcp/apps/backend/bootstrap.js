import { loadEnvFile } from "node:process";
import { loadFoundationConfig, publicFoundationConfig } from "./foundation/config.js";
import { createFoundationGateway } from "./foundation/gateway.js";
import { createPersistence } from "./foundation/persistence.js";
import { createPostgresqlLegacyProvider } from "./foundation/postgresql-legacy-provider.js";

try { loadEnvFile(".env"); } catch {}

const config = loadFoundationConfig(process.env);
const persistence = await createPersistence(config);
const providerPort = config.persistence.provider === "postgresql"
  ? createPostgresqlLegacyProvider(config, persistence)
  : null;
let legacyHandlers = null;
if (config.legacyRuntime.enabled) {
  const { startLegacyRuntime } = await import("./foundation/legacy-runtime.js");
  legacyHandlers = await startLegacyRuntime(config);
}

const gateway = createFoundationGateway(config, { persistence, providerPort, legacyHandlers });
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
