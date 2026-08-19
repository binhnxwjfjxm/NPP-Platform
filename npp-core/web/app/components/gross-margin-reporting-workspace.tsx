'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import type { GrossMarginDashboard } from '../../lib/finance-reporting-types';
import { AppShell } from './app-shell';
import {
  BusinessTableSequenceCell,
  BusinessTableSequenceHeader,
} from './business-table-sequence';
import {
  WorkspaceTabPanel,
  WorkspaceTabs,
  type WorkspaceTabOption,
} from './workspace-tabs';
import styles from './inventory-reporting-workspace.module.css';

type ApiEnvelope<T> = Readonly<{ data?: T; error?: { message?: string } }>;
type Filters = Readonly<{ from: string; to: string; warehouseId: string }>;
type Warehouse = { id: string; code: string };
type GrossMarginReportTab = 'customers' | 'skus' | 'exceptions';

const EMPTY: Filters = Object.freeze({ from: '', to: '', warehouseId: '' });
const GROSS_MARGIN_TABS: readonly WorkspaceTabOption<GrossMarginReportTab>[] = Object.freeze([
  { id: 'customers', label: 'Theo khách hàng' },
  { id: 'skus', label: 'Theo SKU' },
  { id: 'exceptions', label: 'Ngoại lệ' },
]);
const GROSS_MARGIN_TAB_PREFIX = 'gross-margin-reporting';

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
  const [activeTab, setActiveTab] = useState<GrossMarginReportTab>('customers');

  const load = useCallback(async (filters: Filters, initialize = false) => {
    setBusy(true);
    setError('');
    try {
      const next = await requestReport(filters);
      setReport(next);
      if (initialize) {
        setDraft({ from: next.filters.from, to: next.filters.to, warehouseId: '' });
        setWarehouseOptions(deriveWarehouses(next));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được báo cáo lãi gộp.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(EMPTY, true); }, [load]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(draft);
  }

  function resetFilters() {
    setDraft(EMPTY);
    void load(EMPTY, true);
  }

  const actions = (
    <div className={styles.headerActions}>
      <Link className={styles.linkButton} href="/sales/sales-orders">Đơn bán hàng</Link>
      <Link className={styles.linkButton} href="/inventory/costing">Giá vốn Phase 7</Link>
    </div>
  );

  return (
    <AppShell
      title="Lãi gộp"
      subtitle="Đối chiếu doanh thu thuần đã ghi nhận với dữ liệu giá vốn bình quân theo chuỗi chứng từ kho; hàng khách trả đã nhận được đảo cả doanh thu và giá vốn hàng bán."
      kicker="Bán hàng"
      actions={actions}
    >
      <div className={styles.workspace} data-testid="gross-margin-reporting-workspace">
        <form className={styles.filters} onSubmit={applyFilters}>
          <label className={styles.field}><span>Từ ngày</span><input type="date" value={draft.from} disabled={busy} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label>
          <label className={styles.field}><span>Đến ngày</span><input type="date" value={draft.to} disabled={busy} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label>
          <label className={styles.field}><span>Kho</span><select value={draft.warehouseId} disabled={busy} onChange={(event) => setDraft({ ...draft, warehouseId: event.target.value })}><option value="">Tất cả kho được cấp quyền</option>{warehouseOptions.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code}</option>)}</select></label>
          <button className={styles.primaryButton} type="submit" disabled={busy}>Áp dụng</button>
          <button className={styles.secondaryButton} type="button" disabled={busy} onClick={resetFilters}>Đặt lại</button>
        </form>

        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        {busy && !report ? <div className={styles.loading}>Đang tải lãi gộp…</div> : null}

        {report ? <>
          <div className={styles.cards}>
            <article className={styles.card}><p className={styles.cardLabel}>Doanh thu thuần so sánh được</p><p className={styles.cardValue}>{money(report.summary.netRevenueVnd)}</p><p className={styles.cardHint}>Không gồm VAT; đã trừ discount và đảo Customer Return.</p></article>
            <article className={styles.card}><p className={styles.cardLabel}>Giá vốn</p><p className={styles.cardValue}>{money(report.summary.cogsVnd)}</p><p className={styles.cardHint}>Phase 7 MWA_V1 theo exact movement line.</p></article>
            <article className={styles.card}><p className={styles.cardLabel}>Lãi gộp</p><p className={styles.cardValue}>{money(report.summary.grossMarginVnd)}</p><p className={styles.cardHint}>Doanh thu thuần − Giá vốn hàng bán.</p></article>
            <article className={styles.card}><p className={styles.cardLabel}>Biên lãi gộp</p><p className={styles.cardValue}>{percent(report.summary.grossMarginPercent)}</p><p className={styles.cardHint}>Chỉ trên các dòng VND có cost fact hợp lệ.</p></article>
          </div>

          <div className={styles.notice}><strong>Đối soát:</strong> {report.summary.comparableLineCount ?? '0'}/{report.summary.eventLineCount ?? '0'} dòng so sánh được · thiếu liên kết chứng từ {report.summary.missingLineageCount ?? '0'} · thiếu giá vốn {report.summary.missingCostCount ?? '0'} · bất thường giá vốn {report.summary.costAnomalyCount ?? '0'} · chưa quy đổi VND {report.summary.nonVndCount ?? '0'}.</div>

          <WorkspaceTabs
            tabs={GROSS_MARGIN_TABS}
            activeTab={activeTab}
            onChange={setActiveTab}
            idPrefix={GROSS_MARGIN_TAB_PREFIX}
            label="Chi tiết lãi gộp"
          />

          <WorkspaceTabPanel tabId="customers" activeTab={activeTab} idPrefix={GROSS_MARGIN_TAB_PREFIX}>
            <section className={styles.section} data-testid="gross-margin-customers-panel">
              <div className={styles.sectionHeader}><div><h2>Theo khách hàng</h2><p>Nhóm theo mã khách hàng ổn định; tên và mã chỉ dùng để hiển thị.</p></div></div>
              <div className={styles.tableWrap}><table className={styles.table}><thead><tr><BusinessTableSequenceHeader /><th>Khách hàng</th><th className={styles.numeric}>Doanh thu</th><th className={styles.numeric}>Giá vốn hàng bán</th><th className={styles.numeric}>Lãi gộp</th><th className={styles.numeric}>Biên</th></tr></thead><tbody>{report.topCustomers.map((row, rowIndex) => <tr key={row.customerId}><BusinessTableSequenceCell rowIndex={rowIndex} /><td><strong>{row.customerCode}</strong><br />{row.customerName}</td><td className={styles.numeric}>{money(row.netRevenueVnd)}</td><td className={styles.numeric}>{money(row.cogsVnd)}</td><td className={styles.numeric}>{money(row.grossMarginVnd)}</td><td className={styles.numeric}>{percent(row.grossMarginPercent)}</td></tr>)}{!report.topCustomers.length ? <tr><td className={styles.empty} colSpan={6}>Chưa có dòng lãi gộp so sánh được.</td></tr> : null}</tbody></table></div>
            </section>
          </WorkspaceTabPanel>

          <WorkspaceTabPanel tabId="skus" activeTab={activeTab} idPrefix={GROSS_MARGIN_TAB_PREFIX}>
            <section className={styles.section} data-testid="gross-margin-skus-panel">
              <div className={styles.sectionHeader}><div><h2>Theo SKU</h2><p>Nhóm theo mã SKU chuẩn để không tách sai khi tên hàng thay đổi.</p></div><Link className={styles.linkButton} href="/inventory/costing">Mở giá vốn</Link></div>
              <div className={styles.tableWrap}><table className={styles.table}><thead><tr><BusinessTableSequenceHeader /><th>SKU</th><th className={styles.numeric}>Doanh thu</th><th className={styles.numeric}>Giá vốn hàng bán</th><th className={styles.numeric}>Lãi gộp</th><th className={styles.numeric}>Biên</th></tr></thead><tbody>{report.topSkus.map((row, rowIndex) => <tr key={row.variantId}><BusinessTableSequenceCell rowIndex={rowIndex} /><td><strong>{row.sku}</strong></td><td className={styles.numeric}>{money(row.netRevenueVnd)}</td><td className={styles.numeric}>{money(row.cogsVnd)}</td><td className={styles.numeric}>{money(row.grossMarginVnd)}</td><td className={styles.numeric}>{percent(row.grossMarginPercent)}</td></tr>)}{!report.topSkus.length ? <tr><td className={styles.empty} colSpan={6}>Chưa có dữ liệu.</td></tr> : null}</tbody></table></div>
            </section>
          </WorkspaceTabPanel>

          <WorkspaceTabPanel tabId="exceptions" activeTab={activeTab} idPrefix={GROSS_MARGIN_TAB_PREFIX}>
            <section className={styles.section} data-testid="gross-margin-exceptions-panel">
              <div className={styles.sectionHeader}><div><h2>Dòng chưa đủ điều kiện tính lãi gộp</h2><p>Không tự suy đoán giá vốn hoặc quy đổi tiền tệ; các dòng này chưa tính vào chỉ tiêu tổng hợp và hiện rõ nguyên nhân.</p></div></div>
              <div className={styles.tableWrap}><table className={styles.table}><thead><tr><BusinessTableSequenceHeader /><th>Ngày</th><th>Chứng từ</th><th>Kho</th><th>SKU</th><th>Khách hàng</th><th>Nguyên nhân</th></tr></thead><tbody>{report.exceptions.map((row, rowIndex) => <tr key={`${row.eventKind}:${row.sourceLineId}`}><BusinessTableSequenceCell rowIndex={rowIndex} /><td>{row.documentDate}</td><td>{row.eventKind === 'RETURN' ? 'Trả hàng · ' : ''}{row.documentNumber}</td><td>{row.warehouseCode}</td><td>{row.sku}</td><td>{row.customerCode}</td><td>{exceptionLabel(row.exceptionCode)}</td></tr>)}{!report.exceptions.length ? <tr><td className={styles.empty} colSpan={7}>Không có ngoại lệ trong kỳ.</td></tr> : null}</tbody></table></div>
            </section>
          </WorkspaceTabPanel>
        </> : null}
      </div>
    </AppShell>
  );
}
