const QUANTITY_PATTERN = /^(0|[1-9]\d{0,17})(?:\.(\d{1,12}))?$/;
const SCALE = 1_000_000_000_000n;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

export function parseHoldQuantity(value) {
  const normalized = String(value ?? '').trim();
  const match = QUANTITY_PATTERN.exec(normalized);
  if (!match) return null;
  return BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(12, '0'));
}

export function formatHoldQuantity(value) {
  const whole = value / SCALE;
  const fraction = String(value % SCALE).padStart(12, '0');
  return `${whole}.${fraction}`;
}

function clamp(value, minimum, maximum) {
  if (value < minimum) return minimum;
  if (value > maximum) return maximum;
  return value;
}

export async function loadDemandHoldAvailability(client, {
  installationId,
  demandId,
  forUpdate = false,
}) {
  const lock = forUpdate ? ' FOR UPDATE OF demand' : '';
  const demandResult = await client.query(
    `SELECT demand.*
       FROM sales.sales_order_fulfillment_demands demand
      WHERE demand.installation_id = $1
        AND demand.id = $2
        AND demand.state = 'ACTIVE'${lock}`,
    [installationId, demandId],
  );
  const demand = demandResult.rows?.[0] ?? null;
  if (!demand) return null;

  if (forUpdate) {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`sales-fulfillment-scope:${installationId}:${demand.warehouse_id}:${demand.base_variant_id}`],
    );
  }

  const availabilityResult = await client.query(
    `WITH inventory_scope AS (
       SELECT
         COALESCE(sum(balance.on_hand_quantity), 0)::numeric(30,12) AS on_hand,
         COALESCE(sum(balance.reserved_quantity), 0)::numeric(30,12) AS exact_reserved
       FROM inventory.inventory_balances balance
       WHERE balance.installation_id = $1
         AND balance.warehouse_id = $3
         AND balance.base_variant_id = $4
     ), other_fulfillment AS (
       SELECT COALESCE(sum(
         other.reserved_base_quantity - other.allocated_base_quantity
       ), 0)::numeric(30,12) AS warehouse_reserved
       FROM sales.sales_order_fulfillment_demands other
       WHERE other.installation_id = $1
         AND other.warehouse_id = $3
         AND other.base_variant_id = $4
         AND other.state = 'ACTIVE'
         AND other.id <> $2
     )
     SELECT greatest(
       inventory_scope.on_hand
       - inventory_scope.exact_reserved
       - other_fulfillment.warehouse_reserved,
       0
     )::numeric(30,12)::text AS free_quantity
     FROM inventory_scope CROSS JOIN other_fulfillment`,
    [installationId, demandId, demand.warehouse_id, demand.base_variant_id],
  );

  const allocated = parseHoldQuantity(demand.allocated_base_quantity) ?? 0n;
  const free = parseHoldQuantity(availabilityResult.rows?.[0]?.free_quantity) ?? 0n;
  return Object.freeze({
    demand,
    freeBaseQuantity: formatHoldQuantity(free),
    capacityBaseQuantity: formatHoldQuantity(free),
    holdCapacityBaseQuantity: formatHoldQuantity(allocated + free),
  });
}

async function updateOrderFulfillmentStatus(client, {
  installationId,
  salesOrderId,
  actorId,
}) {
  const result = await client.query(
    `SELECT CASE
       WHEN count(*) = 0 THEN NULL
       WHEN sum(demand.packed_base_quantity) = sum(demand.ordered_base_quantity)
            AND sum(demand.ordered_base_quantity) > 0 THEN 'packed'
       WHEN sum(demand.packed_base_quantity) > 0 THEN 'partially_packed'
       WHEN sum(demand.picked_base_quantity) = sum(demand.ordered_base_quantity)
            AND sum(demand.ordered_base_quantity) > 0 THEN 'picked'
       WHEN sum(demand.picked_base_quantity) > 0 THEN 'partially_picked'
       WHEN sum(demand.allocated_base_quantity) = sum(demand.ordered_base_quantity)
            AND sum(demand.ordered_base_quantity) > 0 THEN 'allocated'
       WHEN sum(demand.allocated_base_quantity) > 0 THEN 'partially_allocated'
       WHEN sum(demand.backordered_base_quantity) > 0
            AND sum(demand.reserved_base_quantity) = 0 THEN 'backordered'
       WHEN sum(demand.backordered_base_quantity) > 0 THEN 'partially_reserved'
       ELSE 'reserved'
     END AS fulfillment_status
     FROM sales.sales_order_fulfillment_demands demand
     WHERE demand.installation_id = $1
       AND demand.sales_order_id = $2
       AND demand.state = 'ACTIVE'`,
    [installationId, salesOrderId],
  );
  const status = result.rows?.[0]?.fulfillment_status ?? null;
  if (!status) return null;
  await client.query(
    `UPDATE sales.sales_orders
        SET fulfillment_status = $3,
            updated_at = now(),
            updated_by = $4
      WHERE installation_id = $1
        AND id = $2
        AND status = 'confirmed'`,
    [installationId, salesOrderId, status, actorId],
  );
  return status;
}

export async function reconcileDemandHold(client, {
  installationId,
  demandId,
  actorId,
  targetBaseQuantity = null,
}) {
  const loaded = await loadDemandHoldAvailability(client, {
    installationId,
    demandId,
    forUpdate: true,
  });
  if (!loaded) {
    return failure('FULFILLMENT_DEMAND_NOT_FOUND', 'Không tìm thấy nhu cầu hàng đang hiệu lực.');
  }

  const ordered = parseHoldQuantity(loaded.demand.ordered_base_quantity);
  const allocated = parseHoldQuantity(loaded.demand.allocated_base_quantity) ?? 0n;
  const capacity = parseHoldQuantity(loaded.holdCapacityBaseQuantity) ?? allocated;
  const existingTarget = parseHoldQuantity(
    loaded.demand.allocation_target_base_quantity ?? loaded.demand.ordered_base_quantity,
  );
  const requestedTarget = targetBaseQuantity === null
    ? existingTarget
    : parseHoldQuantity(targetBaseQuantity);

  if (ordered === null || requestedTarget === null || requestedTarget <= 0n) {
    return failure('INVALID_ALLOCATION_QUANTITY', 'Số lượng cần phân bổ không hợp lệ.');
  }
  if (requestedTarget > ordered) {
    return failure(
      'ALLOCATION_EXCEEDS_ORDER_DEMAND',
      'Số lượng phân bổ không được vượt số lượng đơn cần.',
    );
  }
  if (requestedTarget < allocated) {
    return failure(
      'ALLOCATION_TARGET_BELOW_ALLOCATED',
      'Không thể giảm số lượng cần phân bổ thấp hơn số đã phân bổ.',
    );
  }

  const reserved = clamp(capacity, allocated, requestedTarget);
  const backordered = requestedTarget - reserved;
  const contextResult = await client.query(
    "SELECT current_setting('npp.sales_fulfillment_write_context', true) AS previous_context",
  );
  const previousContext = contextResult.rows?.[0]?.previous_context ?? '';
  let demand;
  try {
    await client.query(
      "SELECT set_config('npp.sales_fulfillment_write_context', 'fulfillment_hold_service', true)",
    );
    const updated = await client.query(
      `UPDATE sales.sales_order_fulfillment_demands
          SET allocation_target_base_quantity = $3::numeric,
              reserved_base_quantity = $4::numeric,
              backordered_base_quantity = $5::numeric,
              updated_at = now(),
              updated_by = $6
        WHERE installation_id = $1
          AND id = $2
          AND state = 'ACTIVE'
          AND picked_base_quantity = 0
          AND packed_base_quantity = 0
          AND issued_base_quantity = 0
        RETURNING *`,
      [
        installationId,
        demandId,
        formatHoldQuantity(requestedTarget),
        formatHoldQuantity(reserved),
        formatHoldQuantity(backordered),
        actorId,
      ],
    );
    demand = updated.rows?.[0] ?? null;
  } finally {
    await client.query(
      "SELECT set_config('npp.sales_fulfillment_write_context', $1, true)",
      [previousContext],
    );
  }

  if (!demand) {
    return failure(
      'FULFILLMENT_HOLD_LOCKED',
      'Dòng hàng đã bắt đầu thực hiện nên không thể thay đổi số lượng phân bổ.',
    );
  }

  const fulfillmentStatus = await updateOrderFulfillmentStatus(client, {
    installationId,
    salesOrderId: demand.sales_order_id,
    actorId,
  });
  return Object.freeze({
    ok: true,
    demand,
    fulfillmentStatus,
    targetBaseQuantity: formatHoldQuantity(requestedTarget),
    reservedBaseQuantity: formatHoldQuantity(reserved),
    backorderedBaseQuantity: formatHoldQuantity(backordered),
    freeBaseQuantity: loaded.freeBaseQuantity,
  });
}
