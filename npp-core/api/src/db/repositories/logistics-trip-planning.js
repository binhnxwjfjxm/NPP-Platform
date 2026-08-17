import * as core from './logistics-trip-planning-core.js';

export * from './logistics-trip-planning-core.js';

async function deliveryExecutionMode(client, { installationId, salesOrderVersionId }) {
  const result = await client.query(
    `SELECT delivery_mode, delivery_execution_mode
       FROM sales.sales_order_versions
      WHERE installation_id = $1 AND id = $2`,
    [installationId, salesOrderVersionId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return row.delivery_mode === 'DELIVERY'
    ? (row.delivery_execution_mode ?? 'TRIP')
    : null;
}

export async function listEligibleDeliveryOrders(client, input) {
  const rows = await core.listEligibleDeliveryOrders(client, input);
  if (rows.length === 0) return rows;
  const versionIds = [...new Set(rows.map((row) => row.sales_order_version_id))];
  const result = await client.query(
    `SELECT id, delivery_mode, delivery_execution_mode
       FROM sales.sales_order_versions
      WHERE installation_id = $1
        AND id = ANY($2::uuid[])`,
    [input.installationId, versionIds],
  );
  const modes = new Map(result.rows.map((row) => [
    row.id,
    row.delivery_mode === 'DELIVERY' ? (row.delivery_execution_mode ?? 'TRIP') : null,
  ]));
  return rows.filter((row) => modes.get(row.sales_order_version_id) === 'TRIP');
}

export async function getDeliveryOrderForAssignment(client, input) {
  const row = await core.getDeliveryOrderForAssignment(client, input);
  if (!row) return null;
  const mode = await deliveryExecutionMode(client, {
    installationId: input.installationId,
    salesOrderVersionId: row.sales_order_version_id,
  });
  return mode === 'TRIP' ? row : null;
}

export async function reorderStops(client, { installationId, tripId, stopIds, actorId }) {
  await client.query('SET CONSTRAINTS logistics.trip_stops_sequence_unique DEFERRED');
  for (let index = 0; index < stopIds.length; index += 1) {
    await client.query(
      `UPDATE logistics.trip_stops
          SET stop_sequence = $4,
              updated_at = now(),
              updated_by = $5
        WHERE installation_id = $1 AND trip_id = $2 AND id = $3`,
      [installationId, tripId, stopIds[index], index + 1, actorId],
    );
  }
}

export const logisticsTripDeliveryExecutionInternals = Object.freeze({ deliveryExecutionMode });
