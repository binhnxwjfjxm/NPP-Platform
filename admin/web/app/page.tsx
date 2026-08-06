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
  const nppDailyWork = data.draftOrders.length + data.onboarding.length;

  return (
    <AdminShell
      activeSection="overview"
      kicker="Dành cho chủ và quản lý cấp cao"
      title="Tổng quan hôm nay"
      subtitle="Theo dõi nhanh toàn cảnh và các tình huống cần cấp quản lý xem xét."
    >
      {data.warnings.length > 0 ? (
        <p className="warning compactWarning" role="alert">Chưa tải được: {data.warnings.join(', ')}.</p>
      ) : null}

      <section className="card managementHero" aria-label="Việc cần cấp quản lý">
        <span className="managementHeroIcon"><AdminIcon name="exception" size={28} /></span>
        <div className="managementHeroCopy">
          <p>Việc cần quản lý</p>
          <h2>Chưa có hàng đợi ngoại lệ riêng</h2>
          <span>Khi backend phân loại đúng việc vượt quyền, danh sách sẽ xuất hiện tại đây.</span>
        </div>
        <Link className="managementHeroAction" href="/customer-onboarding">
          Mở ngoại lệ <AdminIcon name="chevronRight" size={18} />
        </Link>
      </section>

      <section className="metricGrid appMetricGrid" aria-label="Tóm tắt vận hành">
        <article className="card metricCard">
          <span className="iconBubble"><AdminIcon name="branch" /></span>
          <div className="metricCopy"><span>Chi nhánh</span><strong>{metric(data.branches)}</strong></div>
        </article>
        <article className="card metricCard">
          <span className="iconBubble"><AdminIcon name="warehouse" /></span>
          <div className="metricCopy"><span>Kho</span><strong>{metric(data.warehouses)}</strong></div>
        </article>
        <article className="card metricCard">
          <span className="iconBubble"><AdminIcon name="location" /></span>
          <div className="metricCopy"><span>Vị trí kho</span><strong>{metric(data.locations)}</strong></div>
        </article>
        <article className="card metricCard">
          <span className="iconBubble"><AdminIcon name="clipboard" /></span>
          <div className="metricCopy"><span>Việc ở NPP</span><strong>{nppDailyWork}</strong></div>
        </article>
      </section>

      <p className="sectionEyebrow">Cần xem trước</p>
      <section className="card dashboardCard priorityListCard">
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
      </section>

      <Link className="card overviewMenuLink" href="/menu">
        <span className="smallIconBubble"><AdminIcon name="menu" size={20} /></span>
        <span><strong>Thông tin ứng dụng</strong><small>Ranh giới quản lý, PWA và ứng dụng liên quan</small></span>
        <AdminIcon name="chevronRight" size={19} />
      </Link>
    </AdminShell>
  );
}
