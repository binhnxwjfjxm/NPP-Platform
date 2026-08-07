import { headers } from 'next/headers';
import {
  getLatestInventoryCostingRun,
  listInventoryCostAdjustments,
  listInventoryCostAnomalies,
  listInventoryCostBalances,
  listInventoryCostDiscrepancies,
  listInventoryCostFacts,
  listInventoryCostingPeriods,
  listInventoryCostReconciliation,
  resolveInventoryCostingRequestId,
} from '../../../lib/inventory-costing-gateway';
import type {
  InventoryCostAdjustmentEvent,
  InventoryCostAnomaly,
  InventoryCostBalance,
  InventoryCostDiscrepancy,
  InventoryCostFact,
  InventoryCostingPeriod,
  InventoryCostingRun,
  InventoryCostReconciliation,
} from '../../../lib/inventory-costing-types';
import InventoryCostingWorkspace from './workspace';

export const dynamic = 'force-dynamic';

export default async function InventoryCostingPage() {
  const headerStore = await headers();
  const requestId = resolveInventoryCostingRequestId(headerStore.get('x-request-id'));
  let balances: InventoryCostBalance[] = [];
  let facts: InventoryCostFact[] = [];
  let anomalies: InventoryCostAnomaly[] = [];
  let reconciliation: InventoryCostReconciliation[] = [];
  let periods: InventoryCostingPeriod[] = [];
  let adjustments: InventoryCostAdjustmentEvent[] = [];
  let discrepancies: InventoryCostDiscrepancy[] = [];
  let run: InventoryCostingRun | null = null;
  let initialError: string | null = null;
  try {
    [
      balances,
      facts,
      anomalies,
      reconciliation,
      periods,
      adjustments,
      discrepancies,
      run,
    ] = await Promise.all([
      listInventoryCostBalances<InventoryCostBalance[]>(requestId),
      listInventoryCostFacts<InventoryCostFact[]>(requestId, new URLSearchParams({ limit: '100' })),
      listInventoryCostAnomalies<InventoryCostAnomaly[]>(requestId, new URLSearchParams({ limit: '100' })),
      listInventoryCostReconciliation<InventoryCostReconciliation[]>(requestId, new URLSearchParams({ limit: '500' })),
      listInventoryCostingPeriods<InventoryCostingPeriod[]>(requestId),
      listInventoryCostAdjustments<InventoryCostAdjustmentEvent[]>(requestId),
      listInventoryCostDiscrepancies<InventoryCostDiscrepancy[]>(requestId),
      getLatestInventoryCostingRun<InventoryCostingRun | null>(requestId),
    ]);
  } catch (error) {
    initialError = error instanceof Error
      ? error.message
      : 'Không tải được dữ liệu giá vốn tồn kho';
  }
  return (
    <InventoryCostingWorkspace
      initialBalances={balances}
      initialFacts={facts}
      initialAnomalies={anomalies}
      initialReconciliation={reconciliation}
      initialPeriods={periods}
      initialAdjustments={adjustments}
      initialDiscrepancies={discrepancies}
      initialRun={run}
      initialError={initialError}
    />
  );
}
