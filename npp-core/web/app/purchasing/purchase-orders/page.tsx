import PurchaseOrderWorkspace from './PurchaseOrderWorkspace';
import { loadPurchaseOrderBootstrap } from '../../../lib/purchase-order-bootstrap';
import { resolvePurchaseOrderRequestId } from '../../../lib/purchase-order-gateway';

export const dynamic = 'force-dynamic';

type PageProps = Readonly<{
  searchParams?: Readonly<{ search?: string | string[] }>;
}>;

function firstSearch(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw ?? '').trim().slice(0, 256);
}

export default async function PurchaseOrdersPage({ searchParams }: PageProps) {
  const requestId = resolvePurchaseOrderRequestId(null);
  const search = firstSearch(searchParams?.search);
  const initialBootstrap = await loadPurchaseOrderBootstrap(requestId);

  return (
    <PurchaseOrderWorkspace
      initialBootstrap={initialBootstrap}
      initialSearch={search}
    />
  );
}
