export async function listDriverTripAssignmentCommercial(client, { installationId, tripId }) {
  const result = await client.query(
    `SELECT assignment.id AS assignment_id,
            delivery_order.id AS delivery_order_id,
            delivery_order.delivery_order_number,
            delivery_order.sales_order_id,
            sales_order.order_number AS sales_order_number,
            order_version.currency_code,
            commercial.total_amount,
            commercial.lines
       FROM logistics.trip_order_assignments assignment
       JOIN sales.delivery_orders delivery_order
         ON delivery_order.installation_id = assignment.installation_id
        AND delivery_order.id = assignment.delivery_order_id
       JOIN sales.sales_orders sales_order
         ON sales_order.installation_id = delivery_order.installation_id
        AND sales_order.id = delivery_order.sales_order_id
       JOIN sales.sales_order_versions order_version
         ON order_version.installation_id = delivery_order.installation_id
        AND order_version.id = delivery_order.sales_order_version_id
       JOIN logistics.trip_dispatch_items dispatch_item
         ON dispatch_item.installation_id = assignment.installation_id
        AND dispatch_item.assignment_id = assignment.id
       LEFT JOIN LATERAL (
         SELECT COALESCE(
                  SUM(
                    round(
                      order_line.line_total * issue_line.issued_base_quantity
                      / NULLIF(order_line.base_quantity, 0),
                      6
                    )
                  ),
                  0
                )::text AS total_amount,
                COALESCE(
                  jsonb_agg(
                    jsonb_build_object(
                      'inventoryIssueLineId', issue_line.id,
                      'issuedUnitQuantity', (
                        issue_line.issued_base_quantity / NULLIF(order_line.conversion_to_base, 0)
                      )::text,
                      'unitPrice', order_line.unit_price::text,
                      'lineAmount', round(
                        order_line.line_total * issue_line.issued_base_quantity
                        / NULLIF(order_line.base_quantity, 0),
                        6
                      )::text
                    )
                    ORDER BY delivery_line.line_number, issue_line.id
                  ),
                  '[]'::jsonb
                ) AS lines
           FROM sales.delivery_order_inventory_issue_lines issue_line
           JOIN sales.delivery_order_lines delivery_line
             ON delivery_line.installation_id = issue_line.installation_id
            AND delivery_line.id = issue_line.delivery_order_line_id
           JOIN sales.sales_order_version_lines order_line
             ON order_line.installation_id = delivery_line.installation_id
            AND order_line.id = delivery_line.sales_order_line_id
          WHERE issue_line.installation_id = assignment.installation_id
            AND issue_line.issue_id = dispatch_item.inventory_issue_id
       ) commercial ON true
      WHERE assignment.installation_id = $1
        AND assignment.trip_id = $2
        AND assignment.unassigned_at IS NULL
      ORDER BY assignment.assigned_at, assignment.id`,
    [installationId, tripId],
  );
  return result.rows;
}
