import { randomUUID } from 'node:crypto';
import {
  listInventoryBalances,
  listInventoryTransferInTransit,
  listInventoryTransfers,
} from '../../../lib/inventory-gateway';
import type { InventoryBalance } from '../../../lib/inventory-types';
import TransferWorkspace, {
  type InventoryTransfer,
  type InventoryTransferInTransit,
} from './transfer-workspace';

export const dynamic = 'force-dynamic';

export default async function InventoryTransfersPage() {
  const requestId = `web_${randomUUID()}`;
  let transfers: InventoryTransfer[] = [];
  let inTransit: InventoryTransferInTransit[] = [];
  let balances: InventoryBalance[] = [];
  let initialError: string | null = null;

  try {
    [transfers, inTransit, balances] = await Promise.all([
      listInventoryTransfers<InventoryTransfer[]>(requestId, new URLSearchParams({ limit: '500' })),
      listInventoryTransferInTransit<InventoryTransferInTransit[]>(requestId, new URLSearchParams({ limit: '1000' })),
      listInventoryBalances<InventoryBalance[]>(requestId, new URLSearchParams({ limit: '2000' })),
    ]);
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được dữ liệu chuyển kho';
  }

  return (
    <TransferWorkspace
      initialTransfers={transfers}
      initialInTransit={inTransit}
      balances={balances}
      initialError={initialError}
    />
  );
}
