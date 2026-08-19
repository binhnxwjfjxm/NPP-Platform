'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import {
  BusinessSequenceNumber,
  BusinessTableSequenceCell,
  BusinessTableSequenceHeader,
} from '../../components/business-table-sequence';
import type {
  InventoryCostAdjustmentEvent,
  InventoryCostAnomaly,
  InventoryCostBalance,
  InventoryCostDiscrepancy,
  InventoryCostFact,
  InventoryCostRebuildResult,
  InventoryCostingPeriod,
  InventoryCostingRun,
  InventoryCostReconciliation,
} from '../../../lib/inventory-costing-types';
import styles from './workspace.module.css';

type Props = {
  initialBalances: InventoryCostBalance[];
  initialFacts: InventoryCostFact[];
  initialAnomalies: InventoryCostAnomaly[];
  initialReconciliation: InventoryCostReconciliation[];
  initialPeriods: InventoryCostingPeriod[];
  initialAdjustments: InventoryCostAdjustmentEvent[];
  initialDiscrepancies: InventoryCostDiscrepancy[];
  initialRun: InventoryCostingRun | null;
  initialError: string | null;
};

type Tab = 'balances' | 'periods' | 'reconciliation' | 'discrepancies' | 'adjustments' | 'anomalies' | 'facts';

function trimDecimal(value: string | null, digits = 6): string {
  if (value === null) return '—';
  const [whole, fraction = ''] = value.split('.');
  const kept = fraction.slice(0, digits).replace(/0+$/, '');
  return kept ? `${whole}.${kept}` : whole;
}

function moneyVnd(value: string | null): string {
  if (value === null) return 'Chưa xác định';
  const negative = value.startsWith('-');
  const normalized = negative ? value.slice(1) : value;
  const [wholeRaw, fraction = ''] = normalized.split('.');
  let whole = BigInt(wholeRaw || '0');
  if (Number(fraction[0] ?? '0') >= 5) whole += 1n;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${grouped} ₫`;
}

async function browserRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/inventory/costing/${path}`, {
    cache: 'no-store',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => null) as {
    data?: T;
    error?: { message?: string };
  } | null;
  if (!payload || !response.ok || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    throw new Error(payload?.error?.message ?? 'Không thể tải dữ liệu giá vốn tồn kho');
  }
  return payload.data as T;
}

function statusLabel(value: string): string {
  return {
    COSTED: 'Đã tính giá',
    ANOMALY: 'Thiếu nguồn giá',
    OK: 'Khớp',
    QUANTITY_MISMATCH: 'Lệch số lượng',
    COST_ANOMALY: 'Có bất thường giá',
    OPEN: 'Đang mở',
    CLOSED: 'Đã khóa',
    RESOLVED: 'Đã xử lý',
  }[value] ?? value;
}

function nextPeriodStart(periods: InventoryCostingPeriod[]): string {
  const open = periods.find((item) => item.status === 'OPEN');
  if (open) return open.periodStart;
  const latestClosed = periods.find((item) => item.status === 'CLOSED');
  if (latestClosed) {
    const [year, month] = latestClosed.periodStart.split('-').map(Number);
    return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  }
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export default function InventoryCostingWorkspace({
  initialBalances,
  initialFacts,
  initialAnomalies,
  initialReconciliation,
  initialPeriods,
  initialAdjustments,
  initialDiscrepancies,
  initialRun,
  initialError,
}: Props) {
  const [balances, setBalances] = useState(initialBalances);
  const [facts, setFacts] = useState(initialFacts);
  const [anomalies, setAnomalies] = useState(initialAnomalies);
  const [reconciliation, setReconciliation] = useState(initialReconciliation);
  const [periods, setPeriods] = useState(initialPeriods);
  const [adjustments, setAdjustments] = useState(initialAdjustments);
  const [discrepancies, setDiscrepancies] = useState(initialDiscrepancies);
  const [run, setRun] = useState(initialRun);
  const [tab, setTab] = useState<Tab>('balances');
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rebuildKey, setRebuildKey] = useState('');
  const epoch = useRef(0);

  useEffect(() => {
    setRebuildKey(`web-costing-rebuild-${crypto.randomUUID()}`);
  }, []);

  const openPeriod = periods.find((item) => item.status === 'OPEN') ?? null;
  const suggestedPeriodStart = nextPeriodStart(periods);
  const totals = useMemo(() => ({
    pools: balances.length,
    costed: balances.filter((item) => item.status === 'COSTED').length,
    anomalies: anomalies.length,
    discrepancies: discrepancies.filter((item) => item.status === 'OPEN').length,
  }), [balances, anomalies, discrepancies]);

  async function refresh() {
    const currentEpoch = epoch.current + 1;
    epoch.current = currentEpoch;
    const [
      nextBalances,
      nextFacts,
      nextAnomalies,
      nextReconciliation,
      nextPeriods,
      nextAdjustments,
      nextDiscrepancies,
      nextRun,
    ] = await Promise.all([
      browserRequest<InventoryCostBalance[]>('balances'),
      browserRequest<InventoryCostFact[]>('facts?limit=100'),
      browserRequest<InventoryCostAnomaly[]>('anomalies?limit=100'),
      browserRequest<InventoryCostReconciliation[]>('reconciliation?limit=500'),
      browserRequest<InventoryCostingPeriod[]>('periods'),
      browserRequest<InventoryCostAdjustmentEvent[]>('adjustments'),
      browserRequest<InventoryCostDiscrepancy[]>('discrepancies'),
      browserRequest<InventoryCostingRun | null>('run'),
    ]);
    if (epoch.current !== currentEpoch) return;
    setBalances(nextBalances);
    setFacts(nextFacts);
    setAnomalies(nextAnomalies);
    setReconciliation(nextReconciliation);
    setPeriods(nextPeriods);
    setAdjustments(nextAdjustments);
    setDiscrepancies(nextDiscrepancies);
    setRun(nextRun);
  }

  async function rebuild() {
    if (!rebuildKey || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await browserRequest<InventoryCostRebuildResult>('rebuild', {
        method: 'POST',
        headers: { 'Idempotency-Key': rebuildKey },
        body: JSON.stringify({}),
      });
      await refresh();
      setNotice(`Đã tổng hợp ${result.run.factCount} dòng giá vốn; ${result.anomalyCount} dòng cần xử lý.`);
      setRebuildKey(`web-costing-rebuild-${crypto.randomUUID()}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không dựng lại được giá vốn tồn kho');
    } finally {
      setBusy(false);
    }
  }

  async function mutatePeriod(action: 'open' | 'close', periodStart: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await browserRequest(`periods/${action}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': `web-costing-period-${action}-${crypto.randomUUID()}` },
        body: JSON.stringify({ periodStart }),
      });
      await refresh();
      setNotice(action === 'open'
        ? `Đã mở kỳ giá vốn ${periodStart}.`
        : `Đã khóa kỳ giá vốn ${periodStart} sau đối soát.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không cập nhật được kỳ giá vốn');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title="Giá vốn tồn kho"
      kicker="Kho"
      subtitle="Bình quân gia quyền di động theo kho và SKU cơ sở; kỳ đã khóa không bị dựng lại âm thầm."
      actions={(
        <button
          type="button"
          className={styles.primary}
          onClick={rebuild}
          disabled={busy || !rebuildKey}
          data-testid="inventory-costing-rebuild"
        >
          {busy ? 'Đang xử lý…' : 'Dựng lại giá vốn'}
        </button>
      )}
    >
      <div className={styles.stack}>
        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        {notice ? <div className={styles.notice}>{notice}</div> : null}

        <section className={styles.summary} aria-label="Tóm tắt giá vốn">
          <article><span>Cost pool</span><strong>{totals.pools}</strong></article>
          <article><span>Đã tính giá</span><strong>{totals.costed}</strong></article>
          <article><span>Anomaly</span><strong>{totals.anomalies}</strong></article>
          <article><span>Chờ đối soát</span><strong>{totals.discrepancies}</strong></article>
        </section>

        <section className={styles.runCard}>
          <div>
            <strong>Phương pháp MWA_V1</strong>
            <p>Pool: installation + warehouse + base SKU · tiền tệ VND.</p>
          </div>
          <div className={styles.runMeta}>
            <span>{openPeriod ? `Kỳ mở ${openPeriod.periodStart} → ${openPeriod.periodEnd}` : 'Chưa có kỳ giá vốn đang mở'}</span>
            <span>{run ? `Lần tổng hợp ${run.id.slice(0, 8)} · ${new Date(run.completedAt).toLocaleString('vi-VN')}` : 'Chưa có dữ liệu giá vốn tổng hợp'}</span>
          </div>
        </section>

        <div className={styles.tabs} role="tablist" aria-label="Dữ liệu giá vốn">
          {([
            ['balances', 'Giá trị tồn'],
            ['periods', 'Kỳ giá vốn'],
            ['reconciliation', 'Đối soát'],
            ['discrepancies', 'Chờ xử lý'],
            ['adjustments', 'Điều chỉnh giá'],
            ['anomalies', 'Bất thường'],
            ['facts', 'Dữ liệu giá vốn'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? `${styles.tab} ${styles.activeTab}` : styles.tab}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'balances' ? (
          <section className={styles.tableWrap}>
            <table><thead><tr><BusinessTableSequenceHeader /><th>Kho</th><th>SKU</th><th>Số lượng</th><th>Giá trị tồn</th><th>Giá bình quân</th><th>Trạng thái</th></tr></thead>
              <tbody>{balances.map((item, rowIndex) => (
                <tr key={`${item.warehouseId}:${item.baseVariantId}`}>
                  <BusinessTableSequenceCell rowIndex={rowIndex} />
                  <td>{item.warehouseCode ?? item.warehouseName ?? item.warehouseId}</td>
                  <td>{item.baseSku ?? item.baseVariantId}</td>
                  <td>{trimDecimal(item.quantity)}</td><td>{moneyVnd(item.inventoryValue)}</td>
                  <td>{moneyVnd(item.averageUnitCost)}</td><td><span className={styles.badge}>{statusLabel(item.status)}</span></td>
                </tr>
              ))}{balances.length === 0 ? <tr><td colSpan={7} className={styles.empty}>Chưa có dữ liệu giá vốn tổng hợp.</td></tr> : null}</tbody>
            </table>
          </section>
        ) : null}

        {tab === 'periods' ? (
          <div className={styles.stack}>
            <section className={styles.runCard}>
              <strong>{openPeriod ? `Kỳ ${openPeriod.periodStart} đang mở` : `Kỳ kế tiếp: ${suggestedPeriodStart}`}</strong>
              <p>Khi đóng kỳ, Công Ty tổng hợp lại phần lịch sử còn mở, chặn nếu còn bất thường hoặc chênh lệch đối soát và lưu bản chốt không sửa.</p>
              <div>
                {openPeriod ? (
                  <button type="button" className={styles.primary} disabled={busy} onClick={() => mutatePeriod('close', openPeriod.periodStart)} data-testid="inventory-costing-period-close">Khóa kỳ sau đối soát</button>
                ) : (
                  <button type="button" className={styles.primary} disabled={busy} onClick={() => mutatePeriod('open', suggestedPeriodStart)} data-testid="inventory-costing-period-open">Mở kỳ {suggestedPeriodStart}</button>
                )}
              </div>
            </section>
            <section className={styles.tableWrap}><table><thead><tr><BusinessTableSequenceHeader /><th>Kỳ</th><th>Trạng thái</th><th>Bản chốt</th><th>Mở bởi</th><th>Đóng bởi</th></tr></thead>
              <tbody>{periods.map((item, rowIndex) => <tr key={item.id}><BusinessTableSequenceCell rowIndex={rowIndex} /><td>{item.periodStart} → {item.periodEnd}</td><td><span className={styles.badge}>{statusLabel(item.status)}</span></td><td>{item.status === 'CLOSED' ? `${item.snapshotPoolCount} nhóm dữ liệu` : '—'}</td><td>{item.openedBy}</td><td>{item.closedBy ?? '—'}</td></tr>)}
              {periods.length === 0 ? <tr><td colSpan={6} className={styles.empty}>Chưa mở kỳ giá vốn đầu tiên.</td></tr> : null}</tbody></table></section>
          </div>
        ) : null}

        {tab === 'reconciliation' ? (
          <section className={styles.tableWrap}><table><thead><tr><BusinessTableSequenceHeader /><th>Kho</th><th>SKU</th><th>Sổ kho</th><th>Giá vốn</th><th>Chênh lệch</th><th>Kết quả</th></tr></thead>
            <tbody>{reconciliation.map((item, rowIndex) => <tr key={`${item.warehouseId}:${item.baseVariantId}`}><BusinessTableSequenceCell rowIndex={rowIndex} /><td>{item.warehouseCode ?? item.warehouseId}</td><td>{item.baseSku ?? item.baseVariantId}</td><td>{trimDecimal(item.ledgerQuantity)}</td><td>{trimDecimal(item.costingQuantity)}</td><td>{trimDecimal(item.quantityDifference)}</td><td><span className={styles.badge}>{statusLabel(item.reconciliationStatus)}</span></td></tr>)}
            {reconciliation.length === 0 ? <tr><td colSpan={7} className={styles.empty}>Chưa có dữ liệu đối soát.</td></tr> : null}</tbody></table></section>
        ) : null}

        {tab === 'discrepancies' ? (
          <section className={styles.lines}>{discrepancies.map((item, rowIndex) => <article className={styles.line} key={item.id}><BusinessSequenceNumber rowIndex={rowIndex} /><div><strong>{item.code}</strong> <span className={styles.badge}>{statusLabel(item.status)}</span></div><p>{item.message}</p><small>{item.warehouseCode ?? item.warehouseId} · {item.baseSku ?? item.baseVariantId} · {item.inventoryMovementLineId ? `Dòng sổ kho ${item.inventoryMovementLineId.slice(0, 8)}` : item.costAdjustmentEventId ? `Sự kiện giá vốn ${item.costAdjustmentEventId.slice(0, 8)}` : item.stableKey}</small></article>)}
          {discrepancies.length === 0 ? <div className={styles.empty}>Không có chênh lệch giá vốn.</div> : null}</section>
        ) : null}

        {tab === 'adjustments' ? (
          <section className={styles.tableWrap}><table><thead><tr><BusinessTableSequenceHeader /><th>Ngày ghi nhận</th><th>Kho / SKU</th><th>Loại</th><th>SL</th><th>Giá trị</th><th>Nguồn</th></tr></thead>
            <tbody>{adjustments.map((item, rowIndex) => <tr key={item.id}><BusinessTableSequenceCell rowIndex={rowIndex} /><td>{item.postingDate}</td><td>{item.warehouseCode ?? item.warehouseId}<br />{item.baseSku ?? item.baseVariantId}</td><td>{item.eventType}</td><td>{trimDecimal(item.quantityDelta)}</td><td>{moneyVnd(item.valueDelta)}</td><td>{item.sourceDocumentType}<br />{item.sourceDocumentId}</td></tr>)}
            {adjustments.length === 0 ? <tr><td colSpan={7} className={styles.empty}>Chưa có điều chỉnh giá vốn.</td></tr> : null}</tbody></table></section>
        ) : null}

        {tab === 'anomalies' ? (
          <section className={styles.lines}>{anomalies.map((item, rowIndex) => <article className={styles.line} key={item.id}><BusinessSequenceNumber rowIndex={rowIndex} /><div><strong>{item.code}</strong><span>{item.warehouseCode} · {item.baseSku}</span></div><p>{item.message}</p><small>Chứng từ kho {item.inventoryMovementId.slice(0, 8)} · dòng {item.inventoryMovementLineId.slice(0, 8)}</small></article>)}
          {anomalies.length === 0 ? <div className={styles.empty}>Không có bất thường về nguồn giá.</div> : null}</section>
        ) : null}

        {tab === 'facts' ? (
          <section className={styles.tableWrap}><table><thead><tr><BusinessTableSequenceHeader /><th>Thời điểm</th><th>Kho / SKU</th><th>Loại</th><th>SL</th><th>Đơn giá</th><th>Giá trị</th><th>Nguồn</th></tr></thead>
            <tbody>{facts.map((item, rowIndex) => <tr key={item.id}><BusinessTableSequenceCell rowIndex={rowIndex} /><td>{new Date(item.movementPostedAt).toLocaleString('vi-VN')}</td><td>{item.warehouseCode ?? item.warehouseId}<br />{item.baseSku ?? item.baseVariantId}</td><td>{item.eventType}</td><td>{trimDecimal(item.quantityDelta)}</td><td>{moneyVnd(item.unitCost)}</td><td>{moneyVnd(item.valueDelta)}</td><td>{item.sourceCostType}<br />{item.sourceDocumentNumber ?? item.sourceLineReference ?? '—'}</td></tr>)}
            {facts.length === 0 ? <tr><td colSpan={8} className={styles.empty}>Chưa có dữ liệu giá vốn.</td></tr> : null}</tbody></table></section>
        ) : null}
      </div>
    </AppShell>
  );
}
