import Link from 'next/link';
import { AppShell } from '../../../components/app-shell';
import styles from '../../../inventory/inventory-workspace.module.css';
import { loadOrganizationSnapshot } from '../../../../lib/organization-snapshot';
import { formatDateTime } from '../../../../lib/organization-types';
import {
  getWarehouseLocationModeRun,
  listWarehouseLocationModeRuns,
  type WarehouseLocationModeRun,
} from '../../../../lib/warehouse-location-mode-history-gateway';

export const dynamic = 'force-dynamic';

type SearchParams = Readonly<{ warehouseId?: string; runId?: string }>;

function actionLabel(run: WarehouseLocationModeRun) {
  return run.targetMode === 'UNMANAGED' ? 'Chuyển sang tồn chung' : 'Bắt đầu quản lý vị trí';
}

function modeLabel(mode: WarehouseLocationModeRun['fromMode'] | WarehouseLocationModeRun['targetMode']) {
  if (mode === 'MANAGED') return 'Có quản lý vị trí';
  if (mode === 'UNMANAGED') return 'Không quản lý vị trí';
  return 'Chưa thiết lập';
}

function locationLabel(id: string | null, code: string | null, name: string | null) {
  if (id === null) return 'Tồn chung';
  return [code, name].filter(Boolean).join(' · ') || 'Vị trí đã chuyển';
}

function quantity(value: string) {
  const normalized = String(value ?? '').trim();
  if (!normalized.includes('.')) return normalized;
  return normalized.replace(/0+$/, '').replace(/\.$/, '');
}

export default async function WarehouseLocationModeHistoryPage({ searchParams }: Readonly<{ searchParams?: SearchParams }>) {
  let error: string | null = null;
  let warehouses: Awaited<ReturnType<typeof loadOrganizationSnapshot>>['warehouses'] = [];
  let runs: readonly WarehouseLocationModeRun[] = [];
  let detail: WarehouseLocationModeRun | null = null;

  try {
    const snapshot = await loadOrganizationSnapshot();
    warehouses = snapshot.warehouses.filter((warehouse) => warehouse.is_active);
    const selectedWarehouseId = searchParams?.warehouseId || warehouses[0]?.id || '';
    if (selectedWarehouseId) runs = await listWarehouseLocationModeRuns(selectedWarehouseId);
    if (searchParams?.runId) detail = await getWarehouseLocationModeRun(searchParams.runId);
  } catch (loadError) {
    error = loadError instanceof Error ? loadError.message : 'Không tải được lịch sử quản lý vị trí.';
  }

  const selectedWarehouseId = searchParams?.warehouseId || warehouses[0]?.id || '';

  return (
    <AppShell
      title="Lịch sử quản lý vị trí"
      subtitle="Theo dõi các lần chuyển giữa quản lý theo vị trí và tồn chung của từng Kho."
      kicker="Kho hàng"
      actions={<Link href="/organization/warehouses">Về Kho hàng</Link>}
    >
      <div className={styles.page} data-testid="warehouse-location-mode-history-page">
        <section className={`${styles.hero} ${styles.compactHero}`}>
          <form className={styles.heroControls} method="get">
            <label className={styles.field}>
              <span>Kho</span>
              <select className={styles.selectInput} name="warehouseId" defaultValue={selectedWarehouseId}>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.name}</option>
                ))}
              </select>
            </label>
            <div className={styles.actionRow}><button className={styles.primaryAction} type="submit">Xem lịch sử</button></div>
          </form>
          {error ? <div className={`${styles.banner} ${styles.bannerError}`}>{error}</div> : null}
        </section>

        <section className={styles.section}>
          <div className={styles.gridTwo}>
            <div className={styles.panel}>
              <h3 className={styles.panelTitle}>Các lần chuyển chế độ</h3>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Thời gian</th><th>Nghiệp vụ</th><th>Trước → Sau</th><th>SKU</th><th></th></tr></thead>
                  <tbody>
                    {runs.length === 0 ? (
                      <tr><td colSpan={5} className={styles.subtle}>Kho này chưa có lịch sử chuyển chế độ.</td></tr>
                    ) : runs.map((run) => (
                      <tr key={run.id}>
                        <td>{formatDateTime(run.completedAt)}</td>
                        <td><strong>{actionLabel(run)}</strong><div className={styles.subtle}>{run.completedBy}</div></td>
                        <td>{modeLabel(run.fromMode)} → {modeLabel(run.targetMode)}</td>
                        <td>{run.affectedSkuCount}</td>
                        <td><Link className={styles.miniButton} href={`/organization/warehouses/location-mode-history?warehouseId=${encodeURIComponent(selectedWarehouseId)}&runId=${encodeURIComponent(run.id)}`}>Xem chi tiết</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <aside className={styles.panel}>
              <h3 className={styles.panelTitle}>Chi tiết lần chuyển</h3>
              {!detail ? <p className={styles.subtle}>Chọn một lần chuyển để xem SKU, lô, vị trí và số lượng.</p> : (
                <>
                  <p className={styles.panelCopy}><strong>{actionLabel(detail)}</strong> · {detail.warehouseCode} — {detail.warehouseName}</p>
                  <div className={styles.stack}>
                    <div className={styles.banner}>Thời gian: {formatDateTime(detail.completedAt)} · Người thực hiện: {detail.completedBy}</div>
                    <div className={styles.banner}>{modeLabel(detail.fromMode)} → {modeLabel(detail.targetMode)} · {detail.affectedSkuCount} SKU · {detail.affectedScopeCount} phạm vi tồn</div>
                  </div>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead><tr><th>SKU</th><th>Lô</th><th>Chuyển từ</th><th>Chuyển đến</th><th>SL</th></tr></thead>
                      <tbody>
                        {(detail.lines ?? []).length === 0 ? (
                          <tr><td colSpan={5} className={styles.subtle}>Lần chuyển này không có dòng tồn cần di chuyển.</td></tr>
                        ) : detail.lines?.map((line) => (
                          <tr key={line.id}>
                            <td className={styles.mono}>{line.sku}</td>
                            <td>{line.lotCode || 'Không lô'}</td>
                            <td>{locationLabel(line.sourceLocationId, line.sourceLocationCode, line.sourceLocationName)}</td>
                            <td>{locationLabel(line.destinationLocationId, line.destinationLocationCode, line.destinationLocationName)}</td>
                            <td className={styles.mono}>{quantity(line.baseQuantity)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </aside>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
