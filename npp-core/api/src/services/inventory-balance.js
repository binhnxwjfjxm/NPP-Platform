import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import { PERMISSIONS } from '../access/permissions.js';
import * as repository from '../db/repositories/inventory-balance.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HISTORY_SCOPE_MODES = new Set(['exact', 'warehouse']);

function failure(code, message, retryable = false) {
  return Object.freeze({ ok: false, code, message, retryable });
}

function hasPermission(requestContext, permission) {
  return Array.isArray(requestContext?.permissions)
    && requestContext.permissions.includes(permission);
}

function warehouseScope(requestContext) {
  const ids = requestContext?.scopes?.warehouseIds;
  return Array.isArray(ids)
    ? new Set(ids.filter((id) => typeof id === 'string' && id.trim()))
    : new Set();
}

function validUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function optionalUuid(value) {
  return value === undefined || value === null || value === '' || validUuid(value);
}

function exactZero(value) {
  return /^-?0(?:\.0+)?$/.test(String(value ?? '').trim());
}

function validateReadScope(requestContext, {
  warehouseId,
  locationId = null,
  baseVariantId,
  lotId = null,
}) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryRead)) {
    return failure('FORBIDDEN', 'Inventory read permission is required');
  }
  if (!validUuid(warehouseId)) return failure('INVALID_WAREHOUSE_ID', 'warehouseId is invalid');
  if (!optionalUuid(locationId)) return failure('INVALID_LOCATION_ID', 'locationId is invalid');
  if (!validUuid(baseVariantId)) return failure('INVALID_BASE_VARIANT_ID', 'baseVariantId is invalid');
  if (!optionalUuid(lotId)) return failure('INVALID_LOT_ID', 'lotId is invalid');
  const allowed = warehouseScope(requestContext);
  if (allowed.size === 0 || !allowed.has(warehouseId)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the server-owned request scope');
  }
  return Object.freeze({ ok: true });
}

export async function getInventoryBalance(client, {
  requestContext,
  warehouseId,
  locationId = null,
  baseVariantId,
  lotId = null,
}) {
  const validation = validateReadScope(requestContext, {
    warehouseId,
    locationId,
    baseVariantId,
    lotId,
  });
  if (!validation.ok) return validation;
  const balance = await repository.getInventoryBalance(client, {
    installationId: requestContext.installationId,
    warehouseId,
    locationId: locationId || null,
    baseVariantId,
    lotId: lotId || null,
  });
  return balance
    ? Object.freeze({ ok: true, balance })
    : failure('BALANCE_NOT_FOUND', 'Inventory balance was not found');
}

export async function listInventoryMovementDrillDown(client, {
  requestContext,
  warehouseId,
  locationId = null,
  baseVariantId,
  lotId = null,
  limit = 500,
  offset = 0,
}) {
  const validation = validateReadScope(requestContext, {
    warehouseId,
    locationId,
    baseVariantId,
    lotId,
  });
  if (!validation.ok) return validation;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    return failure('INVALID_LIMIT', 'limit must be an integer between 1 and 1000');
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) {
    return failure('INVALID_OFFSET', 'offset must be an integer between 0 and 100000');
  }
  const lines = await repository.listInventoryMovementDrillDown(client, {
    installationId: requestContext.installationId,
    warehouseId,
    locationId: locationId || null,
    baseVariantId,
    lotId: lotId || null,
    limit,
    offset,
  });
  return Object.freeze({ ok: true, lines: Object.freeze(lines) });
}

export async function listInventoryMovementHistory(client, {
  requestContext,
  warehouseId,
  locationId = null,
  baseVariantId,
  lotId = null,
  scopeMode = 'exact',
  limit = 51,
  offset = 0,
}) {
  const validation = validateReadScope(requestContext, {
    warehouseId,
    locationId,
    baseVariantId,
    lotId,
  });
  if (!validation.ok) return validation;
  if (!HISTORY_SCOPE_MODES.has(scopeMode)) {
    return failure('INVALID_HISTORY_SCOPE', 'scope must be exact or warehouse');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    return failure('INVALID_LIMIT', 'limit must be an integer between 1 and 1000');
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) {
    return failure('INVALID_OFFSET', 'offset must be an integer between 0 and 100000');
  }
  const rows = await repository.listInventoryMovementHistory(client, {
    installationId: requestContext.installationId,
    warehouseId,
    locationId: scopeMode === 'warehouse' ? null : (locationId || null),
    baseVariantId,
    lotId: scopeMode === 'warehouse' ? null : (lotId || null),
    scopeMode,
    limit,
    offset,
  });
  return Object.freeze({ ok: true, rows: Object.freeze(rows) });
}

export async function reconcileInventoryBalances(client, { requestContext }) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryRead)) {
    return failure('FORBIDDEN', 'Inventory read permission is required');
  }
  const allowed = warehouseScope(requestContext);
  if (allowed.size === 0) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'At least one server-owned warehouse scope is required');
  }
  const warehouseIds = await repository.listInventoryWarehouseIds(client, {
    installationId: requestContext.installationId,
  });
  if (warehouseIds.some((warehouseId) => !allowed.has(warehouseId))) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Full reconciliation requires scope for every inventory warehouse');
  }
  const rows = await repository.reconcileInventoryBalances(client, {
    installationId: requestContext.installationId,
  });
  const differences = rows.filter((row) => !exactZero(row.difference));
  return Object.freeze({
    ok: true,
    rows: Object.freeze(rows),
    differences: Object.freeze(differences),
    reconciled: differences.length === 0,
  });
}

export async function executeInventoryBalanceRebuild({ adapter, requestContext }) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryPost)) {
    return failure('FORBIDDEN', 'Inventory post permission is required for balance rebuild');
  }
  const allowed = warehouseScope(requestContext);
  if (allowed.size === 0) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'At least one server-owned warehouse scope is required');
  }

  const transaction = await withAuditOutboxTransaction({
    adapter,
    mutate: async (client) => {
      await repository.lockBalanceRebuild(client, {
        installationId: requestContext.installationId,
      });
      const warehouseIds = await repository.listInventoryWarehouseIds(client, {
        installationId: requestContext.installationId,
      });
      if (warehouseIds.some((warehouseId) => !allowed.has(warehouseId))) {
        return {
          failed: failure(
            'WAREHOUSE_SCOPE_DENIED',
            'Full rebuild requires scope for every inventory warehouse',
          ),
          skipAudit: true,
        };
      }

      const beforeRows = await repository.reconcileInventoryBalances(client, {
        installationId: requestContext.installationId,
      });
      const beforeDifferences = beforeRows.filter((row) => !exactZero(row.difference));
      const balances = await repository.rebuildInventoryBalances(client, {
        installationId: requestContext.installationId,
      });
      const afterRows = await repository.reconcileInventoryBalances(client, {
        installationId: requestContext.installationId,
      });
      const afterDifferences = afterRows.filter((row) => !exactZero(row.difference));
      if (afterDifferences.length > 0) {
        return {
          failed: failure(
            'BALANCE_REBUILD_RECONCILIATION_FAILED',
            'Balance rebuild did not reconcile to the immutable ledger',
            true,
          ),
          skipAudit: true,
        };
      }

      const summary = Object.freeze({
        installationId: requestContext.installationId,
        balanceRows: balances.length,
        differencesBefore: beforeDifferences.length,
        differencesAfter: 0,
      });
      const audit = buildAuditRecord({
        requestContext,
        action: 'inventory.balance.rebuild',
        resourceType: 'inventory_balance_projection',
        resourceId: requestContext.installationId,
        beforeData: {
          rowCount: beforeRows.length,
          differenceCount: beforeDifferences.length,
        },
        afterData: summary,
        metadata: { warehouseCount: warehouseIds.length },
      });
      const event = buildOutboxEvent({
        requestContext,
        aggregateType: 'inventory_balance_projection',
        aggregateId: requestContext.installationId,
        eventType: 'core.inventory.balance.rebuilt',
        eventVersion: 1,
        payload: summary,
        metadata: {},
      });
      await insertAuditRecord(client, audit);
      await insertOutboxEvent(client, event);
      return Object.freeze({
        ok: true,
        summary,
        reconciliation: Object.freeze(afterRows),
        auditId: audit.auditId,
        eventId: event.eventId,
      });
    },
  });

  return transaction?.failed ?? transaction;
}

export const inventoryBalanceInternals = Object.freeze({
  exactZero,
  validateReadScope,
});
