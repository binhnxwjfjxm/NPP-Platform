import SalesOrderWorkspace from './SalesOrderWorkspace';
import { loadSalesOrderBootstrap } from '../../../lib/sales-order-bootstrap';
import { resolveSalesOrderRequestId } from '../../../lib/sales-order-gateway';

export const dynamic = 'force-dynamic';

type PageProps = Readonly<{
  searchParams?: Readonly<{ search?: string | string[] }>;
}>;

function firstSearch(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw ?? '').trim().slice(0, 256);
}

export default async function SalesOrdersPage({ searchParams }: PageProps) {
  const requestId = resolveSalesOrderRequestId(null);
  const search = firstSearch(searchParams?.search);
  const initialBootstrap = await loadSalesOrderBootstrap(requestId, { search });
  return <SalesOrderWorkspace initialBootstrap={initialBootstrap} />;
}
