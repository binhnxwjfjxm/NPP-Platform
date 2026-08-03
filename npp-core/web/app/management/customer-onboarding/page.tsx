import Link from 'next/link';
import { AppShell } from '../../components/app-shell';
import {
  listCustomerOnboardingRequests,
  resolveCustomerOnboardingRequestId,
  type CustomerOnboardingRequestSummary,
} from '../../../lib/customer-onboarding-gateway';
import { listAllCustomers, resolveCustomerRequestId } from '../../../lib/customer-gateway';
import type { Customer } from '../../../lib/customer-types';
import CustomerOnboardingReview from './customer-onboarding-review';

export const dynamic = 'force-dynamic';

type LoadResult<T> = {
  data: T;
  error: string | null;
};

async function loadPendingRequests(): Promise<LoadResult<CustomerOnboardingRequestSummary[]>> {
  const statuses = ['submitted', 'under_review', 'need_more_info'] as const;
  const results = await Promise.allSettled(statuses.map((status) => listCustomerOnboardingRequests({
    requestId: resolveCustomerOnboardingRequestId(null),
    status,
    limit: 100,
  })));
  const failedCount = results.filter((result) => result.status === 'rejected').length;
  const requests = results
    .flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());

  return {
    data: requests,
    error: failedCount === results.length
      ? 'Không tải được danh sách đề nghị đang chờ.'
      : failedCount > 0
        ? 'Một phần danh sách đề nghị đang chờ chưa tải được.'
        : null,
  };
}

async function loadActiveCustomers(): Promise<LoadResult<Customer[]>> {
  try {
    const customers = await listAllCustomers<Customer>(
      resolveCustomerRequestId(null),
      new URLSearchParams({ active: 'true', limit: '200' }),
    );
    return {
      data: customers.filter((customer) => customer.is_active),
      error: null,
    };
  } catch {
    return {
      data: [],
      error: 'Không tải được danh sách khách hàng có sẵn để liên kết.',
    };
  }
}

export default async function CustomerOnboardingReviewPage() {
  const [requests, customers] = await Promise.all([
    loadPendingRequests(),
    loadActiveCustomers(),
  ]);

  return (
    <AppShell
      kicker="Quản lý khách hàng"
      title="Xử lý đề nghị mở mã khách hàng"
      subtitle="Xem thông tin điểm bán và quyết định tạo mã mới, liên kết khách có sẵn hoặc yêu cầu bổ sung."
      actions={<Link href="/management">Quay lại tổng hợp</Link>}
    >
      {requests.error ? <p role="alert">{requests.error}</p> : null}
      {customers.error ? <p role="alert">{customers.error}</p> : null}
      <CustomerOnboardingReview requests={requests.data} customers={customers.data} />
    </AppShell>
  );
}
