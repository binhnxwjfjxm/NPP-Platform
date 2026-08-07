'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import type {
  InventoryCostAnomaly,
  InventoryCostBalance,
  InventoryCostFact,
  InventoryCostRebuildResult,
  InventoryCostingRun,
  InventoryCostReconciliation,
} from '../../../lib/inventory-costing-types';
import styles from './workspace.module.css';

type Props = {
  initialBalances: InventoryCostBalance[];
  initialFacts: InventoryCostFact[];
  initialAnomalies: InventoryCostAnomaly[];
  initialReconciliation: InventoryCostReconciliation[];
  initialRun: InventoryCostingRun | null;
  initialError: string | null;
};

type Tab = 'balances' | 'reconciliation' | 'anomalies' | 'facts';

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
  const digits = whole.toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${grouped} ₫`;
}

async function browserRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
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
    throw new Error(
      payload?.error?.message ?? 'Không thể tải dữ liệu giá vốn tồn kho',
    );
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
  }[value] ?? value;
}

export default function InventoryCostingWorkspace({
  initialBalances,
  initialFacts,
  initialAnomalies,
  initialReconciliation,
  initialRun,
  initialError,
}: Props) {
  const [balances, setBalances] = useState(initialBalances);
  const [facts, setFacts] = useState(initialFacts);
  const [anomalies, setAnomalies] = useState(initialAnomalies);
  const [reconciliation, setReconciliation] = useState(initialReconciliation);
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

  const totals = useMemo(() => ({
    pools: balances.length,
    costed: balances.filter((item) => item.status === 'COSTED').length,
    anomalies: anomalies.length,
    mismatches: reconciliation.filter(
      (item) => item.reconciliationStatus !== 'OK',
    ).length,
  }), [balances, anomalies, reconciliation]);

  async function refresh() {
    const currentEpoch = epoch.current + 1;
    epoch.current = currentEpoch;
    const [nextBalances, nextFacts, nextAnomalies, nextReconciliation, nextRun] =
      await Promise.all([
        browserRequest<InventoryCostBalance[]>('balances'),
        browserRequest<InventoryCostFact[]>('facts?limit=100'),
        browserRequest<InventoryCostAnomaly[]>('anomalies?limit=100'),
        browserRequest<InventoryCostReconciliation[]>('reconciliation?limit=500'),
        browserRequest<InventoryCostingRun | null>('run'),
      ]);
    if (epoch.current !== currentEpoch) return;
    setBalances(nextBalances);
    setFacts(nextFacts);
    setAnomalies(nextAnomalies);
    setReconciliation(nextReconciliation);
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
      setNotice(
        `Đã dựng ${result.run.factCount} cost fact; ${result.run.anomalyCount} dòng cần xử lý nguồn giá.`,
      );
      setRebuildKey(`web-costing-rebuild-${crypto.randomUUID()}`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Không dựng lại được giá vốn tồn kho',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title="Giá vốn tồn kho"
      kicker="Kho"
      subtitle="Bình quân gia quyền di động theo kho và SKU cơ sở; dữ liệu được dựng lại từ movement bất biến."
      actions={(
        <button
          type="button"
          className={styles.primary}
          onClick={rebuild}
          disabled={busy || !rebuildKey}
          data-testid="inventory-costing-rebuild"
        >
          {busy ? 'Đang dựng…' : 'Dựng lại giá vốn'}
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
          <article><span>Lệch đối soát</span><strong>{totals.mismatches}</strong></article>
        </section>

        <section className={styles.runCard}>
          <div>
            <strong>Phương pháp MWA_V1</strong>
            <p>Pool: installation + warehouse + base SKU · tiền tệ VND.</p>
          </div>
          <div className={styles.runMeta}>
            {run
              ? <>Run {run.id.slice(0, 8)} · {new Date(run.completedAt).toLocaleString('vi-VN')}</>
              : 'Chưa có projection'}
          </div>
        </section>

        <div className={styles.tabs} role="tablist" aria-label="Dữ liệu giá vốn">
          {([
            ['balances', 'Giá trị tồn'],
            ['reconciliation', 'Đối soát'],
            ['anomalies', 'Bất thường'],
            ['facts', 'Cost facts'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? styles.activeTab : styles.tab}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'balances' ? (
          <section className={styles.tableWrap}>
            <table>
              <thead><tr>
                <th>Kho</th><th>SKU</th><th>Số lượng</th>
                <th>Giá trị tồn</th><th>Giá bình quân</th><th>Trạng thái</th>
              </tr></thead>
              <tbody>
                {balances.map((item) => (
                  <tr key={`${item.warehouseId}:${item.baseVariantId}`}>
                    <td>{item.warehouseCode ?? item.warehouseName ?? item.warehouseId}</td>
                    <td>{item.baseSku ?? item.baseVariantId}</td>
                    <td>{trimDecimal(item.quantity)}</td>
                    <td>{moneyVnd(item.inventoryValue)}</td>
                    <td>{moneyVnd(item.averageUnitCost)}</td>
                    <td><span className={styles.badge}>{statusLabel(item.status)}</span></td>
                  </tr>
                ))}
                {balances.length === 0 ? (
                  <tr><td colSpan={6} className={styles.empty}>Chưa có projection giá vốn.</td></tr>
                ) : null}
              </tbody>
            </table>
          </section>
        ) : null}

        {tab === 'reconciliation' ? (
          <section className={styles.tableWrap}>
            <table>
              <thead><tr>
                <th>Kho</th><th>SKU</th><th>Ledger</th>
                <th>Costing</th><th>Chênh lệch</th><th>Kết quả</th>
              </tr></thead>
              <tbody>
                {reconciliation.map((item) => (
                  <tr key={`${item.warehouseId}:${item.baseVariantId}`}>
                    <td>{item.warehouseCode ?? item.warehouseId}</td>
                    <td>{item.baseSku ?? item.baseVariantId}</td>
                    <td>{trimDecimal(item.ledgerQuantity)}</td>
                    <td>{trimDecimal(item.costingQuantity)}</td>
                    <td>{trimDecimal(item.quantityDifference)}</td>
                    <td><span className={styles.badge}>{statusLabel(item.reconciliationStatus)}</span></td>
                  </tr>
                ))}
                {reconciliation.length === 0 ? (
                  <tr><td colSpan={6} className={styles.empty}>Chưa có dữ liệu đối soát.</td></tr>
                ) : null}
              </tbody>
            </table>
          </section>
        ) : null}

        {tab === 'anomalies' ? (
          <section className={styles.lines}>
            {anomalies.map((item) => (
              <article className={styles.line} key={item.id}>
                <div><strong>{item.code}</strong><span>{item.warehouseCode} · {item.baseSku}</span></div>
                <p>{item.message}</p>
                <small>Movement {item.inventoryMovementId.slice(0, 8)} · line {item.inventoryMovementLineId.slice(0, 8)}</small>
              </article>
            ))}
            {anomalies.length === 0 ? <div className={styles.empty}>Không có anomaly nguồn giá.</div> : null}
          </section>
        ) : null}

        {tab === 'facts' ? (
          <section className={styles.tableWrap}>
            <table>
              <thead><tr>
                <th>Thời điểm</th><th>Kho / SKU</th><th>Loại</th>
                <th>SL</th><th>Đơn giá</th><th>Giá trị</th><th>Nguồn</th>
              </tr></thead>
              <tbody>
                {facts.map((item) => (
                  <tr key={item.id}>
                    <td>{new Date(item.movementPostedAt).toLocaleString('vi-VN')}</td>
                    <td>{item.warehouseCode ?? item.warehouseId}<br />{item.baseSku ?? item.baseVariantId}</td>
                    <td>{item.eventType}</td>
                    <td>{trimDecimal(item.quantityDelta)}</td>
                    <td>{moneyVnd(item.unitCost)}</td>
                    <td>{moneyVnd(item.valueDelta)}</td>
                    <td>{item.sourceCostType}<br />{item.sourceDocumentNumber ?? item.sourceLineReference ?? '—'}</td>
                  </tr>
                ))}
                {facts.length === 0 ? (
                  <tr><td colSpan={7} className={styles.empty}>Chưa có cost fact.</td></tr>
                ) : null}
              </tbody>
            </table>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
