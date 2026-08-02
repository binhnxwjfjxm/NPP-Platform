import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { runMcpMigrations } from "./migrations/index.js";
import {
  captureInstallationAudit,
  captureRuntimeIdentity,
  evaluateProviderPreflight
} from "./provider-cutover.js";

const { Pool } = pg;
const adminUrl = process.env.TEST_DATABASE_URL;
const runtimeRole = "mcp_runtime_6c0f";
const overprivRole = "mcp_overpriv_6c0f";
const runtimePassword = "runtime-fixture-6c0f";
const overprivPassword = "overpriv-fixture-6c0f";

function roleUrl(connectionString, role, password) {
  const parsed = new URL(connectionString);
  parsed.username = role;
  parsed.password = password;
  return parsed.toString();
}

async function resetRole(admin, role) {
  await admin.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1 AND pid <> pg_backend_pid()",
    [role]
  );
  await admin.query(`DROP OWNED BY ${role} CASCADE`).catch(() => {});
  await admin.query(`DROP ROLE IF EXISTS ${role}`);
}

async function grantRuntimeContract(admin, role) {
  await admin.query(`GRANT USAGE ON SCHEMA mcp TO ${role}`);
  await admin.query(`GRANT SELECT, INSERT, UPDATE ON mcp.idempotency_records TO ${role}`);
  await admin.query(`GRANT INSERT ON mcp.audit_events TO ${role}`);
  await admin.query(`GRANT INSERT ON mcp.outbox_events TO ${role}`);
}

test(
  "provider cutover preflight accepts restricted runtime role and rejects over-privilege",
  { skip: !adminUrl },
  async (t) => {
    const admin = new Pool({ connectionString: adminUrl });
    let runtime = null;
    let overpriv = null;
    t.after(async () => {
      if (runtime) await runtime.end();
      if (overpriv) await overpriv.end();
      await resetRole(admin, overprivRole);
      await resetRole(admin, runtimeRole);
      await admin.query("DROP SCHEMA IF EXISTS mcp CASCADE");
      await admin.query(
        "DELETE FROM shared.schema_migrations WHERE split_part(id, '_', 1) = 'mcp'"
      ).catch(() => {});
      await admin.query("DROP TABLE IF EXISTS sales.preflight_probe");
      await admin.end();
    });

    await resetRole(admin, overprivRole);
    await resetRole(admin, runtimeRole);
    await admin.query("CREATE SCHEMA IF NOT EXISTS shared");
    await admin.query(`CREATE TABLE IF NOT EXISTS shared.schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    await admin.query("DROP SCHEMA IF EXISTS mcp CASCADE");
    await admin.query("DELETE FROM shared.schema_migrations WHERE split_part(id, '_', 1) = 'mcp'");
    await runMcpMigrations(admin);
    await admin.query("CREATE SCHEMA IF NOT EXISTS sales");
    await admin.query("DROP TABLE IF EXISTS sales.preflight_probe");
    await admin.query("CREATE TABLE sales.preflight_probe (id integer PRIMARY KEY)");

    await admin.query(`CREATE ROLE ${runtimeRole} LOGIN PASSWORD '${runtimePassword}'`);
    await admin.query(`CREATE ROLE ${overprivRole} LOGIN PASSWORD '${overprivPassword}'`);
    await grantRuntimeContract(admin, runtimeRole);
    await grantRuntimeContract(admin, overprivRole);
    await admin.query(`GRANT CREATE ON SCHEMA mcp TO ${overprivRole}`);
    await admin.query(`GRANT INSERT ON sales.preflight_probe TO ${overprivRole}`);

    runtime = new Pool({
      connectionString: roleUrl(adminUrl, runtimeRole, runtimePassword),
      options: "-c search_path=mcp,public -c default_transaction_read_only=on"
    });
    const runtimeIdentity = await captureRuntimeIdentity(runtime);
    const installationAudit = await captureInstallationAudit(admin, { runtimeRole });
    const accepted = evaluateProviderPreflight(
      { runtimeIdentity, installationAudit },
      { expectedRole: runtimeRole }
    );
    assert.deepEqual(accepted, { ready: true, issues: [] });

    overpriv = new Pool({
      connectionString: roleUrl(adminUrl, overprivRole, overprivPassword),
      options: "-c search_path=mcp,public -c default_transaction_read_only=on"
    });
    const overprivIdentity = await captureRuntimeIdentity(overpriv);
    const overprivAudit = await captureInstallationAudit(admin, { runtimeRole: overprivRole });
    const rejected = evaluateProviderPreflight(
      { runtimeIdentity: overprivIdentity, installationAudit: overprivAudit },
      { expectedRole: overprivRole }
    );
    assert.equal(rejected.ready, false);
    assert.match(rejected.issues.join(" "), /runtime_has_mcp_schema_create/);
    assert.match(rejected.issues.join(" "), /runtime_has_core_table_write/);
  }
);
