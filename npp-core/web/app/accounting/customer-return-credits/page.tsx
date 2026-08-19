import { AppShell } from '../../components/app-shell';
import {
  getCustomerReturnCredit,
  listCustomerReturnCredits,
  resolveCustomerReturnCreditRequestId,
} from '../../../lib/customer-return-credit-gateway';
import type { CustomerReturnCredit } from '../../../lib/customer-return-credit-types';
import { listCustomerPaymentTargets } from '../../../lib/customer-payment-gateway';
import type { ReceivableAllocationTarget } from '../../../lib/customer-payment-types';
import CustomerReturnCreditWorkspace from './customer-return-credit-workspace';

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

export default async function CustomerReturnCreditsPage() {
  const requestId = resolveCustomerReturnCreditRequestId(null);
  const [creditsResult, targetsResult] = await Promise.allSettled([
    listCustomerReturnCredits<CustomerReturnCredit>(requestId, { limit: 1000 }),
    listCustomerPaymentTargets<ReceivableAllocationTarget>(requestId),
  ]);

  let error = [creditsResult, targetsResult].some((result) => result.status === 'rejected')
    ? 'Một phần dữ liệu điều chỉnh công nợ hàng trả chưa tải được. Hãy cập nhật lại trang trước khi thao tác.'
    : null;
  let credits = creditsResult.status === 'fulfilled' ? creditsResult.value : [];
  if (credits[0]) {
    try {
      const detail = await getCustomerReturnCredit<CustomerReturnCredit>(credits[0].id, requestId);
      credits = [detail, ...credits.slice(1)];
    } catch {
      error ??= 'Không tải được chi tiết khoản giảm công nợ đầu tiên. Hãy chọn lại chứng từ trước khi thao tác.';
    }
  }

  return (
    <AppShell
      title="Điều chỉnh công nợ hàng trả"
      subtitle="Khoản giảm công nợ chỉ phát sinh khi kho đã nhận phiếu hàng khách trả; phần chưa sử dụng có thể phân bổ hoặc hoàn tiền bằng chứng từ riêng."
      kicker="Kế toán bán hàng"
    >
      <CustomerReturnCreditWorkspace
        initialCredits={credits}
        initialTargets={targetsResult.status === 'fulfilled' ? targetsResult.value : []}
        initialDate={localDate()}
        initialError={error}
      />
    </AppShell>
  );
}
