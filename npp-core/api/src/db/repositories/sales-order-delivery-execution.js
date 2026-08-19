export async function setVersionDeliveryExecutionMode(client, {
  installationId,
  salesOrderId,
  versionNumber,
  deliveryExecutionMode,
}) {
  const result = await client.query(
    `UPDATE sales.sales_order_versions
        SET delivery_execution_mode = $4
      WHERE installation_id = $1
        AND sales_order_id = $2
        AND version_number = $3
        AND version_status = 'draft'
      RETURNING id, version_number, delivery_mode, delivery_execution_mode`,
    [installationId, salesOrderId, versionNumber, deliveryExecutionMode],
  );
  return result.rows[0] ?? null;
}

export async function listVersionDeliveryExecutionModes(client, {
  installationId,
  salesOrderId,
}) {
  const result = await client.query(
    `SELECT id, version_number, delivery_mode, delivery_execution_mode
       FROM sales.sales_order_versions
      WHERE installation_id = $1
        AND sales_order_id = $2
      ORDER BY version_number`,
    [installationId, salesOrderId],
  );
  return result.rows;
}

export async function listCurrentDeliveryExecutionModes(client, {
  installationId,
  salesOrderIds,
}) {
  if (!Array.isArray(salesOrderIds) || salesOrderIds.length === 0) return [];
  const result = await client.query(
    `SELECT sales_order.id AS sales_order_id,
            version.delivery_mode,
            version.delivery_execution_mode
       FROM sales.sales_orders sales_order
       JOIN sales.sales_order_versions version
         ON version.installation_id = sales_order.installation_id
        AND version.sales_order_id = sales_order.id
        AND version.version_number = sales_order.current_version_number
      WHERE sales_order.installation_id = $1
        AND sales_order.id = ANY($2::uuid[])`,
    [installationId, salesOrderIds],
  );
  return result.rows;
}

export async function getDeliveryExecutionTransitionFacts(client, {
  installationId,
  salesOrderId,
}) {
  const result = await client.query(
    `SELECT orders.delivery_status,
            (
              SELECT count(*)::int
                FROM sales.delivery_orders delivery_order
               WHERE delivery_order.installation_id = orders.installation_id
                 AND delivery_order.sales_order_id = orders.id
                 AND delivery_order.status <> 'cancelled'
            ) AS active_delivery_orders,
            (
              SELECT count(*)::int
                FROM sales.delivery_order_inventory_issues issue
                JOIN sales.delivery_orders delivery_order
                  ON delivery_order.installation_id = issue.installation_id
                 AND delivery_order.id = issue.delivery_order_id
               WHERE delivery_order.installation_id = orders.installation_id
                 AND delivery_order.sales_order_id = orders.id
                 AND issue.status = 'POSTED'
            ) AS posted_inventory_issues,
            (
              SELECT count(*)::int
                FROM logistics.trip_dispatch_items dispatch_item
                JOIN sales.delivery_orders delivery_order
                  ON delivery_order.installation_id = dispatch_item.installation_id
                 AND delivery_order.id = dispatch_item.delivery_order_id
               WHERE delivery_order.installation_id = orders.installation_id
                 AND delivery_order.sales_order_id = orders.id
            ) AS trip_dispatch_items,
            (
              SELECT count(*)::int
                FROM logistics.delivery_attempts attempt
                JOIN sales.delivery_orders delivery_order
                  ON delivery_order.installation_id = attempt.installation_id
                 AND delivery_order.id = attempt.delivery_order_id
               WHERE delivery_order.installation_id = orders.installation_id
                 AND delivery_order.sales_order_id = orders.id
            ) AS delivery_attempts
       FROM sales.sales_orders orders
      WHERE orders.installation_id = $1
        AND orders.id = $2::uuid
      FOR UPDATE OF orders`,
    [installationId, salesOrderId],
  );
  return result.rows[0] ?? null;
}
