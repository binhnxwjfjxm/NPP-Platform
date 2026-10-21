import { randomUUID } from 'node:crypto';
import { createIdempotencyKey } from '@npp/contracts';
import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';
import {
  buildAuditRecord, buildOutboxEvent, insertAuditRecord,
  insertOutboxEvent, withAuditOutboxTransaction,
} from '../src/audit-outbox.js';
import { replenishPendingHoldScopes } from '../src/services/sales-fulfillment-replenishment.js';

// Intended for an authorized, separately gated production reconciliation.
// Default is read-only. Run after backend deployment with verified backup,
// restore rehearsal and explicit owner approval; never on application startup.
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const warehouseArg = args.find((item) => item.startsWith('--warehouse-id='));
const warehouseId = warehouseArg?.slice('--warehouse-id='.length) ?? '';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

if (warehouseId && !uuid.test(warehouseId)) throw new Error('invalid_warehouse_id');
if (apply && (!warehouseId || !args.includes('--owner-approved')
    || !process.env.BACKORDER_RECONCILE_BACKUP_REFERENCE
    || !process.env.BACKORDER_RECONCILE_RESTORE_REFERENCE)) {
  throw new Error('production_gate_incomplete: require warehouse, owner approval, backup and restore evidence');
}

const config = loadConfig(process.env);
const pool = getPool(config);
const actorId = 'system:backorder-reconciliation';

async function waitingScopes(client) {
  const result = await client.query(
    `SELECT demand.warehouse_id, demand.base_variant_id,
            count(*)::int AS waiting_lines,
            sum(demand.backordered_base_quantity)::text AS waiting_base_quantity
       FROM sales.sales_order_fulfillment_demands demand
       JOIN sales.sales_orders orders
         ON orders.installation_id = demand.installation_id
        AND orders.id = demand.sales_order_id
      WHERE demand.installation_id = $1
        AND orders.status = 'confirmed'
        AND demand.state = 'ACTIVE'
        AND demand.backordered_base_quantity > 0
        AND ($2::uuid IS NULL OR demand.warehouse_id = $2::uuid)
      GROUP BY demand.warehouse_id, demand.base_variant_id
      ORDER BY demand.warehouse_id, demand.base_variant_id`,
    [config.installationId, warehouseId || null],
  );
  return result.rows;
}

try {
  const initial = await waitingScopes(pool);
  console.log(JSON.stringify({
    mode: apply ? 'APPLY_REQUESTED' : 'READ_ONLY',
    installationId: config.installationId,
    warehouseId: warehouseId || null,
    waitingScopes: initial.length,
    waitingLines: initial.reduce((total, row) => total + Number(row.waiting_lines), 0),
  }));
  if (apply) {
    const requestContext = Object.freeze({
      installationId: config.installationId,
      actorId,
      employeeId: null,
      sourceApp: 'NPP_CORE_MAINTENANCE',
      requestId: createIdempotencyKey('reconcile-backorders', randomUUID()),
    });
    const result = await withAuditOutboxTransaction({
      adapter: pool,
      mutate: async (client) => {
        const before = await waitingScopes(client);
        if (before.length === 0) return { ok: true, replayed: true, updatedLines: 0 };
        const repaired = await replenishPendingHoldScopes(client, {
          installationId: config.installationId,
          actorId,
          scopes: before.map((row) => ({
            warehouseId: row.warehouse_id,
            baseVariantId: row.base_variant_id,
          })),
        });
        const after = await waitingScopes(client);
        const evidence = {
          warehouseId,
          waitingBefore: before.map((row) => ({
            warehouseId: row.warehouse_id, baseVariantId: row.base_variant_id,
            waitingLines: row.waiting_lines, waitingBaseQuantity: row.waiting_base_quantity,
          })),
          waitingAfter: after.map((row) => ({
            warehouseId: row.warehouse_id, baseVariantId: row.base_variant_id,
            waitingLines: row.waiting_lines, waitingBaseQuantity: row.waiting_base_quantity,
          })),
          updatedLines: repaired.updatedLines,
        };
        const audit = buildAuditRecord({
          requestContext, action: 'sales.backorders.reconcile',
          resourceType: 'warehouse', resourceId: warehouseId,
          afterData: evidence,
          metadata: { initiatedBy: 'manual-approved-runbook' },
        });
        const event = buildOutboxEvent({
          requestContext,
          aggregateType: 'warehouse', aggregateId: warehouseId,
          eventType: 'sales.fulfillment.backorders.reconciled',
          payload: evidence,
        });
        await insertAuditRecord(client, audit);
        await insertOutboxEvent(client, event);
        return { ok: true, updatedLines: repaired.updatedLines, auditId: audit.auditId, eventId: event.eventId };
      },
    });
    console.log(JSON.stringify({ mode: 'APPLIED', updatedLines: result.updatedLines, auditId: result.auditId ?? null }));
  }
} finally {
  await closePool();
}
