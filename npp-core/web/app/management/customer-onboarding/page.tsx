import Link from 'next/link';
import { AppShell } from '../../components/app-shell';
import {
  getCustomerOnboardingPortalOptions,
  listCustomerOnboardingRequests,
  resolveCustomerOnboardingRequestId,
  type CustomerOnboardingRequestSummary,
  type CustomerPortalActivationOptions,
} from '../../../lib/customer-onboarding-gateway';
import { listAllCustomers, resolveCustomerRequestId } from '../../../lib/customer-gateway';
import { listAllEmployees, resolveEmployeeRequestId } from '../../../lib/employee-gateway';
import type { Customer } from '../../../lib/customer-types';
import type { Employee } from '../../../lib/employee-types';
import CustomerOnboardingReview, {
  type CustomerOnboardingSourcePresentation,
} from './customer-onboarding-review';

export const dynamic = 'force-dynamic';

const ONBOARDING_PAGE_SIZE = 100;
const CUSTOMER_PAGE_SIZE = 200;
const EMPTY_PORTAL_OPTIONS: CustomerPortalActivationOptions = { warehouses: [], salesChannels: [] };

type LoadResult<T> = {
  data: T;
  error: string | null;
};

type RequestSourceFields = {
  requestedByEmployeeId?: string | null;
  sourceMetadata?: unknown;
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

async function loadEmployees(): Promise<LoadResult<Employee[]>> {
  try {
    return {
      data: await listAllEmployees<Employee>(resolveEmployeeRequestId(null)),
      error: null,
    };
  } catch {
    return {
      data: [],
      error: 'Không tải được tên nhân viên đưa khách về.',
    };
  }
}

async function loadPortalOptions(enabled: boolean): Promise<LoadResult<CustomerPortalActivationOptions>> {
  if (!enabled) return { data: EMPTY_PORTAL_OPTIONS, error: null };
  try {
    return {
      data: await getCustomerOnboardingPortalOptions(resolveCustomerOnboardingRequestId(null)),
      error: null,
    };
  } catch {
    return {
      data: EMPTY_PORTAL_OPTIONS,
      error: 'Không tải được danh sách kho/kênh bán để kích hoạt tài khoản khách hàng.',
    };
  }
}

function sourceMetadata(request: CustomerOnboardingRequestSummary): Record<string, unknown> {
  const metadata = (request as CustomerOnboardingRequestSummary & RequestSourceFields).sourceMetadata;
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};
}

function sourcePresentation(
  request: CustomerOnboardingRequestSummary,
  employeeById: Map<string, Employee>,
): CustomerOnboardingSourcePresentation {
  if (request.sourceSystem === 'CUSTOMER_PORTAL') {
    return {
      channelLabel: 'Ordering · Khách trực tiếp',
      broughtByLabel: 'Khách tự đăng ký',
      outletLabel: null,
      reasonLabel: 'Đăng ký tài khoản đặt hàng',
    };
  }

  const requestSource = request as CustomerOnboardingRequestSummary & RequestSourceFields;
  const employee = requestSource.requestedByEmployeeId
    ? employeeById.get(requestSource.requestedByEmployeeId)
    : null;
  const metadata = sourceMetadata(request);
  const routeName = typeof metadata.routeName === 'string' ? metadata.routeName.trim() : '';

  return {
    channelLabel: 'MCP Field',
    broughtByLabel: employee ? `${employee.code} — ${employee.full_name}` : 'Nhân viên MCP',
    outletLabel: routeName || request.proposedCustomer.name,
    reasonLabel: request.sourceDemandReference === 'FIELD_PROFILE_VERIFICATION'
      ? 'Đề nghị mở / liên kết mã khách hàng'
      : 'Đề nghị tạo mã để phục vụ đơn hàng',
  };
}

export default async function CustomerOnboardingReviewPage() {
  const [requests, customers, employees] = await Promise.all([
    loadPendingRequests(),
    loadActiveCustomers(),
    loadEmployees(),
  ]);
  const portalOptions = await loadPortalOptions(
    requests.data.some((request) => request.sourceSystem === 'CUSTOMER_PORTAL'),
  );
  const employeeById = new Map(employees.data.map((employee) => [employee.id, employee]));
  const sourcePresentationByRequest = Object.fromEntries(
    requests.data.map((request) => [request.id, sourcePresentation(request, employeeById)]),
  );

  return (
    <AppShell
      kicker="Công việc hằng ngày của Bộ phận bán hàng"
      title="Tạo hoặc liên kết mã khách hàng"
      subtitle="Xem thông tin điểm bán và quyết định tạo mã mới, liên kết khách có sẵn hoặc yêu cầu bổ sung ngay trong Hệ thống Công Ty."
      actions={<Link href="/management">Quay lại công việc hằng ngày</Link>}
    >
      {requests.error ? <p role="alert">{requests.error}</p> : null}
      {customers.error ? <p role="alert">{customers.error}</p> : null}
      {employees.error ? <p role="alert">{employees.error}</p> : null}
      {portalOptions.error ? <p role="alert">{portalOptions.error}</p> : null}
      <CustomerOnboardingReview
        requests={requests.data}
        customers={customers.data}
        portalOptions={portalOptions.data}
        sourcePresentationByRequest={sourcePresentationByRequest}
      />
    </AppShell>
  );
}
