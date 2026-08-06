export async function listInventoryTransfers(client, {
  installationId,
  warehouseIds,
  status = null,
  search = null,
  limit = 100,
  offset = 0,
}) {
  const result = await client.query(
    `SELECT transfer.*,
            source.code AS source_warehouse_code,
            source.name AS source_warehouse_name,
            destination.code AS destination_warehouse_code,
            destination.name AS destination_warehouse_name,
            COUNT(line.id)::integer AS line_count,
            COALESCE(SUM(line.base_quantity), 0)::text AS base_quantity_total
       FROM inventory.inventory_transfers transfer
       JOIN shared.warehouses source
         ON source.installation_id = transfer.installation_id
        AND source.id = transfer.source_warehouse_id
       JOIN shared.warehouses destination
         ON destination.installation_id = transfer.installation_id
        AND destination.id = transfer.destination_warehouse_id
       LEFT JOIN inventory.inventory_transfer_lines line
         ON line.installation_id = transfer.installation_id
        AND line.transfer_id = transfer.id
      WHERE transfer.installation_id = $1
        AND (transfer.source_warehouse_id = ANY($2::uuid[]) OR transfer.destination_warehouse_id = ANY($2::uuid[]))
        AND ($3::text IS NULL OR transfer.status = $3)
        AND (
          $4::text IS NULL
          OR transfer.document_number ILIKE '%' || $4 || '%'
          OR source.code ILIKE '%' || $4 || '%'
          OR source.name ILIKE '%' || $4 || '%'
          OR destination.code ILIKE '%' || $4 || '%'
          OR destination.name ILIKE '%' || $4 || '%'
        )
      GROUP BY transfer.id, source.code, source.name, destination.code, destination.name
      ORDER BY transfer.transfer_date DESC, transfer.created_at DESC, transfer.id DESC
      LIMIT $5 OFFSET $6`,
    [installationId, warehouseIds, status, search, limit, offset],
  );
  return result.rows;
}

export async function listInventoryTransferInTransit(client, {
  installationId,
  warehouseIds,
  limit = 500,
  offset = 0,
}) {
  const result = await client.query(
    `SELECT transit.*,
            source.code AS source_warehouse_code,
            source.name AS source_warehouse_name,
            destination.code AS destination_warehouse_code,
            destination.name AS destination_warehouse_name
       FROM inventory.inventory_transfer_in_transit transit
       JOIN shared.warehouses source
         ON source.installation_id = transit.installation_id
        AND source.id = transit.source_warehouse_id
       JOIN shared.warehouses destination
         ON destination.installation_id = transit.installation_id
        AND destination.id = transit.destination_warehouse_id
      WHERE transit.installation_id = $1
        AND (transit.source_warehouse_id = ANY($2::uuid[]) OR transit.destination_warehouse_id = ANY($2::uuid[]))
      ORDER BY transit.dispatched_at DESC, transit.transfer_id, transit.line_number
      LIMIT $3 OFFSET $4`,
    [installationId, warehouseIds, limit, offset],
  );
  return result.rows;
}

export async function getInventoryTransferById(client, {
  installationId,
  id,
  warehouseIds,
  forUpdate = false,
}) {
  const headerResult = await client.query(
    `SELECT transfer.*,
            source.code AS source_warehouse_code,
            source.name AS source_warehouse_name,
            destination.code AS destination_warehouse_code,
            destination.name AS destination_warehouse_name
       FROM inventory.inventory_transfers transfer
       JOIN shared.warehouses source
         ON source.installation_id = transfer.installation_id
        AND source.id = transfer.source_warehouse_id
       JOIN shared.warehouses destination
         ON destination.installation_id = transfer.installation_id
        AND destination.id = transfer.destination_warehouse_id
      WHERE transfer.installation_id = $1
        AND transfer.id = $2
        AND transfer.source_warehouse_id = ANY($3::uuid[])
        AND transfer.destination_warehouse_id = ANY($3::uuid[])
      ${forUpdate ? 'FOR UPDATE OF transfer' : ''}`,
    [installationId, id, warehouseIds],
  );
  const transfer = headerResult.rows[0];
  if (!transfer) return null;
  const lineResult = await client.query(
    `SELECT line.*
       FROM inventory.inventory_transfer_lines line
      WHERE line.installation_id = $1 AND line.transfer_id = $2
      ORDER BY line.line_number`,
    [installationId, id],
  );
  return { ...transfer, lines: lineResult.rows };
}

export async function loadTransferWarehouses(client, { installationId, warehouseIds }) {
  const result = await client.query(
    `SELECT id, code, name, warehouse_type, is_active
       FROM shared.warehouses
      WHERE installation_id = $1 AND id = ANY($2::uuid[])`,
    [installationId, warehouseIds],
  );
  return result.rows;
}

export async function loadTransferVariants(client, { installationId, variantIds }) {
  const result = await client.query(
    `SELECT source.id,
            source.product_id,
            source.sku,
            source.name,
            source.unit_id,
            source.conversion_to_base,
            source.is_active,
            unit.code AS unit_code,
            unit.allows_fractional,
            unit.is_active AS unit_is_active,
            base.id AS base_variant_id,
            base.sku AS base_sku
       FROM shared.product_variants source
       JOIN shared.units_of_measure unit
         ON unit.installation_id = source.installation_id
        AND unit.id = source.unit_id
       JOIN shared.product_variants base
         ON base.installation_id = source.installation_id
        AND base.product_id = source.product_id
        AND base.is_inventory_base = true
        AND base.is_active = true
      WHERE source.installation_id = $1
        AND source.id = ANY($2::uuid[])`,
    [installationId, variantIds],
  );
  return result.rows;
}

export async function loadTransferLocations(client, { installationId, locationIds }) {
  if (locationIds.length === 0) return [];
  const result = await client.query(
    `SELECT id, warehouse_id, code, name, is_active
       FROM shared.warehouse_locations
      WHERE installation_id = $1 AND id = ANY($2::uuid[])`,
    [installationId, locationIds],
  );
  return result.rows;
}

export async function loadTransferLots(client, { installationId, lotIds }) {
  if (lotIds.length === 0) return [];
  const result = await client.query(
    `SELECT id, base_variant_id, lot_code, expiry_date
       FROM inventory.inventory_lots
      WHERE installation_id = $1 AND id = ANY($2::uuid[])`,
    [installationId, lotIds],
  );
  return result.rows;
}

async function insertLines(client, {
  installationId,
  transferId,
  actorId,
  lines,
}) {
  for (const line of lines) {
    await client.query(
      `INSERT INTO inventory.inventory_transfer_lines (
         id, installation_id, transfer_id, line_number,
         source_location_id, source_variant_id, source_sku, item_name,
         source_unit_id, source_unit_code, source_quantity, conversion_to_base,
         base_variant_id, base_sku, base_quantity,
         lot_id, lot_code, expiry_date, note, created_by
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, $7, $8,
         $9, $10, $11::numeric, $12::numeric,
         $13, $14, $15::numeric,
         $16, $17, $18::date, $19, $20
       )`,
      [
        line.id, installationId, transferId, line.lineNumber,
        line.sourceLocationId, line.sourceVariantId, line.sourceSku, line.itemName,
        line.sourceUnitId, line.sourceUnitCode, line.sourceQuantity, line.conversionToBase,
        line.baseVariantId, line.baseSku, line.baseQuantity,
        line.lotId, line.lotCode, line.expiryDate, line.note, actorId,
      ],
    );
  }
}

export async function insertInventoryTransferDraft(client, {
  id,
  installationId,
  transferDate,
  sourceWarehouseId,
  destinationWarehouseId,
  note,
  actorId,
  lines,
}) {
  await client.query(
    `INSERT INTO inventory.inventory_transfers (
       id, installation_id, transfer_date, source_warehouse_id,
       destination_warehouse_id, status, note, created_by, updated_by
     ) VALUES ($1, $2, $3::date, $4, $5, 'draft', $6, $7, $7)`,
    [id, installationId, transferDate, sourceWarehouseId, destinationWarehouseId, note, actorId],
  );
  await insertLines(client, { installationId, transferId: id, actorId, lines });
  return getInventoryTransferById(client, {
    installationId,
    id,
    warehouseIds: [sourceWarehouseId, destinationWarehouseId],
  });
}

export async function updateInventoryTransferDraft(client, {
  installationId,
  id,
  transferDate,
  sourceWarehouseId,
  destinationWarehouseId,
  note,
  expectedRevision,
  actorId,
  lines,
}) {
  const result = await client.query(
    `UPDATE inventory.inventory_transfers
        SET transfer_date = $3::date,
            source_warehouse_id = $4,
            destination_warehouse_id = $5,
            note = $6,
            revision = revision + 1,
            updated_at = now(),
            updated_by = $7
      WHERE installation_id = $1
        AND id = $2
        AND status = 'draft'
        AND revision = $8::bigint
      RETURNING id`,
    [installationId, id, transferDate, sourceWarehouseId, destinationWarehouseId, note, actorId, expectedRevision],
  );
  if (!result.rows[0]) return null;
  await client.query(
    `DELETE FROM inventory.inventory_transfer_lines
      WHERE installation_id = $1 AND transfer_id = $2`,
    [installationId, id],
  );
  await insertLines(client, { installationId, transferId: id, actorId, lines });
  return getInventoryTransferById(client, {
    installationId,
    id,
    warehouseIds: [sourceWarehouseId, destinationWarehouseId],
  });
}

export async function approveInventoryTransfer(client, {
  installationId,
  id,
  expectedRevision,
  documentNumber,
  documentNumberAllocationId,
  actorId,
}) {
  const result = await client.query(
    `UPDATE inventory.inventory_transfers
        SET status = 'approved',
            document_number = $4,
            document_number_allocation_id = $5,
            approved_at = now(),
            approved_by = $6,
            revision = revision + 1,
            updated_at = now(),
            updated_by = $6
      WHERE installation_id = $1
        AND id = $2
        AND status = 'draft'
        AND revision = $3::bigint
      RETURNING source_warehouse_id, destination_warehouse_id`,
    [installationId, id, expectedRevision, documentNumber, documentNumberAllocationId, actorId],
  );
  return result.rows[0] ?? null;
}

export async function cancelInventoryTransfer(client, {
  installationId,
  id,
  expectedRevision,
  reason,
  actorId,
}) {
  const result = await client.query(
    `UPDATE inventory.inventory_transfers
        SET status = 'cancelled',
            cancelled_at = now(),
            cancelled_by = $5,
            cancellation_reason = $4,
            revision = revision + 1,
            updated_at = now(),
            updated_by = $5
      WHERE installation_id = $1
        AND id = $2
        AND status IN ('draft', 'approved')
        AND revision = $3::bigint
      RETURNING source_warehouse_id, destination_warehouse_id`,
    [installationId, id, expectedRevision, reason, actorId],
  );
  return result.rows[0] ?? null;
}

export async function dispatchInventoryTransfer(client, {
  installationId,
  id,
  expectedRevision,
  inventoryMovementId,
  actorId,
}) {
  const result = await client.query(
    `UPDATE inventory.inventory_transfers
        SET status = 'dispatched',
            inventory_movement_id = $4,
            dispatched_at = now(),
            dispatched_by = $5,
            revision = revision + 1,
            updated_at = now(),
            updated_by = $5
      WHERE installation_id = $1
        AND id = $2
        AND status = 'approved'
        AND revision = $3::bigint
      RETURNING source_warehouse_id, destination_warehouse_id`,
    [installationId, id, expectedRevision, inventoryMovementId, actorId],
  );
  return result.rows[0] ?? null;
}
