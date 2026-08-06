import { AppShell } from '../../components/app-shell';
import { getCodHandover, listCodHandovers, resolveCodRequestId } from '../../../lib/cod-reconciliation-gateway';
import type { CodHandover } from '../../../lib/cod-reconciliation-types';
import CodReconciliationWorkspace from './cod-reconciliation-workspace';

export const dynamic = 'force-dynamic';

export default async function CodReconciliationPage() {
  const requestId = resolveCodRequestId(null);
  let handovers: CodHandover[] = [];
  let error: string | null = null;
  try {
    handovers = await listCodHandovers<CodHandover>(requestId, { limit: 1000 });
    if (handovers[0]) handovers = [await getCodHandover<CodHandover>(handovers[0].id, requestId), ...handovers.slice(1)];
  } catch {
    error = 'Dữ liệu đối soát COD chưa tải được. Hãy cập nhật lại trang trước khi thao tác.';
  }
  return (
    <AppShell
      title="Đối soát COD"
      subtitle="Tách rõ tiền khách đã trả, tiền tài xế đang giữ, tiền đã bàn giao và số công ty thực nhận."
      kicker="Kế toán bán hàng"
    >
      <CodReconciliationWorkspace initialHandovers={handovers} initialError={error} />
    </AppShell>
  );
}
