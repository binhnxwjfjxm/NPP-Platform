import { AdminShell } from '../admin-shell';
import { normalizeReportPeriod } from '../reports/report-data';
import { AlertsLocal } from './alerts-local';

const validTabs = new Set(['all', 'sales', 'debt', 'inventory', 'delivery', 'mcp', 'rules', 'history']);

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ tab?: string; period?: string }> }) {
  const { tab, period: periodInput } = await searchParams;
  const activeTab = tab && validTabs.has(tab) ? tab : 'all';
  const period = normalizeReportPeriod(periodInput);
  return (
    <AdminShell activeSection="alerts" title="Trung tâm cảnh báo" subtitle="Theo dõi tín hiệu bất thường từ dữ liệu quản trị thật.">
      <AlertsLocal activeTab={activeTab} period={period} />
    </AdminShell>
  );
}
