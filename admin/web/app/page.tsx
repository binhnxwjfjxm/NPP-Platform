import Link from 'next/link';
import { AdminShell } from './admin-shell';
import { loadOverview } from '@/lib/core-api';

export const dynamic = 'force-dynamic';

function metric(value: number | null): string | number {
  return value === null ? '—' : value;
}

function statusLabel(status: string): string {
  if (status === 'submitted') return 'Mới gửi';
  if (status === 'under_review') return 'Đang xem xét';
  if (status === 'need_more_info') return 'Cần bổ sung';
  return status;
}

export default async function AdminOverviewPage() {
  const data = await loadOverview().catch(() => ({
    branches: null,
    warehouses: null,
    locations: null,
    draftOrders: [],
    onboarding: [],
    warnings: ['toàn bộ dữ liệu điều hành'],
  }));

  return (
    <AdminShell
      kicker="Dành cho chủ và quản lý"
      title="Tổng hợp việc cần xử lý"
      subtitle="Xem nhanh trạng thái NPP và các đề nghị cần duyệt, không thay thế màn tác nghiệp đầy đủ."
      action={<Link className="actionLink" href="/customer-onboarding">Mở danh sách duyệt</Link>}
    >
      <p className="notice">Admin chỉ tổng hợp, cảnh báo và xử lý các bước duyệt nhỏ. Các thao tác vận hành đầy đủ tiếp tục nằm ở NPP Operations.</p>
      {data.warnings.length > 0 ? (
        <p className="warning" role="alert">Chưa tải được: {data.warnings.join(', ')}.</p>
      ) : null}

      <section className="grid4" aria-label="Tóm tắt vận hành">
        <article className="card metric"><strong>{metric(data.branches)}</strong><span>Chi nhánh hoạt động</span></article>
        <article className="card metric"><strong>{metric(data.warehouses)}</strong><span>Kho hoạt động</span></article>
        <article className="card metric"><strong>{metric(data.locations)}</strong><span>Vị trí kho hoạt động</span></article>
        <article className="card metric"><strong>{data.draftOrders.length + data.onboarding.length}</strong><span>Việc đang chờ gần nhất</span></article>
      </section>

      <section className="sectionGrid">
        <article className="card">
          <header className="sectionHeader">
            <div><h2>Đơn bán hàng nháp</h2><p>Các đơn đã tạo nhưng chưa xác nhận.</p></div>
            <a href={`${process.env.NPP_OPERATIONS_URL || 'https://office.nguyenlieuhungphat.com'}/sales/sales-orders`}>Mở NPP</a>
          </header>
          {data.draftOrders.length === 0 ? <p className="empty">Không có đơn nháp trong danh sách gần nhất.</p> : (
            <ul className="list">
              {data.draftOrders.slice(0, 10).map((row, index) => {
                const item = row && typeof row === 'object' ? row as Record<string, unknown> : {};
                return <li key={String(item.id || index)}><strong>{String(item.order_number || item.orderNumber || 'Đơn chưa có số')}</strong><small>{String(item.customer_name || item.customerName || 'Chưa có tên khách')}</small></li>;
              })}
            </ul>
          )}
        </article>

        <article className="card">
          <header className="sectionHeader">
            <div><h2>Đề nghị mở mã khách hàng</h2><p>Các đề nghị từ MCP đang chờ quyết định.</p></div>
            <Link href="/customer-onboarding">Xử lý</Link>
          </header>
          {data.onboarding.length === 0 ? <p className="empty">Không có đề nghị đang chờ.</p> : (
            <ul className="list">
              {data.onboarding.slice(0, 10).map((request) => (
                <li key={request.id}><strong>{request.proposedCustomer.name}</strong><small>{statusLabel(request.status)} · {new Date(request.updatedAt).toLocaleString('vi-VN')}</small></li>
              ))}
            </ul>
          )}
        </article>
      </section>
    </AdminShell>
  );
}
