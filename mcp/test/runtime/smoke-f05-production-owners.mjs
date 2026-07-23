import { assertF05ProductionSmokeGuard, redactSmokeError } from "./f05-production-smoke-guard.mjs";
import { createLiveF05SmokeDriver } from "./f05-production-smoke-live-driver.mjs";
import { runF05ProductionOwnersSmoke } from "./f05-production-smoke-runner.mjs";

try {
  const guard = assertF05ProductionSmokeGuard();
  const evidence = await runF05ProductionOwnersSmoke(createLiveF05SmokeDriver());
  console.log(JSON.stringify({ ...evidence, installation: guard.expectedInstallationId, nppCode: guard.expectedNppCode }, null, 2));
} catch (error) {
  const evidence = error && typeof error === "object" ? error.evidence : null;
  const errors = error instanceof AggregateError ? error.errors : [error];
  console.error(JSON.stringify({
    NPP_F05_PRODUCTION_OWNERS_RUNTIME_SMOKE: "FAIL",
    ...(evidence ? { evidence } : {}),
    errors: errors.filter(Boolean).map(redactSmokeError)
  }, null, 2));
  process.exitCode = 1;
}
