export * from './logistics-trip-planning-core.js';

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
