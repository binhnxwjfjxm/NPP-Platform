export async function listActiveOrderAllocationDemands(client, {
  installationId,
  salesOrderId,
}) {
  const result = await client.query(
    `SELECT
       demand.id,
       demand.sales_order_id,
       demand.sales_order_version_id,
       demand.sales_order_line_id,
       demand.line_number,
       demand.warehouse_id,
       demand.sku_snapshot,
       demand.reserved_base_quantity,
       demand.backordered_base_quantity,
       demand.allocated_base_quantity,
       orders.order_number,
       orders.status AS sales_order_status,
       orders.fulfillment_status,
       line.item_name_snapshot,
       line.unit_code_snapshot
      FROM sales.sales_order_fulfillment_demands demand
      JOIN sales.sales_orders orders
        ON orders.installation_id = demand.installation_id
       AND orders.id = demand.sales_order_id
      JOIN sales.sales_order_version_lines line
        ON line.installation_id = demand.installation_id
       AND line.id = demand.sales_order_line_id
     WHERE demand.installation_id = $1
       AND demand.sales_order_id = $2
       AND demand.state = 'ACTIVE'
       AND orders.status = 'confirmed'
     ORDER BY demand.line_number ASC, demand.id ASC`,
    [installationId, salesOrderId],
  );
  return result.rows;
}

export async function getActiveOrderAllocationDemand(client, {
  installationId,
  salesOrderId,
  demandId,
}) {
  const result = await client.query(
    `SELECT
       demand.id,
       demand.sales_order_id,
       demand.sales_order_version_id,
       demand.sales_order_line_id,
       demand.line_number,
       demand.warehouse_id,
       demand.sku_snapshot,
       demand.reserved_base_quantity,
       demand.backordered_base_quantity,
       demand.allocated_base_quantity,
       orders.order_number,
       orders.status AS sales_order_status,
       orders.fulfillment_status,
       line.item_name_snapshot,
       line.unit_code_snapshot
      FROM sales.sales_order_fulfillment_demands demand
      JOIN sales.sales_orders orders
        ON orders.installation_id = demand.installation_id
       AND orders.id = demand.sales_order_id
      JOIN sales.sales_order_version_lines line
        ON line.installation_id = demand.installation_id
       AND line.id = demand.sales_order_line_id
     WHERE demand.installation_id = $1
       AND demand.sales_order_id = $2
       AND demand.id = $3
       AND demand.state = 'ACTIVE'
       AND orders.status = 'confirmed'`,
    [installationId, salesOrderId, demandId],
  );
  return result.rows[0] ?? null;
}
