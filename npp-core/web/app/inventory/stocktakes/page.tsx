import { randomUUID } from 'node:crypto';
import { listInventoryBalances } from '../../../lib/inventory-gateway';
import type { InventoryBalance } from '../../../lib/inventory-types';
import { loadStocktakePermissionKeys } from '../../../lib/stocktake-context';
import { listStocktakes, listStocktakeWarehouses, normalizeStocktakeGatewayError } from '../../../lib/stocktake-gateway';
import type { Stocktake } from '../../../lib/stocktake-types';
import StocktakeWorkspace from './stocktake-workspace';

export const dynamic = 'force-dynamic';

type WarehouseOption = { id: string; code: string; name: string };

export default async function StocktakesPage() {
  const requestId = `web_${randomUUID()}`;
  const [stocktakesResult, balancesResult, warehousesResult, permissionsResult] = await Promise.allSettled([
    listStocktakes<Stocktake[]>(requestId, new URLSearchParams({ limit: '500' })),
    listInventoryBalances<InventoryBalance[]>(requestId, new URLSearchParams({ limit: '1000' })),
    listStocktakeWarehouses<WarehouseOption[]>(requestId),
    loadStocktakePermissionKeys(requestId),
  ]);
  const initialError = stocktakesResult.status === 'rejected'
    ? normalizeStocktakeGatewayError(stocktakesResult.reason).publicMessage
    : null;
  const lookupError = balancesResult.status === 'rejected'
    || warehousesResult.status === 'rejected'
    || permissionsResult.status === 'rejected'
    ? 'Một phần dữ liệu kiểm kê chưa tải được. Hãy cập nhật trước khi thao tác.'
    : null;

  return (
    <StocktakeWorkspace
      initialStocktakes={stocktakesResult.status === 'fulfilled' ? stocktakesResult.value : []}
      balances={balancesResult.status === 'fulfilled' ? balancesResult.value : []}
      warehouses={warehousesResult.status === 'fulfilled' ? warehousesResult.value : []}
      initialPermissionKeys={permissionsResult.status === 'fulfilled' ? permissionsResult.value : []}
      initialError={initialError}
      initialLookupError={lookupError}
    />
  );
}
