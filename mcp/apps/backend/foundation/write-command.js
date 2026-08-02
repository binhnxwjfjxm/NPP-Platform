import { createHash, randomUUID } from "node:crypto";
import { authorizeCommand } from "./authorization.js";

const COMMAND_PATTERN = /^mcp\.[a-z0-9][a-z0-9._:-]{1,126}$/;
const EVENT_PATTERN = /^mcp\.[a-z0-9][a-z0-9._:-]{1,126}$/;
const AGGREGATE_PATTERN = /^[a-z][a-z0-9._:-]{1,126}$/;

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function commandError(code, statusCode, publicDetails = {}, publicRetryable = false) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  error.publicDetails = publicDetails;
  error.publicRetryable = publicRetryable;
  return error;
}

function requiredText(value, pattern, code) {
  const candidate = String(value ?? "").trim().toLowerCase();
  if (!pattern.test(candidate)) {
    const error = new TypeError(code);
    error.code = code;
    throw error;
  }
  return candidate;
}

function canonicalValue(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("invalid_command_payload_number");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalValue(item, seen));
  if (!value || typeof value !== "object") throw new TypeError("invalid_command_payload_type");
  if (seen.has(value)) throw new TypeError("cyclic_command_payload");
  seen.add(value);
  const output = {};
  for (const key of Object.keys(value).sort()) {
    const item = value[key];
    if (item === undefined) continue;
    output[key] = canonicalValue(item, seen);
  }
  seen.delete(value);
  return output;
}

export function commandFingerprint(commandName, payload) {
  const command = requiredText(commandName, COMMAND_PATTERN, "invalid_command_name");
  const canonical = JSON.stringify({ command, payload: canonicalValue(payload) });
  return createHash("sha256").update(canonical).digest("hex");
}

function requireIdempotency(context) {
  const key = String(context?.idempotencyKey || "").trim();
  if (!key) throw commandError("idempotency_key_required", 400);
  return key;
}

function transactionCapabilities(transaction) {
  if (typeof transaction !== "function") throw new TypeError("transaction_runner_required");
  return transaction;
}

function requireTransactionPort(tx, namespace, method) {
  const port = tx?.[namespace]?.[method];
  if (typeof port !== "function") {
    const error = new TypeError(`transaction_${namespace}_${method}_required`);
    error.code = "invalid_transaction_contract";
    throw error;
  }
  return port.bind(tx[namespace]);
}

function normalizedClaim(value) {
  const claim = object(value);
  const state = String(claim.state || "").trim().toLowerCase();
  if (!new Set(["claimed", "replay", "conflict", "in_progress"]).has(state)) {
    const error = new TypeError("invalid_idempotency_claim_state");
    error.code = "invalid_transaction_contract";
    throw error;
  }
  return { ...claim, state };
}

function replayResponse(claim) {
  const stored = object(claim.response);
  const originalRequestId = String(claim.originalRequestId || stored?.meta?.idempotency?.originalRequestId || "").trim();
  return {
    data: Object.prototype.hasOwnProperty.call(stored, "data") ? stored.data : stored,
    meta: {
      idempotency: {
        replayed: true,
        ...(originalRequestId ? { originalRequestId: originalRequestId.slice(0, 128) } : {})
      }
    }
  };
}

function conflictForClaim(claim) {
  if (claim.state === "conflict") return commandError("idempotency_key_conflict", 409);
  if (claim.state === "in_progress") {
    const parsed = Number.parseInt(String(claim.retryAfterSeconds || "2"), 10);
    const retryAfterSeconds = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 300) : 2;
    return commandError("idempotency_in_progress", 409, { retryAfterSeconds }, true);
  }
  return null;
}

function aggregateDescriptor(value, mutationResult) {
  const raw = typeof value === "function" ? value(mutationResult) : value;
  const aggregate = object(raw);
  const type = requiredText(aggregate.type, AGGREGATE_PATTERN, "invalid_aggregate_type");
  const id = String(aggregate.id ?? "").trim();
  if (!id || id.length > 191) throw new TypeError("invalid_aggregate_id");
  const version = Number(aggregate.version ?? 1);
  if (!Number.isInteger(version) || version < 1) throw new TypeError("invalid_aggregate_version");
  return Object.freeze({ type, id, version });
}

function eventEnvelope({ context, eventType, aggregate, source, payload, eventId, occurredAt }) {
  return Object.freeze({
    eventId,
    eventType,
    aggregateType: aggregate.type,
    aggregateId: aggregate.id,
    aggregateVersion: aggregate.version,
    installationId: context.installation.id,
    actorId: context.principal.id,
    actorType: context.principal.type,
    employeeId: context.principal.employeeId || null,
    requestId: context.requestId,
    idempotencyKey: context.idempotencyKey,
    source,
    occurredAt,
    payload: canonicalValue(payload)
  });
}

export async function executeWriteCommand({
  context,
  commandName,
  permission,
  scope = null,
  payload,
  aggregate,
  eventType,
  source = "mcp-backend",
  transaction,
  mutate,
  eventPayload = (result) => result,
  clock = () => new Date(),
  uuid = randomUUID
}) {
  const command = requiredText(commandName, COMMAND_PATTERN, "invalid_command_name");
  const event = requiredText(eventType, EVENT_PATTERN, "invalid_event_type");
  const actor = authorizeCommand(context, { permission, scope });
  const idempotencyKey = requireIdempotency(context);
  if (typeof mutate !== "function") throw new TypeError("mutation_handler_required");
  if (typeof eventPayload !== "function") throw new TypeError("event_payload_builder_required");
  const runInTransaction = transactionCapabilities(transaction);
  const fingerprint = commandFingerprint(command, payload);

  return runInTransaction(async (tx) => {
    const claimIdempotency = requireTransactionPort(tx, "idempotency", "claim");
    const completeIdempotency = requireTransactionPort(tx, "idempotency", "complete");
    const appendAudit = requireTransactionPort(tx, "audit", "append");
    const enqueueOutbox = requireTransactionPort(tx, "outbox", "enqueue");

    const claim = normalizedClaim(await claimIdempotency({
      installationId: context.installation.id,
      commandName: command,
      idempotencyKey,
      fingerprint,
      requestId: context.requestId,
      actorId: actor.id
    }));

    if (claim.state === "replay") return replayResponse(claim);
    const claimError = conflictForClaim(claim);
    if (claimError) throw claimError;

    const mutationResult = await mutate(tx, {
      context,
      commandName: command,
      fingerprint,
      idempotencyRecordId: claim.recordId || null
    });
    const aggregateValue = aggregateDescriptor(aggregate, mutationResult);
    const occurredAtValue = clock();
    const occurredAt = occurredAtValue instanceof Date ? occurredAtValue.toISOString() : new Date(occurredAtValue).toISOString();
    const eventId = uuid();
    const envelope = eventEnvelope({
      context,
      eventType: event,
      aggregate: aggregateValue,
      source: String(source || "mcp-backend").trim().slice(0, 128) || "mcp-backend",
      payload: eventPayload(mutationResult),
      eventId,
      occurredAt
    });

    await appendAudit({
      ...envelope,
      action: command,
      permission: String(permission).trim().toLowerCase(),
      scope: scope ? String(scope).trim().toLowerCase() : null
    });
    await enqueueOutbox(envelope);

    const response = {
      data: mutationResult,
      meta: {
        idempotency: {
          replayed: false,
          originalRequestId: context.requestId
        }
      }
    };

    await completeIdempotency({
      recordId: claim.recordId || null,
      installationId: context.installation.id,
      commandName: command,
      idempotencyKey,
      fingerprint,
      requestId: context.requestId,
      response
    });

    return response;
  });
}
