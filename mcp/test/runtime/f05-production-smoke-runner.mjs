import { emptyEvidence, finalizeEvidence, recordArchiveProof, recordCleanupProof, recordOperationProof, recordRetiredPostProof } from "./f05-production-smoke-evidence.mjs";
import { MUTATION_INVENTORY, RETIRED_SETTINGS_POSTS } from "./f05-production-smoke-inventory.mjs";

export async function runF05ProductionOwnersSmoke(driver) {
  const evidence = emptyEvidence();
  let fixtures;
  let primaryError;
  let cleanupError;
  try {
    fixtures = await driver.createTemporaryFixtures();
    for (const operation of MUTATION_INVENTORY) {
      const facts = await driver.proveOperation(operation, fixtures);
      recordOperationProof(evidence, operation.name, facts);
    }
    for (const path of RETIRED_SETTINGS_POSTS) {
      const facts = await driver.proveRetiredPost(path, fixtures);
      recordRetiredPostProof(evidence, path, facts);
    }
    const archiveFacts = await driver.proveArchiveLifecycle(fixtures);
    recordArchiveProof(evidence, archiveFacts);
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      const cleanupFacts = await driver.cleanupTemporaryFixtures(fixtures);
      const cleanupVerification = await driver.verifyCleanup(fixtures);
      recordCleanupProof(evidence, { ...cleanupFacts, ...cleanupVerification });
    } catch (error) {
      cleanupError = error;
      evidence.cleanup = { status: "FAIL", error: error?.message || String(error) };
    }
  }
  finalizeEvidence(evidence);
  if (primaryError || cleanupError) {
    const error = new AggregateError([primaryError, cleanupError].filter(Boolean), "npp_f05_production_smoke_failed");
    error.evidence = evidence;
    throw error;
  }
  return evidence;
}
