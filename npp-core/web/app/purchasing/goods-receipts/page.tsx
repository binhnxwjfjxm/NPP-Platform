import GoodsReceiptWorkspace from './GoodsReceiptWorkspace';
import type { GoodsReceipt } from '../../../lib/goods-receipt-types';
import type { PurchaseOrder } from '../../../lib/purchase-order-types';
import type { Warehouse, WarehouseLocation } from '../../../lib/organization-types';
import { listGoodsReceipts, normalizeGoodsReceiptGatewayError, resolveGoodsReceiptRequestId } from '../../../lib/goods-receipt-gateway';
import { listPurchaseOrders } from '../../../lib/purchase-order-gateway';
import { loadOrganizationSnapshot } from '../../../lib/organization-snapshot';
import { loadGoodsReceiptPermissionKeys } from '../../../lib/goods-receipt-context';
import { loadPurchaseOrderPermissionKeys } from '../../../lib/purchase-order-context';

export const dynamic = 'force-dynamic';

export default async function GoodsReceiptsPage() {
  const requestId = resolveGoodsReceiptRequestId(null);
  const [receiptsResult, ordersResult, organizationResult, receiptPermissionsResult, purchaseOrderPermissionsResult] = await Promise.allSettled([
    listGoodsReceipts<GoodsReceipt>(requestId, { limit: 1000 }),
    listPurchaseOrders<PurchaseOrder>(requestId, { limit: 1000 }),
    loadOrganizationSnapshot(),
    loadGoodsReceiptPermissionKeys(requestId),
    loadPurchaseOrderPermissionKeys(requestId),
  ]);

  const initialError = receiptsResult.status === 'rejected'
    ? normalizeGoodsReceiptGatewayError(receiptsResult.reason).publicMessage
    : null;
  const lookupErrors = [ordersResult, organizationResult, receiptPermissionsResult, purchaseOrderPermissionsResult]
    .filter((result) => result.status === 'rejected');
  const initialLookupError = lookupErrors.length
    ? 'Một phần dữ liệu phiếu nhận hàng chưa tải được. Hãy cập nhật dữ liệu trước khi thao tác.'
    : null;

  return (
    <GoodsReceiptWorkspace
      initialGoodsReceipts={receiptsResult.status === 'fulfilled' ? receiptsResult.value : []}
      initialPurchaseOrders={ordersResult.status === 'fulfilled' ? ordersResult.value : []}
      initialWarehouses={organizationResult.status === 'fulfilled'
        ? organizationResult.value.warehouses.filter((warehouse: Warehouse) => warehouse.is_active)
        : []}
      initialLocations={organizationResult.status === 'fulfilled'
        ? organizationResult.value.locations.filter((location: WarehouseLocation) => location.is_active)
        : []}
      initialPermissionKeys={receiptPermissionsResult.status === 'fulfilled' ? receiptPermissionsResult.value : []}
      initialPurchaseOrderPermissionKeys={purchaseOrderPermissionsResult.status === 'fulfilled' ? purchaseOrderPermissionsResult.value : []}
      initialError={initialError}
      initialLookupError={initialLookupError}
    />
  );
}

