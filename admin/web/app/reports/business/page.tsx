import { AdminShell } from '../../admin-shell';
import { reportPeriods } from '../report-data';
import { loadBusinessReport, type BusinessBreakdownKey } from '../business-report-data';
import { BusinessReportWorkspace } from './business-report-workspace';

const dimensions: readonly BusinessBreakdownKey[] = [
  'customers',
  'customerGroups',
  'channels',
  'products',
  'productGroups',
  'employees',
];

function initialDimension(value?: string): BusinessBreakdownKey {
  return dimensions.includes(value as BusinessBreakdownKey) ? value as BusinessBreakdownKey : 'customers';
}

export default async function BusinessReportPage({
  searchParams,
}: {
  searchParams?: {
    period?: string;
    view?: string;
    item?: string;
    productGroupId?: string;
    customerGroupId?: string;
    includeZeroProducts?: string;
  };
}) {
  const report = await loadBusinessReport(searchParams?.period, {
    productGroupId: searchParams?.productGroupId,
    customerGroupId: searchParams?.customerGroupId,
    includeZeroProducts: searchParams?.includeZeroProducts,
  });

  return (
    <AdminShell
      activeSection="reports"
      title="Báo cáo Kinh doanh"
      subtitle="Theo dõi doanh thu, đơn hàng, khách mua và sản lượng theo từng sản phẩm."
      contentWidth="special"
    >
      <BusinessReportWorkspace
        report={report}
        periods={reportPeriods}
        initialDimension={initialDimension(searchParams?.view)}
        initialItem={searchParams?.item}
      />
    </AdminShell>
  );
}
