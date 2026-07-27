import CustomerWorkspace from './customer-workspace';
import type { Customer, CustomerGroup } from '../../lib/customer-types';
import {
  listAllCustomers,
  listCustomerGroups,
  normalizeCustomerGatewayError,
  resolveCustomerRequestId,
} from '../../lib/customer-gateway';

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  const requestId = resolveCustomerRequestId(null);
  let initialCustomers: Customer[] = [];
  let initialGroups: CustomerGroup[] = [];
  let initialError: string | null = null;

  try {
    [initialCustomers, initialGroups] = await Promise.all([
      listAllCustomers<Customer>(requestId, new URLSearchParams({ limit: '1000' })),
      listCustomerGroups<CustomerGroup>(requestId, new URLSearchParams({ limit: '1000' })),
    ]);
  } catch (error) {
    initialError = normalizeCustomerGatewayError(error).publicMessage;
  }

  return (
    <CustomerWorkspace
      initialCustomers={initialCustomers}
      initialGroups={initialGroups}
      initialError={initialError}
    />
  );
}
