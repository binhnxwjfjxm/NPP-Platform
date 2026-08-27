export const NEGATIVE_STOCK_PERMISSION = 'core.inventory.negative-stock.issue';

export function hasNegativeStockPermission(requestContext) {
  return Array.isArray(requestContext?.permissions)
    && requestContext.permissions.includes(NEGATIVE_STOCK_PERMISSION);
}

export function controlledNegativeStockEvidence(warehouseId) {
  return Object.freeze({
    source: 'SERVER_POLICY',
    decision: 'ALLOW',
    permissionKey: NEGATIVE_STOCK_PERMISSION,
    warehouseId: String(warehouseId),
  });
}

export function negativeStockScopeSupported({
  locationRequired = false,
  lotTrackingMode = 'NONE',
  expiryTrackingMode = 'NONE',
} = {}) {
  return locationRequired !== true
    && String(lotTrackingMode ?? 'NONE').toUpperCase() === 'NONE'
    && String(expiryTrackingMode ?? 'NONE').toUpperCase() !== 'REQUIRED';
}

export async function authorizeControlledNegativeStock(client, {
  requestContext,
  warehouseId,
}) {
  if (!hasNegativeStockPermission(requestContext)) {
    return Object.freeze({
      ok: false,
      code: 'NEGATIVE_STOCK_PERMISSION_DENIED',
      message: 'Bạn chưa được cấp quyền xuất vượt tồn khả dụng.',
    });
  }

  const result = await client.query(
    `SELECT allow_negative_stock, is_active
       FROM shared.warehouses
      WHERE installation_id = $1
        AND id = $2
      FOR SHARE`,
    [requestContext.installationId, warehouseId],
  );
  const warehouse = result.rows?.[0] ?? null;
  if (!warehouse || warehouse.is_active !== true) {
    return Object.freeze({
      ok: false,
      code: 'NEGATIVE_STOCK_WAREHOUSE_UNAVAILABLE',
      message: 'Kho không tồn tại hoặc đang ngừng hoạt động.',
    });
  }
  if (warehouse.allow_negative_stock !== true) {
    return Object.freeze({
      ok: false,
      code: 'NEGATIVE_STOCK_POLICY_DISABLED',
      message: 'Kho này đang tắt chính sách xuất vượt tồn khả dụng.',
    });
  }

  return Object.freeze({
    ok: true,
    evidence: controlledNegativeStockEvidence(warehouseId),
  });
}

export function readControlledNegativeStockEvidence(line) {
  const evidence = line?.metadata?.negativeStockAuthorization;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  if (evidence.source !== 'SERVER_POLICY'
    || evidence.decision !== 'ALLOW'
    || evidence.permissionKey !== NEGATIVE_STOCK_PERMISSION
    || String(evidence.warehouseId ?? '') !== String(line?.warehouseId ?? '')) {
    return null;
  }
  return controlledNegativeStockEvidence(line.warehouseId);
}

export async function verifyControlledNegativeStockEvidence(client, {
  requestContext,
  line,
}) {
  const evidence = readControlledNegativeStockEvidence(line);
  if (!evidence) {
    return Object.freeze({
      ok: false,
      code: 'NEGATIVE_STOCK_EVIDENCE_INVALID',
      message: 'Bằng chứng cho phép xuất vượt tồn không hợp lệ.',
    });
  }
  const authorization = await authorizeControlledNegativeStock(client, {
    requestContext,
    warehouseId: line.warehouseId,
  });
  if (!authorization.ok) return authorization;
  return Object.freeze({ ok: true, evidence: authorization.evidence });
}
