import Link from 'next/link';
import { AppShell } from '../components/app-shell';
import { loadOrganizationSnapshot } from '../../lib/organization-snapshot';
import { createEmptyOrganizationSnapshot, formatDateTime } from '../../lib/organization-types';
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
    return { data: [], error: publicError(error, 'Không tải được đơn bán hàng đang chờ hoàn tất') };
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
  const failed = results.some((result) => result.status === 'rejected');
  return {
    data: requests
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
      .slice(0, 20),
    error: failed ? 'Một phần danh sách xác minh khách hàng chưa tải được' : null,
  };
}

function onboardingStatus(status: string): string {
  if (status === 'submitted') return 'Mới gửi';
  if (status === 'under_review') return 'Đang xem xét';
  if (status === 'need_more_info') return 'Cần bổ sung';
  return status;
}

export default async function ManagementPage() {
  const [organizationResult, orders, onboarding] = await Promise.all([
    loadOrganizationSnapshot()
      .then((data) => ({ data, error: null as string | null }))
      .catch(() => ({ data: createEmptyOrganizationSnapshot(), error: 'Không tải được cơ cấu chi nhánh và kho' })),
    loadDraftOrders(),
    loadOnboardingQueue(),
  ]);

  const activeBranches = organizationResult.data.branches.filter((item) => item.is_active).length;
  const activeWarehouses = organizationResult.data.warehouses.filter((item) => item.is_active).length;
  const activeLocations = organizationResult.data.locations.filter((item) => item.is_active).length;

  return (
    <AppShell
      kicker="Điều hành dành cho chủ và quản lý"
      title="Tổng hợp việc cần xử lý"
      subtitle="Xem nhanh dữ liệu đang có và đi thẳng tới đúng màn hình nghiệp vụ."
      actions={<Link className={styles.link} href="/dashboard">Xem cơ cấu hệ thống</Link>}
    >
      <div className={styles.page} data-testid="management-overview-page">
        <p className={styles.notice}>
          Màn hình này chỉ đọc dữ liệu. Việc tạo, sửa hoặc duyệt vẫn thực hiện tại màn hình nghiệp vụ tương ứng.
        </p>

        <section className={styles.summaryGrid} aria-label="Tóm tắt vận hành">
          <article className={styles.summaryCard}><strong>{activeBranches}</strong><span>Chi nhánh đang hoạt động</span></article>
          <article className={styles.summaryCard}><strong>{activeWarehouses}</strong><span>Kho đang hoạt động</span></article>
          <article className={styles.summaryCard}><strong>{activeLocations}</strong><span>Vị trí kho đang hoạt động</span></article>
          <article className={styles.summaryCard}><strong>{orders.data.length + onboarding.data.length}</strong><span>Việc đang chờ trong danh sách gần nhất</span></article>
        </section>

        {organizationResult.error ? <p className={styles.error} role="alert">{organizationResult.error}</p> : null}

        <section className={styles.queueGrid}>
          <article className={styles.queueCard}>
            <header className={styles.queueHeader}>
              <div>
                <h2>Đơn bán hàng nháp</h2>
                <p>Các đơn đã tạo nhưng chưa xác nhận.</p>
              </div>
              <Link className={styles.link} href="/sales/sales-orders">Mở đơn bán hàng</Link>
            </header>
            {orders.error ? <p className={styles.error} role="alert">{orders.error}</p> : null}
            {orders.data.length === 0 && !orders.error ? <p className={styles.empty}>Không có đơn nháp trong danh sách gần nhất.</p> : null}
            <ul className={styles.list}>
              {orders.data.map((order) => (
                <li className={styles.item} key={order.id}>
                  <div className={styles.itemTop}>
                    <strong>{order.customerName || order.walkInDisplayName || 'Khách chưa đặt tên'}</strong>
                    <span className={styles.badge}>Chưa xác nhận</span>
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
                <h2>Đề nghị xác minh khách hàng</h2>
                <p>Các điểm bán đã phát sinh nhu cầu mua và cần xử lý mở hoặc liên kết mã.</p>
              </div>
              <Link className={styles.link} href="/customers">Mở danh mục khách hàng</Link>
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
