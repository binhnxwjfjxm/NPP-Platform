import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createPostgresqlPersistence } from "./postgresql-adapter.js";
import { createPostgresqlWriteTransaction } from "./postgresql-write-repository.js";
import { commandFingerprint, executeWriteCommand } from "./write-command.js";
import { MCP_MIGRATIONS, migrationVerifyWithAdapter, runMcpMigrations } from "./migrations/index.js";

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL;

function persistenceConfig() {
  return {
    persistence: {
      databaseUrl,
      schema: "mcp",
      expectedRole: null,
      poolMax: 4,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 5000,
      statementTimeoutMs: 15000
    }
  };
}

function context(idempotencyKey, requestId = "request-1") {
  return Object.freeze({
    requestId,
    idempotencyKey,
    auth: Object.freeze({ authenticated: true }),
    installation: Object.freeze({ id: "installation-test" }),
    principal: Object.freeze({
      id: "service:test:mcp",
      type: "service",
      authentication: "backend-token",
      employeeId: null,
      roles: Object.freeze([]),
      permissions: Object.freeze(["mcp.outlets.write"]),
      scopes: Object.freeze(["mcp:*"])
    })
  });
}

test("PostgreSQL write foundation migrates cleanly and preserves atomic command semantics", { skip: !databaseUrl }, async (t) => {
  const admin = new Pool({ connectionString: databaseUrl });
  let persistence = null;
  t.after(async () => {
    if (persistence) await persistence.close();
    await admin.query("DROP SCHEMA IF EXISTS mcp CASCADE");
    await admin.query("DELETE FROM shared.schema_migrations WHERE split_part(id, '_', 1) = 'mcp'");
    await admin.end();
  });
  await admin.query("CREATE SCHEMA IF NOT EXISTS shared");
  await admin.query(`CREATE TABLE IF NOT EXISTS shared.schema_migrations (
    id text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  await admin.query("DROP SCHEMA IF EXISTS mcp CASCADE");
  await admin.query("DELETE FROM shared.schema_migrations WHERE split_part(id, '_', 1) = 'mcp'");

  const first = await runMcpMigrations(admin);
  const second = await runMcpMigrations(admin);
  assert.deepEqual(first.applied, MCP_MIGRATIONS.map((migration) => migration.id));
  assert.deepEqual(second.applied, []);
  assert.equal((await migrationVerifyWithAdapter(admin)).verified, true);

  persistence = createPostgresqlPersistence(persistenceConfig(), { PoolImpl: Pool });
  assert.equal((await persistence.assertReady()).ready, true);
  const transaction = createPostgresqlWriteTransaction(persistence);

  const command = {
    commandName: "mcp.outlet.create",
    permission: "mcp.outlets.write",
    scope: "mcp:outlets",
    payload: { name: "Outlet A" },
    aggregate: (result) => ({ type: "field_outlet", id: result.id, version: 1 }),
    eventType: "mcp.outlet.created",
    transaction,
    mutate: async () => ({ id: "outlet-a", name: "Outlet A" }),
    eventPayload: (result) => result,
    clock: () => new Date("2026-08-02T00:00:00.000Z"),
    uuid: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  };

  const created = await executeWriteCommand({ ...command, context: context("idem-a") });
  assert.equal(created.meta.idempotency.replayed, false);
  const replay = await executeWriteCommand({ ...command, context: context("idem-a", "request-retry") });
  assert.equal(replay.meta.idempotency.replayed, true);
  assert.equal(replay.meta.idempotency.originalRequestId, "request-1");
  await assert.rejects(
    () => executeWriteCommand({
      ...command,
      context: context("idem-a", "request-conflict"),
      payload: { name: "Outlet B" }
    }),
    (error) => error.code === "idempotency_key_conflict" && error.statusCode === 409
  );

  await admin.query(
    `INSERT INTO mcp.idempotency_records (
       installation_id, command_name, idempotency_key, fingerprint, request_id, actor_id
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    ["installation-test", "mcp.outlet.create", "idem-progress", commandFingerprint("mcp.outlet.create", { marker: "progress" }), "request-progress", "service:test:mcp"]
  );
  const progressCommand = {
    ...command,
    payload: { marker: "progress" },
    context: context("idem-progress", "request-progress-retry")
  };
  await assert.rejects(
    () => executeWriteCommand(progressCommand),
    (error) => error.code === "idempotency_in_progress" && error.statusCode === 409
  );

  const auditCountBefore = Number((await admin.query("SELECT count(*) AS count FROM mcp.audit_events")).rows[0].count);
  await assert.rejects(() => transaction(async (tx) => {
    await tx.audit.append({
      eventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      eventType: "mcp.rollback.tested",
      aggregateType: "field_outlet",
      aggregateId: "rollback",
      aggregateVersion: 1,
      installationId: "installation-test",
      actorId: "service:test:mcp",
      actorType: "service",
      employeeId: null,
      requestId: "request-rollback",
      idempotencyKey: "idem-rollback",
      source: "integration-test",
      action: "mcp.rollback.test",
      permission: "mcp.outlets.write",
      scope: "mcp:outlets",
      occurredAt: "2026-08-02T00:00:00.000Z",
      payload: { rollback: true }
    });
    await tx.outbox.enqueue({
      eventId: "not-a-uuid",
      eventType: "mcp.rollback.tested",
      aggregateType: "field_outlet",
      aggregateId: "rollback",
      aggregateVersion: 1,
      installationId: "installation-test",
      actorId: "service:test:mcp",
      actorType: "service",
      employeeId: null,
      requestId: "request-rollback",
      idempotencyKey: "idem-rollback",
      source: "integration-test",
      occurredAt: "2026-08-02T00:00:00.000Z",
      payload: { rollback: true }
    });
  }));
  const auditCountAfter = Number((await admin.query("SELECT count(*) AS count FROM mcp.audit_events")).rows[0].count);
  assert.equal(auditCountAfter, auditCountBefore);

  await assert.rejects(
    () => admin.query("UPDATE mcp.audit_events SET action = 'forbidden' WHERE event_id = $1::uuid", ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]),
    /mcp_audit_events_append_only/
  );
});
