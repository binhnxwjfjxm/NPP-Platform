import SupplierReturnWorkspace from './SupplierReturnWorkspace';
import type { SupplierReturn } from '../../../lib/supplier-return-types';
import type { GoodsReceipt } from '../../../lib/goods-receipt-types';
import type { Warehouse, WarehouseLocation } from '../../../lib/organization-types';
import { listSupplierReturns, resolveSupplierReturnRequestId } from '../../../lib/supplier-return-gateway';
import { listGoodsReceipts } from '../../../lib/goods-receipt-gateway';
import { loadOrganizationSnapshot } from '../../../lib/organization-snapshot';
import { loadSupplierReturnPermissionKeys } from '../../../lib/supplier-return-context';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function SupplierReturnsPage({ searchParams }: PageProps) {
  const requestId = resolveSupplierReturnRequestId(null);
  const initialSourceGoodsReceiptId = typeof searchParams?.goodsReceiptId === 'string'
    ? searchParams.goodsReceiptId
    : Array.isArray(searchParams?.goodsReceiptId)
      ? searchParams.goodsReceiptId[0] ?? null
      : null;
  const [returnsResult, receiptsResult, organizationResult, permissionsResult] = await Promise.allSettled([
    listSupplierReturns<SupplierReturn>(requestId, { limit: 1000 }),
    listGoodsReceipts<GoodsReceipt>(requestId, { limit: 1000, status: 'posted' }),
    loadOrganizationSnapshot(),
    loadSupplierReturnPermissionKeys(requestId),
  ]);

  const initialError = returnsResult.status === 'rejected' ? 'Không tải được danh sách phiếu trả nhà cung cấp.' : null;
  const lookupErrors = [receiptsResult, organizationResult, permissionsResult].filter((result) => result.status === 'rejected');
  const initialLookupError = lookupErrors.length
    ? 'Một phần dữ liệu phiếu trả chưa tải được. Hãy cập nhật dữ liệu trước khi thao tác.'
    : null;

  return (
    <SupplierReturnWorkspace
      initialSupplierReturns={returnsResult.status === 'fulfilled' ? returnsResult.value : []}
      initialGoodsReceipts={receiptsResult.status === 'fulfilled' ? receiptsResult.value : []}
      initialWarehouses={organizationResult.status === 'fulfilled'
        ? organizationResult.value.warehouses.filter((warehouse: Warehouse) => warehouse.is_active)
        : []}
      initialLocations={organizationResult.status === 'fulfilled'
        ? organizationResult.value.locations.filter((location: WarehouseLocation) => location.is_active)
        : []}
      initialPermissionKeys={permissionsResult.status === 'fulfilled' ? permissionsResult.value : []}
      initialError={initialError}
      initialLookupError={initialLookupError}
      initialSourceGoodsReceiptId={initialSourceGoodsReceiptId}
    />
  );
}
