import { getCodHandover, listCodHandovers, resolveCodRequestId } from '../../../lib/cod-reconciliation-gateway';
import type { CodHandover } from '../../../lib/cod-reconciliation-types';
import CodReportingWorkspace from '../../components/cod-reporting-workspace';

export const dynamic = 'force-dynamic';

type CodReportTab = 'custody' | 'collections' | 'handover' | 'accounting' | 'promises' | 'exceptions';
type Props = Readonly<{ searchParams?: Readonly<{ tab?: string | string[] }> }>;

const COD_REPORT_TABS = new Set<CodReportTab>([
  'custody',
  'collections',
  'handover',
  'accounting',
  'promises',
  'exceptions',
]);

export default async function CodReportingPage({ searchParams }: Props) {
  const requestedTab = Array.isArray(searchParams?.tab) ? searchParams?.tab[0] : searchParams?.tab;
  const initialTab: CodReportTab = COD_REPORT_TABS.has(requestedTab as CodReportTab)
    ? requestedTab as CodReportTab
    : 'custody';
  const requestId = resolveCodRequestId(null);
  let handovers: CodHandover[] = [];
  let codError: string | null = null;

  try {
    handovers = await listCodHandovers<CodHandover>(requestId, { limit: 1000 });
    if (handovers[0]) {
      handovers = [await getCodHandover<CodHandover>(handovers[0].id, requestId), ...handovers.slice(1)];
    }
  } catch {
    codError = 'Dữ liệu kế toán xác nhận COD chưa tải được. Hãy cập nhật lại trang trước khi thao tác.';
  }

  return (
    <CodReportingWorkspace
      initialHandovers={handovers}
      initialCodError={codError}
      initialTab={initialTab}
    />
  );
}
