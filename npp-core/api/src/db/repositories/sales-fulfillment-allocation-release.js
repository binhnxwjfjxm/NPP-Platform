export async function setManualEditReleaseWriteContexts(client) {
  await client.query(
    "SELECT set_config('npp.sales_fulfillment_allocation_write_context', 'fulfillment_release_service', true)",
  );
  await client.query(
    "SELECT set_config('npp.sales_fulfillment_write_context', 'fulfillment_release_service', true)",
  );
  await client.query(
    "SELECT set_config('npp.inventory_reservation_write_context', 'reservation_service', true)",
  );
}

export async function setExecutionCloseReleaseWriteContexts(client) {
  await setManualEditReleaseWriteContexts(client);
  await client.query(
    "SELECT set_config('npp.sales_execution_close_release', 'true', true)",
  );
}

export async function hasPhysicalExecutionFacts(client, {
  installationId,
  salesOrderId,
}) {
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1
         FROM sales.sales_order_fulfillment_demands demand
        WHERE demand.installation_id = $1
          AND demand.sales_order_id = $2
          AND demand.state = 'ACTIVE'
          AND (
            demand.picked_base_quantity <> 0
            OR demand.packed_base_quantity <> 0
            OR demand.issued_base_quantity <> 0
          )
     ) AS blocked`,
    [installationId, salesOrderId],
  );
  return result.rows[0]?.blocked === true;
}

export async function releaseAllocation(client, {
  installationId,
  allocationId,
  actorId,
}) {
  const result = await client.query(
    `UPDATE sales.sales_order_fulfillment_allocations
        SET state = 'RELEASED',
            updated_at = now(),
            updated_by = $3
      WHERE installation_id = $1
        AND id = $2
        AND state = 'ACTIVE'
        AND picked_base_quantity = 0
        AND packed_base_quantity = 0
      RETURNING *`,
    [installationId, allocationId, actorId],
  );
  return result.rows[0] ?? null;
}
