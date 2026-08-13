import Link from 'next/link';
import { AppShell } from '../components/app-shell';
import { DashboardOperations } from './dashboard-operations';
import type { DashboardReports, DashboardStructureMetric } from './dashboard-report-types';
import styles from './dashboard.module.css';
import { loadOrganizationSnapshot } from '../../lib/organization-snapshot';
import { createEmptyOrganizationSnapshot, formatCompactNumber } from '../../lib/organization-types';
import { getReportingDashboard, resolveReportingRequestId } from '../../lib/reporting-dashboard-gateway';
import { getInventoryReportingDashboard, resolveInventoryReportingRequestId } from '../../lib/inventory-reporting-gateway';
import { getLogisticsDashboard, resolveLogisticsReportingRequestId } from '../../lib/logistics-reporting-gateway';
import { getAgingDashboard, resolveFinanceReportingRequestId } from '../../lib/finance-reporting-gateway';

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

const shortcuts = shortcutGroups.flatMap((group) =>
  group.items.map((item) => ({ ...item, group: group.title, groupId: group.id })),
);

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

async function loadDashboardReports(): Promise<{ reports: DashboardReports; errors: string[] }> {
  const [sales, inventory, logistics, aging] = await Promise.allSettled([
    getReportingDashboard('sales', resolveReportingRequestId(null)),
    getInventoryReportingDashboard(resolveInventoryReportingRequestId(null)),
    getLogisticsDashboard(resolveLogisticsReportingRequestId(null)),
    getAgingDashboard(resolveFinanceReportingRequestId(null)),
  ]);

  const reports: DashboardReports = {};
  const errors: string[] = [];
  if (sales.status === 'fulfilled') reports.sales = sales.value; else errors.push('bán hàng');
  if (inventory.status === 'fulfilled') reports.inventory = inventory.value; else errors.push('tồn kho');
  if (logistics.status === 'fulfilled') reports.logistics = logistics.value; else errors.push('giao hàng');
  if (aging.status === 'fulfilled') reports.aging = aging.value; else errors.push('công nợ');
  return { reports, errors };
}

export default async function DashboardPage() {
  let snapshot = createEmptyOrganizationSnapshot();
  let initialError: string | null = null;

  try {
    snapshot = await loadOrganizationSnapshot();
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được dữ liệu tổng quan';
  }

  const { reports, errors: reportErrors } = await loadDashboardReports();
  const metrics: readonly DashboardStructureMetric[] = [
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
  ];

  return (
    <AppShell
      title="Tổng quan điều hành"
      subtitle="Đi thẳng tới công việc cần xử lý, đồng thời nhìn được các chỉ số vận hành quan trọng trên cùng một màn hình."
      kicker="Điều hành nhanh"
    >
      <main className={styles.page} data-testid="dashboard-launchpad-page">
        {initialError ? (
          <div className={styles.dataNotice} role="status" data-testid="dashboard-kpi-stale">
            KPI cơ cấu chưa cập nhật: {initialError}. Các lối tắt nghiệp vụ vẫn sử dụng bình thường.
          </div>
        ) : null}

        <DashboardOperations structureMetrics={metrics} reports={reports} reportErrors={reportErrors}>
          <section className={styles.launchpad} aria-labelledby="dashboard-launchpad-title">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>Truy cập nhanh</p>
                <h2 id="dashboard-launchpad-title">Mở đúng việc, không qua màn trung gian</h2>
              </div>
              <span className={styles.sectionHint}>Lối tắt gọn trong 3 hàng trên desktop</span>
            </div>

            <div className={styles.shortcutGrid}>
              {shortcuts.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={styles.shortcut}
                  data-group={item.groupId}
                  data-testid={`dashboard-shortcut-${item.href.replaceAll('/', '-').replace(/^-+/, '')}`}
                >
                  <ShortcutGlyph icon={item.icon} />
                  <span className={styles.shortcutCopy}>
                    <strong>{item.label}</strong>
                    <small>{item.group}</small>
                  </span>
                  <svg className={styles.arrow} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </Link>
              ))}
            </div>
          </section>
        </DashboardOperations>

        <p className={styles.sourceNote}>
          Chỉ số cơ cấu: {formatCompactNumber(metrics.reduce((sum, metric) => sum + metric.active, 0))} điểm đang hoạt động. Các card đo lường chỉ hiển thị dữ liệu reporting canonical mà tài khoản hiện tại được phép đọc.
        </p>
      </main>
    </AppShell>
  );
}
