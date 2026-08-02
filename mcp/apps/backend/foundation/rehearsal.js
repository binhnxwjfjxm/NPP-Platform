import { createHash } from "node:crypto";

export const REHEARSAL_CONFIRM_ENV = "MCP_MIGRATION_REHEARSAL_CONFIRM";
export const REHEARSAL_CONFIRM_VALUE = "temporary-database";
export const REMOTE_REHEARSAL_CONFIRM_ENV = "MCP_MIGRATION_REHEARSAL_REMOTE_CONFIRM";
export const REMOTE_REHEARSAL_CONFIRM_VALUE = "isolated-non-production-cluster";
export const LEGACY_ORDER_CLASSES = Object.freeze([
  "OFFICIAL_ORDER_MIGRATION_CANDIDATE",
  "FIELD_ORDER_INTENT",
  "SAMPLE_TEST_DEMAND",
  "HISTORICAL_DISPLAY_ONLY",
  "INVALID_ORPHAN_RECONCILIATION_REQUIRED"
]);

function rehearsalError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function parseDatabaseUrl(value) {
  if (!value) throw rehearsalError("missing_database_url", "DATABASE_URL is required for MCP migration rehearsal");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw rehearsalError("invalid_database_url", "DATABASE_URL must be a valid PostgreSQL connection string");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw rehearsalError("invalid_database_url", "DATABASE_URL must use postgres or postgresql");
  }
  if (!parsed.pathname || parsed.pathname === "/") {
    throw rehearsalError("missing_database_name", "DATABASE_URL must include an administrative database name");
  }
  return parsed;
}

export function assertRehearsalSafety(env = process.env) {
  if (String(env.NODE_ENV ?? "").trim().toLowerCase() === "production") {
    throw rehearsalError("production_rehearsal_forbidden", "MCP migration rehearsal is forbidden when NODE_ENV=production");
  }
  if (env[REHEARSAL_CONFIRM_ENV] !== REHEARSAL_CONFIRM_VALUE) {
    throw rehearsalError(
      "rehearsal_confirmation_required",
      `MCP migration rehearsal requires ${REHEARSAL_CONFIRM_ENV}=${REHEARSAL_CONFIRM_VALUE}`
    );
  }
  if (String(env.MIGRATION_ALLOW_PRODUCTION ?? "").trim() || String(env.MIGRATION_PRODUCTION_CONFIRM ?? "").trim()) {
    throw rehearsalError("production_confirmation_forbidden", "Production migration confirmation must not be present during rehearsal");
  }
  const parsed = parseDatabaseUrl(env.DATABASE_URL);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (!localHosts.has(parsed.hostname)) {
    const remoteAllowed = String(env.MCP_MIGRATION_REHEARSAL_ALLOW_REMOTE ?? "").trim().toLowerCase() === "true";
    if (!remoteAllowed || env[REMOTE_REHEARSAL_CONFIRM_ENV] !== REMOTE_REHEARSAL_CONFIRM_VALUE) {
      throw rehearsalError(
        "remote_rehearsal_forbidden",
        `Remote rehearsal requires MCP_MIGRATION_REHEARSAL_ALLOW_REMOTE=true and ${REMOTE_REHEARSAL_CONFIRM_ENV}=${REMOTE_REHEARSAL_CONFIRM_VALUE}`
      );
    }
  }
  return parsed;
}

export function hashIdentifier(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

export function safeDatabaseIdentifier(databaseName) {
  return `database:${hashIdentifier(databaseName || "unknown")}`;
}

export function redactOperationalText(value, secrets = []) {
  let text = String(value ?? "");
  text = text.replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, "[REDACTED_DATABASE_URL]");
  for (const secret of secrets.filter(Boolean)) {
    const raw = String(secret);
    text = text.split(raw).join("[REDACTED]");
    try {
      const decoded = decodeURIComponent(raw);
      if (decoded !== raw) text = text.split(decoded).join("[REDACTED]");
    } catch {
      // Ignore malformed percent-encoding; raw replacement already ran.
    }
  }
  return text;
}

export function cryptoHash(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function reconcileSnapshots(before, after) {
  const result = {
    migrationsMatch: same(before?.migrations, after?.migrations),
    tablesMatch: same(before?.tables, after?.tables),
    rowCountsMatch: same(before?.rowCounts, after?.rowCounts),
    checksumsMatch: same(before?.checksums, after?.checksums),
    constraintsMatch: same(before?.constraints, after?.constraints),
    indexesMatch: same(before?.indexes, after?.indexes),
    triggersMatch: same(before?.triggers, after?.triggers)
  };
  result.overallMatch = Object.values(result).every(Boolean);
  return Object.freeze(result);
}

function emptyClassCounts() {
  return Object.fromEntries(LEGACY_ORDER_CLASSES.map((name) => [name, 0]));
}

export function reconcileLegacyOrderFixture(fixture) {
  if (!fixture || typeof fixture !== "object" || Array.isArray(fixture)) {
    throw rehearsalError("invalid_legacy_reconciliation_fixture");
  }
  if (fixture.phase !== "6C.0A" || fixture.schemaVersion !== 1 || fixture.fixtureOnly !== true) {
    throw rehearsalError("invalid_legacy_reconciliation_fixture_metadata");
  }
  if (!Array.isArray(fixture.records)) throw rehearsalError("invalid_legacy_reconciliation_records");

  const byClass = emptyClassCounts();
  const seen = new Set();
  let unclassified = 0;
  for (const record of fixture.records) {
    const id = String(record?.legacyOrderId ?? "").trim();
    if (!id || seen.has(id)) throw rehearsalError("invalid_or_duplicate_legacy_order_id");
    seen.add(id);
    const classification = String(record?.classification ?? "").trim();
    if (!LEGACY_ORDER_CLASSES.includes(classification)) {
      unclassified += 1;
      continue;
    }
    byClass[classification] += 1;
  }

  const summary = Object.freeze({
    total: fixture.records.length,
    byClass: Object.freeze(byClass),
    unclassified
  });
  if (!same(summary, fixture.expectedSummary)) {
    throw rehearsalError("legacy_reconciliation_summary_mismatch");
  }
  return summary;
}

export function validateRehearsalReport(report) {
  const issues = [];
  if (report?.schemaVersion !== 1) issues.push("schemaVersion");
  if (report?.phase !== "6C.0E") issues.push("phase");
  if (!/^(?:[0-9a-f]{40}|local)$/.test(String(report?.sourceCommit || ""))) issues.push("sourceCommit");
  if (!report?.startedAt) issues.push("startedAt");
  if (!report?.generatedAt) issues.push("generatedAt");
  if (!new Set(["success", "failure"]).has(report?.status)) issues.push("status");
  if (!report?.cleanup || typeof report.cleanup !== "object") issues.push("cleanup");
  if (!Array.isArray(report?.errors)) issues.push("errors");
  if (report?.status === "success") {
    const databasePattern = /^database:[0-9a-f]{12}$/;
    for (const key of ["source", "restore", "regression"]) {
      if (!databasePattern.test(String(report?.databases?.[key] || ""))) issues.push(`${key}DatabaseIdentifier`);
    }
    if (report?.backup?.format !== "postgresql-custom") issues.push("backupFormat");
    if (!/^[0-9a-f]{64}$/.test(String(report?.backup?.sha256 || ""))) issues.push("backupChecksum");
    if (!Number.isInteger(report?.backup?.sizeBytes) || report.backup.sizeBytes < 1) issues.push("backupSize");
    if (report?.migrations?.source?.coreVerified !== true || report?.migrations?.source?.mcpVerified !== true) issues.push("sourceMigrations");
    if (report?.migrations?.restore?.coreVerified !== true || report?.migrations?.restore?.mcpVerified !== true) issues.push("restoreMigrations");
    if (report?.regression?.verified !== true) issues.push("regression");
    if (report?.reconciliation?.overallMatch !== true) issues.push("reconciliation");
    if (report?.appendOnly?.source !== true || report?.appendOnly?.restore !== true) issues.push("appendOnly");
    if (report?.legacyOrderClassification?.unclassified !== 0) issues.push("legacyOrderClassification");
    const classCounts = Object.values(report?.legacyOrderClassification?.byClass || {});
    if (classCounts.length !== LEGACY_ORDER_CLASSES.length || classCounts.some((value) => !Number.isInteger(value) || value < 0)) {
      issues.push("legacyOrderClassCounts");
    } else if (classCounts.reduce((total, value) => total + value, 0) !== report?.legacyOrderClassification?.total) {
      issues.push("legacyOrderClassTotal");
    }
    if (report.errors.length !== 0) issues.push("successErrors");
    if (!["removed", "not-created"].includes(report?.cleanup?.backup)) issues.push("backupCleanup");
    for (const key of ["source", "restore", "regression"]) {
      if (!["dropped", "not-created"].includes(report?.cleanup?.[key])) issues.push(`${key}Cleanup`);
    }
  }
  return Object.freeze({ valid: issues.length === 0, issues: Object.freeze(issues) });
}
