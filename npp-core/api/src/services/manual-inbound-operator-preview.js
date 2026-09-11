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

async function loadBalanceContext(client, { installationId, warehouseId, baseVariantIds }) {
  if (baseVariantIds.length === 0) return [];
  const result = await client.query(
    `SELECT base.id AS base_variant_id,
            base_unit.code AS base_unit_code,
            balance.base_variant_id AS balance_base_variant_id,
            balance.location_id,
            balance.lot_id,
            balance.on_hand_quantity,
            lot.normalized_lot_code
       FROM shared.product_variants base
       JOIN shared.units_of_measure base_unit
         ON base_unit.installation_id = base.installation_id
        AND base_unit.id = base.unit_id
       LEFT JOIN inventory.inventory_balances balance
         ON balance.installation_id = base.installation_id
        AND balance.warehouse_id = $2
        AND balance.base_variant_id = base.id
       LEFT JOIN inventory.inventory_lots lot
         ON lot.installation_id = balance.installation_id
        AND lot.id = balance.lot_id
      WHERE base.installation_id = $1
        AND base.id = ANY($3::uuid[])
      ORDER BY base.id ASC, balance.location_id ASC NULLS FIRST, balance.lot_id ASC NULLS FIRST`,
    [installationId, warehouseId, baseVariantIds],
  );
  return result.rows ?? [];
}

function enrichStock(row, warehouse, balanceContext) {
  const contexts = balanceContext.filter((item) => item.base_variant_id === row.baseVariantId);
  const baseUnitCode = contexts.find((item) => item.base_unit_code)?.base_unit_code ?? null;
  if (!row.baseVariantId || !row.baseQuantity) {
    return Object.freeze({ ...row, baseUnitCode, currentOnHand: null, afterOnHand: null });
  }
  if (warehouse.locationRequired && !row.locationId) {
    return Object.freeze({ ...row, baseUnitCode, currentOnHand: null, afterOnHand: null });
  }
  if (row.lotTrackingMode !== 'NONE' && row.lotTrackingMode !== 'REQUIRED') {
    return Object.freeze({ ...row, baseUnitCode, currentOnHand: null, afterOnHand: null });
  }
  if (row.lotTrackingMode === 'REQUIRED' && !row.lotCode) {
    return Object.freeze({ ...row, baseUnitCode, currentOnHand: null, afterOnHand: null });
  }

  const locationId = warehouse.locationRequired ? row.locationId : null;
  const lotCode = row.lotTrackingMode === 'REQUIRED' ? row.lotCode : null;
  const matching = contexts.filter((item) => {
    if (!item.balance_base_variant_id) return false;
    if ((item.location_id ?? null) !== (locationId ?? null)) return false;
    if (lotCode === null) return item.lot_id === null;
    return String(item.normalized_lot_code ?? '') === String(lotCode);
  });

  let currentOnHand = '0';
  for (const item of matching) {
    const next = addExactDecimal(currentOnHand, String(item.on_hand_quantity ?? '0'));
    if (next === null) {
      return Object.freeze({ ...row, baseUnitCode, currentOnHand: null, afterOnHand: null });
    }
    currentOnHand = next;
  }
  const afterOnHand = addExactDecimal(currentOnHand, row.baseQuantity);
  return Object.freeze({
    ...row,
    baseUnitCode,
    currentOnHand,
    afterOnHand,
  });
}

export async function previewManualInboundOperator(client, { requestContext, payload }) {
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

  const baseVariantIds = [...new Set(
    prepared.preview.rows
      .map((row) => String(row.baseVariantId ?? '').trim())
      .filter((id) => UUID_PATTERN.test(id)),
  )];
  const balanceContext = await loadBalanceContext(client, {
    installationId: requestContext.installationId,
    warehouseId: prepared.preview.warehouse.id,
    baseVariantIds,
  });
  const rows = prepared.preview.rows.map((row) => enrichStock(row, prepared.preview.warehouse, balanceContext));

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
});