import { randomUUID } from 'node:crypto';
import { parse12 } from './inventory-costing-period-utils.js';

export const poolKey = (row) => `${row.warehouse_id}:${row.base_variant_id}`;

export async function latestClosedPeriod(client, installationId) {
  const result = await client.query(
    `SELECT * FROM inventory.inventory_costing_periods
      WHERE installation_id=$1 AND status='CLOSED' ORDER BY period_end DESC LIMIT 1`,
    [installationId],
  );
  return result.rows?.[0] ?? null;
}

export async function seedPools(client, installationId, periodId, selected) {
  const pools = new Map();
  if (!periodId) return pools;
  const result = await client.query(
    `SELECT * FROM inventory.inventory_cost_period_balances
      WHERE installation_id=$1 AND period_id=$2 AND warehouse_id=ANY($3::uuid[])`,
    [installationId, periodId, selected],
  );
  for (const row of result.rows ?? []) {
    pools.set(poolKey(row), {
      warehouseId: row.warehouse_id,
      baseVariantId: row.base_variant_id,
      quantity: parse12(row.quantity) ?? 0n,
      value: parse12(row.inventory_value) ?? 0n,
      average: parse12(row.average_unit_cost) ?? 0n,
      status: row.status,
      anomalyCount: Number(row.anomaly_count ?? 0),
      projectedThroughEvent: Number(row.projected_through_event ?? 0),
    });
  }
  return pools;
}

export async function canonicalFactByMovementLine(client, installationId, movementLineId) {
  const result = await client.query(
    `SELECT fact.*
       FROM inventory.inventory_cost_facts fact
       JOIN inventory.inventory_costing_periods period
         ON period.installation_id=fact.installation_id
        AND period.closed_rebuild_run_id=fact.rebuild_run_id
      WHERE fact.installation_id=$1
        AND fact.inventory_movement_line_id=$2
        AND fact.status='COSTED'
      ORDER BY period.period_end DESC, fact.event_order DESC
      LIMIT 1`,
    [installationId, movementLineId],
  );
  return result.rows?.[0] ?? null;
}

export async function canonicalFactByMovementPosition(
  client,
  installationId,
  movementId,
  lineNumber,
) {
  const result = await client.query(
    `SELECT fact.*
       FROM inventory.inventory_cost_facts fact
       JOIN inventory.inventory_costing_periods period
         ON period.installation_id=fact.installation_id
        AND period.closed_rebuild_run_id=fact.rebuild_run_id
      WHERE fact.installation_id=$1
        AND fact.inventory_movement_id=$2
        AND fact.movement_line_number=$3
        AND fact.status='COSTED'
      ORDER BY period.period_end DESC, fact.event_order DESC
      LIMIT 1`,
    [installationId, movementId, lineNumber],
  );
  return result.rows?.[0] ?? null;
}

export async function canonicalTransferFact(client, installationId, transferLineId) {
  const result = await client.query(
    `SELECT fact.*
       FROM inventory.inventory_cost_facts fact
       JOIN inventory.inventory_costing_periods period
         ON period.installation_id=fact.installation_id
        AND period.closed_rebuild_run_id=fact.rebuild_run_id
      WHERE fact.installation_id=$1
        AND fact.status='COSTED'
        AND fact.event_type='TRANSFER_ISSUE_OUT'
        AND fact.metadata->>'inventoryTransferLineId'=$2
      ORDER BY period.period_end DESC, fact.event_order DESC
      LIMIT 1`,
    [installationId, transferLineId],
  );
  return result.rows?.[0] ?? null;
}

export function compareEvents(left, right) {
  const leftDate = left.kind === 'movement'
    ? String(left.row.document_date).slice(0, 10)
    : String(left.row.posting_date);
  const rightDate = right.kind === 'movement'
    ? String(right.row.document_date).slice(0, 10)
    : String(right.row.posting_date);
  if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
  if (left.kind !== right.kind) return left.kind === 'movement' ? -1 : 1;
  if (left.kind === 'movement') {
    return String(left.row.posted_at).localeCompare(String(right.row.posted_at))
      || String(left.row.movement_id).localeCompare(String(right.row.movement_id))
      || Number(left.row.line_number) - Number(right.row.line_number)
      || String(left.row.movement_line_id).localeCompare(String(right.row.movement_line_id));
  }
  return String(left.row.created_at).localeCompare(String(right.row.created_at))
    || String(left.row.id).localeCompare(String(right.row.id));
}

export async function resolveQueue(client, installationId, selected, codes) {
  await client.query(
    `UPDATE inventory.inventory_cost_discrepancies
        SET status='RESOLVED',resolved_at=now(),last_seen_at=now()
      WHERE installation_id=$1 AND warehouse_id=ANY($2::uuid[])
        AND code=ANY($3::text[]) AND status='OPEN'`,
    [installationId, selected, codes],
  );
}

export async function discrepancy(client, input) {
  await client.query(
    `INSERT INTO inventory.inventory_cost_discrepancies (
       id,installation_id,code,status,warehouse_id,base_variant_id,
       inventory_movement_id,inventory_movement_line_id,cost_adjustment_event_id,
       period_id,stable_key,message,details,first_seen_at,last_seen_at
     ) VALUES ($1,$2,$3,'OPEN',$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,now(),now())
     ON CONFLICT (installation_id,stable_key) DO UPDATE
       SET status='OPEN',resolved_at=NULL,last_seen_at=now(),message=EXCLUDED.message,details=EXCLUDED.details`,
    [
      randomUUID(), input.installationId, input.code, input.warehouseId,
      input.baseVariantId, input.movementId ?? null, input.movementLineId ?? null,
      input.adjustmentId ?? null, input.periodId ?? null, input.stableKey,
      input.message, JSON.stringify(input.details ?? {}),
    ],
  );
}

export async function closedLateMovements(client, installationId, selected, closed) {
  if (!closed) return [];
  const result = await client.query(
    `SELECT movement.id AS movement_id,line.id AS movement_line_id,
            line.warehouse_id,line.base_variant_id,movement.document_date::text AS document_date,movement.posted_at
       FROM inventory.inventory_movements movement
       JOIN inventory.inventory_movement_lines line
         ON line.installation_id=movement.installation_id AND line.movement_id=movement.id
      WHERE movement.installation_id=$1 AND line.warehouse_id=ANY($2::uuid[])
        AND movement.document_date<=$3::date AND movement.posted_at>$4::timestamptz
        AND NOT EXISTS (
          SELECT 1 FROM inventory.inventory_cost_adjustment_events correction
           WHERE correction.installation_id=movement.installation_id
             AND correction.event_type='FORWARD_CORRECTION'
             AND correction.original_movement_line_id=line.id
        )`,
    [installationId, selected, closed.period_end, closed.closed_at],
  );
  return result.rows ?? [];
}

export async function earliestAffected(client, installationId, selected, seededFromPeriodId, events) {
  const prior = await client.query(
    `SELECT * FROM inventory.inventory_cost_rebuild_runs
      WHERE installation_id=$1 AND warehouse_ids=$2::uuid[]
        AND metadata->>'periodAware'='true'
        AND COALESCE(metadata->>'seededFromPeriodId','')=$3
      ORDER BY completed_at DESC,id DESC LIMIT 1`,
    [installationId, selected, seededFromPeriodId ?? ''],
  );
  const run = prior.rows?.[0];
  if (!run) return events[0] ?? null;
  const facts = await client.query(
    `SELECT inventory_movement_line_id FROM inventory.inventory_cost_facts
      WHERE installation_id=$1 AND rebuild_run_id=$2`,
    [installationId, run.id],
  );
  const movementIds = new Set((facts.rows ?? []).map((row) => row.inventory_movement_line_id));
  const adjustmentIds = new Set(Array.isArray(run.metadata?.adjustmentEventIds)
    ? run.metadata.adjustmentEventIds
    : []);
  return events.find((event) => event.kind === 'movement'
    ? !movementIds.has(event.row.movement_line_id)
    : !adjustmentIds.has(event.row.id)) ?? null;
}
