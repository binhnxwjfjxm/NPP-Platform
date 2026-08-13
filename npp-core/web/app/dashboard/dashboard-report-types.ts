import type { ReportingDashboard } from '../../lib/reporting-dashboard-types';
import type { InventoryReportingDashboard } from '../../lib/inventory-reporting-types';
import type { LogisticsDashboard } from '../../lib/logistics-reporting-types';
import type { AgingDashboard } from '../../lib/finance-reporting-types';

export type DashboardReports = {
  sales?: ReportingDashboard;
  inventory?: InventoryReportingDashboard;
  logistics?: LogisticsDashboard;
  aging?: AgingDashboard;
};

export type DashboardStructureMetric = Readonly<{
  id: 'branches' | 'warehouses' | 'locations';
  label: string;
  total: number;
  active: number;
}>;
