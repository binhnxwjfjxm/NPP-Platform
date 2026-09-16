import {
  createInventoryReportingExport as createBaseInventoryReportingExport,
  normalizeInventoryReportingExportSelection,
  inventoryReportingExportInternals,
} from './reporting-inventory-export-base.js';
import { listWarehouseBusinessHoldSummary } from './inventory-business-holds.js';

function holdKey(warehouseCode, sku) {
  return `${String(warehouseCode ?? '').trim().toLowerCase()}:${String(sku ?? '').trim().toLowerCase()}`;
}

async function loadHoldMaps(pool, { requestContext, warehouseIds, filters }) {
  const holds = await listWarehouseBusinessHoldSummary(pool, {
    installationId: requestContext.installationId,
    warehouseIds,
    warehouseId: filters.warehouseId,
  });
  if (!holds.length) return { byScope: new Map(), reservedByWarehouse: new Map() };

  const scopedWarehouseIds = [...new Set(holds.map((row) => row.warehouseId))];
  const variantIds = [...new Set(holds.map((row) => row.baseVariantId))];
  const [warehouseResult, variantResult] = await Promise.all([
    pool.query(
      `SELECT id, code FROM shared.warehouses WHERE installation_id = $1 AND id = ANY($2::uuid[])`,
      [requestContext.installationId, scopedWarehouseIds],
    ),
    pool.query(
      `SELECT id, sku FROM shared.product_variants WHERE installation_id = $1 AND id = ANY($2::uuid[])`,
      [requestContext.installationId, variantIds],
    ),
  ]);
  const warehouseCodeById = new Map((warehouseResult.rows ?? []).map((row) => [row.id, row.code]));
  const skuById = new Map((variantResult.rows ?? []).map((row) => [row.id, row.sku]));
  const byScope = new Map();
  const reservedByWarehouse = new Map();
  for (const hold of holds) {
    const warehouseCode = warehouseCodeById.get(hold.warehouseId);
    const sku = skuById.get(hold.baseVariantId);
    if (warehouseCode && sku) byScope.set(holdKey(warehouseCode, sku), hold);
    if (Number(hold.heldBaseQuantity) > 0 && warehouseCode) {
      const key = String(warehouseCode).trim().toLowerCase();
      reservedByWarehouse.set(key, (reservedByWarehouse.get(key) ?? 0) + 1);
    }
  }
  return { byScope, reservedByWarehouse };
}

function adjustRows(dimension, rows, holdMaps) {
  if (dimension === 'overview') {
    return rows.map((row) => ({
      ...row,
      reservedSkuCount: String(holdMaps.reservedByWarehouse.get(String(row.warehouseCode ?? '').trim().toLowerCase()) ?? 0),
    }));
  }
  if (dimension !== 'positions' && dimension !== 'slow-moving') return rows;
  return rows.map((row) => {
    const hold = holdMaps.byScope.get(holdKey(row.warehouseCode, row.sku));
    if (!hold) return row;
    return {
      ...row,
      onHandQuantity: hold.onHandBaseQuantity,
      reservedQuantity: hold.heldBaseQuantity,
      availableQuantity: hold.availableBaseQuantity,
    };
  });
}

export async function createInventoryReportingExport(pool, args) {
  const dimension = args?.selection?.dimension;
  if (!['overview', 'positions', 'slow-moving'].includes(dimension)) {
    return createBaseInventoryReportingExport(pool, args);
  }
  const holdMaps = await loadHoldMaps(pool, args);
  const adapter = Object.freeze({
    async query(sql, values) {
      const result = await pool.query(sql, values);
      return { ...result, rows: adjustRows(dimension, result.rows ?? [], holdMaps) };
    },
  });
  return createBaseInventoryReportingExport(adapter, args);
}

export { normalizeInventoryReportingExportSelection, inventoryReportingExportInternals };
