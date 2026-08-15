import { randomUUID } from 'node:crypto';

export async function setDeliveryReversalWriteContext(client) {
  await client.query(
    "SELECT set_config('npp.delivery_order_write_context', 'delivery_reversal_service', true)",
  );
}

export async function lockOperationKey(client, { installationId, idempotencyKey }) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`sales-delivery-order-reversal:${installationId}:${idempotencyKey}`],
  );
}

export async function getDeliveryOrderForUpdate(client, { installationId, deliveryOrderId }) {
  const result = await client.query(
    `SELECT delivery_order.*,
            orders.status AS sales_order_status,
            orders.order_number
       FROM sales.delivery_orders delivery_order
       JOIN sales.sales_orders orders
         ON orders.installation_id = delivery_order.installation_id
        AND orders.id = delivery_order.sales_order_id
      WHERE delivery_order.installation_id = $1
        AND delivery_order.id = $2
      FOR UPDATE OF delivery_order`,
    [installationId, deliveryOrderId],
  );
  return result.rows[0] ?? null;
}

export async function getDeliveryOrderEventByKey(client, { installationId, idempotencyKey }) {
  const result = await client.query(
    `SELECT * FROM sales.delivery_order_events
      WHERE installation_id = $1 AND idempotency_key = $2`,
    [installationId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

export async function getReleaseBlockers(client, { installationId, deliveryOrderId }) {
  const result = await client.query(
    `SELECT
       EXISTS (
         SELECT 1
           FROM sales.delivery_order_inventory_issues issue
          WHERE issue.installation_id = $1
            AND issue.delivery_order_id = $2
            AND issue.status IN ('POSTING', 'POSTED')
       ) AS has_active_inventory_issue,
       EXISTS (
         SELECT 1
           FROM logistics.trip_order_assignments assignment
          WHERE assignment.installation_id = $1
            AND assignment.delivery_order_id = $2
            AND assignment.unassigned_at IS NULL
       ) AS has_active_trip_assignment`,
    [installationId, deliveryOrderId],
  );
  return result.rows[0] ?? { has_active_inventory_issue: false, has_active_trip_assignment: false };
}

export async function releaseDeliveryOrderForReversal(client, {
  installationId,
  deliveryOrderId,
  reason,
  actorId,
  occurredAt,
}) {
  const result = await client.query(
    `UPDATE sales.delivery_orders
        SET status = 'cancelled',
            cancelled_at = $3,
            cancelled_by = $4,
            cancellation_reason = $5,
            revision = revision + 1,
            updated_at = now(),
            updated_by = $4
      WHERE installation_id = $1
        AND id = $2
        AND status = 'ready_to_dispatch'
      RETURNING *`,
    [installationId, deliveryOrderId, occurredAt, actorId, reason],
  );
  return result.rows[0] ?? null;
}

export async function insertDeliveryOrderEvent(client, data) {
  const result = await client.query(
    `INSERT INTO sales.delivery_order_events (
       id, installation_id, delivery_order_id, event_type, idempotency_key,
       payload_hash, actor_id, request_id, source_app, reason, metadata, occurred_at
     ) VALUES ($1,$2,$3,'RELEASED_FOR_REVERSAL',$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
     RETURNING *`,
    [
      randomUUID(),
      data.installationId,
      data.deliveryOrderId,
      data.idempotencyKey,
      data.payloadHash,
      data.actorId,
      data.requestId,
      data.sourceApp,
      data.reason,
      JSON.stringify(data.metadata ?? {}),
      data.occurredAt,
    ],
  );
  return result.rows[0] ?? null;
}
