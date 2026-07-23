import {
  auditRows,
  db,
  ensure,
  idempotencyRows,
  must,
  mustConflict,
  object,
  replayed,
  sameJson,
  stamp
} from "./a5-5-2-smoke-http.mjs";

async function verifyAggregateContext(table, id, firstRequestId, idempotencyKey, label) {
  const rows = await db(`${table}?id=eq.${encodeURIComponent(id)}&select=raw_payload`);
  ensure(rows.length === 1, `${label}_aggregate_missing`);
  const context = object(object(rows[0].raw_payload).foundation_context);
  ensure(context.requestId === firstRequestId, `${label}_foundation_request_id_missing`);
  ensure(context.idempotencyKey === idempotencyKey, `${label}_foundation_idempotency_key_missing`);
}

export async function runOperation({
  name,
  path,
  operation,
  payload,
  conflictPayload,
  aggregateTable,
  aggregateIdKey,
  aggregateRows
}) {
  const key = `a552.${name}.${stamp}`;
  const firstRequestId = `a552-${name}-first-${stamp}`;
  const first = await must(path, {
    method: "POST",
    requestId: firstRequestId,
    idempotencyKey: key,
    body: payload
  });
  ensure(!replayed(first.payload), `${name}_first_marked_replay`);

  const second = await must(path, {
    method: "POST",
    requestId: `a552-${name}-replay-${stamp}`,
    idempotencyKey: key,
    body: payload
  });
  ensure(replayed(second.payload), `${name}_second_not_replayed`);
  ensure(sameJson(first.payload.data, second.payload.data), `${name}_replay_response_changed`);

  await mustConflict(path, {
    method: "POST",
    requestId: `a552-${name}-conflict-${stamp}`,
    idempotencyKey: key,
    body: conflictPayload
  });

  const data = object(first.payload.data);
  const aggregateId = String(data[aggregateIdKey] || "");
  ensure(aggregateId, `${name}_aggregate_id_missing`);
  aggregateRows.push({ table: aggregateTable, id: aggregateId, label: name });
  await verifyAggregateContext(aggregateTable, aggregateId, firstRequestId, key, name);

  const outcomes = (await auditRows(operation, key)).map((row) => row.outcome);
  ensure(outcomes.includes("succeeded"), `${name}_audit_succeeded_missing`);
  ensure(outcomes.includes("replayed"), `${name}_audit_replayed_missing`);

  const records = await idempotencyRows(operation, key);
  ensure(records.length === 1, `${name}_idempotency_record_missing`);
  ensure(records[0].status === "completed", `${name}_idempotency_not_completed`);
  ensure(Number(records[0].attempt_count) === 2, `${name}_idempotency_attempt_count_mismatch`);
  ensure(String(records[0].aggregate_id || "") === aggregateId, `${name}_aggregate_id_not_persisted`);

  return {
    execute: "PASS",
    replay: "PASS",
    conflict: "PASS",
    audit: "PASS",
    context: "PASS",
    aggregateId
  };
}
