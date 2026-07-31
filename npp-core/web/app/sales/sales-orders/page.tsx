import SalesOrderWorkspace from './SalesOrderWorkspace';
import { loadSalesOrderBootstrap } from '../../../lib/sales-order-bootstrap';
import { resolveSalesOrderRequestId } from '../../../lib/sales-order-gateway';

export const dynamic = 'force-dynamic';

export default async function SalesOrdersPage() {
  const requestId = resolveSalesOrderRequestId(null);
  const initialBootstrap = await loadSalesOrderBootstrap(requestId);
  return <SalesOrderWorkspace initialBootstrap={initialBootstrap} />;
}
