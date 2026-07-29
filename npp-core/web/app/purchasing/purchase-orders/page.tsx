import PurchaseOrderWorkspace from './PurchaseOrderWorkspace';
import type { PurchaseOrder } from '../../../lib/purchase-order-types';
import { listPurchaseOrders, normalizePurchaseOrderGatewayError, resolvePurchaseOrderRequestId } from '../../../lib/purchase-order-gateway';

export const dynamic = 'force-dynamic';

export default async function PurchaseOrdersPage() {
  const requestId = resolvePurchaseOrderRequestId(null);
  let initial: PurchaseOrder[] = [];
  let initialError: string | null = null;
  try {
    initial = await listPurchaseOrders<PurchaseOrder>(requestId, { limit: 50 });
  } catch (error) {
    initialError = normalizePurchaseOrderGatewayError(error).publicMessage;
  }

  return (
    // keep server component small — workspace handles client interactions
    <PurchaseOrderWorkspace initialPurchaseOrders={initial} initialError={initialError} />
  );
}
