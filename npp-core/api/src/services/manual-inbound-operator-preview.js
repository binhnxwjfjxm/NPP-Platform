import { PERMISSIONS } from '../access/permissions.js';
import { previewManualInbound } from './manual-inbound-preparation.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(code, message, statusCode = 400, details = {}) {
  return Object.freeze({ ok: false, code, message, statusCode, retryable: false, details });
}

function hasPermission(requestContext, permission) {
  return Array.isArray(requestContext?.permissions) && requestContext.permissions.includes(permission);
}

function parseExactDecimal(value) {
  const normalized = String(value ?? '').trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return null;
  const fraction = match[3] ?? '';
  const absolute = BigInt(`${match[2]}${fraction}` || '0');
  return Object.freeze({
    scaled: match[1] ? -absolute : absolute,
    scale: fraction.length,
  });
}

function scaleUp(value, fromScale, toScale) {
  return value * (10n ** BigInt(toScale - fromScale));
}

function formatScaled(value, scale) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const digits = absolute.toString().padStart(scale + 1, '0');
  const whole = scale === 0 ? digits : digits.slice(0, -scale);
  const fraction = scale === 0 ? '' : digits.slice(-scale).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function addExactDecimal(left, right) {
  const parsedLeft = parseExactDecimal(left);
  const parsedRight = parseExactDecimal(right);
  if (!parsedLeft || !parsedRight) return null;
  const scale = Math.max(parsedLeft.scale, parsedRight.scale);
  return formatScaled(
    scaleUp(parsedLeft.scaled, parsedLeft.scale, scale) + scaleUp(parsedRight.scaled, parsedRight.scale, scale),
    scale,
  );
}

function normalizedSupplierId(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const normalized = String(value).trim();
  return UUID_PATTERN.test(normalized) ? normalized : false;
}

async function resolveSupplier(client, installationId, supplierId) {
  if (!supplierId) return null;
  const result = await client.query(
    `SELECT id, code, name
       FROM shared.suppliers
      WHERE installation_id = $1
        AND id = $2
        AND is_active = true`,
    [installationId, supplierId],
  );
  return result.rows?.[0] ?? null;
}

export async function listManualInboundSupplierOptions(client, { requestContext }) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryManualInboundPrepare)) {
    return failure('PERMISSION_DENIED', 'Không có quyền chuẩn bị Nhập kho thủ công.', 403);
  }
  const result = await client.query(
    `SELECT id, code, name
       FROM shared.suppliers
      WHERE installation_id = $1
        AND is_active = true
      ORDER BY code ASC, name ASC, id ASC
      LIMIT 1000`,
    [requestContext.installationId],
  );
  return Object.freeze({
    ok: true,
    suppliers: Object.freeze(result.rows.map((row) => Object.freeze({
      id: row.id,
      code: row.code,
      name: row.name,
    }))),
  });
}

function stockScope(row, warehouse) {
  if (!row.baseVariantId || !row.baseQuantity) return null;
  if (warehouse.locationRequired && !row.locationId) return null;
  if (row.lotTrackingMode !== 'NONE' && row.lotTrackingMode !== 'REQUIRED') return null;
  if (row.lotTrackingMode === 'REQUIRED' && !row.lotCode) return null;
  return Object.freeze({
    baseVariantId: row.baseVariantId,
    locationId: warehouse.locationRequired ? row.locationId : null,
    normalizedLotCode: row.lotTrackingMode === 'REQUIRED' ? String(row.lotCode) : null,
  });
}

function stockScopeKey(scope) {
  return JSON.stringify([scope.baseVariantId, scope.locationId ?? null, scope.normalizedLotCode ?? null]);
}

function requestedStockScopes(rows, warehouse) {
  const scopes = new Map();
  for (const row of rows) {
    const scope = stockScope(row, warehouse);
    if (scope) scopes.set(stockScopeKey(scope), scope);
  }
  return [...scopes.values()];
}

function incomingQuantitiesByStockScope(rows, warehouse) {
  const quantities = new Map();
  for (const row of rows) {
    const scope = stockScope(row, warehouse);
    if (!scope) continue;
    const key = stockScopeKey(scope);
    const current = quantities.get(key);
    const next = current === undefined
      ? String(row.baseQuantity)
      : current === null
        ? null
        : addExactDecimal(current, String(row.baseQuantity));
    quantities.set(key, next);
  }
  return quantities;
}

async function loadBalanceContext(client, { installationId, warehouseId, scopes }) {
  if (scopes.length === 0) return [];
  const result = await client.query(
    `WITH requested_scopes AS (
       SELECT DISTINCT base_variant_id, location_id, normalized_lot_code
         FROM jsonb_to_recordset($3::jsonb)
           AS requested(base_variant_id uuid, location_id uuid, normalized_lot_code text)
     )
     SELECT base.id AS base_variant_id,
            base_unit.code AS base_unit_code,
            balance.base_variant_id AS balance_base_variant_id,
            balance.location_id,
            balance.lot_id,
            balance.on_hand_quantity,
            lot.normalized_lot_code
       FROM requested_scopes scope
       JOIN shared.product_variants base
         ON base.installation_id = $1
        AND base.id = scope.base_variant_id
       JOIN shared.units_of_measure base_unit
         ON base_unit.installation_id = base.installation_id
        AND base_unit.id = base.unit_id
       LEFT JOIN inventory.inventory_balances balance
         ON balance.installation_id = base.installation_id
        AND balance.warehouse_id = $2
        AND balance.base_variant_id = base.id
        AND balance.location_id IS NOT DISTINCT FROM scope.location_id
        AND (
          (scope.normalized_lot_code IS NULL AND balance.lot_id IS NULL)
          OR (
            scope.normalized_lot_code IS NOT NULL
            AND EXISTS (
              SELECT 1
                FROM inventory.inventory_lots requested_lot
               WHERE requested_lot.installation_id = balance.installation_id
                 AND requested_lot.id = balance.lot_id
                 AND requested_lot.normalized_lot_code = scope.normalized_lot_code
            )
          )
        )
       LEFT JOIN inventory.inventory_lots lot
         ON lot.installation_id = balance.installation_id
        AND lot.id = balance.lot_id
      ORDER BY base.id ASC, balance.location_id ASC NULLS FIRST, balance.lot_id ASC NULLS FIRST`,
    [installationId, warehouseId, JSON.stringify(scopes)],
  );
  return result.rows ?? [];
}

function enrichStock(row, warehouse, balanceContext, incomingQuantities) {
  const contexts = balanceContext.filter((item) => item.base_variant_id === row.baseVariantId);
  const baseUnitCode = contexts.find((item) => item.base_unit_code)?.base_unit_code ?? null;
  const scope = stockScope(row, warehouse);
  if (!scope) {
    return Object.freeze({ ...row, baseUnitCode, currentOnHand: null, afterOnHand: null });
  }

  const matching = contexts.filter((item) => {
    if (!item.balance_base_variant_id) return false;
    if ((item.location_id ?? null) !== (scope.locationId ?? null)) return false;
    if (scope.normalizedLotCode === null) return item.lot_id === null;
    return String(item.normalized_lot_code ?? '') === scope.normalizedLotCode;
  });

  let currentOnHand = '0';
  for (const item of matching) {
    const next = addExactDecimal(currentOnHand, String(item.on_hand_quantity ?? '0'));
    if (next === null) {
      return Object.freeze({ ...row, baseUnitCode, currentOnHand: null, afterOnHand: null });
    }
    currentOnHand = next;
  }
  const incomingQuantity = incomingQuantities.get(stockScopeKey(scope));
  const afterOnHand = incomingQuantity === null || incomingQuantity === undefined
    ? null
    : addExactDecimal(currentOnHand, incomingQuantity);
  return Object.freeze({
    ...row,
    baseUnitCode,
    currentOnHand,
    afterOnHand,
  });
}

export async function previewManualInboundOperator(client, { requestContext, payload }) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryManualInboundPrepare)) {
    return failure('PERMISSION_DENIED', 'Không có quyền chuẩn bị Nhập kho thủ công.', 403);
  }
  const supplierId = normalizedSupplierId(payload?.supplierId);
  if (supplierId === false) {
    return failure('INVALID_SUPPLIER_ID', 'Nhà cung cấp không hợp lệ.');
  }
  const supplier = supplierId
    ? await resolveSupplier(client, requestContext.installationId, supplierId)
    : null;
  if (supplierId && !supplier) {
    return failure('SUPPLIER_NOT_FOUND', 'Nhà cung cấp không tồn tại hoặc đã ngừng sử dụng.');
  }

  const prepared = await previewManualInbound(client, { requestContext, payload });
  if (!prepared.ok) return prepared;

  const scopes = requestedStockScopes(prepared.preview.rows, prepared.preview.warehouse);
  const balanceContext = await loadBalanceContext(client, {
    installationId: requestContext.installationId,
    warehouseId: prepared.preview.warehouse.id,
    scopes,
  });
  const incomingQuantities = incomingQuantitiesByStockScope(prepared.preview.rows, prepared.preview.warehouse);
  const rows = prepared.preview.rows.map((row) => enrichStock(
    row,
    prepared.preview.warehouse,
    balanceContext,
    incomingQuantities,
  ));

  return Object.freeze({
    ok: true,
    preview: Object.freeze({
      ...prepared.preview,
      header: Object.freeze({
        ...prepared.preview.header,
        supplierId: supplier?.id ?? null,
        supplierCode: supplier?.code ?? null,
        supplierName: supplier?.name ?? null,
      }),
      rows: Object.freeze(rows),
    }),
  });
}

export const manualInboundOperatorPreviewInternals = Object.freeze({
  addExactDecimal,
  normalizedSupplierId,
  enrichStock,
  incomingQuantitiesByStockScope,
  requestedStockScopes,
  stockScope,
});