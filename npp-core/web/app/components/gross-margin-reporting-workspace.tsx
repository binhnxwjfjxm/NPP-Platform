'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import type { GrossMarginDashboard } from '../../lib/finance-reporting-types';
import { AppShell } from './app-shell';
import styles from './inventory-reporting-workspace.module.css';

type ApiEnvelope<T> = Readonly<{ data?: T; error?: { message?: string } }>;
type Filters = Readonly<{ from: string; to: string; warehouseId: string }>;
type Warehouse = { id: string; code: string };
const EMPTY: Filters = Object.freeze({ from: '', to: '', warehouseId: '' });

function formatDecimal(value: string | null | undefined, maxFraction = 2) {
  const normalized = String(value ?? '0').trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return normalized || '0';
  const [, sign, integerRaw, fraction = ''] = match;
  const kept = fraction.slice(0, maxFraction).replace(/0+$/, '');
  const grouped = integerRaw.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${grouped}${kept ? `,${kept}` : ''}`;
}

const money = (value: string | null | undefined) => `${formatDecimal(value, 0)} ₫`;
const percent = (value: string | null | undefined) => value === null || value === undefined ? '—' : `${formatDecimal(value, 2)}%`;

async function requestReport(filters: Filters): Promise<GrossMarginDashboard> {
  const query = new URLSearchParams();
  if (filters.from) query.set('from', filters.from);
  if (filters.to) query.set('to', filters.to);
  if (filters.warehouseId) query.set('warehouseId', filters.warehouseId);
  const serialized = query.toString();
  const response = await fetch(`/api/reporting/gross-margin${serialized ? `?${serialized}` : ''}`, { method: 'GET', cache: 'no-store' });
  const envelope = await response.json().catch(() => ({})) as ApiEnvelope<GrossMarginDashboard>;
  if (!response.ok || !envelope.data) throw new Error(envelope.error?.message || 'Không tải được báo cáo lãi gộp.');
  return envelope.data;
}

function deriveWarehouses(report: GrossMarginDashboard): Warehouse[] {
  const map = new Map<string, Warehouse>();
  for (const row of [...report.lines, ...report.exceptions]) {
    if (row.warehouseId && row.warehouseCode) map.set(row.warehouseId, { id: row.warehouseId, code: row.warehouseCode });
  }
  return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
}

function exceptionLabel(code?: string) {
  return ({ NON_VND_REVENUE: 'Doanh thu không phải VND', MISSING_INVENTORY_LINEAGE: 'Thiếu lineage xuất/nhập kho', MISSING_COST_FACT: 'Chưa có cost fact Phase 7', COST_ANOMALY: 'Cost fact có ngoại lệ' } as Record<string, string>)[code ?? ''] ?? code ?? '—';
}

export function GrossMarginReportingWorkspace() {
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [warehouseOptions, setWarehouseOptions] = useState<Warehouse[]>([]);
  const [report, setReport] = useState<GrossMarginDashboard | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (filters: Filters, initialize = false) => {
    setBusy(true); setError('');
    try {
      const next = await requestReport(filters);
      setReport(next);
      if (initialize) {
        setDraft({ from: next.filters.from, to: next.filters.to, warehouseId: '' });
        setWarehouseOptions(deriveWarehouses(next));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được báo cáo lãi gộp.');
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(EMPTY, true); }, [load]);
  function applyFilters(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void load(draft); }
  function resetFilters() { setDraft(EMPTY); void load(EMPTY, true); }

  const actions = <div className={styles.headerActions}><Link className={styles.linkButton} href="/sales/sales-orders">Đơn bán hàng</Link><Link className={styles.linkButton} href="/inventory/costing">Giá vốn Phase 7</Link></div>;

  return (
    <AppShell title="Lãi gộp" subtitle="Đối chiếu doanh thu thuần đã ghi nhận với cost fact MWA_V1 theo exact inventory lineage; Customer Return đã nhận được đảo cả doanh thu và COGS." kicker="Bán hàng" actions={actions}>
      <div className={styles.workspace} data-testid="gross-margin-reporting-workspace">
        <form className={styles.filters} onSubmit={applyFilters}>
          <label className={styles.field}><span>Từ ngày</span><input type="date" value={draft.from} disabled={busy} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></label>
          <label className={styles.field}><span>Đến ngày</span><input type="date" value={draft.to} disabled={busy} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
          <label className={styles.field}><span>Kho</span><select value={draft.warehouseId} disabled={busy} onChange={(e) => setDraft({ ...draft, warehouseId: e.target.value })}><option value="">Tất cả kho được cấp quyền</option>{warehouseOptions.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}</select></label>
          <button className={styles.primaryButton} type="submit" disabled={busy}>Áp dụng</button><button className={styles.secondaryButton} type="button" disabled={busy} onClick={resetFilters}>Đặt lại</button>
        </form>
        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        {busy && !report ? <div className={styles.loading}>Đang tải lãi gộp…</div> : null}
        {report ? <>
          <div className={styles.cards}>
            <article className={styles.card}><p className={styles.cardLabel}>Doanh thu thuần so sánh được</p><p className={styles.cardValue}>{money(report.summary.netRevenueVnd)}</p><p className={styles.cardHint}>Không gồm VAT; đã trừ discount và đảo Customer Return.</p></article>
            <article className={styles.card}><p className={styles.cardLabel}>Giá vốn</p><p className={styles.cardValue}>{money(report.summary.cogsVnd)}</p><p className={styles.cardHint}>Phase 7 MWA_V1 theo exact movement line.</p></article>
            <article className={styles.card}><p className={styles.cardLabel}>Lãi gộp</p><p className={styles.cardValue}>{money(report.summary.grossMarginVnd)}</p><p className={styles.cardHint}>Doanh thu thuần − COGS.</p></article>
            <article className={styles.card}><p className={styles.cardLabel}>Biên lãi gộp</p><p className={styles.cardValue}>{percent(report.summary.grossMarginPercent)}</p><p className={styles.cardHint}>Chỉ trên các dòng VND có cost fact hợp lệ.</p></article>
          </div>
          <div className={styles.notice}><strong>Đối soát:</strong> {report.summary.comparableLineCount ?? '0'}/{report.summary.eventLineCount ?? '0'} dòng so sánh được · thiếu lineage {report.summary.missingLineageCount ?? '0'} · thiếu cost {report.summary.missingCostCount ?? '0'} · cost anomaly {report.summary.costAnomalyCount ?? '0'} · non-VND {report.summary.nonVndCount ?? '0'}.</div>

          <section className={styles.section}><div className={styles.sectionHeader}><div><h2>Theo khách hàng</h2><p>Nhóm theo customer ID ổn định; tên/mã chỉ dùng để hiển thị.</p></div></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Khách hàng</th><th className={styles.numeric}>Doanh thu</th><th className={styles.numeric}>COGS</th><th className={styles.numeric}>Lãi gộp</th><th className={styles.numeric}>Biên</th></tr></thead><tbody>{report.topCustomers.map((r) => <tr key={r.customerId}><td><strong>{r.customerCode}</strong><br />{r.customerName}</td><td className={styles.numeric}>{money(r.netRevenueVnd)}</td><td className={styles.numeric}>{money(r.cogsVnd)}</td><td className={styles.numeric}>{money(r.grossMarginVnd)}</td><td className={styles.numeric}>{percent(r.grossMarginPercent)}</td></tr>)}{!report.topCustomers.length ? <tr><td className={styles.empty} colSpan={5}>Chưa có dòng lãi gộp so sánh được.</td></tr> : null}</tbody></table></div></section>

          <section className={styles.section}><div className={styles.sectionHeader}><div><h2>Theo SKU</h2><p>Nhóm theo base variant ID để không tách sai do snapshot tên.</p></div><Link className={styles.linkButton} href="/inventory/costing">Mở giá vốn</Link></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>SKU</th><th className={styles.numeric}>Doanh thu</th><th className={styles.numeric}>COGS</th><th className={styles.numeric}>Lãi gộp</th><th className={styles.numeric}>Biên</th></tr></thead><tbody>{report.topSkus.map((r) => <tr key={r.variantId}><td><strong>{r.sku}</strong></td><td className={styles.numeric}>{money(r.netRevenueVnd)}</td><td className={styles.numeric}>{money(r.cogsVnd)}</td><td className={styles.numeric}>{money(r.grossMarginVnd)}</td><td className={styles.numeric}>{percent(r.grossMarginPercent)}</td></tr>)}{!report.topSkus.length ? <tr><td className={styles.empty} colSpan={5}>Chưa có dữ liệu.</td></tr> : null}</tbody></table></div></section>

          <section className={styles.section}><div className={styles.sectionHeader}><div><h2>Dòng chưa đủ điều kiện tính lãi gộp</h2><p>Không tự suy đoán giá vốn hoặc quy đổi tiền tệ; các dòng này bị loại khỏi KPI và hiện rõ nguyên nhân.</p></div></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Ngày</th><th>Chứng từ</th><th>Kho</th><th>SKU</th><th>Khách hàng</th><th>Nguyên nhân</th></tr></thead><tbody>{report.exceptions.map((r) => <tr key={`${r.eventKind}:${r.sourceLineId}`}><td>{r.documentDate}</td><td>{r.eventKind === 'RETURN' ? 'Trả hàng · ' : ''}{r.documentNumber}</td><td>{r.warehouseCode}</td><td>{r.sku}</td><td>{r.customerCode}</td><td>{exceptionLabel(r.exceptionCode)}</td></tr>)}{!report.exceptions.length ? <tr><td className={styles.empty} colSpan={6}>Không có ngoại lệ trong kỳ.</td></tr> : null}</tbody></table></div></section>
        </> : null}
      </div>
    </AppShell>
  );
}
