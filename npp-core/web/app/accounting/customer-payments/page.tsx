import { AppShell } from '../../components/app-shell';
import { listAllCustomers, resolveCustomerRequestId } from '../../../lib/customer-gateway';
import type { Customer } from '../../../lib/customer-types';
import { loadOrganizationSnapshot } from '../../../lib/organization-snapshot';
import type { Warehouse } from '../../../lib/organization-types';
import {
  getCustomerPayment,
  listCustomerPayments,
  listCustomerPaymentTargets,
  resolveCustomerPaymentRequestId,
} from '../../../lib/customer-payment-gateway';
import type {
  CustomerPayment,
  ReceivableAllocationTarget,
} from '../../../lib/customer-payment-types';
import CustomerPaymentWorkspace from './customer-payment-workspace';
import CustomerPaymentPrintDock from './CustomerPaymentPrintDock';

export const dynamic = 'force-dynamic';

function localDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export default async function CustomerPaymentsPage() {
  const requestId = resolveCustomerPaymentRequestId(null);
  const customerRequestId = resolveCustomerRequestId(null);
  const [paymentsResult, targetsResult, customersResult, organizationResult] = await Promise.allSettled([
    listCustomerPayments<CustomerPayment>(requestId, { limit: 1000 }),
    listCustomerPaymentTargets<ReceivableAllocationTarget>(requestId),
    listAllCustomers<Customer>(
      customerRequestId,
      new URLSearchParams({ active: 'true', limit: '1000' }),
    ),
    loadOrganizationSnapshot(),
  ]);

  let error = [paymentsResult, targetsResult, customersResult, organizationResult]
    .some((result) => result.status === 'rejected')
    ? 'Một phần dữ liệu thu tiền khách hàng chưa tải được. Hãy cập nhật lại trang trước khi thao tác.'
    : null;

  let payments = paymentsResult.status === 'fulfilled' ? paymentsResult.value : [];
  if (payments[0]) {
    try {
      const detail = await getCustomerPayment<CustomerPayment>(payments[0].id, requestId);
      payments = [detail, ...payments.slice(1)];
    } catch {
      error ??= 'Không tải được chi tiết phiếu thu đầu tiên. Hãy chọn lại phiếu trước khi thao tác.';
    }
  }

  const warehouses: Warehouse[] = organizationResult.status === 'fulfilled'
    ? organizationResult.value.warehouses.filter((warehouse) => warehouse.is_active)
    : [];

  return (
    <AppShell
      title="Thu tiền khách hàng"
      subtitle="Ghi nhận tiền đã nhận, phân bổ một lần vào nhiều khoản nợ và đảo nghiệp vụ bằng lịch sử bất biến."
      kicker="Kế toán bán hàng"
    >
      <CustomerPaymentWorkspace
        initialPayments={payments}
        initialTargets={targetsResult.status === 'fulfilled' ? targetsResult.value : []}
        customers={customersResult.status === 'fulfilled'
          ? customersResult.value.filter((customer) => customer.is_active)
          : []}
        warehouses={warehouses}
        initialPaymentDate={localDate()}
        initialError={error}
      />
      <CustomerPaymentPrintDock initialPayments={payments} />
    </AppShell>
  );
}
