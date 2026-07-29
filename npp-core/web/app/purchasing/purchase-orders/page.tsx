import PurchaseOrderWorkspace from './PurchaseOrderWorkspace';
import type { PurchaseOrder } from '../../../lib/purchase-order-types';
import type { Supplier } from '../../../lib/supplier-types';
import type { Product } from '../../../lib/product-types';
import type { Warehouse } from '../../../lib/organization-types';
import {
  listPurchaseOrders,
  normalizePurchaseOrderGatewayError,
  resolvePurchaseOrderRequestId,
} from '../../../lib/purchase-order-gateway';
import { listAllSuppliers } from '../../../lib/supplier-gateway';
import { listProducts } from '../../../lib/product-gateway';
import { loadOrganizationSnapshot } from '../../../lib/organization-snapshot';
import { loadPurchaseOrderPermissionKeys } from '../../../lib/purchase-order-context';

export const dynamic = 'force-dynamic';

export default async function PurchaseOrdersPage() {
  const requestId = resolvePurchaseOrderRequestId(null);
  const [ordersResult, suppliersResult, organizationResult, productsResult, permissionsResult] = await Promise.allSettled([
    listPurchaseOrders<PurchaseOrder>(requestId, { limit: 1000 }),
    listAllSuppliers<Supplier>(requestId, new URLSearchParams({ active: 'true', limit: '1000' })),
    loadOrganizationSnapshot(),
    listProducts<Product>(requestId, new URLSearchParams({ active: 'true', orderable: 'true', limit: '1000' })),
    loadPurchaseOrderPermissionKeys(requestId),
  ]);

  const initialError = ordersResult.status === 'rejected'
    ? normalizePurchaseOrderGatewayError(ordersResult.reason).publicMessage
    : null;
  const lookupErrors = [suppliersResult, organizationResult, productsResult, permissionsResult]
    .filter((result) => result.status === 'rejected');
  const initialLookupError = lookupErrors.length
    ? 'Một phần dữ liệu tạo đơn chưa tải được. Hãy cập nhật dữ liệu trước khi thao tác.'
    : null;

  return (
    <PurchaseOrderWorkspace
      initialPurchaseOrders={ordersResult.status === 'fulfilled' ? ordersResult.value : []}
      initialSuppliers={suppliersResult.status === 'fulfilled' ? suppliersResult.value : []}
      initialWarehouses={organizationResult.status === 'fulfilled'
        ? organizationResult.value.warehouses.filter((warehouse: Warehouse) => warehouse.is_active)
        : []}
      initialProducts={productsResult.status === 'fulfilled' ? productsResult.value : []}
      initialPermissionKeys={permissionsResult.status === 'fulfilled' ? permissionsResult.value : []}
      initialError={initialError}
      initialLookupError={initialLookupError}
    />
  );
}
