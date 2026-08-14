export async function getManualHandoverReceivableSource(client, { installationId, issueId }) {
  const headerResult = await client.query(
    `SELECT issue.id,
            issue.posted_at AS occurred_at,
            delivery_order.id AS delivery_order_id,
            delivery_order.delivery_order_number,
            delivery_order.sales_order_id,
            delivery_order.sales_order_version_id,
            delivery_order.customer_id,
            delivery_order.customer_address_id,
            delivery_order.warehouse_id,
            delivery_order.customer_code_snapshot,
            delivery_order.customer_name_snapshot,
            delivery_order.warehouse_code_snapshot,
            delivery_order.warehouse_name_snapshot,
            delivery_order.collection_policy,
            sales_version.currency_code,
            sales_order.revision AS source_revision
       FROM sales.delivery_order_inventory_issues issue
       JOIN sales.delivery_orders delivery_order
         ON delivery_order.installation_id = issue.installation_id
        AND delivery_order.id = issue.delivery_order_id
       JOIN sales.sales_orders sales_order
         ON sales_order.installation_id = delivery_order.installation_id
        AND sales_order.id = delivery_order.sales_order_id
       JOIN sales.sales_order_versions sales_version
         ON sales_version.installation_id = delivery_order.installation_id
        AND sales_version.id = delivery_order.sales_order_version_id
      WHERE issue.installation_id = $1
        AND issue.id = $2::uuid
        AND issue.issue_source_type = 'MANUAL_HANDOVER'
        AND issue.status = 'POSTED'
        AND delivery_order.status = 'handed_over'
      FOR SHARE OF issue, delivery_order, sales_order, sales_version`,
    [installationId, issueId],
  );
  const header = headerResult.rows[0];
  if (!header) return null;

  const lineResult = await client.query(
    `SELECT NULL::uuid AS delivery_attempt_line_id,
            issue_line.id AS inventory_issue_line_id,
            issue_line.delivery_order_line_id,
            issue_line.issued_base_quantity AS accepted_base_quantity,
            delivery_line.sales_order_line_id,
            sales_line.base_quantity AS sales_line_base_quantity,
            sales_line.sku_snapshot,
            sales_line.item_name_snapshot,
            sales_line.unit_code_snapshot,
            sales_line.line_subtotal,
            sales_line.discount_amount,
            sales_line.tax_amount,
            sales_line.line_total,
            delivery_line.line_number
       FROM sales.delivery_order_inventory_issue_lines issue_line
       JOIN sales.delivery_order_lines delivery_line
         ON delivery_line.installation_id = issue_line.installation_id
        AND delivery_line.id = issue_line.delivery_order_line_id
       JOIN sales.sales_order_version_lines sales_line
         ON sales_line.installation_id = delivery_line.installation_id
        AND sales_line.id = delivery_line.sales_order_line_id
      WHERE issue_line.installation_id = $1
        AND issue_line.issue_id = $2::uuid
        AND issue_line.issued_base_quantity > 0
      ORDER BY delivery_line.line_number, issue_line.id`,
    [installationId, issueId],
  );
  return { ...header, lines: lineResult.rows };
}

export async function refreshAcceptedDeliveryStatus(client, {
  installationId,
  salesOrderId,
  actorId,
}) {
  const result = await client.query(
    'SELECT sales.refresh_sales_order_accepted_delivery_status($1,$2::uuid,$3) AS status',
    [installationId, salesOrderId, actorId],
  );
  return result.rows[0]?.status ?? null;
}
