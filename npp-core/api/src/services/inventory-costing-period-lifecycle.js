import { randomUUID } from 'node:crypto';
import { deriveIdempotencyKey } from '../idempotency-derived.js';
import { actorId, failure, hashPayload, monthBounds } from './inventory-costing-period-utils.js';
import { rebuildOpenCosting } from './inventory-costing-period-projector.js';

function mapPeriod(row) {
  return {
    id: row.id,
    periodStart: String(row.period_start).slice(0, 10),
    periodEnd: String(row.period_end).slice(0, 10),
    status: row.status,
    closedRebuildRunId: row.closed_rebuild_run_id ?? null,
    openedAt: row.opened_at,
    openedBy: row.opened_by,
    closedAt: row.closed_at ?? null,
    closedBy: row.closed_by ?? null,
    snapshotPoolCount: Number(row.snapshot_pool_count ?? row.metadata?.snapshotPoolCount ?? 0),
    snapshotAnomalyPoolCount: Number(row.snapshot_anomaly_pool_count ?? 0),
  };
}

export async function listPeriods(client, requestContext) {
  const result = await client.query(
    `SELECT * FROM inventory.inventory_costing_period_status
      WHERE installation_id=$1 ORDER BY period_start DESC LIMIT 36`,
    [requestContext.installationId],
  );
  return { ok: true, periods: (result.rows ?? []).map(mapPeriod) };
}

export async function openPeriod(client, { requestContext, periodStart }) {
  const bounds = monthBounds(periodStart);
  if (!bounds) {
    return failure('INVALID_PERIOD_START', 'periodStart must be the first day of a valid month');
  }
  const existing = await client.query(
    `SELECT * FROM inventory.inventory_costing_period_status
      WHERE installation_id=$1 AND period_start=$2::date`,
    [requestContext.installationId, bounds.start],
  );
  if (existing.rows?.[0]) {
    const period = existing.rows[0];
    if (period.status === 'OPEN') return { ok: true, period: mapPeriod(period), replayed: true };
    return failure('COSTING_PERIOD_CLOSED', 'A CLOSED costing period cannot be reopened');
  }
  const open = await client.query(
    `SELECT period_start FROM inventory.inventory_costing_periods
      WHERE installation_id=$1 AND status='OPEN'`,
    [requestContext.installationId],
  );
  if (open.rows?.[0]) {
    return failure(
      'COSTING_PERIOD_CONFLICT',
      'Another costing period is already OPEN',
      { periodStart: String(open.rows[0].period_start).slice(0, 10) },
    );
  }
  const latestClosed = await client.query(
    `SELECT period_end,(period_end + interval '1 day')::date AS next_start
       FROM inventory.inventory_costing_periods
      WHERE installation_id=$1 AND status='CLOSED'
      ORDER BY period_end DESC LIMIT 1`,
    [requestContext.installationId],
  );
  if (latestClosed.rows?.[0]) {
    const nextStart = String(latestClosed.rows[0].next_start).slice(0, 10);
    if (bounds.start !== nextStart) {
      return failure(
        'COSTING_PERIOD_SEQUENCE_INVALID',
        'The next OPEN period must immediately follow the latest CLOSED period',
        { expectedPeriodStart: nextStart },
      );
    }
  }
  const result = await client.query(
    `INSERT INTO inventory.inventory_costing_periods (
       id,installation_id,period_start,period_end,status,opened_by,request_id,source_app,metadata
     ) VALUES ($1,$2,$3::date,$4::date,'OPEN',$5,$6,$7,'{}'::jsonb)
     RETURNING *`,
    [
      randomUUID(), requestContext.installationId, bounds.start, bounds.end,
      actorId(requestContext), requestContext.requestId, requestContext.sourceApp ?? 'npp-core',
    ],
  );
  return { ok: true, period: mapPeriod(result.rows[0]), replayed: false };
}

export async function closePeriod(client, { requestContext, periodStart, idempotencyKey }) {
  const bounds = monthBounds(periodStart);
  if (!bounds) {
    return failure('INVALID_PERIOD_START', 'periodStart must be the first day of a valid month');
  }
  const result = await client.query(
    `SELECT * FROM inventory.inventory_costing_periods
      WHERE installation_id=$1 AND period_start=$2::date FOR UPDATE`,
    [requestContext.installationId, bounds.start],
  );
  const period = result.rows?.[0];
  if (!period) return failure('COSTING_PERIOD_NOT_FOUND', 'Costing period was not opened');
  if (period.status === 'CLOSED') return { ok: true, period: mapPeriod(period), replayed: true };

  const snapshotIdempotencyKey = deriveIdempotencyKey(
    'inventory-cost-period-snapshot',
    idempotencyKey,
  );
  const projection = await rebuildOpenCosting(client, {
    requestContext,
    idempotencyKey: snapshotIdempotencyKey,
    payload: {},
    replaceProjection: true,
    throughDate: bounds.end,
  });
  if (!projection.ok) return projection;
  if (projection.anomalyCount > 0 || projection.reconciliationMismatchCount > 0) {
    return failure(
      'COSTING_PERIOD_HAS_DISCREPANCIES',
      'Costing period cannot close while anomalies or reconciliation mismatches remain',
      {
        anomalyCount: projection.anomalyCount,
        reconciliationMismatchCount: projection.reconciliationMismatchCount,
      },
    );
  }

  for (const balance of projection.balances) {
    await client.query(
      `INSERT INTO inventory.inventory_cost_period_balances (
       installation_id,period_id,warehouse_id,base_variant_id,method_version,currency_code,
       quantity,inventory_value,average_unit_cost,status,anomaly_count,projected_through_event,rebuild_run_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::numeric,$8::numeric,$9::numeric,$10,$11,$12,$13)`,
      [
        requestContext.installationId, period.id, balance.warehouseId,
        balance.baseVariantId, balance.methodVersion, balance.currencyCode,
        balance.quantity, balance.inventoryValue, balance.averageUnitCost,
        balance.status, balance.anomalyCount, balance.projectedThroughEvent,
        projection.run.id,
      ],
    );
  }
  const closed = await client.query(
    `UPDATE inventory.inventory_costing_periods
        SET status='CLOSED',closed_rebuild_run_id=$3,closed_at=now(),closed_by=$4,
            metadata=jsonb_set(metadata,'{snapshotPoolCount}',to_jsonb($5::integer),true)
      WHERE installation_id=$1 AND id=$2 AND status='OPEN'
      RETURNING *`,
    [
      requestContext.installationId, period.id, projection.run.id,
      actorId(requestContext), projection.balances.length,
    ],
  );
  return {
    ok: true,
    period: mapPeriod(closed.rows[0]),
    snapshotRunId: projection.run.id,
    replayed: false,
  };
}
