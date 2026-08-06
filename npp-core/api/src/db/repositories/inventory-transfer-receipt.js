export async function getReceiptByIdempotencyKey(client, { installationId, idempotencyKey }) {
  const result = await client.query(
    `SELECT *
       FROM inventory.inventory_transfer_receipts
      WHERE installation_id = $1 AND idempotency_key = $2`,
    [installationId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

export async function getNextReceiptSequence(client, { installationId, transferId }) {
  const result = await client.query(
    `SELECT COALESCE(max(receipt_sequence), 0)::integer + 1 AS next_sequence
       FROM inventory.inventory_transfer_receipts
      WHERE installation_id = $1 AND transfer_id = $2`,
    [installationId, transferId],
  );
  return Number(result.rows[0]?.next_sequence ?? 1);
}

export async function getTransferResolutionRows(client, { installationId, transferId }) {
  const result = await client.query(
    `SELECT line.*,
            resolution.accepted_source_quantity,
            resolution.damaged_source_quantity,
            resolution.over_source_quantity,
            resolution.short_source_quantity,
            resolution.accepted_base_quantity,
            resolution.damaged_base_quantity,
            resolution.over_base_quantity,
            resolution.short_base_quantity,
            resolution.remaining_source_quantity,
            resolution.remaining_base_quantity,
            policy.location_required,
            policy.lot_tracking_mode,
            policy.expiry_tracking_mode
       FROM inventory.inventory_transfer_lines line
       JOIN inventory.inventory_transfer_line_resolution resolution
         ON resolution.installation_id = line.installation_id
        AND resolution.transfer_line_id = line.id
       LEFT JOIN inventory.product_tracking_policies policy
         ON policy.installation_id = line.installation_id
        AND policy.base_variant_id = line.base_variant_id
      WHERE line.installation_id = $1 AND line.transfer_id = $2
      ORDER BY line.line_number`,
    [installationId, transferId],
  );
  return result.rows;
}

export async function loadDestinationLocations(client, {
  installationId,
  destinationWarehouseId,
  locationIds,
}) {
  if (locationIds.length === 0) return [];
  const result = await client.query(
    `SELECT id, warehouse_id, code, name, is_active
       FROM shared.warehouse_locations
      WHERE installation_id = $1
        AND warehouse_id = $2
        AND id = ANY($3::uuid[])`,
    [installationId, destinationWarehouseId, locationIds],
  );
  return result.rows;
}

export async function insertTransferReceipt(client, {
  id,
  installationId,
  transferId,
  receiptSequence,
  receiptDate,
  inventoryMovementId,
  idempotencyKey,
  payloadHash,
  note,
  actorId,
  lines,
}) {
  await client.query(
    `INSERT INTO inventory.inventory_transfer_receipts (
       id, installation_id, transfer_id, receipt_sequence, receipt_date,
       inventory_movement_id, idempotency_key, payload_hash, note, created_by
     ) VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10)`,
    [
      id,
      installationId,
      transferId,
      receiptSequence,
      receiptDate,
      inventoryMovementId,
      idempotencyKey,
      payloadHash,
      note,
      actorId,
    ],
  );
  for (const line of lines) {
    await client.query(
      `INSERT INTO inventory.inventory_transfer_receipt_lines (
         id, installation_id, receipt_id, transfer_line_id, line_number,
         destination_location_id, accepted_source_quantity, damaged_source_quantity,
         over_source_quantity, conversion_to_base, accepted_base_quantity,
         damaged_base_quantity, over_base_quantity, note, created_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7::numeric,$8::numeric,$9::numeric,$10::numeric,
         $11::numeric,$12::numeric,$13::numeric,$14,$15
       )`,
      [
        line.id,
        installationId,
        id,
        line.transferLineId,
        line.lineNumber,
        line.destinationLocationId,
        line.acceptedSourceQuantity,
        line.damagedSourceQuantity,
        line.overSourceQuantity,
        line.conversionToBase,
        line.acceptedBaseQuantity,
        line.damagedBaseQuantity,
        line.overBaseQuantity,
        line.note,
        actorId,
      ],
    );
  }
  return getTransferReceiptById(client, { installationId, receiptId: id, forUpdate: false });
}

export async function listTransferReceipts(client, { installationId, transferId }) {
  const result = await client.query(
    `SELECT receipt.*,
            damage.id AS damage_approval_id,
            damage.approval_note AS damage_approval_note,
            damage.approved_at AS damage_approved_at,
            damage.approved_by AS damage_approved_by,
            reversal.id AS reversal_id,
            reversal.reversal_movement_id,
            reversal.reason AS reversal_reason,
            reversal.reversed_at,
            reversal.reversed_by
       FROM inventory.inventory_transfer_receipts receipt
       LEFT JOIN inventory.inventory_transfer_damage_approvals damage
         ON damage.installation_id = receipt.installation_id
        AND damage.receipt_id = receipt.id
       LEFT JOIN inventory.inventory_transfer_receipt_reversals reversal
         ON reversal.installation_id = receipt.installation_id
        AND reversal.receipt_id = receipt.id
      WHERE receipt.installation_id = $1 AND receipt.transfer_id = $2
      ORDER BY receipt.receipt_sequence`,
    [installationId, transferId],
  );
  const receipts = result.rows;
  if (receipts.length === 0) return [];
  const lineResult = await client.query(
    `SELECT receipt_line.*,
            transfer_line.source_sku,
            transfer_line.item_name,
            transfer_line.source_unit_code,
            transfer_line.base_sku,
            transfer_line.lot_code,
            transfer_line.expiry_date,
            location.code AS destination_location_code,
            location.name AS destination_location_name
       FROM inventory.inventory_transfer_receipt_lines receipt_line
       JOIN inventory.inventory_transfer_receipts receipt
         ON receipt.installation_id = receipt_line.installation_id
        AND receipt.id = receipt_line.receipt_id
       JOIN inventory.inventory_transfer_lines transfer_line
         ON transfer_line.installation_id = receipt_line.installation_id
        AND transfer_line.id = receipt_line.transfer_line_id
       LEFT JOIN shared.warehouse_locations location
         ON location.installation_id = receipt_line.installation_id
        AND location.id = receipt_line.destination_location_id
      WHERE receipt_line.installation_id = $1
        AND receipt.transfer_id = $2
      ORDER BY receipt.receipt_sequence, receipt_line.line_number`,
    [installationId, transferId],
  );
  const linesByReceipt = new Map();
  for (const line of lineResult.rows) {
    const lines = linesByReceipt.get(line.receipt_id) ?? [];
    lines.push(line);
    linesByReceipt.set(line.receipt_id, lines);
  }
  return receipts.map((receipt) => ({ ...receipt, lines: linesByReceipt.get(receipt.id) ?? [] }));
}

export async function getTransferReceiptById(client, {
  installationId,
  receiptId,
  forUpdate = false,
}) {
  const result = await client.query(
    `SELECT receipt.*,
            damage.id AS damage_approval_id,
            damage.approval_note AS damage_approval_note,
            damage.approved_at AS damage_approved_at,
            damage.approved_by AS damage_approved_by,
            reversal.id AS reversal_id,
            reversal.reversal_movement_id,
            reversal.reason AS reversal_reason,
            reversal.reversed_at,
            reversal.reversed_by
       FROM inventory.inventory_transfer_receipts receipt
       LEFT JOIN inventory.inventory_transfer_damage_approvals damage
         ON damage.installation_id = receipt.installation_id
        AND damage.receipt_id = receipt.id
       LEFT JOIN inventory.inventory_transfer_receipt_reversals reversal
         ON reversal.installation_id = receipt.installation_id
        AND reversal.receipt_id = receipt.id
      WHERE receipt.installation_id = $1 AND receipt.id = $2
      ${forUpdate ? 'FOR UPDATE OF receipt' : ''}`,
    [installationId, receiptId],
  );
  const receipt = result.rows[0];
  if (!receipt) return null;
  const lines = await client.query(
    `SELECT receipt_line.*,
            transfer_line.source_sku,
            transfer_line.item_name,
            transfer_line.source_unit_code,
            transfer_line.base_sku,
            transfer_line.lot_code,
            transfer_line.expiry_date,
            location.code AS destination_location_code,
            location.name AS destination_location_name
       FROM inventory.inventory_transfer_receipt_lines receipt_line
       JOIN inventory.inventory_transfer_lines transfer_line
         ON transfer_line.installation_id = receipt_line.installation_id
        AND transfer_line.id = receipt_line.transfer_line_id
       LEFT JOIN shared.warehouse_locations location
         ON location.installation_id = receipt_line.installation_id
        AND location.id = receipt_line.destination_location_id
      WHERE receipt_line.installation_id = $1 AND receipt_line.receipt_id = $2
      ORDER BY receipt_line.line_number`,
    [installationId, receiptId],
  );
  return { ...receipt, lines: lines.rows };
}

export async function getShortClosure(client, { installationId, transferId }) {
  const result = await client.query(
    `SELECT *
       FROM inventory.inventory_transfer_short_closures
      WHERE installation_id = $1 AND transfer_id = $2`,
    [installationId, transferId],
  );
  return result.rows[0] ?? null;
}

export async function insertDamageApproval(client, {
  id,
  installationId,
  receiptId,
  note,
  actorId,
}) {
  const result = await client.query(
    `INSERT INTO inventory.inventory_transfer_damage_approvals (
       id, installation_id, receipt_id, approval_note, approved_by
     ) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (installation_id, receipt_id) DO NOTHING
     RETURNING *`,
    [id, installationId, receiptId, note, actorId],
  );
  return result.rows[0] ?? null;
}

export async function insertShortClosure(client, {
  id,
  installationId,
  transferId,
  reason,
  actorId,
  lines,
}) {
  await client.query(
    `INSERT INTO inventory.inventory_transfer_short_closures (
       id, installation_id, transfer_id, reason, closed_by
     ) VALUES ($1,$2,$3,$4,$5)`,
    [id, installationId, transferId, reason, actorId],
  );
  for (const line of lines) {
    await client.query(
      `INSERT INTO inventory.inventory_transfer_short_closure_lines (
         id, installation_id, closure_id, transfer_line_id,
         short_source_quantity, conversion_to_base, short_base_quantity
       ) VALUES ($1,$2,$3,$4,$5::numeric,$6::numeric,$7::numeric)`,
      [
        line.id,
        installationId,
        id,
        line.transferLineId,
        line.shortSourceQuantity,
        line.conversionToBase,
        line.shortBaseQuantity,
      ],
    );
  }
  return getShortClosure(client, { installationId, transferId });
}

export async function hasDownstreamOutboundMovement(client, {
  installationId,
  receiptMovementId,
}) {
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1
         FROM inventory.inventory_movements receipt_movement
         JOIN inventory.inventory_movement_lines receipt_line
           ON receipt_line.installation_id = receipt_movement.installation_id
          AND receipt_line.movement_id = receipt_movement.id
         JOIN inventory.inventory_movement_lines downstream_line
           ON downstream_line.installation_id = receipt_line.installation_id
          AND downstream_line.warehouse_id = receipt_line.warehouse_id
          AND downstream_line.location_id IS NOT DISTINCT FROM receipt_line.location_id
          AND downstream_line.base_variant_id = receipt_line.base_variant_id
          AND downstream_line.lot_id IS NOT DISTINCT FROM receipt_line.lot_id
          AND downstream_line.direction = 'OUT'
         JOIN inventory.inventory_movements downstream_movement
           ON downstream_movement.installation_id = downstream_line.installation_id
          AND downstream_movement.id = downstream_line.movement_id
        WHERE receipt_movement.installation_id = $1
          AND receipt_movement.id = $2
          AND downstream_movement.posted_at > receipt_movement.posted_at
          AND downstream_movement.reversal_of_movement_id IS NULL
     ) AS has_downstream`,
    [installationId, receiptMovementId],
  );
  return Boolean(result.rows[0]?.has_downstream);
}

export async function insertReceiptReversal(client, {
  id,
  installationId,
  receiptId,
  reversalMovementId,
  reason,
  actorId,
}) {
  const result = await client.query(
    `INSERT INTO inventory.inventory_transfer_receipt_reversals (
       id, installation_id, receipt_id, reversal_movement_id, reason, reversed_by
     ) VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [id, installationId, receiptId, reversalMovementId, reason, actorId],
  );
  return result.rows[0] ?? null;
}
