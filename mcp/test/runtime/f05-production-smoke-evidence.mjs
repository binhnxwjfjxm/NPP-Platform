import { MUTATION_INVENTORY, RETIRED_SETTINGS_POSTS } from "./f05-production-smoke-inventory.mjs";

const PASS = "PASS";
const PENDING = "PENDING";

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function assertNoSyntheticPass(value, path = "proof") {
  if (value === PASS) throw new Error(`${path}_synthetic_pass_label_rejected`);
  if (Array.isArray(value)) value.forEach((item, index) => assertNoSyntheticPass(item, `${path}.${index}`));
  else if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) assertNoSyntheticPass(item, `${path}.${key}`);
  }
}

function requireBoolean(value, message) {
  if (value !== true) throw new Error(message);
}

function requireNonEmptyString(value, message) {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
}

function requireNonEmptyArray(value, message) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(message);
}

function hasOutcome(rows, outcome) {
  return Array.isArray(rows) && rows.some((row) => row?.outcome === outcome);
}

function contextRowsAreExact(rows) {
  return Array.isArray(rows) && rows.length > 0 && rows.every((row) => row?.contextExact === true);
}

function archiveSequenceHas(sequence, stage) {
  return Array.isArray(sequence) && sequence.some((item) => item?.stage === stage && item.observed === true);
}

export function emptyEvidence() {
  return {
    NPP_F05_PRODUCTION_OWNERS_RUNTIME_SMOKE: PENDING,
    generatedAt: new Date().toISOString(),
    operations: Object.fromEntries(MUTATION_INVENTORY.map(({ name }) => [name, { status: PENDING }])),
    retiredSettingsPosts: Object.fromEntries(RETIRED_SETTINGS_POSTS.map((path) => [path, { status: PENDING }])),
    archiveLifecycle: { status: PENDING },
    cleanup: { status: PENDING }
  };
}

export function recordOperationProof(evidence, name, facts = {}) {
  assertNoSyntheticPass(facts, `operation.${name}`);
  requireBoolean(facts.firstExecuted, `${name}_first_execution_not_observed`);
  requireBoolean(facts.replayObserved, `${name}_replay_not_observed`);
  requireBoolean(facts.replayPayloadEqual, `${name}_replay_payload_mismatch`);
  requireBoolean(facts.conflictObserved, `${name}_conflict_not_observed`);
  requireBoolean(facts.canonicalEnvelope, `${name}_canonical_envelope_not_observed`);
  requireNonEmptyString(facts.firstRequestId, `${name}_request_id_missing`);
  requireNonEmptyString(facts.aggregateId, `${name}_aggregate_id_missing`);
  requireBoolean(facts.idempotency?.singleCompletedRecord, `${name}_idempotency_record_not_completed`);
  requireBoolean(facts.idempotency?.requestContextExact, `${name}_idempotency_context_not_exact`);
  requireNonEmptyArray(facts.audit?.rows, `${name}_audit_rows_missing`);
  if (!hasOutcome(facts.audit.rows, "succeeded")) throw new Error(`${name}_audit_success_missing`);
  if (!hasOutcome(facts.audit.rows, "replayed")) throw new Error(`${name}_audit_replay_missing`);
  if (!contextRowsAreExact(facts.audit.rows)) throw new Error(`${name}_audit_context_not_exact`);
  requireBoolean(facts.invariant?.observed, `${name}_invariant_not_observed`);

  evidence.operations[name] = {
    status: PASS,
    facts: {
      firstRequestId: facts.firstRequestId,
      aggregateId: facts.aggregateId,
      invariant: facts.invariant,
      auditRows: facts.audit.rows.length,
      idempotencyRecord: facts.idempotency.record
    }
  };
  return evidence.operations[name];
}

export function recordRetiredPostProof(evidence, path, facts = {}) {
  assertNoSyntheticPass(facts, `retiredPost.${path}`);
  requireBoolean(facts.canonical404, `${path}_canonical_404_not_observed`);
  requireNonEmptyString(facts.requestId, `${path}_request_id_missing`);
  requireBoolean(facts.receivedAtObserved, `${path}_received_at_missing`);
  evidence.retiredSettingsPosts[path] = { status: PASS, facts };
  return evidence.retiredSettingsPosts[path];
}

export function recordArchiveProof(evidence, facts = {}) {
  assertNoSyntheticPass(facts, "archiveLifecycle");
  requireNonEmptyArray(facts.sequence, "archive_sequence_missing");
  for (const stage of ["failure", "retry-claim", "reclaim", "completion", "finalizer"]) {
    if (!archiveSequenceHas(facts.sequence, stage)) throw new Error(`archive_${stage}_not_observed`);
  }
  requireBoolean(facts.providerR2?.created, "archive_r2_create_not_observed");
  requireBoolean(facts.providerR2?.presenceObserved, "archive_r2_presence_not_observed");
  requireBoolean(facts.providerR2?.absenceObserved, "archive_r2_absence_not_observed");
  requireBoolean(facts.intent?.completed, "archive_intent_not_completed");
  requireBoolean(facts.deleteJob?.completed, "archive_delete_job_not_completed");
  requireBoolean(facts.crossSystemBoundary?.postgresIntentBeforeR2, "archive_postgres_intent_boundary_not_observed");
  requireBoolean(facts.crossSystemBoundary?.r2FailureBeforeRetry, "archive_r2_failure_boundary_not_observed");
  requireBoolean(facts.crossSystemBoundary?.r2DeleteBeforeFinalizer, "archive_r2_delete_boundary_not_observed");
  requireBoolean(facts.crossSystemBoundary?.finalizerAfterStorageCompletion, "archive_finalizer_boundary_not_observed");
  requireBoolean(facts.noFakeCrossSystemTransaction, "archive_cross_system_boundary_not_observed");

  evidence.archiveLifecycle = { status: PASS, facts };
  return evidence.archiveLifecycle;
}

export function recordCleanupProof(evidence, facts = {}) {
  assertNoSyntheticPass(facts, "cleanup");
  requireBoolean(facts.databaseRowsAbsent, "cleanup_database_rows_not_absent");
  requireBoolean(facts.r2RowsAbsent, "cleanup_r2_rows_not_absent");
  evidence.cleanup = { status: PASS, facts };
  return evidence.cleanup;
}

export function finalizeEvidence(evidence) {
  const operationsPass = Object.values(evidence.operations).every((item) => item.status === PASS);
  const retiredPass = Object.values(evidence.retiredSettingsPosts).every((item) => item.status === PASS);
  const archivePass = evidence.archiveLifecycle.status === PASS;
  const cleanupPass = evidence.cleanup.status === PASS;
  evidence.NPP_F05_PRODUCTION_OWNERS_RUNTIME_SMOKE = operationsPass && retiredPass && archivePass && cleanupPass ? PASS : "FAIL";
  return evidence;
}
