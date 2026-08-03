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

const ONBOARDING_PAGE_SIZE = 100;
const CUSTOMER_PAGE_SIZE = 200;

type LoadResult<T> = {
  data: T;
  error: string | null;
};

async function loadAllRequestsForStatus(status: string): Promise<CustomerOnboardingRequestSummary[]> {
  const requests: CustomerOnboardingRequestSummary[] = [];
  const seen = new Set<string>();
  let offset = 0;

  while (true) {
    const batch = await listCustomerOnboardingRequests({
      requestId: resolveCustomerOnboardingRequestId(null),
      status,
      limit: ONBOARDING_PAGE_SIZE,
      offset,
    });
    let added = 0;
    for (const request of batch) {
      if (seen.has(request.id)) continue;
      seen.add(request.id);
      requests.push(request);
      added += 1;
    }
    if (batch.length < ONBOARDING_PAGE_SIZE || added === 0) break;
    offset += ONBOARDING_PAGE_SIZE;
  }

  return requests;
}

async function loadPendingRequests(): Promise<LoadResult<CustomerOnboardingRequestSummary[]>> {
  const statuses = ['submitted', 'under_review', 'need_more_info'] as const;
  const results = await Promise.allSettled(statuses.map(loadAllRequestsForStatus));
  const failedCount = results.filter((result) => result.status === 'rejected').length;
  const byId = new Map<string, CustomerOnboardingRequestSummary>();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const request of result.value) byId.set(request.id, request);
  }

  return {
    data: Array.from(byId.values())
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()),
    error: failedCount === results.length
      ? 'Không tải được danh sách đề nghị đang chờ.'
      : failedCount > 0
        ? 'Một phần danh sách đề nghị đang chờ chưa tải được.'
        : null,
  };
}

async function loadActiveCustomers(): Promise<LoadResult<Customer[]>> {
  try {
    const customers: Customer[] = [];
    const seen = new Set<string>();
    let offset = 0;

    while (true) {
      const batch = await listAllCustomers<Customer>(
        resolveCustomerRequestId(null),
        new URLSearchParams({
          active: 'true',
          limit: String(CUSTOMER_PAGE_SIZE),
          offset: String(offset),
        }),
      );
      let added = 0;
      for (const customer of batch) {
        if (!customer.is_active || seen.has(customer.id)) continue;
        seen.add(customer.id);
        customers.push(customer);
        added += 1;
      }
      if (batch.length < CUSTOMER_PAGE_SIZE || added === 0) break;
      offset += CUSTOMER_PAGE_SIZE;
    }

    return {
      data: customers.sort((left, right) => left.code.localeCompare(right.code, 'vi')),
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
