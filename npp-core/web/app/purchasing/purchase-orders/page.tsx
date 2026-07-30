import PurchaseOrderWorkspace from './PurchaseOrderWorkspace';
import { loadPurchaseOrderBootstrap } from '../../../lib/purchase-order-bootstrap';
import { resolvePurchaseOrderRequestId } from '../../../lib/purchase-order-gateway';

export const dynamic = 'force-dynamic';

export default async function PurchaseOrdersPage() {
  const requestId = resolvePurchaseOrderRequestId(null);
  const initialBootstrap = await loadPurchaseOrderBootstrap(requestId);

  return (
    <PurchaseOrderWorkspace initialBootstrap={initialBootstrap} />
  );
}
