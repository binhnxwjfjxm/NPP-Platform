import Link from 'next/link';
import { AdminShell } from './admin-shell';
import { loadOverview } from '@/lib/core-api';

export const dynamic = 'force-dynamic';

function metric(value: number | null): string | number {
  return value === null ? '—' : value;
}

export default async function AdminOverviewPage() {
  const data = await loadOverview().catch(() => ({
    branches: null,
    warehouses: null,
    locations: null,
    draftOrders: [],
    onboarding: [],
    warnings: ['toàn bộ dữ liệu tổng hợp'],
  }));
  const nppOperationsUrl = (process.env.NPP_OPERATIONS_URL?.trim() || 'https://npp-platform.vercel.app').replace(/\/$/, '');

  return (
    <AdminShell
      kicker="Dành cho chủ và quản lý cấp cao"
      title="Tổng hợp và ngoại lệ cấp quản lý"
      subtitle="Theo dõi toàn cảnh; công việc Sales Admin hằng ngày được xử lý trong NPP Operations."
      action={<a className="actionLink" href={`${nppOperationsUrl}/management`}>Mở NPP Operations</a>}
    >
      <p className="notice">
        Admin không tạo mã khách và không xác nhận mọi đơn hàng. Chỉ ngoại lệ vượt quyền mới được đưa lên hàng đợi cấp quản lý.
      </p>
      {data.warnings.length > 0 ? (
        <p className="warning" role="alert">Chưa tải được: {data.warnings.join(', ')}.</p>
      ) : null}

      <section className="grid4" aria-label="Tóm tắt vận hành">
        <article className="card metric"><strong>{metric(data.branches)}</strong><span>Chi nhánh hoạt động</span></article>
        <article className="card metric"><strong>{metric(data.warehouses)}</strong><span>Kho hoạt động</span></article>
        <article className="card metric"><strong>{metric(data.locations)}</strong><span>Vị trí kho hoạt động</span></article>
        <article className="card metric"><strong>{data.draftOrders.length + data.onboarding.length}</strong><span>Việc hằng ngày đang nằm ở NPP</span></article>
      </section>

      <section className="sectionGrid">
        <article className="card">
          <header className="sectionHeader">
            <div>
              <h2>Công việc hằng ngày của Sales Admin</h2>
              <p>Đơn nháp và đề nghị mở mã khách được xử lý tại NPP Operations.</p>
            </div>
            <a href={`${nppOperationsUrl}/management`}>Mở NPP</a>
          </header>
          <ul className="list">
            <li><strong>{data.draftOrders.length} đơn chờ xác nhận</strong><small>Kiểm tra và xác nhận trong màn Đơn bán hàng của NPP.</small></li>
            <li><strong>{data.onboarding.length} đề nghị mã khách</strong><small>Tạo mới hoặc liên kết khách hàng trong màn công việc hằng ngày của NPP.</small></li>
          </ul>
        </article>

        <article className="card">
          <header className="sectionHeader">
            <div>
              <h2>Việc cần cấp quản lý</h2>
              <p>Chỉ hiển thị đơn, khách, công nợ hoặc giá bị đẩy lên do vượt quy tắc.</p>
            </div>
            <Link href="/customer-onboarding">Xem ranh giới</Link>
          </header>
          <p className="empty">
            Backend hiện chưa phân loại hàng đợi ngoại lệ riêng. Admin tạm thời không hiển thị nút duyệt tác nghiệp hằng ngày để tránh CEO làm thay Sales Admin.
          </p>
        </article>
      </section>
    </AdminShell>
  );
}
