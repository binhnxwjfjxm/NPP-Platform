import { randomUUID } from 'node:crypto';
import InitialLoadRetry from '../../components/initial-load-retry';
import {
  listInventoryBalances,
  listInventoryTransferInTransit,
  listInventoryTransfers,
} from '../../../lib/inventory-gateway';
import { listOrganizationResource } from '../../../lib/organization-gateway';
import type { InventoryBalance } from '../../../lib/inventory-types';
import type { WarehouseLocation } from '../../../lib/organization-types';
import TransferWorkspace, {
  type InventoryTransfer,
  type InventoryTransferInTransit,
} from './transfer-workspace';

export const dynamic = 'force-dynamic';

function loadFailure(label: string, result: PromiseSettledResult<unknown>): string | null {
  if (result.status === 'fulfilled') return null;
  const message = result.reason instanceof Error ? result.reason.message : 'Dữ liệu tạm thời chưa sẵn sàng';
  return `${label}: ${message}`;
}

export default async function InventoryTransfersPage() {
  const requestId = `web_${randomUUID()}`;
  let transfers: InventoryTransfer[] = [];
  let inTransit: InventoryTransferInTransit[] = [];
  let balances: InventoryBalance[] = [];
  let locations: WarehouseLocation[] = [];
  let initialError: string | null = null;

  const [transfersResult, inTransitResult, balancesResult, locationsResult] = await Promise.allSettled([
    listInventoryTransfers<InventoryTransfer[]>(requestId, new URLSearchParams({ limit: '500' })),
    listInventoryTransferInTransit<InventoryTransferInTransit[]>(requestId, new URLSearchParams({ limit: '1000' })),
    listInventoryBalances<InventoryBalance[]>(requestId, new URLSearchParams({ limit: '1000' })),
    listOrganizationResource<WarehouseLocation[]>(
      'warehouse-locations',
      requestId,
      new URLSearchParams({ active: 'true', limit: '1000' }),
    ),
  ]);

  if (transfersResult.status === 'fulfilled') transfers = transfersResult.value;
  if (inTransitResult.status === 'fulfilled') inTransit = inTransitResult.value;
  if (balancesResult.status === 'fulfilled') balances = balancesResult.value;
  if (locationsResult.status === 'fulfilled') locations = locationsResult.value;

  const failures = [
    loadFailure('Danh sách phiếu', transfersResult),
    loadFailure('Hàng đang đi đường', inTransitResult),
    loadFailure('Tồn kho khả dụng', balancesResult),
    loadFailure('Vị trí kho', locationsResult),
  ].filter((value): value is string => value !== null);

  if (failures.length) {
    initialError = `Một phần dữ liệu chuyển kho chưa tải được. ${failures.join(' · ')}`;
  }

  return (
    <>
      <InitialLoadRetry enabled={Boolean(initialError)} retryKey="inventory-transfers" />
      <TransferWorkspace
        initialTransfers={transfers}
        initialInTransit={inTransit}
        balances={balances}
        locations={locations}
        initialError={initialError}
      />
    </>
  );
}
