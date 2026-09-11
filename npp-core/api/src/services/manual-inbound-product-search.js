import { PERMISSIONS } from '../access/permissions.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(code, message, statusCode = 400, details = {}) {
  return Object.freeze({ ok: false, code, message, statusCode, retryable: false, details });
}

function hasPermission(requestContext, permission) {
  return Array.isArray(requestContext?.permissions) && requestContext.permissions.includes(permission);
}

function allowedWarehouseIds(requestContext) {
  return [...new Set(
    (Array.isArray(requestContext?.scopes?.warehouseIds) ? requestContext.scopes.warehouseIds : [])
      .map((id) => String(id ?? '').trim())
      .filter((id) => UUID_PATTERN.test(id)),
  )];
}

function limitValue(value) {
  const parsed = Number(value ?? 30);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 50 ? parsed : null;
}

export async function searchManualInboundProducts(client, {
  requestContext,
  warehouseId,
  search,
  limit = 30,
}) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryManualInboundPrepare)) {
    return failure('PERMISSION_DENIED', 'Không có quyền chuẩn bị Nhập kho thủ công.', 403);
  }

  const normalizedWarehouseId = String(warehouseId ?? '').trim();
  if (!UUID_PATTERN.test(normalizedWarehouseId)) {
    return failure('INVALID_WAREHOUSE_ID', 'Hãy chọn kho nhập hợp lệ.');
  }
  if (!allowedWarehouseIds(requestContext).includes(normalizedWarehouseId)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Kho không hoạt động hoặc ngoài phạm vi được cấp.', 403);
  }

  const normalizedSearch = String(search ?? '').trim();
  if (!normalizedSearch) return Object.freeze({ ok: true, products: Object.freeze([]) });
  if (normalizedSearch.length > 256) {
    return failure('INVALID_SEARCH', 'Nội dung tìm hàng quá dài.');
  }
  const normalizedLimit = limitValue(limit);
  if (!normalizedLimit) return failure('INVALID_LIMIT', 'Số kết quả tìm hàng không hợp lệ.');

  const warehouseResult = await client.query(
    `SELECT id, code, name, location_management_mode
       FROM shared.warehouses
      WHERE installation_id = $1
        AND id = $2
        AND is_active = true`,
    [requestContext.installationId, normalizedWarehouseId],
  );
  const warehouse = warehouseResult.rows?.[0] ?? null;
  if (!warehouse) return failure('WAREHOUSE_SCOPE_DENIED', 'Kho không hoạt động hoặc ngoài phạm vi được cấp.', 403);
  if (!['MANAGED', 'UNMANAGED'].includes(warehouse.location_management_mode)) {
    return failure('WAREHOUSE_LOCATION_MODE_REQUIRED', 'Kho chưa thiết lập chế độ quản lý vị trí.', 409);
  }

  const normalizedExact = normalizedSearch.toUpperCase();
  const pattern = `%${normalizedSearch}%`;
  const result = await client.query(
    `SELECT
       pv.id,
       pv.product_id,
       pv.sku,
       pv.name AS variant_name,
       pv.conversion_to_base,
       p.code AS product_code,
       p.name AS product_name,
       u.code AS unit_code,
       u.name AS unit_name,
       u.allows_fractional,
       base.id AS base_variant_id,
       base.sku AS base_sku,
       policy.lot_tracking_mode,
       policy.expiry_tracking_mode,
       primary_barcode.barcode AS primary_barcode,
       current_cost.average_unit_cost
     FROM shared.product_variants pv
     JOIN shared.products p
       ON p.installation_id = pv.installation_id
      AND p.id = pv.product_id
     JOIN shared.units_of_measure u
       ON u.installation_id = pv.installation_id
      AND u.id = pv.unit_id
      AND u.is_active = true
     LEFT JOIN shared.product_variants base
       ON base.installation_id = pv.installation_id
      AND base.product_id = pv.product_id
      AND base.is_inventory_base = true
      AND base.is_active = true
     LEFT JOIN inventory.product_tracking_policies policy
       ON policy.installation_id = base.installation_id
      AND policy.base_variant_id = base.id
     LEFT JOIN LATERAL (
       SELECT barcode.barcode
         FROM shared.product_barcodes barcode
        WHERE barcode.installation_id = pv.installation_id
          AND barcode.variant_id = pv.id
          AND barcode.is_active = true
        ORDER BY barcode.is_primary DESC, barcode.created_at ASC, barcode.id ASC
        LIMIT 1
     ) primary_barcode ON true
     LEFT JOIN LATERAL (
       SELECT cost.average_unit_cost
         FROM inventory.inventory_cost_balances cost
        WHERE cost.installation_id = pv.installation_id
          AND cost.warehouse_id = $2
          AND cost.base_variant_id = base.id
          AND cost.status = 'COSTED'
          AND cost.average_unit_cost > 0
        LIMIT 1
     ) current_cost ON true
     WHERE pv.installation_id = $1
       AND pv.is_active = true
       AND p.is_active = true
       AND p.is_inventory_managed = true
       AND pv.unit_id IS NOT NULL
       AND pv.conversion_to_base IS NOT NULL
       AND (
         pv.sku ILIKE $3
         OR COALESCE(pv.name, '') ILIKE $3
         OR p.code ILIKE $3
         OR p.name ILIKE $3
         OR EXISTS (
           SELECT 1
             FROM shared.product_barcodes matching_barcode
            WHERE matching_barcode.installation_id = pv.installation_id
              AND matching_barcode.variant_id = pv.id
              AND matching_barcode.is_active = true
              AND matching_barcode.normalized_barcode ILIKE upper($3)
         )
       )
     ORDER BY
       CASE
         WHEN upper(pv.sku) = $4 THEN 0
         WHEN upper(p.code) = $4 THEN 1
         WHEN EXISTS (
           SELECT 1
             FROM shared.product_barcodes exact_barcode
            WHERE exact_barcode.installation_id = pv.installation_id
              AND exact_barcode.variant_id = pv.id
              AND exact_barcode.is_active = true
              AND exact_barcode.normalized_barcode = $4
         ) THEN 2
         ELSE 3
       END,
       p.name ASC,
       pv.sku ASC,
       pv.id ASC
     LIMIT $5`,
    [requestContext.installationId, normalizedWarehouseId, pattern, normalizedExact, normalizedLimit],
  );

  return Object.freeze({
    ok: true,
    products: Object.freeze(result.rows.map((row) => Object.freeze({
      id: row.id,
      productId: row.product_id,
      sku: row.sku,
      variantName: row.variant_name ?? null,
      productCode: row.product_code,
      productName: row.product_name,
      unitCode: row.unit_code,
      unitName: row.unit_name,
      allowsFractional: row.allows_fractional === true,
      conversionToBase: row.conversion_to_base === null ? null : String(row.conversion_to_base),
      baseVariantId: row.base_variant_id ?? null,
      baseSku: row.base_sku ?? null,
      lotTrackingMode: row.lot_tracking_mode ?? null,
      expiryTrackingMode: row.expiry_tracking_mode ?? null,
      primaryBarcode: row.primary_barcode ?? null,
      unitCost: row.average_unit_cost === null || row.average_unit_cost === undefined
        ? null
        : String(row.average_unit_cost),
      locationManagementMode: warehouse.location_management_mode,
      locationRequired: warehouse.location_management_mode === 'MANAGED',
    }))),
  });
}
