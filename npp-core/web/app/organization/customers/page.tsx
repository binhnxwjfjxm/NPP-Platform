import CustomerWorkspace from './customer-workspace';
import type { Customer } from '../../../lib/customer-types';

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  let initialCustomers: Customer[] = [];
  let initialError: string | null = null;

  try {
    const response = await fetch('/api/customers?limit=1000', { cache: 'no-store' });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error((payload && typeof payload?.error?.message === 'string') ? payload.error.message : `HTTP ${response.status}`);
    }
    const payload = (await response.json()) as { data?: Customer[]; error?: { message?: string } };
    if (!Array.isArray(payload.data)) {
      throw new Error(payload.error?.message ?? 'Không tải được danh sách khách hàng');
    }
    initialCustomers = payload.data;
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được danh sách khách hàng';
  }

  return <CustomerWorkspace initialCustomers={initialCustomers} initialError={initialError} />;
}
