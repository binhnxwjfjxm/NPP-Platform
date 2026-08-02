import test from "node:test";
import assert from "node:assert/strict";
import { canonicalErrorPayload } from "./api-contract.js";
import { commandFingerprint, executeWriteCommand } from "./write-command.js";

function requestContext(overrides = {}) {
  return {
    requestId: "request_phase6c0c_0001",
    receivedAt: "2026-08-02T00:00:00.000Z",
    installation: { id: "installation-a", nppCode: "NPP-A" },
    actor: { id: "service:npp-a:mcp-v1", type: "service", authentication: "backend-token" },
    principal: {
      id: "user:employee-a",
      type: "user",
      authentication: "identity-resolver",
      employeeId: "employee-a",
      roles: ["mcp.field-employee"],
      permissions: ["mcp.visit.write"],
      scopes: ["mcp:route:route-a"]
    },
    auth: { authenticated: true, mode: "proxy-service" },
    idempotencyKey: "visit-write-00000001",
    ...overrides
  };
}

function cloneState(value) {
  return {
    idempotency: new Map([...value.idempotency.entries()].map(([key, item]) => [key, structuredClone(item)])),
    domain: structuredClone(value.domain),
    audit: structuredClone(value.audit),
    outbox: structuredClone(value.outbox)
  };
}

function transactionFixture({ seed = [], failAudit = false, failOutbox = false } = {}) {
  let committed = {
    idempotency: new Map(seed),
    domain: [],
    audit: [],
    outbox: []
  };
  let transactions = 0;
  let nextRecord = 1;

  async function transaction(callback) {
    transactions += 1;
    const draft = cloneState(committed);
    const tx = {
      domain: {
        insert(value) {
          draft.domain.push(structuredClone(value));
        }
      },
      idempotency: {
        async claim(input) {
          const key = `${input.installationId}:${input.commandName}:${input.idempotencyKey}`;
          const existing = draft.idempotency.get(key);
          if (existing) {
            if (existing.fingerprint !== input.fingerprint) return { state: "conflict" };
            if (existing.state === "in_progress") return { state: "in_progress", retryAfterSeconds: 3 };
            return {
              state: "replay",
              response: structuredClone(existing.response),
              originalRequestId: existing.requestId
            };
          }
          const recordId = `idem-${nextRecord++}`;
          draft.idempotency.set(key, {
            state: "in_progress",
            recordId,
            fingerprint: input.fingerprint,
            requestId: input.requestId,
            response: null
          });
          return { state: "claimed", recordId };
        },
        async complete(input) {
          const key = `${input.installationId}:${input.commandName}:${input.idempotencyKey}`;
          const existing = draft.idempotency.get(key);
          assert.ok(existing, "idempotency claim must exist before completion");
          draft.idempotency.set(key, {
            ...existing,
            state: "completed",
            response: structuredClone(input.response)
          });
        }
      },
      audit: {
        async append(event) {
          if (failAudit) throw new Error("postgres audit insert failed with sql details");
          draft.audit.push(structuredClone(event));
        }
      },
      outbox: {
        async enqueue(event) {
          if (failOutbox) throw new Error("postgres outbox insert failed with sql details");
          draft.outbox.push(structuredClone(event));
        }
      }
    };

    const result = await callback(tx);
    committed = draft;
    return result;
  }

  return {
    transaction,
    get state() { return committed; },
    get transactions() { return transactions; }
  };
}

const baseCommand = {
  commandName: "mcp.visit.complete",
  permission: "mcp.visit.write",
  scope: "mcp:route:route-a",
  eventType: "mcp.visit.completed",
  aggregate: (result) => ({ type: "visit", id: result.id, version: 1 }),
  payload: { visitId: "visit-a", result: "completed" },
  clock: () => new Date("2026-08-02T00:00:00.000Z"),
  uuid: () => "event-00000000-0000-4000-8000-000000000001"
};

test("fingerprints are deterministic across object key order", () => {
  assert.equal(
    commandFingerprint("mcp.visit.complete", { b: 2, a: { y: 2, x: 1 } }),
    commandFingerprint("mcp.visit.complete", { a: { x: 1, y: 2 }, b: 2 })
  );
});

test("successful write stores mutation, audit, outbox and replay atomically", async () => {
  const fixture = transactionFixture();
  const first = await executeWriteCommand({
    ...baseCommand,
    context: requestContext(),
    transaction: fixture.transaction,
    mutate: async (tx) => {
      const result = { id: "visit-a", status: "completed" };
      tx.domain.insert(result);
      return result;
    }
  });

  assert.equal(first.meta.idempotency.replayed, false);
  assert.equal(fixture.state.domain.length, 1);
  assert.equal(fixture.state.audit.length, 1);
  assert.equal(fixture.state.outbox.length, 1);
  assert.equal(fixture.state.audit[0].employeeId, "employee-a");
  assert.equal(fixture.state.audit[0].requestId, "request_phase6c0c_0001");
  assert.equal(fixture.state.outbox[0].eventId, fixture.state.audit[0].eventId);

  const replay = await executeWriteCommand({
    ...baseCommand,
    context: requestContext({ requestId: "request_phase6c0c_0002" }),
    transaction: fixture.transaction,
    mutate: async () => {
      throw new Error("replay must not execute mutation");
    }
  });

  assert.equal(replay.meta.idempotency.replayed, true);
  assert.equal(replay.meta.idempotency.originalRequestId, "request_phase6c0c_0001");
  assert.equal(fixture.state.domain.length, 1);
  assert.equal(fixture.state.audit.length, 1);
  assert.equal(fixture.state.outbox.length, 1);
});

test("same idempotency key with different payload conflicts", async () => {
  const fixture = transactionFixture();
  await executeWriteCommand({
    ...baseCommand,
    context: requestContext(),
    transaction: fixture.transaction,
    mutate: async (tx) => {
      tx.domain.insert({ id: "visit-a" });
      return { id: "visit-a" };
    }
  });

  await assert.rejects(
    () => executeWriteCommand({
      ...baseCommand,
      payload: { visitId: "visit-a", result: "cancelled" },
      context: requestContext({ requestId: "request_phase6c0c_0003" }),
      transaction: fixture.transaction,
      mutate: async () => ({ id: "visit-a" })
    }),
    (error) => error.code === "idempotency_key_conflict" && error.statusCode === 409
  );
});

test("in-progress idempotency claims return a retryable stable conflict", async () => {
  const fingerprint = commandFingerprint(baseCommand.commandName, baseCommand.payload);
  const key = `installation-a:${baseCommand.commandName}:visit-write-00000001`;
  const fixture = transactionFixture({
    seed: [[key, {
      state: "in_progress",
      recordId: "idem-existing",
      fingerprint,
      requestId: "request_original_0001",
      response: null
    }]]
  });

  await assert.rejects(
    () => executeWriteCommand({
      ...baseCommand,
      context: requestContext(),
      transaction: fixture.transaction,
      mutate: async () => ({ id: "visit-a" })
    }),
    (error) => error.code === "idempotency_in_progress" &&
      error.statusCode === 409 &&
      error.publicRetryable === true &&
      error.publicDetails.retryAfterSeconds === 3
  );
});

test("audit or outbox failure rolls back domain mutation and idempotency completion", async () => {
  const fixture = transactionFixture({ failAudit: true });
  await assert.rejects(
    () => executeWriteCommand({
      ...baseCommand,
      context: requestContext(),
      transaction: fixture.transaction,
      mutate: async (tx) => {
        tx.domain.insert({ id: "visit-a" });
        return { id: "visit-a" };
      }
    }),
    /postgres audit insert failed/
  );
  assert.equal(fixture.state.domain.length, 0);
  assert.equal(fixture.state.audit.length, 0);
  assert.equal(fixture.state.outbox.length, 0);
  assert.equal(fixture.state.idempotency.size, 0);
});

test("authorization and idempotency fail before opening a transaction", async () => {
  const fixture = transactionFixture();
  await assert.rejects(
    () => executeWriteCommand({
      ...baseCommand,
      context: requestContext({
        principal: { ...requestContext().principal, permissions: [] }
      }),
      transaction: fixture.transaction,
      mutate: async () => ({ id: "visit-a" })
    }),
    (error) => error.code === "permission_denied"
  );
  await assert.rejects(
    () => executeWriteCommand({
      ...baseCommand,
      context: requestContext({ idempotencyKey: null }),
      transaction: fixture.transaction,
      mutate: async () => ({ id: "visit-a" })
    }),
    (error) => error.code === "idempotency_key_required"
  );
  assert.equal(fixture.transactions, 0);
});

test("unexpected provider diagnostics remain sanitized by the public API contract", () => {
  const normalized = canonicalErrorPayload(
    {
      message: "postgres insert failed",
      stack: "secret stack",
      statusCode: 500,
      publicDetails: {
        sql: "insert into mcp.visits",
        provider: "postgresql",
        safeReason: "audit_write_failed"
      }
    },
    { requestId: "request_phase6c0c_0001", status: 500 }
  );

  assert.equal(normalized.payload.error.code, "INTERNAL_ERROR");
  assert.deepEqual(normalized.payload.error.details, { safeReason: "audit_write_failed" });
  assert.doesNotMatch(JSON.stringify(normalized.payload), /postgres|insert into|secret stack/i);
});
