import { AdminShell } from './admin-shell';
import { AdminOverviewLocal } from './admin-overview-local';
import { normalizeReportPeriod, resolveReportRange } from './reports/report-data';

export const dynamic = 'force-dynamic';

export default function AdminOverviewPage({ searchParams }: { searchParams?: { period?: string } }) {
  const period = normalizeReportPeriod(searchParams?.period);
  const range = resolveReportRange(period);
  return (
    <AdminShell activeSection="overview" title="Tổng quan quản trị" subtitle="Tín hiệu ưu tiên, tình hình vận hành và các quyết định cần chú ý.">
      <AdminOverviewLocal period={period} from={range.from} to={range.to} />
    </AdminShell>
  );
}
