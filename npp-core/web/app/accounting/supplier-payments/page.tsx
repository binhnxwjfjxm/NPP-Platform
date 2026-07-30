import { AppShell } from '../../components/app-shell';
import { listAllSuppliers, resolveSupplierRequestId } from '../../../lib/supplier-gateway';
import type { Supplier } from '../../../lib/supplier-types';
import { loadOrganizationSnapshot } from '../../../lib/organization-snapshot';
import type { Warehouse } from '../../../lib/organization-types';
import {
  listSupplierPayments,
  listSupplierPaymentTargets,
  resolveSupplierPaymentRequestId,
} from '../../../lib/supplier-payment-gateway';
import type { AllocationTarget, SupplierPayment } from '../../../lib/supplier-payment-types';
import SupplierPaymentWorkspace from './supplier-payment-workspace';

export const dynamic = 'force-dynamic';

function localDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part)=>[part.type,part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export default async function SupplierPaymentsPage() {
  const requestId = resolveSupplierPaymentRequestId(null);
  const supplierRequestId = resolveSupplierRequestId(null);
  const [paymentsResult,targetsResult,suppliersResult,organizationResult] = await Promise.allSettled([
    listSupplierPayments<SupplierPayment>(requestId,{ limit:1000 }),
    listSupplierPaymentTargets<AllocationTarget>(requestId),
    listAllSuppliers<Supplier>(supplierRequestId,new URLSearchParams({ active:'true',limit:'1000' })),
    loadOrganizationSnapshot(),
  ]);
  const error = [paymentsResult,targetsResult,suppliersResult,organizationResult].some((result)=>result.status==='rejected')
    ? 'Một phần dữ liệu thanh toán nhà cung cấp chưa tải được. Hãy cập nhật lại trang trước khi thao tác.'
    : null;
  const warehouses: Warehouse[] = organizationResult.status==='fulfilled'
    ? organizationResult.value.warehouses.filter((warehouse)=>warehouse.is_active)
    : [];

  return (
    <AppShell
      title="Thanh toán nhà cung cấp"
      subtitle="Ghi nhận thanh toán, phân bổ vào chứng từ phải trả và đảo nghiệp vụ bằng lịch sử bất biến."
      kicker="Kế toán mua hàng"
    >
      <SupplierPaymentWorkspace
        initialPayments={paymentsResult.status==='fulfilled'?paymentsResult.value:[]}
        initialTargets={targetsResult.status==='fulfilled'?targetsResult.value:[]}
        suppliers={suppliersResult.status==='fulfilled'?suppliersResult.value.filter((supplier)=>supplier.is_active):[]}
        warehouses={warehouses}
        initialPaymentDate={localDate()}
        initialError={error}
      />
    </AppShell>
  );
}
