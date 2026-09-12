export async function getCustomerDeliveryOrders(client, {
  installationId,
  customerId,
  warehouseIds,
  limit = 21,
  offset = 0,
}) {
  if (!Array.isArray(warehouseIds) || warehouseIds.length === 0) return [];
  const result = await client.query(
    `SELECT delivery_order.id,
            delivery_order.delivery_order_number,
            delivery_order.sales_order_id,
            orders.order_number,
            delivery_order.customer_id,
            delivery_order.warehouse_id,
            delivery_order.warehouse_code_snapshot,
            delivery_order.warehouse_name_snapshot,
            delivery_order.handover_mode,
            delivery_order.requested_delivery_date,
            delivery_order.status,
            delivery_order.created_at,
            delivery_order.updated_at,
            COALESCE(line_totals.line_count, 0)::integer AS line_count
       FROM sales.delivery_orders delivery_order
       JOIN sales.sales_orders orders
         ON orders.installation_id = delivery_order.installation_id
        AND orders.id = delivery_order.sales_order_id
       LEFT JOIN LATERAL (
         SELECT count(*) AS line_count
           FROM sales.delivery_order_lines line
          WHERE line.installation_id = delivery_order.installation_id
            AND line.delivery_order_id = delivery_order.id
       ) line_totals ON true
      WHERE delivery_order.installation_id = $1
        AND delivery_order.customer_id = $2::uuid
        AND delivery_order.warehouse_id = ANY($3::uuid[])
      ORDER BY delivery_order.created_at DESC, delivery_order.id DESC
      LIMIT $4::integer OFFSET $5::integer`,
    [installationId, customerId, warehouseIds, limit, offset],
  );
  return Array.isArray(result.rows) ? result.rows : [];
}

export async function getCustomerDeliveryAttemptFacts(client, {
  installationId,
  deliveryOrderIds,
}) {
  if (!Array.isArray(deliveryOrderIds) || deliveryOrderIds.length === 0) return [];
  const result = await client.query(
    `SELECT attempt.delivery_order_id,
            count(*)::text AS attempt_count,
            count(*) FILTER (WHERE attempt.result = 'delivered_full')::text AS delivered_full_count,
            count(*) FILTER (WHERE attempt.result = 'delivered_partial')::text AS delivered_partial_count,
            count(*) FILTER (WHERE attempt.result = 'failed')::text AS failed_count,
            count(*) FILTER (WHERE attempt.result = 'rescheduled')::text AS rescheduled_count,
            (array_agg(attempt.result ORDER BY attempt.attempted_at DESC, attempt.id DESC))[1] AS latest_result,
            max(attempt.attempted_at) AS latest_attempt_at,
            (array_agg(attempt.note ORDER BY attempt.attempted_at DESC, attempt.id DESC))[1] AS latest_note,
            (array_agg(attempt.rescheduled_for ORDER BY attempt.attempted_at DESC, attempt.id DESC))[1] AS latest_rescheduled_for
       FROM logistics.delivery_attempts attempt
      WHERE attempt.installation_id = $1
        AND attempt.delivery_order_id = ANY($2::uuid[])
      GROUP BY attempt.delivery_order_id`,
    [installationId, deliveryOrderIds],
  );
  return Array.isArray(result.rows) ? result.rows : [];
}

export async function getCustomerReturns(client, {
  installationId,
  customerId,
  warehouseIds,
  limit = 21,
  offset = 0,
}) {
  if (!Array.isArray(warehouseIds) || warehouseIds.length === 0) return [];
  const result = await client.query(
    `SELECT customer_return.id,
            customer_return.return_number,
            customer_return.customer_id,
            customer_return.warehouse_id,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            customer_return.status,
            customer_return.note,
            customer_return.received_at,
            customer_return.cancelled_at,
            customer_return.cancellation_reason,
            customer_return.created_at,
            customer_return.updated_at,
            COALESCE(line_totals.line_count, 0)::integer AS line_count,
            COALESCE(line_totals.accepted_line_count, 0)::integer AS accepted_line_count
       FROM sales.customer_returns customer_return
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = customer_return.installation_id
        AND warehouse.id = customer_return.warehouse_id
       LEFT JOIN LATERAL (
         SELECT count(*) AS line_count,
                count(receipt.id) AS accepted_line_count
           FROM sales.customer_return_lines line
           LEFT JOIN sales.customer_return_receipt_lines receipt
             ON receipt.installation_id = line.installation_id
            AND receipt.customer_return_line_id = line.id
          WHERE line.installation_id = customer_return.installation_id
            AND line.customer_return_id = customer_return.id
       ) line_totals ON true
      WHERE customer_return.installation_id = $1
        AND customer_return.customer_id = $2::uuid
        AND customer_return.warehouse_id = ANY($3::uuid[])
      ORDER BY customer_return.created_at DESC, customer_return.id DESC
      LIMIT $4::integer OFFSET $5::integer`,
    [installationId, customerId, warehouseIds, limit, offset],
  );
  return Array.isArray(result.rows) ? result.rows : [];
}
