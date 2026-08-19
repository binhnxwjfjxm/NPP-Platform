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
