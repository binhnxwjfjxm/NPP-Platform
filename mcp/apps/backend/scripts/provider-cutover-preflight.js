import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  assessCutoverReadiness,
  captureInstallationAudit,
  captureRuntimeIdentity,
  digestCutoverPlan,
  evaluateProviderPreflight,
  redactSensitiveText,
  validateCutoverPlan
} from "../foundation/provider-cutover.js";
import {
  MIGRATION_DATABASE_URL_ENV,
  databaseCredentialIdentity,
  parseDatabaseUrl
} from "../foundation/migrations/cli.js";

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PREFLIGHT_CONFIRM_ENV = "MCP_CUTOVER_PREFLIGHT_CONFIRM";
export const PREFLIGHT_CONFIRM_VALUE = "read-only-target";
export const PREFLIGHT_ALLOW_PRODUCTION_ENV = "MCP_CUTOVER_PREFLIGHT_ALLOW_PRODUCTION";
export const PREFLIGHT_PRODUCTION_CONFIRM_ENV = "MCP_CUTOVER_PREFLIGHT_PRODUCTION_CONFIRM";
export const PREFLIGHT_PRODUCTION_CONFIRM_VALUE = "I_UNDERSTAND_THIS_READS_PRODUCTION";
export const DEFAULT_PLAN_PATH = path.resolve(
  __dirname,
  "../../../audit/phase-6c0f/fixtures/cutover-plan.json"
);
export const DEFAULT_REPORT_PATH = path.resolve(
  __dirname,
  "../../../artifacts/provider-cutover-preflight-report.json"
);

function fail(code, message = code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function assertPreflightSafety(env = process.env) {
  if (env[PREFLIGHT_CONFIRM_ENV] !== PREFLIGHT_CONFIRM_VALUE) {
    fail(
      "preflight_confirmation_required",
      `${PREFLIGHT_CONFIRM_ENV}=${PREFLIGHT_CONFIRM_VALUE} is required`
    );
  }
  if (String(env.NODE_ENV ?? "").trim().toLowerCase() !== "production") return;
  if (
    env[PREFLIGHT_ALLOW_PRODUCTION_ENV] !== "true" ||
    env[PREFLIGHT_PRODUCTION_CONFIRM_ENV] !== PREFLIGHT_PRODUCTION_CONFIRM_VALUE
  ) {
    fail(
      "production_preflight_forbidden",
      `Production read-only preflight requires ${PREFLIGHT_ALLOW_PRODUCTION_ENV}=true and ${PREFLIGHT_PRODUCTION_CONFIRM_ENV}=${PREFLIGHT_PRODUCTION_CONFIRM_VALUE}`
    );
  }
}

function loadPlan(planPath) {
  return JSON.parse(readFileSync(planPath, "utf8"));
}

function safeLog(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function writeReport(report, reportPath) {
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export async function runProviderCutoverCommand(
  command,
  env = process.env,
  {
    PoolImpl = Pool,
    planPath = env.MCP_CUTOVER_PLAN_PATH || DEFAULT_PLAN_PATH,
    reportPath = env.MCP_CUTOVER_REPORT_PATH || DEFAULT_REPORT_PATH,
    now = () => new Date().toISOString()
  } = {}
) {
  let runtimePool = null;
  let auditPool = null;
  const sensitiveValues = [env.DATABASE_URL, env[MIGRATION_DATABASE_URL_ENV]].filter(Boolean);
  try {
    if (!new Set(["validate", "verify-target", "verify-ready"]).has(command)) return 2;
    const plan = loadPlan(planPath);
    const implementationHead = String(env.MCP_CUTOVER_EXPECTED_SOURCE_COMMIT || "").trim();
    const expectedSourceCommit = command === "validate" ? null : implementationHead;
    if (command !== "validate" && !expectedSourceCommit) fail("expected_source_commit_required");
    const validation = validateCutoverPlan(plan, { expectedSourceCommit });
    const readiness = assessCutoverReadiness(plan, { expectedSourceCommit });

    if (command === "validate") {
      safeLog({
        timestamp: now(),
        command,
        status: validation.valid ? "success" : "error",
        sourceCommit: plan.source?.commit || null,
        implementationHead: implementationHead || null,
        planDigest: digestCutoverPlan(plan),
        validation,
        readiness
      });
      return validation.valid ? 0 : 1;
    }

    assertPreflightSafety(env);
    if (!validation.valid) fail("cutover_plan_invalid", validation.issues.join(", "));
    const runtimeUrl = parseDatabaseUrl(env.DATABASE_URL);
    const auditUrl = parseDatabaseUrl(env[MIGRATION_DATABASE_URL_ENV]);
    if (databaseCredentialIdentity(runtimeUrl) === databaseCredentialIdentity(auditUrl)) {
      fail(
        "runtime_audit_credential_not_separated",
        "Read-only audit must not use the runtime credential identity"
      );
    }
    const expectedRole = String(env.MCP_DB_ROLE || plan.roles?.runtime || "").trim();
    if (!expectedRole || expectedRole !== plan.roles.runtime) fail("runtime_role_plan_mismatch");

    runtimePool = new PoolImpl({
      connectionString: runtimeUrl,
      application_name: "mcp-cutover-runtime-preflight",
      options: "-c default_transaction_read_only=on -c search_path=mcp,public"
    });
    auditPool = new PoolImpl({
      connectionString: auditUrl,
      application_name: "mcp-cutover-audit-preflight",
      options: "-c default_transaction_read_only=on"
    });
    const runtimeIdentity = await captureRuntimeIdentity(runtimePool);
    const installationAudit = await captureInstallationAudit(auditPool, {
      runtimeRole: expectedRole
    });
    const target = evaluateProviderPreflight(
      { runtimeIdentity, installationAudit },
      { expectedRole }
    );
    const report = Object.freeze({
      schemaVersion: 1,
      phase: "6C.0F",
      generatedAt: now(),
      sourceCommit: plan.source.commit,
      implementationHead,
      planDigest: digestCutoverPlan(plan),
      command,
      planValidation: validation,
      planReadiness: readiness,
      target,
      runtimeIdentity,
      installationAudit,
      productionMutations: Object.freeze({
        databaseAttached: false,
        rolesOrGrantsChanged: false,
        backupRequested: false,
        migrationRun: false,
        backendDeployed: false,
        trafficCutover: false
      })
    });
    writeReport(report, reportPath);
    safeLog({
      timestamp: report.generatedAt,
      command,
      status: target.ready && (command !== "verify-ready" || readiness.ready)
        ? "success"
        : "blocked",
      sourceCommit: report.sourceCommit,
      implementationHead,
      planDigest: report.planDigest,
      target,
      readiness
    });
    return target.ready && (command !== "verify-ready" || readiness.ready) ? 0 : 1;
  } catch (error) {
    safeLog({
      timestamp: now(),
      command,
      status: "error",
      error: {
        code: error.code || "UNKNOWN_ERROR",
        message: redactSensitiveText(error.message, sensitiveValues)
      }
    });
    return 1;
  } finally {
    if (runtimePool) await runtimePool.end();
    if (auditPool) await auditPool.end();
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMainModule) {
  const command = process.argv[2];
  if (!command) {
    process.stderr.write(
      "Usage: node scripts/provider-cutover-preflight.js <validate|verify-target|verify-ready>\n"
    );
    process.exitCode = 2;
  } else {
    process.exitCode = await runProviderCutoverCommand(command);
  }
}
