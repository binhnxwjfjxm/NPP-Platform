import Link from 'next/link';
import { AppShell } from '../components/app-shell';
import styles from './dashboard.module.css';
import { loadOrganizationSnapshot } from '../../lib/organization-snapshot';
import {
  createEmptyOrganizationSnapshot,
  formatCompactNumber,
} from '../../lib/organization-types';

export const dynamic = 'force-dynamic';

type ShortcutIcon = 'sales' | 'purchasing' | 'inventory' | 'logistics' | 'accounting' | 'reporting' | 'customer';

const shortcutGroups = [
  {
    id: 'sales',
    title: 'Bán hàng & khách hàng',
    items: [
      { href: '/management', label: 'Điều hành bán hàng', icon: 'sales' },
      { href: '/sales/sales-orders', label: 'Đơn bán hàng', icon: 'sales' },
      { href: '/customers', label: 'Khách hàng', icon: 'customer' },
      { href: '/management/customer-onboarding', label: 'Mở / liên kết mã khách', icon: 'customer' },
    ],
  },
  {
    id: 'purchasing-inventory',
    title: 'Mua hàng & kho',
    items: [
      { href: '/purchasing/purchase-orders', label: 'Đơn đặt hàng', icon: 'purchasing' },
      { href: '/purchasing/goods-receipts', label: 'Phiếu nhận hàng', icon: 'purchasing' },
      { href: '/inventory/fulfillment', label: 'Chuẩn bị hàng', icon: 'inventory' },
      { href: '/inventory/balances', label: 'Tra cứu tồn kho', icon: 'inventory' },
    ],
  },
  {
    id: 'logistics-accounting',
    title: 'Giao hàng & công nợ',
    items: [
      { href: '/inventory/delivery-orders', label: 'Phiếu giao hàng', icon: 'logistics' },
      { href: '/logistics/trips', label: 'Lập & xếp chuyến', icon: 'logistics' },
      { href: '/accounting/receivables', label: 'Công nợ phải thu', icon: 'accounting' },
      { href: '/accounting/customer-payments', label: 'Thu tiền khách hàng', icon: 'accounting' },
    ],
  },
  {
    id: 'reporting',
    title: 'Báo cáo điều hành',
    items: [
      { href: '/sales/reporting', label: 'Báo cáo bán hàng', icon: 'reporting' },
      { href: '/purchasing/reporting', label: 'Báo cáo mua hàng', icon: 'reporting' },
      { href: '/inventory/reporting', label: 'Báo cáo tồn kho', icon: 'reporting' },
      { href: '/logistics/reporting', label: 'Hiệu suất giao hàng', icon: 'reporting' },
      { href: '/accounting/aging', label: 'Tuổi nợ', icon: 'reporting' },
    ],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  title: string;
  items: ReadonlyArray<{ href: string; label: string; icon: ShortcutIcon }>;
}>;

function ShortcutGlyph({ icon }: { icon: ShortcutIcon }) {
  const path = {
    sales: <><path d="M5 6h14v12H5z" /><path d="M8 10h8M8 14h5" /></>,
    purchasing: <><path d="M6 5h12l-1 14H7z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>,
    inventory: <><path d="m4 8 8-4 8 4-8 4z" /><path d="m4 8v8l8 4 8-4V8M12 12v8" /></>,
    logistics: <><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></>,
    accounting: <><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M8 8h8M8 12h6M8 16h4" /></>,
    reporting: <><path d="M5 19V9M12 19V5M19 19v-7" /><path d="M3 19h18" /></>,
    customer: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></>,
  }[icon];

  return (
    <span className={styles.shortcutIcon} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {path}
      </svg>
    </span>
  );
}

export default async function DashboardPage() {
  let snapshot = createEmptyOrganizationSnapshot();
  let initialError: string | null = null;

  try {
    snapshot = await loadOrganizationSnapshot();
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được dữ liệu tổng quan';
  }

  const metrics = [
    {
      id: 'branches',
      label: 'Chi nhánh',
      total: snapshot.branches.length,
      active: snapshot.branches.filter((item) => item.is_active).length,
    },
    {
      id: 'warehouses',
      label: 'Kho hàng',
      total: snapshot.warehouses.length,
      active: snapshot.warehouses.filter((item) => item.is_active).length,
    },
    {
      id: 'locations',
      label: 'Vị trí kho',
      total: snapshot.locations.length,
      active: snapshot.locations.filter((item) => item.is_active).length,
    },
  ] as const;

  return (
    <AppShell
      title="Tổng quan điều hành"
      subtitle="Đi thẳng tới công việc cần xử lý và giữ lại các chỉ số nền thực sự hữu ích."
      kicker="Điều hành nhanh"
    >
      <main className={styles.page} data-testid="dashboard-launchpad-page">
        {initialError ? (
          <div className={styles.dataNotice} role="status" data-testid="dashboard-kpi-stale">
            KPI cơ cấu chưa cập nhật: {initialError}. Các lối tắt nghiệp vụ vẫn sử dụng bình thường.
          </div>
        ) : null}

        <section className={styles.metrics} aria-labelledby="dashboard-metrics-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Nhịp hệ thống</p>
              <h2 id="dashboard-metrics-title">Cơ cấu đang hoạt động</h2>
            </div>
            <Link href="/organization" className={styles.inlineLink}>Xem cơ cấu</Link>
          </div>

          <div className={styles.metricGrid}>
            {metrics.map((metric) => (
              <article key={metric.id} className={styles.metric} data-testid={`dashboard-metric-${metric.id}`}>
                <span>{metric.label}</span>
                <strong>{formatCompactNumber(metric.active)}</strong>
                <small>{formatCompactNumber(metric.total)} tổng cộng</small>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.launchpad} aria-labelledby="dashboard-launchpad-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Lối tắt nghiệp vụ</p>
              <h2 id="dashboard-launchpad-title">Mở đúng việc, không qua màn trung gian</h2>
            </div>
          </div>

          <div className={styles.groups}>
            {shortcutGroups.map((group) => (
              <section key={group.id} className={styles.group} data-testid={`dashboard-group-${group.id}`}>
                <h3>{group.title}</h3>
                <div className={styles.shortcutGrid}>
                  {group.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={styles.shortcut}
                      data-testid={`dashboard-shortcut-${item.href.replaceAll('/', '-').replace(/^-+/, '')}`}
                    >
                      <ShortcutGlyph icon={item.icon} />
                      <span>{item.label}</span>
                      <svg className={styles.arrow} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="m9 6 6 6-6 6" />
                      </svg>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      </main>
    </AppShell>
  );
}
