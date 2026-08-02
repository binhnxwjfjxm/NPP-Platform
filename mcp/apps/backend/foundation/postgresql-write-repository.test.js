import test from "node:test";
import assert from "node:assert/strict";
import { createPostgresqlWriteTransaction } from "./postgresql-write-repository.js";

function persistenceFor(client, calls = []) {
  return {
    schema: "mcp",
    async withTransaction(work) {
      calls.push("transaction");
      return work(client);
    }
  };
}

test("write repository refuses a non-MCP persistence schema", () => {
  assert.throws(
    () => createPostgresqlWriteTransaction({ schema: "public", withTransaction: async () => null }),
    (error) => error.code === "mcp_schema_required"
  );
});

test("transaction exposes only fixed ports and frozen domain repositories", async () => {
  const client = { async query() { return { rows: [] }; } };
  const transaction = createPostgresqlWriteTransaction(persistenceFor(client), {
    domainRepositoryFactory: () => ({ outlets: { findById: async () => null } })
  });
  await transaction(async (tx) => {
    assert.deepEqual(Object.keys(tx).sort(), ["audit", "idempotency", "outbox", "repositories"]);
    assert.equal(Object.isFrozen(tx), true);
    assert.equal(Object.isFrozen(tx.repositories), true);
    assert.equal("client" in tx, false);
    assert.equal("query" in tx, false);
  });
});

test("unsafe generic repository contracts are rejected", async () => {
  const client = { async query() { return { rows: [] }; } };
  const transaction = createPostgresqlWriteTransaction(persistenceFor(client), {
    domainRepositoryFactory: () => ({ outlets: { query: async () => null } })
  });
  await assert.rejects(
    () => transaction(async () => null),
    (error) => error.code === "unsafe_domain_repository_contract"
  );
});

test("idempotency port implements claim, replay, conflict and completion contracts", async () => {
  const calls = [];
  const responses = [
    { rows: [{ record_id: "11111111-1111-4111-8111-111111111111" }] },
    { rows: [{ record_id: "11111111-1111-4111-8111-111111111111" }] }
  ];
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      return responses.shift() || { rows: [] };
    }
  };
  const transaction = createPostgresqlWriteTransaction(persistenceFor(client));
  await transaction(async (tx) => {
    const claimed = await tx.idempotency.claim({
      installationId: "installation-1",
      commandName: "mcp.outlet.create",
      idempotencyKey: "idem-1",
      fingerprint: "a".repeat(64),
      requestId: "request-1",
      actorId: "service-1"
    });
    assert.equal(claimed.state, "claimed");
    await tx.idempotency.complete({
      recordId: claimed.recordId,
      installationId: "installation-1",
      commandName: "mcp.outlet.create",
      idempotencyKey: "idem-1",
      fingerprint: "a".repeat(64),
      requestId: "request-1",
      response: { data: { id: "outlet-1" } }
    });
  });
  assert.equal(calls[0].text.includes("ON CONFLICT"), true);
  assert.equal(calls.at(-1).text.includes("state = 'completed'"), true);
  assert.deepEqual(calls.at(-1).values.slice(1, 6), ["installation-1", "mcp.outlet.create", "idem-1", "a".repeat(64), "request-1"]);

  const replayClient = {
    calls: 0,
    async query() {
      this.calls += 1;
      if (this.calls === 1) return { rows: [] };
      return { rows: [{
        record_id: "22222222-2222-4222-8222-222222222222",
        fingerprint: "b".repeat(64),
        state: "completed",
        response: { data: { id: "outlet-2" } },
        request_id: "request-original"
      }] };
    }
  };
  const replayTransaction = createPostgresqlWriteTransaction(persistenceFor(replayClient));
  await replayTransaction(async (tx) => {
    const replay = await tx.idempotency.claim({
      installationId: "installation-1",
      commandName: "mcp.outlet.create",
      idempotencyKey: "idem-2",
      fingerprint: "b".repeat(64),
      requestId: "request-retry",
      actorId: "service-1"
    });
    assert.equal(replay.state, "replay");
    assert.equal(replay.originalRequestId, "request-original");
  });
});

test("audit and outbox ports write schema-owned tables with JSON payloads", async () => {
  const calls = [];
  const client = { async query(text, values) { calls.push({ text, values }); return { rows: [] }; } };
  const transaction = createPostgresqlWriteTransaction(persistenceFor(client));
  const event = {
    eventId: "33333333-3333-4333-8333-333333333333",
    eventType: "mcp.outlet.created",
    aggregateType: "field_outlet",
    aggregateId: "outlet-3",
    aggregateVersion: 1,
    installationId: "installation-1",
    actorId: "service-1",
    actorType: "service",
    employeeId: null,
    requestId: "request-3",
    idempotencyKey: "idem-3",
    source: "mcp-backend",
    occurredAt: "2026-08-02T00:00:00.000Z",
    payload: { id: "outlet-3" }
  };
  await transaction(async (tx) => {
    await tx.audit.append({ ...event, action: "mcp.outlet.create", permission: "mcp.outlets.write", scope: "mcp:*" });
    await tx.outbox.enqueue(event);
  });
  assert.equal(calls[0].text.includes("mcp.audit_events"), true);
  assert.equal(calls[1].text.includes("mcp.outbox_events"), true);
  assert.equal(calls[0].values.at(-1), JSON.stringify(event.payload));
});
