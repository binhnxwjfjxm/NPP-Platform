import SupplierWorkspace from './supplier-workspace';
import type { Supplier } from '../../lib/supplier-types';
import {
  listAllSuppliers,
  normalizeSupplierGatewayError,
  resolveSupplierRequestId,
} from '../../lib/supplier-gateway';

export const dynamic = 'force-dynamic';

export default async function SuppliersPage() {
  const requestId = resolveSupplierRequestId(null);
  let initialSuppliers: Supplier[] = [];
  let initialError: string | null = null;

  try {
    initialSuppliers = await listAllSuppliers<Supplier>(requestId, new URLSearchParams({ limit: '1000' }));
  } catch (error) {
    initialError = normalizeSupplierGatewayError(error).publicMessage;
  }

  return (
    <SupplierWorkspace
      initialSuppliers={initialSuppliers}
      initialError={initialError}
    />
  );
}
