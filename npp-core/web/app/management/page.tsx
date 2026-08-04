import Link from 'next/link';
import { AppShell } from '../components/app-shell';
import { loadOrganizationSnapshotWithStatus } from '../../lib/organization-snapshot';
import { createEmptyOrganizationSnapshot, formatDateTime } from '../../lib/organization-types';
import type { OrganizationResourceKey } from '../../lib/organization-types';
import {
  listCustomerOnboardingRequests,
  resolveCustomerOnboardingRequestId,
  type CustomerOnboardingRequestSummary,
} from '../../lib/customer-onboarding-gateway';
import { listSalesOrders, resolveSalesOrderRequestId } from '../../lib/sales-order-gateway';
import type { SalesOrder } from '../../lib/sales-order-types';
import styles from './management.module.css';

export const dynamic = 'force-dynamic';

type LoadResult<T> = {
  data: T;
  error: string | null;
};

function publicError(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'publicMessage' in error) {
    const message = (error as { publicMessage?: unknown }).publicMessage;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

async function loadDraftOrders(): Promise<LoadResult<SalesOrder[]>> {
  try {
    return {
      data: await listSalesOrders<SalesOrder>(resolveSalesOrderRequestId(null), {
        status: 'draft',
        limit: 20,
      }),
      error: null,
    };
  } catch (error) {
    return { data: [], error: publicError(error, 'Không tải được đơn bán hàng đang chờ xác nhận') };
  }
}

async function loadOnboardingQueue(): Promise<LoadResult<CustomerOnboardingRequestSummary[]>> {
  const statuses = ['submitted', 'under_review', 'need_more_info'] as const;
  const results = await Promise.allSettled(statuses.map((status) => listCustomerOnboardingRequests({
    requestId: resolveCustomerOnboardingRequestId(null),
    status,
    limit: 20,
  })));
  const requests = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  const failedCount = results.filter((result) => result.status === 'rejected').length;
  return {
    data: requests
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
      .slice(0, 20),
    error: failedCount === results.length
      ? 'Không tải được danh sách đề nghị mở mã khách hàng'
      : failedCount > 0
        ? 'Một phần danh sách đề nghị mở mã khách hàng chưa tải được'
        : null,
  };
}

function onboardingStatus(status: string): string {
  if (status === 'submitted') return 'Mới gửi';
  if (status === 'under_review') return 'Đang xem xét';
  if (status === 'need_more_info') return 'Cần bổ sung';
  return status;
}

function organizationMetric(
  unavailable: OrganizationResourceKey[],
  resource: OrganizationResourceKey,
  value: number,
): number | string {
  return unavailable.includes(resource) ? '—' : value;
}

function organizationLoadMessage(unavailable: OrganizationResourceKey[]): string | null {
  if (unavailable.length === 0) return null;
  const labels: Record<OrganizationResourceKey, string> = {
    branches: 'chi nhánh',
    warehouses: 'kho',
    locations: 'vị trí kho',
  };
  return `Chưa tải được số liệu ${unavailable.map((resource) => labels[resource]).join(', ')}.`;
}

export default async function ManagementPage() {
  const [organizationResult, orders, onboarding] = await Promise.all([
    loadOrganizationSnapshotWithStatus()
      .then(({ snapshot, unavailable }) => ({
        data: snapshot,
        unavailable,
        error: organizationLoadMessage(unavailable),
      }))
      .catch(() => ({
        data: createEmptyOrganizationSnapshot(),
        unavailable: ['branches', 'warehouses', 'locations'] as OrganizationResourceKey[],
        error: 'Không tải được cơ cấu chi nhánh và kho',
      })),
    loadDraftOrders(),
    loadOnboardingQueue(),
  ]);

  const activeBranches = organizationResult.data.branches.filter((item) => item.is_active).length;
  const activeWarehouses = organizationResult.data.warehouses.filter((item) => item.is_active).length;
  const activeLocations = organizationResult.data.locations.filter((item) => item.is_active).length;

  return (
    <AppShell
      kicker="Công việc hằng ngày của Sales Admin"
      title="Đơn hàng và mã khách cần xử lý"
      subtitle="Xác nhận đơn thông thường, tạo hoặc liên kết mã khách và theo dõi trạng thái xử lý ngay trong NPP Operations."
      actions={<Link className={styles.link} href="/organization">Xem cơ cấu hệ thống</Link>}
    >
      <div className={styles.page} data-testid="management-overview-page">
        <p className={styles.notice}>
          Đây là màn tác nghiệp hằng ngày của Sales Admin, CS và kế toán. Chỉ ngoại lệ vượt quyền mới chuyển lên Admin cấp quản lý.
        </p>

        <section className={styles.summaryGrid} aria-label="Tóm tắt vận hành">
          <article className={styles.summaryCard}>
            <strong>{organizationMetric(organizationResult.unavailable, 'branches', activeBranches)}</strong>
            <span>Chi nhánh đang hoạt động</span>
          </article>
          <article className={styles.summaryCard}>
            <strong>{organizationMetric(organizationResult.unavailable, 'warehouses', activeWarehouses)}</strong>
            <span>Kho đang hoạt động</span>
          </article>
          <article className={styles.summaryCard}>
            <strong>{organizationMetric(organizationResult.unavailable, 'locations', activeLocations)}</strong>
            <span>Vị trí kho đang hoạt động</span>
          </article>
          <article className={styles.summaryCard}>
            <strong>{orders.data.length + onboarding.data.length}</strong>
            <span>Việc hằng ngày đang chờ</span>
          </article>
        </section>

        {organizationResult.error ? <p className={styles.error} role="alert">{organizationResult.error}</p> : null}

        <section className={styles.queueGrid}>
          <article className={styles.queueCard}>
            <header className={styles.queueHeader}>
              <div>
                <h2>Đơn chờ xác nhận hằng ngày</h2>
                <p>Các đơn nháp thông thường cần Sales Admin kiểm tra và xác nhận.</p>
              </div>
              <Link className={styles.link} href="/sales/sales-orders">Mở màn xác nhận</Link>
            </header>
            {orders.error ? <p className={styles.error} role="alert">{orders.error}</p> : null}
            {orders.data.length === 0 && !orders.error ? <p className={styles.empty}>Không có đơn nháp trong danh sách gần nhất.</p> : null}
            <ul className={styles.list}>
              {orders.data.map((order) => (
                <li className={styles.item} key={order.id}>
                  <div className={styles.itemTop}>
                    <strong>{order.customerName || order.walkInDisplayName || 'Khách chưa đặt tên'}</strong>
                    <span className={styles.badge}>Chờ xác nhận</span>
                  </div>
                  <span className={styles.meta}>{order.warehouseName} · {order.sourceType}</span>
                  <small>Cập nhật {formatDateTime(order.updatedAt)}</small>
                </li>
              ))}
            </ul>
          </article>

          <article className={styles.queueCard}>
            <header className={styles.queueHeader}>
              <div>
                <h2>Đề nghị mở hoặc liên kết mã khách</h2>
                <p>Các điểm bán đã phát sinh nhu cầu mua và cần xử lý thành khách hàng chính thức.</p>
              </div>
              <Link className={styles.link} href="/management/customer-onboarding">Mở màn xử lý</Link>
            </header>
            {onboarding.error ? <p className={styles.error} role="alert">{onboarding.error}</p> : null}
            {onboarding.data.length === 0 && !onboarding.error ? <p className={styles.empty}>Không có đề nghị đang chờ trong danh sách gần nhất.</p> : null}
            <ul className={styles.list}>
              {onboarding.data.map((request) => (
                <li className={styles.item} key={request.id}>
                  <div className={styles.itemTop}>
                    <strong>{request.proposedCustomer.name}</strong>
                    <span className={styles.badge}>{onboardingStatus(request.status)}</span>
                  </div>
                  <span className={styles.meta}>
                    {request.proposedCustomer.address.addressLine1}
                    {request.proposedCustomer.address.ward ? `, ${request.proposedCustomer.address.ward}` : ''}
                    {request.proposedCustomer.address.province ? `, ${request.proposedCustomer.address.province}` : ''}
                  </span>
                  <small>Cập nhật {formatDateTime(request.updatedAt)}</small>
                </li>
              ))}
            </ul>
          </article>
        </section>
      </div>
    </AppShell>
  );
}
