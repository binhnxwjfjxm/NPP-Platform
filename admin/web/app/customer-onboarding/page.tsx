import Link from 'next/link';
import { AdminShell } from '../admin-shell';
import { listCustomers, loadPendingOnboarding } from '@/lib/core-api';
import CustomerOnboardingReview from './review';

export const dynamic = 'force-dynamic';

export default async function CustomerOnboardingPage() {
  const [requestsResult, customersResult] = await Promise.allSettled([
    loadPendingOnboarding(),
    listCustomers(),
  ]);
  const requests = requestsResult.status === 'fulfilled' ? requestsResult.value : [];
  const customers = customersResult.status === 'fulfilled'
    ? customersResult.value.sort((left, right) => left.code.localeCompare(right.code, 'vi'))
    : [];

  return (
    <AdminShell
      kicker="Duyệt khách hàng"
      title="Xử lý đề nghị mở mã khách hàng"
      subtitle="Tạo mã mới, liên kết khách có sẵn hoặc yêu cầu bổ sung theo đúng luồng NPP Core."
      action={<Link className="actionLink" href="/">Quay lại tổng hợp</Link>}
    >
      {requestsResult.status === 'rejected' ? <p className="warning" role="alert">Không tải được danh sách đề nghị đang chờ.</p> : null}
      {customersResult.status === 'rejected' ? <p className="warning" role="alert">Không tải được danh sách khách hàng có sẵn để liên kết.</p> : null}
      <CustomerOnboardingReview requests={requests} customers={customers} />
    </AdminShell>
  );
}
