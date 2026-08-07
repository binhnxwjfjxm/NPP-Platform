import { randomUUID } from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeWarehouseIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string' && UUID_PATTERN.test(value.trim()))
    .map((value) => value.trim()))].sort();
}

export async function lockRebuild(client, { installationId, warehouseIds }) {
  const scope = safeWarehouseIds(warehouseIds).join(',');
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
    [`inventory-cost:${installationId}`, scope],
  );
}

export async function getRunByIdempotencyKey(client, { installationId, idempotencyKey }) {
  const result = await client.query(
    `SELECT *
       FROM inventory.inventory_cost_rebuild_runs
      WHERE installation_id = $1
        AND idempotency_key = $2`,
    [installationId, idempotencyKey],
  );
  return result.rows?.[0] ?? null;
}

export async function getRunById(client, { installationId, runId }) {
  const result = await client.query(
    `SELECT *
       FROM inventory.inventory_cost_rebuild_runs
      WHERE installation_id = $1
        AND id = $2`,
    [installationId, runId],
  );
  return result.rows?.[0] ?? null;
}

export async function listLedgerLines(client, { installationId, warehouseIds }) {
  const result = await client.query(
    `SELECT movement.id AS movement_id,
            movement.movement_type,
            movement.source_domain,
            movement.source_document_type,
            movement.source_document_id,
            movement.source_document_number,
            movement.document_date::text AS document_date,
            movement.posted_at,
            movement.reversal_of_movement_id,
            movement.reason_code,
            movement.metadata AS movement_metadata,
            line.id AS movement_line_id,
            line.line_number,
            line.warehouse_id,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            line.location_id,
            line.base_variant_id,
            variant.sku AS base_sku,
            line.lot_id,
            line.direction,
            line.base_quantity_delta,
            line.source_line_reference,
            line.metadata AS line_metadata,
            receipt_line.id AS goods_receipt_line_id,
            receipt_line.purchase_order_line_id,
            order_line.ordered_quantity AS purchase_order_quantity,
            order_line.base_quantity AS purchase_order_base_quantity,
            order_line.unit_price AS purchase_unit_price,
            order_line.discount_amount AS purchase_discount_amount,
            purchase_order.currency_code AS purchase_currency_code
       FROM inventory.inventory_movements movement
       JOIN inventory.inventory_movement_lines line
         ON line.installation_id = movement.installation_id
        AND line.movement_id = movement.id
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = line.installation_id
        AND warehouse.id = line.warehouse_id
       JOIN shared.product_variants variant
         ON variant.installation_id = line.installation_id
        AND variant.id = line.base_variant_id
       LEFT JOIN purchasing.goods_receipt_lines receipt_line
         ON receipt_line.installation_id = line.installation_id
        AND receipt_line.id = CASE
          WHEN COALESCE(line.metadata->>'goodsReceiptLineId', '') ~*
               '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN (line.metadata->>'goodsReceiptLineId')::uuid
          ELSE NULL
        END
       LEFT JOIN purchasing.purchase_order_lines order_line
         ON order_line.installation_id = receipt_line.installation_id
        AND order_line.id = receipt_line.purchase_order_line_id
       LEFT JOIN purchasing.purchase_orders purchase_order
         ON purchase_order.installation_id = order_line.installation_id
        AND purchase_order.id = order_line.purchase_order_id
      WHERE movement.installation_id = $1
        AND line.warehouse_id = ANY($2::uuid[])
      ORDER BY movement.document_date,
               movement.posted_at,
               movement.id,
               line.line_number,
               line.id`,
    [installationId, safeWarehouseIds(warehouseIds)],
  );
  return result.rows ?? [];
}

export async function insertRun(client, input) {
  const result = await client.query(
    `INSERT INTO inventory.inventory_cost_rebuild_runs (
       id, installation_id, method_version, currency_code, warehouse_ids,
       ledger_line_count, fact_count, anomaly_count, idempotency_key, payload_hash,
       started_at, completed_at, created_by, request_id, source_app, metadata
     ) VALUES (
       $1, $2, $3, $4, $5::uuid[],
       $6, $7, $8, $9, $10,
       $11, $12, $13, $14, $15, $16::jsonb
     )
     RETURNING *`,
    [
      input.id, input.installationId, input.methodVersion, input.currencyCode,
      safeWarehouseIds(input.warehouseIds), input.ledgerLineCount, input.factCount,
      input.anomalyCount, input.idempotencyKey, input.payloadHash, input.startedAt,
      input.completedAt, input.createdBy, input.requestId, input.sourceApp,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return result.rows[0];
}

export async function insertFact(client, input) {
  const result = await client.query(
    `INSERT INTO inventory.inventory_cost_facts (
       id, installation_id, rebuild_run_id, method_version, event_order, status,
       event_type, inventory_movement_id, inventory_movement_line_id,
       reversal_of_cost_fact_id, warehouse_id, location_id, base_variant_id, lot_id,
       direction, quantity_delta, unit_cost, value_delta, currency_code,
       source_cost_type, source_document_type, source_document_id,
       source_document_number, source_line_reference, effective_date,
       movement_posted_at, movement_line_number, metadata
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10, $11, $12, $13, $14,
       $15, $16::numeric, $17::numeric, $18::numeric, $19,
       $20, $21, $22, $23, $24, $25,
       $26, $27, $28::jsonb
     )
     RETURNING *`,
    [
      input.id, input.installationId, input.rebuildRunId, input.methodVersion,
      input.eventOrder, input.status, input.eventType, input.inventoryMovementId,
      input.inventoryMovementLineId, input.reversalOfCostFactId, input.warehouseId,
      input.locationId, input.baseVariantId, input.lotId, input.direction,
      input.quantityDelta, input.unitCost, input.valueDelta, input.currencyCode,
      input.sourceCostType, input.sourceDocumentType, input.sourceDocumentId,
      input.sourceDocumentNumber, input.sourceLineReference, input.effectiveDate,
      input.movementPostedAt, input.movementLineNumber,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return result.rows[0];
}

export async function insertAnomaly(client, input) {
  const result = await client.query(
    `INSERT INTO inventory.inventory_cost_anomalies (
       id, installation_id, rebuild_run_id, inventory_movement_id,
       inventory_movement_line_id, warehouse_id, base_variant_id,
       code, message, details
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     RETURNING *`,
    [
      input.id ?? randomUUID(), input.installationId, input.rebuildRunId,
      input.inventoryMovementId, input.inventoryMovementLineId,
      input.warehouseId, input.baseVariantId, input.code, input.message,
      JSON.stringify(input.details ?? {}),
    ],
  );
  return result.rows[0];
}

export async function replaceBalances(client, {
  installationId,
  warehouseIds,
  rebuildRunId,
  balances,
}) {
  const previous = await client.query(
    `SELECT current_setting('npp.inventory_cost_write_context', true) AS value`,
  );
  const previousValue = previous.rows?.[0]?.value ?? '';
  await client.query(`SELECT set_config('npp.inventory_cost_write_context', 'projector', true)`);
  try {
    await client.query(
      `DELETE FROM inventory.inventory_cost_balances
        WHERE installation_id = $1
          AND warehouse_id = ANY($2::uuid[])`,
      [installationId, safeWarehouseIds(warehouseIds)],
    );
    for (const balance of balances) {
      await client.query(
        `INSERT INTO inventory.inventory_cost_balances (
           installation_id, warehouse_id, base_variant_id, method_version,
           currency_code, quantity, inventory_value, average_unit_cost,
           status, anomaly_count, projected_through_event, rebuild_run_id, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6::numeric, $7::numeric, $8::numeric,
           $9, $10, $11, $12, now()
         )`,
        [
          installationId, balance.warehouseId, balance.baseVariantId,
          balance.methodVersion, balance.currencyCode, balance.quantity,
          balance.inventoryValue, balance.averageUnitCost, balance.status,
          balance.anomalyCount, balance.projectedThroughEvent, rebuildRunId,
        ],
      );
    }
  } finally {
    await client.query(
      `SELECT set_config('npp.inventory_cost_write_context', $1, true)`,
      [previousValue],
    );
  }
}

export async function listBalances(client, {
  installationId,
  warehouseIds,
  status = null,
  limit = 200,
  offset = 0,
}) {
  const result = await client.query(
    `SELECT balance.*,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            variant.sku AS base_sku
       FROM inventory.inventory_cost_balances balance
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = balance.installation_id
        AND warehouse.id = balance.warehouse_id
       JOIN shared.product_variants variant
         ON variant.installation_id = balance.installation_id
        AND variant.id = balance.base_variant_id
      WHERE balance.installation_id = $1
        AND balance.warehouse_id = ANY($2::uuid[])
        AND ($3::text IS NULL OR balance.status = $3)
      ORDER BY warehouse.code, variant.sku, balance.base_variant_id
      LIMIT $4 OFFSET $5`,
    [installationId, safeWarehouseIds(warehouseIds), status, limit, offset],
  );
  return result.rows ?? [];
}

export async function listFacts(client, {
  installationId,
  warehouseIds,
  runId = null,
  movementId = null,
  status = null,
  limit = 200,
  offset = 0,
}) {
  const result = await client.query(
    `SELECT fact.*,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            variant.sku AS base_sku
       FROM inventory.inventory_cost_facts fact
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = fact.installation_id
        AND warehouse.id = fact.warehouse_id
       JOIN shared.product_variants variant
         ON variant.installation_id = fact.installation_id
        AND variant.id = fact.base_variant_id
      WHERE fact.installation_id = $1
        AND fact.warehouse_id = ANY($2::uuid[])
        AND ($3::uuid IS NULL OR fact.rebuild_run_id = $3)
        AND ($4::uuid IS NULL OR fact.inventory_movement_id = $4)
        AND ($5::text IS NULL OR fact.status = $5)
      ORDER BY fact.movement_posted_at DESC, fact.event_order DESC
      LIMIT $6 OFFSET $7`,
    [
      installationId, safeWarehouseIds(warehouseIds), runId, movementId,
      status, limit, offset,
    ],
  );
  return result.rows ?? [];
}

export async function listAnomalies(client, {
  installationId,
  warehouseIds,
  runId = null,
  code = null,
  limit = 200,
  offset = 0,
}) {
  const result = await client.query(
    `SELECT anomaly.*,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            variant.sku AS base_sku
       FROM inventory.inventory_cost_anomalies anomaly
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = anomaly.installation_id
        AND warehouse.id = anomaly.warehouse_id
       JOIN shared.product_variants variant
         ON variant.installation_id = anomaly.installation_id
        AND variant.id = anomaly.base_variant_id
      WHERE anomaly.installation_id = $1
        AND anomaly.warehouse_id = ANY($2::uuid[])
        AND ($3::uuid IS NULL OR anomaly.rebuild_run_id = $3)
        AND ($4::text IS NULL OR anomaly.code = $4)
      ORDER BY anomaly.created_at DESC, anomaly.id DESC
      LIMIT $5 OFFSET $6`,
    [installationId, safeWarehouseIds(warehouseIds), runId, code, limit, offset],
  );
  return result.rows ?? [];
}

export async function listReconciliation(client, {
  installationId,
  warehouseIds,
  status = null,
  limit = 500,
  offset = 0,
}) {
  const result = await client.query(
    `SELECT *
       FROM inventory.inventory_cost_reconciliation
      WHERE installation_id = $1
        AND warehouse_id = ANY($2::uuid[])
        AND ($3::text IS NULL OR reconciliation_status = $3)
      ORDER BY warehouse_code, base_sku, base_variant_id
      LIMIT $4 OFFSET $5`,
    [installationId, safeWarehouseIds(warehouseIds), status, limit, offset],
  );
  return result.rows ?? [];
}

export async function latestRun(client, { installationId, warehouseIds }) {
  const result = await client.query(
    `SELECT *
       FROM inventory.inventory_cost_latest_runs
      WHERE installation_id = $1
        AND warehouse_ids && $2::uuid[]`,
    [installationId, warehouseIds],
  );
  return result.rows?.[0] ?? null;
}
