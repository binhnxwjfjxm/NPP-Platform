import Link from 'next/link';
import { AdminIcon } from './admin-icons';
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

  return (
    <AdminShell
      activeSection="overview"
      kicker="Dành cho chủ và quản lý cấp cao"
      title="Tổng quan quản lý"
      subtitle="Theo dõi toàn cảnh; công việc Sales Admin hằng ngày được xử lý trong NPP Operations."
    >
      <section className="noticePanel" aria-label="Ranh giới vận hành">
        <span className="noticeIcon"><AdminIcon name="info" size={24} /></span>
        <p>
          <strong>Admin không tạo mã khách và không xác nhận mọi đơn hàng.</strong>
          <span>Chỉ ngoại lệ vượt quyền mới được đưa lên hàng đợi cấp quản lý.</span>
        </p>
      </section>

      {data.warnings.length > 0 ? (
        <p className="warning" role="alert">Chưa tải được: {data.warnings.join(', ')}.</p>
      ) : null}

      <section className="metricGrid" aria-label="Tóm tắt vận hành">
        <article className="card metricCard">
          <span className="iconBubble"><AdminIcon name="branch" /></span>
          <div className="metricCopy"><span>Chi nhánh hoạt động</span><strong>{metric(data.branches)}</strong></div>
        </article>
        <article className="card metricCard">
          <span className="iconBubble"><AdminIcon name="warehouse" /></span>
          <div className="metricCopy"><span>Kho hoạt động</span><strong>{metric(data.warehouses)}</strong></div>
        </article>
        <article className="card metricCard">
          <span className="iconBubble"><AdminIcon name="location" /></span>
          <div className="metricCopy"><span>Vị trí kho hoạt động</span><strong>{metric(data.locations)}</strong></div>
        </article>
        <article className="card metricCard">
          <span className="iconBubble"><AdminIcon name="clipboard" /></span>
          <div className="metricCopy"><span>Việc hằng ngày ở NPP</span><strong>{data.draftOrders.length + data.onboarding.length}</strong></div>
        </article>
      </section>

      <section className="dashboardGrid">
        <article className="card dashboardCard">
          <header className="cardHeader">
            <div className="cardHeading">
              <span className="smallIconBubble"><AdminIcon name="clipboard" size={20} /></span>
              <div><h2>Việc cần cấp quản lý</h2><p>Chỉ hiển thị dữ liệu khi backend phân loại đúng ngoại lệ.</p></div>
            </div>
            <Link className="iconLink" href="/customer-onboarding" aria-label="Mở ranh giới ngoại lệ">
              <AdminIcon name="chevronRight" size={20} />
            </Link>
          </header>
          <div className="managementList">
            <Link className="managementRow" href="/customer-onboarding">
              <span className="rowIcon"><AdminIcon name="tag" size={20} /></span>
              <span className="rowLabel">Ngoại lệ giá</span>
              <span className="rowValue isUnavailable">—</span>
              <AdminIcon className="rowChevron" name="chevronRight" size={19} />
            </Link>
            <Link className="managementRow" href="/customer-onboarding">
              <span className="rowIcon"><AdminIcon name="user" size={20} /></span>
              <span className="rowLabel">Ngoại lệ khách hàng</span>
              <span className="rowValue isUnavailable">—</span>
              <AdminIcon className="rowChevron" name="chevronRight" size={19} />
            </Link>
            <Link className="managementRow" href="/customer-onboarding">
              <span className="rowIcon"><AdminIcon name="coin" size={20} /></span>
              <span className="rowLabel">Công nợ vượt ngưỡng</span>
              <span className="rowValue isUnavailable">—</span>
              <AdminIcon className="rowChevron" name="chevronRight" size={19} />
            </Link>
          </div>
          <footer className="cardFooter">
            <Link href="/customer-onboarding">Xem ranh giới ngoại lệ <AdminIcon name="chevronRight" size={17} /></Link>
          </footer>
        </article>

        <article className="card dashboardCard">
          <header className="cardHeader">
            <div className="cardHeading">
              <span className="smallIconBubble"><AdminIcon name="operations" size={20} /></span>
              <div><h2>Vai trò ứng dụng</h2><p>Mỗi ứng dụng giữ đúng phần việc của mình.</p></div>
            </div>
          </header>
          <div className="applicationList">
            <div className="applicationRow">
              <span className="rowIcon"><AdminIcon name="exception" size={20} /></span>
              <span><strong>Admin MCP/NPP</strong><small>Tổng hợp và ngoại lệ cấp quản lý</small></span>
              <span className="rolePill">Quản lý</span>
            </div>
            <div className="applicationRow">
              <span className="rowIcon"><AdminIcon name="operations" size={20} /></span>
              <span><strong>NPP Operations</strong><small>Xử lý nghiệp vụ hằng ngày</small></span>
              <span className="rolePill">Vận hành</span>
            </div>
            <div className="applicationRow">
              <span className="rowIcon"><AdminIcon name="mobile" size={20} /></span>
              <span><strong>MCP Field</strong><small>Tác nghiệp thị trường</small></span>
              <span className="rolePill">Thị trường</span>
            </div>
            <div className="applicationRow">
              <span className="rowIcon"><AdminIcon name="truck" size={20} /></span>
              <span><strong>Delivery</strong><small>Tác nghiệp giao hàng</small></span>
              <span className="rolePill">Giao nhận</span>
            </div>
          </div>
        </article>
      </section>

      <section className="card nppSummaryCard" aria-label="Công việc hằng ngày trong NPP">
        <header className="cardHeader compactCardHeader">
          <div className="cardHeading">
            <span className="smallIconBubble"><AdminIcon name="clipboard" size={20} /></span>
            <div><h2>Công việc hằng ngày đang nằm ở NPP</h2><p>Admin chỉ tổng hợp, không thay Sales Admin xử lý các việc này.</p></div>
          </div>
        </header>
        <div className="nppSummaryGrid">
          <article className="summaryItem">
            <span className="iconBubble"><AdminIcon name="document" /></span>
            <span className="summaryCopy"><strong>Đơn chờ xác nhận</strong><span><b>{data.draftOrders.length}</b> đơn</span></span>
          </article>
          <article className="summaryItem">
            <span className="iconBubble"><AdminIcon name="userPlus" /></span>
            <span className="summaryCopy"><strong>Đề nghị mở mã khách</strong><span><b>{data.onboarding.length}</b> yêu cầu</span></span>
          </article>
        </div>
      </section>
    </AdminShell>
  );
}
