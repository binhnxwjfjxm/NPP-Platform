import OrderManagementWorkspace from './OrderManagementWorkspace';
import { loadSalesOrderPermissionKeys } from '../../../lib/sales-order-context';
import { resolveSalesOrderRequestId } from '../../../lib/sales-order-gateway';

export const dynamic = 'force-dynamic';

export default async function OrderManagementPage() {
  const requestId = resolveSalesOrderRequestId(null);
  const permissionKeys = await loadSalesOrderPermissionKeys(requestId).catch(() => []);
  return <OrderManagementWorkspace permissionKeys={permissionKeys} />;
}
