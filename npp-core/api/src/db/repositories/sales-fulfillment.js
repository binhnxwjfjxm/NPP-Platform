import { randomUUID } from 'node:crypto';

export async function setFulfillmentWriteContext(client) {
  await client.query(
    "SELECT set_config('npp.sales_fulfillment_write_context', 'fulfillment_service', true)",
  );
}

export async function getFulfillmentSettings(client, { installationId }) {
  const result = await client.query(
    `SELECT allow_backorder
       FROM shared.sales_order_settings
      WHERE installation_id = $1`,
    [installationId],
  );
  return Object.freeze({
    allowBackorder: result.rows[0]?.allow_backorder !== false,
  });
}

export async function getConfirmedFulfillmentInput(client, {
  installationId,
  salesOrderId,
  versionNumber,
}) {
  const result = await client.query(
    `SELECT
       so.id AS sales_order_id,
       so.fulfillment_status,
       sov.id AS sales_order_version_id,
       sov.version_number,
       sov.warehouse_id,
       line.id AS sales_order_line_id,
       line.line_number,
       line.variant_id AS sales_variant_id,
       line.sku_snapshot,
       line.base_quantity AS ordered_base_quantity,
       selected_variant.product_id,
       ARRAY(
         SELECT base_variant.id
           FROM shared.product_variants base_variant
          WHERE base_variant.installation_id = line.installation_id
            AND base_variant.product_id = selected_variant.product_id
            AND base_variant.is_inventory_base = true
            AND base_variant.is_active = true
          ORDER BY base_variant.id
       ) AS base_variant_ids
      FROM sales.sales_orders so
      JOIN sales.sales_order_versions sov
        ON sov.installation_id = so.installation_id
       AND sov.sales_order_id = so.id
       AND sov.version_number = $3
       AND sov.version_status = 'confirmed'
      JOIN sales.sales_order_version_lines line
        ON line.installation_id = sov.installation_id
       AND line.sales_order_version_id = sov.id
      JOIN shared.product_variants selected_variant
        ON selected_variant.installation_id = line.installation_id
       AND selected_variant.id = line.variant_id
     WHERE so.installation_id = $1
       AND so.id = $2
       AND so.status = 'confirmed'
     ORDER BY line.line_number ASC`,
    [installationId, salesOrderId, versionNumber],
  );
  return result.rows;
}

export async function lockFulfillmentScope(client, {
  installationId,
  warehouseId,
  baseVariantId,
}) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`sales-fulfillment-scope:${installationId}:${warehouseId}:${baseVariantId}`],
  );
}

export async function getWarehouseAvailableQuantity(client, {
  installationId,
  warehouseId,
  baseVariantId,
  excludingSalesOrderId,
}) {
  const result = await client.query(
    `WITH inventory_scope AS (
       SELECT
         COALESCE(sum(balance.on_hand_quantity), 0)::numeric(30,12) AS on_hand,
         COALESCE(sum(balance.reserved_quantity), 0)::numeric(30,12) AS exact_reserved
       FROM inventory.inventory_balances balance
       WHERE balance.installation_id = $1
         AND balance.warehouse_id = $2
         AND balance.base_variant_id = $3
     ), fulfillment_scope AS (
       SELECT COALESCE(sum(
         demand.reserved_base_quantity - demand.allocated_base_quantity
       ), 0)::numeric(30,12) AS warehouse_reserved
       FROM sales.sales_order_fulfillment_demands demand
       WHERE demand.installation_id = $1
         AND demand.warehouse_id = $2
         AND demand.base_variant_id = $3
         AND demand.state = 'ACTIVE'
         AND demand.sales_order_id <> $4
     )
     SELECT greatest(
       inventory_scope.on_hand
       - inventory_scope.exact_reserved
       - fulfillment_scope.warehouse_reserved,
       0
     )::numeric(30,12)::text AS available_quantity
     FROM inventory_scope CROSS JOIN fulfillment_scope`,
    [installationId, warehouseId, baseVariantId, excludingSalesOrderId],
  );
  return result.rows[0]?.available_quantity ?? '0.000000000000';
}

export async function supersedeActiveDemands(client, {
  installationId,
  salesOrderId,
  actorId,
}) {
  const result = await client.query(
    `UPDATE sales.sales_order_fulfillment_demands
        SET state = 'SUPERSEDED', updated_at = now(), updated_by = $3
      WHERE installation_id = $1
        AND sales_order_id = $2
        AND state = 'ACTIVE'
      RETURNING id`,
    [installationId, salesOrderId, actorId],
  );
  return result.rows;
}

export async function cancelActiveDemands(client, {
  installationId,
  salesOrderId,
  actorId,
}) {
  const result = await client.query(
    `UPDATE sales.sales_order_fulfillment_demands
        SET state = 'CANCELLED', updated_at = now(), updated_by = $3
      WHERE installation_id = $1
        AND sales_order_id = $2
        AND state = 'ACTIVE'
      RETURNING id`,
    [installationId, salesOrderId, actorId],
  );
  return result.rows;
}

export async function insertFulfillmentDemand(client, data) {
  const result = await client.query(
    `INSERT INTO sales.sales_order_fulfillment_demands (
       id, installation_id, sales_order_id, sales_order_version_id,
       sales_order_line_id, line_number, warehouse_id, sales_variant_id,
       base_variant_id, sku_snapshot, ordered_base_quantity,
       reserved_base_quantity, backordered_base_quantity, state,
       created_by, updated_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'ACTIVE',$14,$14
     )
     RETURNING *`,
    [
      randomUUID(),
      data.installationId,
      data.salesOrderId,
      data.salesOrderVersionId,
      data.salesOrderLineId,
      data.lineNumber,
      data.warehouseId,
      data.salesVariantId,
      data.baseVariantId,
      data.sku,
      data.orderedBaseQuantity,
      data.reservedBaseQuantity,
      data.backorderedBaseQuantity,
      data.actorId,
    ],
  );
  return result.rows[0] ?? null;
}

export async function updateSalesOrderFulfillmentStatus(client, {
  installationId,
  salesOrderId,
  status,
  actorId,
}) {
  const result = await client.query(
    `UPDATE sales.sales_orders
        SET fulfillment_status = $3,
            revision = revision + 1,
            updated_at = now(),
            updated_by = $4
      WHERE installation_id = $1
        AND id = $2
        AND status = 'confirmed'
      RETURNING id`,
    [installationId, salesOrderId, status, actorId],
  );
  return result.rows[0]?.id ?? null;
}

export async function loadFulfillmentProjection(client, {
  installationId,
  salesOrderId,
}) {
  const [orderResult, demandResult, settings] = await Promise.all([
    client.query(
      `SELECT fulfillment_status
         FROM sales.sales_orders
        WHERE installation_id = $1 AND id = $2`,
      [installationId, salesOrderId],
    ),
    client.query(
      `SELECT
         id, sales_order_version_id, sales_order_line_id, line_number,
         warehouse_id, sales_variant_id, base_variant_id, sku_snapshot,
         ordered_base_quantity, reserved_base_quantity,
         backordered_base_quantity, allocated_base_quantity,
         picked_base_quantity, packed_base_quantity, issued_base_quantity,
         cancelled_base_quantity, state, created_at, updated_at
       FROM sales.sales_order_fulfillment_demands
       WHERE installation_id = $1
         AND sales_order_id = $2
         AND state = 'ACTIVE'
       ORDER BY line_number ASC`,
      [installationId, salesOrderId],
    ),
    getFulfillmentSettings(client, { installationId }),
  ]);

  return Object.freeze({
    status: orderResult.rows[0]?.fulfillment_status ?? 'unallocated',
    allowBackorder: settings.allowBackorder,
    lines: Object.freeze(demandResult.rows),
  });
}
