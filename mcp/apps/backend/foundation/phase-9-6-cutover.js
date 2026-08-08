import { createHash } from "node:crypto";

export const PHASE_96_TEST_ONLY_POLICY = "TEST_ONLY_ARCHIVE_NO_OPERATIONAL_IMPORT";
export const PHASE_96_IMPORT_POLICY = "IMPORT_OPERATIONAL";
export const PHASE_96_FORBIDDEN_LEGACY_RUNTIME_CONFIG = Object.freeze([
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MCP_LEGACY_RUNTIME_ENABLED"
]);

const REQUIRED_RUNTIME_CONFIG = Object.freeze(["DATABASE_URL", "PERSISTENCE_PROVIDER"]);
const BLOCKING_FINDING_TYPES = Object.freeze(new Set([
  "missing_source_id", "missing_installation_id", "cross_installation_source", "duplicate_source_id",
  "mapping_collision", "target_collision", "missing_required_fk", "orphan_fk",
  "duplicate_order_source_identity", "orphan_order_idempotency_record", "idempotency_conflict",
  "order_reconciliation_required"
]));
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function text(value) { const normalized = String(value ?? "").trim(); return normalized || null; }
function uniqueSorted(values) { return [...new Set(values.filter(Boolean))].sort(); }
function finding(list, code) { if (!list.includes(code)) list.push(code); }
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}
function canonicalJson(value) { return JSON.stringify(canonicalize(value)); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function rowsDigest(rows) { return sha256([...rows].map(canonicalJson).sort().join("\n")); }
function classificationRows(classifications) {
  return Object.entries(classifications || {}).flatMap(([entity, rows]) => (Array.isArray(rows) ? rows : []).map((row) => ({ entity, ...row })));
}

export function verifyPhase95SnapshotPackage({ manifest, classifications, findings = [] } = {}) {
  const issues = [];
  if (!manifest || manifest.phase !== "9.5") finding(issues, "phase_9_5_manifest_required");
  const manifestSha256 = text(manifest?.manifestSha256);
  if (!SHA256_PATTERN.test(manifestSha256 || "")) finding(issues, "invalid_phase_9_5_manifest_sha256");
  if (manifest && manifestSha256) {
    const { manifestSha256: ignored, ...body } = manifest;
    void ignored;
    if (sha256(canonicalJson(body)) !== manifestSha256) finding(issues, "phase_9_5_manifest_self_hash_mismatch");
  }
  const flattenedClassifications = classificationRows(classifications);
  if (manifest?.classificationCount !== flattenedClassifications.length) finding(issues, "phase_9_5_classification_count_mismatch");
  if (text(manifest?.classificationSha256) && rowsDigest(flattenedClassifications) !== manifest.classificationSha256) finding(issues, "phase_9_5_classification_hash_mismatch");
  if (manifest?.findingCount !== findings.length) finding(issues, "phase_9_5_finding_count_mismatch");
  if (text(manifest?.findingsSha256) && rowsDigest(findings) !== manifest.findingsSha256) finding(issues, "phase_9_5_findings_hash_mismatch");
  return Object.freeze({ valid: issues.length === 0, issues: Object.freeze(issues.sort()), manifestSha256 });
}

export function digestPhase96Decision(decision) { return sha256(canonicalJson(decision ?? null)); }

export function buildPhase96ImportPlan({ snapshot, ownerDecision = null } = {}) {
  const blockers = [];
  const verified = verifyPhase95SnapshotPackage(snapshot || {});
  blockers.push(...verified.issues);
  const manifest = snapshot?.manifest || {};
  const policy = text(ownerDecision?.policy);
  const decisionInstallationId = text(ownerDecision?.installationId);
  const decisionManifestSha = text(ownerDecision?.snapshotManifestSha256);
  const manifestInstallationId = text(manifest.installationId);

  if (!ownerDecision || !new Set([PHASE_96_TEST_ONLY_POLICY, PHASE_96_IMPORT_POLICY]).has(policy)) finding(blockers, "owner_legacy_data_policy_required");
  if (!decisionInstallationId) finding(blockers, "owner_decision_installation_required");
  if (!SHA256_PATTERN.test(decisionManifestSha || "")) finding(blockers, "snapshot_manifest_sha256_required");
  if (manifestInstallationId && decisionInstallationId && manifestInstallationId !== decisionInstallationId) finding(blockers, "owner_decision_installation_mismatch");
  if (verified.manifestSha256 && decisionManifestSha && verified.manifestSha256 !== decisionManifestSha) finding(blockers, "owner_decision_snapshot_mismatch");

  const rows = classificationRows(snapshot?.classifications);
  const reconciliationRows = rows.filter((row) => row.disposition === "reconciliation_required");
  const operationalRows = rows.filter((row) => row.disposition === "operational_import");
  const alreadyCanonical = rows.filter((row) => row.disposition === "already_canonical");
  const archiveRows = rows.filter((row) => new Set(["archive_only", "evidence_only"]).has(row.disposition));
  const importRows = [];

  if (policy === PHASE_96_TEST_ONLY_POLICY) {
    archiveRows.push(...operationalRows.map((row) => ({ ...row, disposition: "owner_archive_only", originalDisposition: row.disposition })));
    archiveRows.push(...reconciliationRows.map((row) => ({ ...row, disposition: "owner_archive_only", originalDisposition: row.disposition })));
  } else if (policy === PHASE_96_IMPORT_POLICY) {
    importRows.push(...operationalRows);
    if (manifest.importReady !== true) finding(blockers, "phase_9_5_import_not_ready");
    if (reconciliationRows.length > 0) finding(blockers, "reconciliation_rows_block_import");
  }

  const blockingFindings = (snapshot?.findings || []).filter((item) => BLOCKING_FINDING_TYPES.has(item?.type));
  if (blockingFindings.some((item) => new Set(["cross_installation_source", "missing_installation_id"]).has(item.type))) {
    finding(blockers, "source_installation_boundary_unresolved");
  }

  return Object.freeze({
    ready: blockers.length === 0,
    mode: policy === PHASE_96_TEST_ONLY_POLICY ? "ZERO_OPERATIONAL_IMPORT" : policy === PHASE_96_IMPORT_POLICY ? "IMPORT_OPERATIONAL" : null,
    importRows: Object.freeze(importRows),
    archiveRows: Object.freeze(archiveRows),
    alreadyCanonicalRows: Object.freeze(alreadyCanonical),
    counts: Object.freeze({ import: importRows.length, archive: archiveRows.length, alreadyCanonical: alreadyCanonical.length, reconciliationObserved: reconciliationRows.length }),
    blockers: Object.freeze(uniqueSorted(blockers)),
    decisionDigest: ownerDecision ? digestPhase96Decision(ownerDecision) : null,
    snapshotManifestSha256: verified.manifestSha256
  });
}

export function assessPhase96RuntimeDecommission({ persistenceProvider, configVariableNames = [], bridgeEvidence = {} } = {}) {
  const blockers = [];
  if (text(persistenceProvider)?.toLowerCase() !== "postgresql") finding(blockers, "postgresql_must_be_canonical_runtime");
  const names = uniqueSorted(configVariableNames.map(text));
  for (const required of REQUIRED_RUNTIME_CONFIG) if (!names.includes(required)) finding(blockers, `missing_runtime_config:${required}`);
  for (const forbidden of PHASE_96_FORBIDDEN_LEGACY_RUNTIME_CONFIG) if (names.includes(forbidden)) finding(blockers, `legacy_runtime_config_still_required:${forbidden}`);
  for (const key of ["customerOnboarding", "coreSalesOrder", "retryIdempotency"]) if (bridgeEvidence?.[key] !== true) finding(blockers, `bridge_evidence_missing:${key}`);
  return Object.freeze({ ready: blockers.length === 0, blockers: Object.freeze(blockers.sort()), configVariableNames: Object.freeze(names) });
}

export function assessPhase96Gate({ importPlan, runtime } = {}) {
  const blockers = [];
  if (importPlan?.ready !== true) blockers.push(...(importPlan?.blockers || ["import_plan_not_ready"]));
  if (runtime?.ready !== true) blockers.push(...(runtime?.blockers || ["runtime_decommission_not_ready"]));
  return Object.freeze({ ready: blockers.length === 0, blockers: Object.freeze(uniqueSorted(blockers)) });
}
