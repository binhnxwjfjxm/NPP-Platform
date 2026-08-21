import * as repository from '../db/repositories/product-inventory-policy.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function normalizedTimestamp(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function hasNonZeroDecimal(value) {
  const normalized = String(value ?? '0').trim();
  return !/^[+-]?0(?:\.0+)?$/.test(normalized);
}

function mapProduct(row) {
  return Object.freeze({
    id: row.id,
    code: row.code,
    name: row.name,
    isInventoryManaged: row.is_inventory_managed === true,
    updatedAt: normalizedTimestamp(row.updated_at),
  });
}

export async function listProductInventoryPolicies(client, { installationId }) {
  const rows = await repository.listProductInventoryPolicies(client, { installationId });
  return Object.freeze({ ok: true, products: Object.freeze(rows.map(mapProduct)) });
}

export async function getProductInventoryPolicy(client, { installationId, id }) {
  if (!UUID_PATTERN.test(String(id ?? '').trim())) return failure('PRODUCT_NOT_FOUND', 'Không tìm thấy sản phẩm');
  const row = await repository.getProductInventoryPolicy(client, { installationId, id: String(id).trim() });
  return row ? Object.freeze({ ok: true, product: mapProduct(row) }) : failure('PRODUCT_NOT_FOUND', 'Không tìm thấy sản phẩm');
}

export async function updateProductInventoryPolicy(client, {
  installationId,
  id,
  payload,
  updatedBy,
}) {
  const productId = String(id ?? '').trim();
  if (!UUID_PATTERN.test(productId)) return failure('PRODUCT_NOT_FOUND', 'Không tìm thấy sản phẩm');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.isInventoryManaged !== 'boolean') {
    return failure('INVALID_INVENTORY_POLICY', 'Hãy chọn rõ Qua kho hoặc Không qua kho');
  }
  const expectedUpdatedAt = normalizedTimestamp(payload.expectedUpdatedAt);
  if (!expectedUpdatedAt) return failure('INVALID_EXPECTED_UPDATED_AT', 'Phiên bản sản phẩm không hợp lệ');

  const existing = await repository.getProductInventoryPolicyForUpdate(client, { installationId, id: productId });
  if (!existing) return failure('PRODUCT_NOT_FOUND', 'Không tìm thấy sản phẩm');
  const currentUpdatedAt = normalizedTimestamp(existing.updated_at);
  if (currentUpdatedAt !== expectedUpdatedAt) {
    return failure('STALE_VERSION', 'Sản phẩm vừa được cập nhật ở nơi khác. Hãy làm mới rồi thử lại.', false, {
      conflictType: 'stale_version',
      managementPath: '/products',
    });
  }

  const nextManaged = payload.isInventoryManaged;
  if (existing.is_inventory_managed === nextManaged) {
    return Object.freeze({
      ok: true,
      product: mapProduct(existing),
      beforeData: mapProduct(existing),
      changed: false,
      action: 'update',
    });
  }

  if (!nextManaged) {
    const blockers = await repository.getProductInventoryPolicyBlockers(client, { installationId, productId });
    if (hasNonZeroDecimal(blockers.onHandQuantity)
      || hasNonZeroDecimal(blockers.reservedQuantity)
      || blockers.activeFulfillmentDemandCount > 0
      || blockers.openPurchaseOrderCount > 0) {
      return failure(
        'DOMAIN_CONFLICT',
        'Chưa thể chuyển sang Không qua kho vì sản phẩm còn tồn, giữ hàng hoặc đơn mua đang xử lý. Hãy xử lý hết các nghiệp vụ này rồi thử lại.',
        false,
        { reason: 'PRODUCT_INVENTORY_POLICY_HAS_OPEN_OPERATIONS', blockers, managementPath: '/products' },
      );
    }
  } else {
    const activeInventoryBaseSkuCount = await repository.countActiveInventoryBaseVariants(client, { installationId, productId });
    if (activeInventoryBaseSkuCount !== 1) {
      return failure(
        'DOMAIN_CONFLICT',
        'Chưa thể chuyển sang Qua kho vì sản phẩm cần đúng một SKU tồn chuẩn đang sử dụng.',
        false,
        { reason: 'ACTIVE_INVENTORY_BASE_SKU_REQUIRED', activeInventoryBaseSkuCount, managementPath: '/products' },
      );
    }
  }

  const updated = await repository.updateProductInventoryPolicy(client, {
    installationId,
    id: productId,
    isInventoryManaged: nextManaged,
    updatedBy,
    expectedUpdatedAt,
  });
  if (!updated) {
    return failure('STALE_VERSION', 'Sản phẩm vừa được cập nhật ở nơi khác. Hãy làm mới rồi thử lại.', false, {
      conflictType: 'stale_version',
      managementPath: '/products',
    });
  }
  return Object.freeze({
    ok: true,
    product: mapProduct(updated),
    beforeData: mapProduct(existing),
    changed: true,
    action: 'update',
  });
}

export const productInventoryPolicyInternals = Object.freeze({ hasNonZeroDecimal, mapProduct });
