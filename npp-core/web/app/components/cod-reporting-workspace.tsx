'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { CodHandover } from '../../lib/cod-reconciliation-types';
import type { CodReportingDashboard } from '../../lib/cod-reporting-types';
import CodReconciliationWorkspace from '../accounting/cod-reconciliation/cod-reconciliation-workspace';
import { AppShell } from './app-shell';
import metricStyles from './cod-reporting-workspace.module.css';
import {
  WorkspaceTabPanel,
  WorkspaceTabs,
  type WorkspaceTabOption,
} from './workspace-tabs';
import styles from './inventory-reporting-workspace.module.css';

type ApiEnvelope<T> = Readonly<{ data?: T; error?: { message?: string } }>;
type CodReportTab = 'custody' | 'collections' | 'handover' | 'accounting' | 'promises' | 'exceptions';
type Props = Readonly<{
  initialHandovers: CodHandover[];
  initialCodError: string | null;
  initialTab?: CodReportTab;
}>;

const COD_TABS: readonly WorkspaceTabOption<CodReportTab>[] = Object.freeze([
  { id: 'custody', label: 'Tài xế giữ tiền' },
  { id: 'collections', label: 'Thu trong kỳ' },
  { id: 'handover', label: 'Bàn giao & kế toán' },
  { id: 'accounting', label: 'Kế toán xác nhận' },
  { id: 'promises', label: 'Hẹn thu quá hạn' },
  { id: 'exceptions', label: 'Cần kiểm tra' },
]);

const COD_TAB_PREFIX = 'cod-reporting';

const COLLECTION_METHOD_LABELS: Readonly<Record<string, string>> = Object.freeze({
  cash: 'Tiền mặt',
  cod: 'Thu khi giao hàng',
  cash_on_delivery: 'Thu khi giao hàng',
  bank_transfer: 'Chuyển khoản',
  transfer: 'Chuyển khoản',
});

const COLLECTION_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  pending: 'Chờ thu',
  promised: 'Đã hẹn thu',
  collected: 'Đã thu',
  partially_collected: 'Thu một phần',
  reversed: 'Đã hoàn tác',
  waived: 'Không thu',
});

const RECONCILIATION_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  submitted: 'Chờ xác nhận',
  reconciled: 'Đã khớp',
  discrepancy: 'Có chênh lệch',
  reversed: 'Đã hoàn tác',
  acceptance_reversed: 'Đã hoàn tác xác nhận',
  matched: 'Đã khớp',
  mismatch: 'Cần kiểm tra',
  unresolved: 'Chưa xử lý',
});

function officeLabel(value: string | null | undefined, labels: Readonly<Record<string, string>>) {
  const normalized = String(value ?? '').trim();
  return labels[normalized] ?? normalized.replace(/[_-]+/g, ' ');
}

function count(value: string | null | undefined) {
  const normalized = String(value ?? '0').trim();
  return /^-?\d+$/.test(normalized) ? normalized.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : normalized;
}

function money(value: string | null | undefined, currency: string | null | undefined) {
  const raw = String(value ?? '0').trim();
  const sign = raw.startsWith('-') ? '-' : '';
  const unsigned = sign ? raw.slice(1) : raw;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const decimal = fraction.replace(/0+$/, '');
  return `${sign}${grouped}${decimal ? `,${decimal}` : ''}${currency ? ` ${currency}` : ''}`;
}

function timestamp(value: string | null | undefined) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function custodyAmountList(rows: readonly { currencyCode: string; custodyRemainingAmount: string }[]) {
  return rows.length
    ? rows.map((row) => money(row.custodyRemainingAmount, row.currencyCode)).join(' · ')
    : '0';
}

export default function CodReportingWorkspace({ initialHandovers, initialCodError, initialTab = 'custody' }: Props) {
  const [report, setReport] = useState<CodReportingDashboard | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<CodReportTab>(initialTab);

  const load = useCallback(async (next = { from, to, warehouseId }) => {
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (next.from) params.set('from', next.from);
      if (next.to) params.set('to', next.to);
      if (next.warehouseId) params.set('warehouseId', next.warehouseId);
      const serialized = params.toString();
      const response = await fetch(`/api/reporting/cod${serialized ? `?${serialized}` : ''}`, { cache: 'no-store' });
      const payload = await response.json() as ApiEnvelope<CodReportingDashboard>;
      if (!response.ok || !payload.data) throw new Error(payload.error?.message || 'Không tải được báo cáo COD');
      setReport(payload.data);
      setFrom(payload.data.filters.from);
      setTo(payload.data.filters.to);
      setWarehouseId(payload.data.filters.warehouseId ?? '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được báo cáo COD');
    } finally {
      setBusy(false);
    }
  }, [from, to, warehouseId]);

  useEffect(() => { void load({ from: '', to: '', warehouseId: '' }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setActiveTab(initialTab); }, [initialTab]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void load();
  }

  const custodyCount = useMemo(
    () => report?.currentSnapshot.custodyByCurrency
      .reduce((sum, row) => sum + BigInt(row.collectionCount), 0n)
      .toString() ?? '0',
    [report],
  );
  const pendingCount = String(report?.currentSnapshot.pendingHandovers.length ?? 0);
  const exceptionCount = String(
    (report?.currentSnapshot.discrepancies.length ?? 0)
      + (report?.exceptions.lifecycle.length ?? 0)
      + (report?.exceptions.currencyLineage.length ?? 0),
  );

  return (
    <AppShell
      title="COD & đối soát"
      subtitle="Theo dõi tiền khách đã trả, tiền tài xế đang giữ, bàn giao và kế toán tiếp nhận từ cùng một nguồn dữ liệu COD chính thức."
    >
      <div className={styles.workspace} data-testid="cod-reporting-workspace">
        <div className={styles.headerActions}>
          <Link className={styles.linkButton} href="/accounting/reconciliation">Đối soát tổng hợp</Link>
        </div>

        <form className={styles.filters} onSubmit={submit}>
          <label className={styles.field}>
            Từ ngày
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} disabled={busy} />
          </label>
          <label className={styles.field}>
            Đến ngày
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} disabled={busy} />
          </label>
          <label className={styles.field}>
            Kho
            <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} disabled={busy}>
              <option value="">Tất cả kho được cấp quyền</option>
              {report?.warehouses.map((row) => (
                <option key={row.warehouseId} value={row.warehouseId}>{row.warehouseCode} · {row.warehouseName}</option>
              ))}
            </select>
          </label>
          <button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? 'Đang tải…' : 'Lọc báo cáo'}</button>
        </form>

        <p className={styles.notice}>
          Khoản tiền tài xế đang giữ là <strong>số liệu hiện tại</strong> và không bị giới hạn bởi kỳ báo cáo. Từ/đến ngày chỉ áp dụng cho hoạt động thu, bàn giao và kế toán tiếp nhận.
        </p>
        {error ? <p className={styles.error}>{error}</p> : null}

        <section className={styles.cards} aria-label="Tổng quan COD">
          <article className={`${styles.card} ${metricStyles.metricCard}`}>
            <span className={`${styles.cardLabel} ${metricStyles.metricLabel}`}>Khoản tiền tài xế đang giữ</span>
            <strong className={`${styles.cardValue} ${metricStyles.metricValue}`}>{count(custodyCount)}</strong>
            <small className={`${styles.cardHint} ${metricStyles.metricHint}`}>{custodyAmountList(report?.currentSnapshot.custodyByCurrency ?? [])}</small>
          </article>
          <article className={`${styles.card} ${metricStyles.metricCard}`}>
            <span className={`${styles.cardLabel} ${metricStyles.metricLabel}`}>Bàn giao chờ kế toán nhận</span>
            <strong className={`${styles.cardValue} ${metricStyles.metricValue}`}>{count(pendingCount)}</strong>
            <small className={`${styles.cardHint} ${metricStyles.metricHint}`}>Đang chờ kế toán xác nhận</small>
          </article>
          <article className={`${styles.card} ${metricStyles.metricCard}`}>
            <span className={`${styles.cardLabel} ${metricStyles.metricLabel}`}>Lời hẹn thu đã quá hạn</span>
            <strong className={`${styles.cardValue} ${metricStyles.metricValue}`}>{count(String(report?.currentSnapshot.overduePromises.length ?? 0))}</strong>
            <small className={`${styles.cardHint} ${metricStyles.metricHint}`}>Chưa thu tiền và đã quá ngày hẹn</small>
          </article>
          <article className={`${styles.card} ${metricStyles.metricCard}`}>
            <span className={`${styles.cardLabel} ${metricStyles.metricLabel}`}>Cần kiểm tra / chênh lệch</span>
            <strong className={`${styles.cardValue} ${metricStyles.metricValue}`}>{count(exceptionCount)}</strong>
            <small className={`${styles.cardHint} ${metricStyles.metricHint}`}>Tách riêng để đối chiếu, không tự gộp số liệu</small>
          </article>
        </section>

        <WorkspaceTabs
          tabs={COD_TABS}
          activeTab={activeTab}
          onChange={setActiveTab}
          idPrefix={COD_TAB_PREFIX}
          label="Chi tiết COD và đối soát"
        />

        <WorkspaceTabPanel tabId="custody" activeTab={activeTab} idPrefix={COD_TAB_PREFIX}>
          <section className={styles.section} data-testid="cod-custody-panel">
            <div className={styles.sectionHeader}>
              <div><h2>Tiền mặt đang ở tài xế</h2><p>Trạng thái khách đã thanh toán và tiền tài xế đang giữ được theo dõi riêng.</p></div>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Tài xế</th><th>Loại tiền</th><th className={styles.numeric}>Số khoản thu</th><th className={styles.numeric}>Đang giữ</th><th>Cũ nhất</th></tr></thead>
                <tbody>
                  {report?.currentSnapshot.custodyByDriver.map((row) => (
                    <tr key={`${row.driverProfileId}-${row.currencyCode}`}>
                      <td>{row.driverCode} · {row.driverName}</td>
                      <td>{row.currencyCode}</td>
                      <td className={styles.numeric}>{count(row.collectionCount)}</td>
                      <td className={styles.numeric}>{money(row.custodyRemainingAmount, row.currencyCode)}</td>
                      <td>{timestamp(row.oldestCollectedAt)} · {count(row.oldestAgeDays)} ngày</td>
                    </tr>
                  ))}
                  {report?.currentSnapshot.custodyByDriver.length === 0 && !busy ? <tr><td colSpan={5} className={styles.empty}>Không có tiền mặt COD đang nằm ở tài xế.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        </WorkspaceTabPanel>

        <WorkspaceTabPanel tabId="collections" activeTab={activeTab} idPrefix={COD_TAB_PREFIX}>
          <section className={styles.section} data-testid="cod-collections-panel">
            <div className={styles.sectionHeader}>
              <div><h2>Hoạt động thu trong kỳ</h2><p>Tách theo loại tiền, phương thức và trạng thái; không cộng gộp khác loại tiền.</p></div>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Loại tiền</th><th>Phương thức</th><th>Trạng thái</th><th className={styles.numeric}>Số lượt</th><th className={styles.numeric}>Phải thu</th><th className={styles.numeric}>Đã nhận</th></tr></thead>
                <tbody>
                  {report?.activity.collections.map((row) => (
                    <tr key={`${row.currencyCode}-${row.collectionMethod}-${row.collectionStatus}`}>
                      <td>{row.currencyCode}</td>
                      <td>{officeLabel(row.collectionMethod, COLLECTION_METHOD_LABELS)}</td>
                      <td>{officeLabel(row.collectionStatus, COLLECTION_STATUS_LABELS)}</td>
                      <td className={styles.numeric}>{count(row.collectionCount)}</td>
                      <td className={styles.numeric}>{money(row.expectedAmount, row.currencyCode)}</td>
                      <td className={styles.numeric}>{money(row.receivedAmount, row.currencyCode)}</td>
                    </tr>
                  ))}
                  {report?.activity.collections.length === 0 && !busy ? <tr><td colSpan={6} className={styles.empty}>Không có hoạt động thu COD trong kỳ.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        </WorkspaceTabPanel>

        <WorkspaceTabPanel tabId="handover" activeTab={activeTab} idPrefix={COD_TAB_PREFIX}>
          <section className={styles.section} data-testid="cod-handovers-period-panel">
            <div className={styles.sectionHeader}>
              <div><h2>Bàn giao trong kỳ</h2><p>Số bàn giao và chênh lệch bàn giao theo từng loại tiền.</p></div>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Loại tiền</th><th className={styles.numeric}>Số bàn giao</th><th className={styles.numeric}>Đã khai bàn giao</th><th className={styles.numeric}>Chênh lệch bàn giao</th></tr></thead>
                <tbody>
                  {report?.activity.handovers.map((row) => (
                    <tr key={`handover-${row.currencyCode}`}>
                      <td>{row.currencyCode}</td>
                      <td className={styles.numeric}>{count(row.handoverCount)}</td>
                      <td className={styles.numeric}>{money(row.claimedAmount, row.currencyCode)}</td>
                      <td className={styles.numeric}>{money(row.handoverDifferenceAmount, row.currencyCode)}</td>
                    </tr>
                  ))}
                  {report?.activity.handovers.length === 0 && !busy ? <tr><td colSpan={4} className={styles.empty}>Không có bàn giao COD trong kỳ.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.section} data-testid="cod-acceptances-period-panel">
            <div className={styles.sectionHeader}>
              <div><h2>Kế toán tiếp nhận trong kỳ</h2><p>Số lần kế toán nhận, tiền Công Ty đã nhận và chênh lệch theo từng loại tiền.</p></div>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Loại tiền</th><th className={styles.numeric}>Số lần tiếp nhận</th><th className={styles.numeric}>Đã tiếp nhận</th><th className={styles.numeric}>Chênh lệch</th></tr></thead>
                <tbody>
                  {report?.activity.acceptances.map((row) => (
                    <tr key={`acceptance-${row.currencyCode}`}>
                      <td>{row.currencyCode}</td>
                      <td className={styles.numeric}>{count(row.acceptanceCount)}</td>
                      <td className={styles.numeric}>{money(row.acceptedAmount, row.currencyCode)}</td>
                      <td className={styles.numeric}>{money(row.varianceAmount, row.currencyCode)}</td>
                    </tr>
                  ))}
                  {report?.activity.acceptances.length === 0 && !busy ? <tr><td colSpan={4} className={styles.empty}>Không có kế toán tiếp nhận COD trong kỳ.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.section} data-testid="cod-pending-handovers-panel">
            <div className={styles.sectionHeader}>
              <div><h2>Bàn giao chờ kế toán tiếp nhận</h2><p>Đây là tiền tài xế đã bàn giao nhưng kế toán chưa xác nhận tiếp nhận.</p></div>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Chuyến / tài xế</th><th>Kho</th><th>Loại tiền</th><th className={styles.numeric}>Chờ nhận</th><th>Bàn giao lúc</th></tr></thead>
                <tbody>
                  {report?.currentSnapshot.pendingHandovers.map((row) => (
                    <tr key={row.handoverId}>
                      <td><Link href="/accounting/cod-reporting?tab=accounting">{row.tripNumber} · {row.driverCode}</Link></td>
                      <td>{row.warehouseCode}</td>
                      <td>{row.currencyCode}</td>
                      <td className={styles.numeric}>{money(row.pendingAcceptanceAmount, row.currencyCode)}</td>
                      <td>{timestamp(row.handedOverAt)}</td>
                    </tr>
                  ))}
                  {report?.currentSnapshot.pendingHandovers.length === 0 && !busy ? <tr><td colSpan={5} className={styles.empty}>Không có bàn giao đang chờ tiếp nhận.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        </WorkspaceTabPanel>

        <WorkspaceTabPanel tabId="accounting" activeTab={activeTab} idPrefix={COD_TAB_PREFIX}>
          <CodReconciliationWorkspace initialHandovers={initialHandovers} initialError={initialCodError} />
        </WorkspaceTabPanel>

        <WorkspaceTabPanel tabId="promises" activeTab={activeTab} idPrefix={COD_TAB_PREFIX}>
          <section className={styles.section} data-testid="cod-overdue-promises-panel">
            <div className={styles.sectionHeader}>
              <div><h2>Lời hẹn thu đã quá hạn</h2><p>Không biến khoản chưa thu thành tiền tài xế đang giữ.</p></div>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Phiếu giao</th><th>Chuyến / tài xế</th><th className={styles.numeric}>Số phải thu</th><th>Hẹn bởi</th><th>Quá hạn</th></tr></thead>
                <tbody>
                  {report?.currentSnapshot.overduePromises.map((row) => (
                    <tr key={row.collectionId}>
                      <td>{row.deliveryOrderNumber ?? row.deliveryOrderId}</td>
                      <td>{row.tripNumber} · {row.driverCode}</td>
                      <td className={styles.numeric}>{money(row.expectedAmount, row.currencyCode)}</td>
                      <td>{row.promisedBy}</td>
                      <td>{count(row.overdueDays)} ngày</td>
                    </tr>
                  ))}
                  {report?.currentSnapshot.overduePromises.length === 0 && !busy ? <tr><td colSpan={5} className={styles.empty}>Không có lời hẹn thu quá hạn.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        </WorkspaceTabPanel>

        <WorkspaceTabPanel tabId="exceptions" activeTab={activeTab} idPrefix={COD_TAB_PREFIX}>
          <section className={styles.section} data-testid="cod-exceptions-panel">
            <div className={styles.sectionHeader}>
              <div><h2>Cần kiểm tra và chênh lệch</h2><p>Các trường hợp lệch trạng thái hoặc không xác định được một loại tiền duy nhất được tách riêng để kiểm tra, không tự suy đoán.</p></div>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Loại</th><th>Nguồn</th><th>Kho</th><th>Chi tiết</th></tr></thead>
                <tbody>
                  {report?.currentSnapshot.discrepancies.map((row) => (
                    <tr key={`discrepancy-${row.handoverId}`}>
                      <td>Chênh lệch bàn giao</td>
                      <td><Link href="/accounting/cod-reporting?tab=accounting">{row.tripNumber} · {row.driverCode}</Link></td>
                      <td>{row.warehouseCode}</td>
                      <td>{money(row.varianceAmount, row.currencyCode)} · {officeLabel(row.projectionStatus, RECONCILIATION_STATUS_LABELS)}</td>
                    </tr>
                  ))}
                  {report?.exceptions.lifecycle.map((row) => (
                    <tr key={`lifecycle-${row.anomalyType}-${row.sourceId}`}>
                      <td>{officeLabel(row.anomalyType, RECONCILIATION_STATUS_LABELS)}</td>
                      <td><Link href="/accounting/reconciliation">{row.sourceNumber}</Link></td>
                      <td>{row.warehouseId}</td>
                      <td>{officeLabel(row.reconciliationStatus, RECONCILIATION_STATUS_LABELS)}</td>
                    </tr>
                  ))}
                  {report?.exceptions.currencyLineage.map((row) => (
                    <tr key={`currency-${row.handoverId}`}>
                      <td>Không xác định loại tiền</td>
                      <td><Link href="/accounting/cod-reporting?tab=accounting">{row.tripNumber} · {row.driverCode}</Link></td>
                      <td>{row.warehouseCode}</td>
                      <td>{row.currencyCount} loại tiền trong một bàn giao — không đưa vào tổng tiền</td>
                    </tr>
                  ))}
                  {exceptionCount === '0' && !busy ? <tr><td colSpan={4} className={styles.empty}>Không có trường hợp COD cần kiểm tra hiện tại.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        </WorkspaceTabPanel>
      </div>
    </AppShell>
  );
}
