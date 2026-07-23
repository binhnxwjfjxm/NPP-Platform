import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scanRepository } from "./audit-direct-db-mutations.mjs";

function uniqueSorted(values) { return [...new Set(values)].sort(); }

function textReport(result) {
  const lines = [
    result.errors.length ? "direct_db_mutation_policy_failed" : "direct_db_mutation_policy_passed",
    `findings=${result.summary.total}`,
    `legacy_debt=${result.summary.legacyDebt}`,
    `retired_fingerprints=${result.retirements.fingerprintCount}`,
    `completed_phases=${result.retirements.completedPhases.join(",") || "-"}`
  ];
  if (result.errors.length) {
    lines.push("", "errors:");
    for (const error of result.errors) lines.push(`- ${error}`);
  }
  return `${lines.join("\n")}\n`;
}

function retirementPhaseMatches(replacementPhase, completedPhase) {
  const baselinePhase = String(replacementPhase || "").trim();
  const phase = String(completedPhase || "").trim();
  return Boolean(baselinePhase && phase && (phase === baselinePhase || phase.startsWith(`${baselinePhase}.`)));
}

function validateReclassifications(document, sourceEntries) {
  const errors = [];
  const entries = Array.isArray(document.entries) ? document.entries : [];
  const sourceByFingerprint = new Map(sourceEntries.map((entry) => [entry.fingerprint, entry]));
  const seen = new Set();
  const replacements = new Map();

  if (document.schemaVersion !== 1) errors.push("invalid_reclassification_schema_version");
  for (const entry of entries) {
    const fingerprint = String(entry?.fingerprint || "").trim();
    for (const field of ["fingerprint", "classification", "operation", "owner", "reason", "replacementPhase", "replacementTarget"]) {
      if (!String(entry?.[field] || "").trim()) errors.push(`reclassification_entry_missing_${field}:${fingerprint || "unknown"}`);
    }
    if (!fingerprint) continue;
    if (seen.has(fingerprint)) errors.push(`duplicate_reclassification_fingerprint:${fingerprint}`);
    seen.add(fingerprint);

    const source = sourceByFingerprint.get(fingerprint);
    if (!source) {
      errors.push(`reclassification_unknown_baseline_fingerprint:${fingerprint}`);
      continue;
    }
    if (source.classification !== "approved-boundary") errors.push(`reclassification_source_not_approved:${fingerprint}:${source.classification}`);
    if (entry.classification !== "known-legacy-debt") errors.push(`reclassification_target_not_legacy_debt:${fingerprint}:${entry.classification}`);
    if (entry.operation !== source.operation) errors.push(`reclassification_operation_changed:${fingerprint}:${source.operation}:${entry.operation}`);
    if (entry.owner !== source.owner) errors.push(`reclassification_owner_changed:${fingerprint}:${source.owner}:${entry.owner}`);
    replacements.set(fingerprint, { ...source, ...entry });
  }

  return {
    errors,
    entries: sourceEntries.map((entry) => replacements.get(entry.fingerprint) || entry),
    fingerprintCount: replacements.size
  };
}

function validateRetirements(document, baselineEntries, findings) {
  const errors = [];
  const entries = Array.isArray(document.entries) ? document.entries : [];
  const baselineByFingerprint = new Map(baselineEntries.map((entry) => [entry.fingerprint, entry]));
  const liveFingerprints = new Set(findings.map((finding) => finding.fingerprint));
  const seenPhases = new Set();
  const seenFingerprints = new Set();
  const retiredFingerprints = new Set();
  const completedPhases = [];

  if (document.schemaVersion !== 1) errors.push("invalid_retirement_schema_version");
  for (const entry of entries) {
    for (const field of ["phase", "completedAt", "owner", "reason"]) {
      if (!String(entry?.[field] || "").trim()) errors.push(`retirement_entry_missing_${field}`);
    }
    const phase = String(entry?.phase || "").trim();
    if (phase) {
      if (seenPhases.has(phase)) errors.push(`duplicate_retirement_phase:${phase}`);
      seenPhases.add(phase);
      completedPhases.push(phase);
    }
    const fingerprints = Array.isArray(entry?.fingerprints) ? entry.fingerprints : [];
    if (fingerprints.length === 0) errors.push(`retirement_phase_without_fingerprints:${phase || "unknown"}`);
    for (const fingerprint of fingerprints) {
      if (seenFingerprints.has(fingerprint)) errors.push(`duplicate_retired_fingerprint:${fingerprint}`);
      seenFingerprints.add(fingerprint);
      retiredFingerprints.add(fingerprint);
      const baseline = baselineByFingerprint.get(fingerprint);
      if (!baseline) { errors.push(`retirement_unknown_baseline_fingerprint:${fingerprint}`); continue; }
      if (baseline.classification !== "known-legacy-debt") errors.push(`retirement_not_legacy_debt:${fingerprint}`);
      if (phase && !retirementPhaseMatches(baseline.replacementPhase, phase)) errors.push(`retirement_phase_mismatch:${fingerprint}:${baseline.replacementPhase}:${phase}`);
      if (liveFingerprints.has(fingerprint)) errors.push(`retired_finding_still_live:${fingerprint}`);
    }
  }
  return { errors, retiredFingerprints, completedPhases: uniqueSorted(completedPhases) };
}

async function optionalEntries(root, relativePath) {
  const raw = await readFile(path.join(root, relativePath), "utf8").catch(() => null);
  if (!raw) return [];
  const document = JSON.parse(raw);
  return Array.isArray(document.entries) ? document.entries : [];
}

async function optionalDocument(root, relativePath) {
  const raw = await readFile(path.join(root, relativePath), "utf8").catch(() => null);
  return raw ? JSON.parse(raw) : { schemaVersion: 1, entries: [] };
}

export async function auditDirectDbMutationPolicy({
  root = process.cwd(),
  scanRoots,
  baselinePath = "scripts/direct-db-mutation-baseline.json",
  additionsPath = "scripts/direct-db-mutation-baseline-additions.json",
  reclassificationsPath = "scripts/direct-db-mutation-retirement-reclassifications.json",
  retirementsPath = "scripts/direct-db-mutation-retirements.json",
  writeReports = true,
  findingsTextPath = "direct-db-mutation-findings.txt",
  findingsJsonPath = "direct-db-mutation-findings.json"
} = {}) {
  const baselineDocument = JSON.parse(await readFile(path.join(root, baselinePath), "utf8"));
  const sourceEntries = [
    ...(Array.isArray(baselineDocument.entries) ? baselineDocument.entries : []),
    ...await optionalEntries(root, additionsPath)
  ];
  const reclassificationDocument = await optionalDocument(root, reclassificationsPath);
  const reclassification = validateReclassifications(reclassificationDocument, sourceEntries);
  const baselineEntries = reclassification.entries;
  const generatedBaselinePath = "scripts/.direct-db-mutation-baseline.generated.json";
  await writeFile(path.join(root, generatedBaselinePath), JSON.stringify({ schemaVersion: 1, entries: baselineEntries }), "utf8");

  let result;
  try {
    result = await scanRepository({ root, scanRoots, baselinePath: generatedBaselinePath, writeReports: false });
  } finally {
    await rm(path.join(root, generatedBaselinePath), { force: true });
  }

  const retirementDocument = JSON.parse(await readFile(path.join(root, retirementsPath), "utf8"));
  const policy = validateRetirements(retirementDocument, baselineEntries, result.findings);
  const errors = result.errors.filter((error) => {
    if (!error.startsWith("stale_baseline:")) return true;
    const fingerprint = error.slice("stale_baseline:".length);
    return !policy.retiredFingerprints.has(fingerprint);
  });
  errors.push(...reclassification.errors, ...policy.errors);

  const policyResult = {
    ...result,
    errors: uniqueSorted(errors),
    reclassifications: { fingerprintCount: reclassification.fingerprintCount },
    retirements: { completedPhases: policy.completedPhases, fingerprintCount: policy.retiredFingerprints.size }
  };
  if (writeReports) {
    await writeFile(path.join(root, findingsTextPath), textReport(policyResult), "utf8");
    await writeFile(path.join(root, findingsJsonPath), `${JSON.stringify(policyResult, null, 2)}\n`, "utf8");
  }
  return policyResult;
}

async function main() {
  try {
    const result = await auditDirectDbMutationPolicy();
    const report = textReport(result);
    if (result.errors.length) { console.error(report.trimEnd()); process.exitCode = 1; }
    else console.log(report.trimEnd());
  } catch (error) {
    console.error(`direct_db_mutation_policy_failed\n- policy_error:${error?.message || String(error)}`);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
