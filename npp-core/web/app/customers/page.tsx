import CustomerWorkspace from './customer-workspace';
import CustomerBulkTabsLauncher from './customer-bulk-tabs-launcher';
import CustomerMediaLauncher from './customer-media-launcher';
import type { Customer, CustomerGroup } from '../../lib/customer-types';
import { listVietnamProvinces } from '../../lib/vietnam-administrative-data';
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
  let initialProvinces = listVietnamProvinces();
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
    <>
      <CustomerWorkspace
        initialCustomers={initialCustomers}
        initialGroups={initialGroups}
        initialProvinces={initialProvinces}
        initialError={initialError}
      />
      <CustomerBulkTabsLauncher />
      <CustomerMediaLauncher customers={initialCustomers} />
    </>
  );
}
