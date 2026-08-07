'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import type { AgingDashboard } from '../../lib/finance-reporting-types';
import { AppShell } from './app-shell';
import styles from './inventory-reporting-workspace.module.css';

type ApiEnvelope<T> = Readonly<{ data?: T; error?: { message?: string } }>;

type Warehouse = { id: string; code: string };

function formatDecimal(value: string | null | undefined, maxFraction = 0) {
  const normalized = String(value ?? '0').trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return normalized || '0';
  const [, sign, integerRaw, fraction = ''] = match;
  const kept = fraction.slice(0, maxFraction);
  const grouped = integerRaw.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const trimmed = kept.replace(/0+$/, '');
  return `${sign}${grouped}${trimmed ? `,${trimmed}` : ''}`;
}

function money(value: string | null | undefined, currency: string) {
  return `${formatDecimal(value)} ${currency}`;
}

function arBucket(value: string) {
  return ({ AGE_0_30: '0–30 ngày', AGE_31_60: '31–60 ngày', AGE_61_90: '61–90 ngày', AGE_91_PLUS: 'Trên 90 ngày' } as Record<string, string>)[value] ?? value;
}

function apBucket(value: string) {
  return ({ NOT_DUE: 'Chưa đến hạn', OVERDUE_1_30: 'Quá hạn 1–30 ngày', OVERDUE_31_60: 'Quá hạn 31–60 ngày', OVERDUE_61_90: 'Quá hạn 61–90 ngày', OVERDUE_91_PLUS: 'Quá hạn trên 90 ngày' } as Record<string, string>)[value] ?? value;
}

async function requestReport(warehouseId = ''): Promise<AgingDashboard> {
  const query = new URLSearchParams();
  if (warehouseId) query.set('warehouseId', warehouseId);
  const serialized = query.toString();
  const response = await fetch(`/api/reporting/aging${serialized ? `?${serialized}` : ''}`, { method: 'GET', cache: 'no-store' });
  const envelope = await response.json().catch(() => ({})) as ApiEnvelope<AgingDashboard>;
  if (!response.ok || !envelope.data) throw new Error(envelope.error?.message || 'Không tải được báo cáo tuổi nợ.');
  return envelope.data;
}

function deriveWarehouses(report: AgingDashboard): Warehouse[] {
  const map = new Map<string, Warehouse>();
  for (const row of [...report.receivable.documents, ...report.payable.documents]) {
    if (row.warehouseId && row.warehouseCode) map.set(row.warehouseId, { id: row.warehouseId, code: row.warehouseCode });
  }
  return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export function AgingReportingWorkspace() {
  const [warehouseId, setWarehouseId] = useState('');
  const [warehouseOptions, setWarehouseOptions] = useState<Warehouse[]>([]);
  const [report, setReport] = useState<AgingDashboard | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (nextWarehouseId = '', initialize = false) => {
    setBusy(true);
    setError('');
    try {
      const next = await requestReport(nextWarehouseId);
      setReport(next);
      if (initialize) setWarehouseOptions(deriveWarehouses(next));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được báo cáo tuổi nợ.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load('', true); }, [load]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(warehouseId);
  }

  function resetFilters() {
    setWarehouseId('');
    void load('');
  }

  const actions = (
    <div className={styles.headerActions}>
      <Link className={styles.linkButton} href="/accounting/receivables">Công nợ phải thu</Link>
      <Link className={styles.linkButton} href="/accounting/payables">Công nợ phải trả</Link>
    </div>
  );

  return (
    <AppShell
      title="Tuổi nợ phải thu / phải trả"
      subtitle="Theo dõi số dư công nợ hiện tại trong phạm vi kho được cấp. Phải thu phân tuổi theo ngày chứng từ; phải trả dùng đúng hạn thanh toán canonical."
      kicker="Kế toán & công nợ"
      actions={actions}
    >
      <div className={styles.workspace} data-testid="aging-reporting-workspace">
        <form className={styles.filters} onSubmit={applyFilters}>
          <label className={styles.field}>
            <span>Kho</span>
            <select value={warehouseId} disabled={busy} onChange={(event) => setWarehouseId(event.target.value)}>
              <option value="">Tất cả kho được cấp quyền</option>
              {warehouseOptions.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code}</option>)}
            </select>
          </label>
          <button className={styles.primaryButton} type="submit" disabled={busy}>Áp dụng</button>
          <button className={styles.secondaryButton} type="button" onClick={resetFilters} disabled={busy}>Đặt lại</button>
        </form>

        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        {busy && !report ? <div className={styles.loading}>Đang tải tuổi nợ…</div> : null}

        {report ? <>
          <div className={styles.notice}>
            <strong>Ngày chốt hiện tại:</strong> {report.currentDate}. AR chưa có due date canonical nên không gắn nhãn “quá hạn”; AP dùng due date thật. Tiền luôn tách theo currency.
          </div>

          <section className={styles.section}>
            <div className={styles.sectionHeader}><div><h2>Phải thu khách hàng</h2><p>Tuổi khoản phải thu tính từ ngày chứng từ nguồn trên số dư hiện còn phải thu.</p></div><Link className={styles.linkButton} href="/accounting/receivables">Mở công nợ phải thu</Link></div>
            <div className={styles.tableWrap}><table className={styles.table}>
              <thead><tr><th>Tiền tệ</th><th>Tuổi khoản phải thu</th><th className={styles.numeric}>Chứng từ</th><th className={styles.numeric}>Còn phải thu</th></tr></thead>
              <tbody>{report.receivable.summary.map((row) => <tr key={`${row.currencyCode}:${row.ageBucket}`}><td>{row.currencyCode}</td><td>{arBucket(row.ageBucket)}</td><td className={styles.numeric}>{formatDecimal(row.documentCount)}</td><td className={styles.numeric}>{money(row.remainingAmount, row.currencyCode)}</td></tr>)}{!report.receivable.summary.length ? <tr><td className={styles.empty} colSpan={4}>Không có khoản phải thu đang mở.</td></tr> : null}</tbody>
            </table></div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}><div><h2>Khách hàng còn công nợ</h2><p>Xếp theo số dư còn phải thu, giữ nguyên từng đồng tiền.</p></div></div>
            <div className={styles.tableWrap}><table className={styles.table}>
              <thead><tr><th>Khách hàng</th><th>Tiền tệ</th><th className={styles.numeric}>Chứng từ</th><th className={styles.numeric}>Còn phải thu</th><th>Chứng từ cũ nhất</th><th className={styles.numeric}>Tuổi lớn nhất</th></tr></thead>
              <tbody>{report.receivable.customers.map((row) => <tr key={`${row.customerId}:${row.currencyCode}`}><td><strong>{row.customerCode}</strong><br />{row.customerName}</td><td>{row.currencyCode}</td><td className={styles.numeric}>{formatDecimal(row.documentCount)}</td><td className={styles.numeric}>{money(row.remainingAmount, row.currencyCode)}</td><td>{row.oldestDocumentDate ?? '—'}</td><td className={styles.numeric}>{row.oldestAgeDays ?? '0'} ngày</td></tr>)}{!report.receivable.customers.length ? <tr><td className={styles.empty} colSpan={6}>Không có dữ liệu.</td></tr> : null}</tbody>
            </table></div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}><div><h2>Phải trả nhà cung cấp</h2><p>Quá hạn tính đúng từ due date đã khóa trên chứng từ phải trả.</p></div><Link className={styles.linkButton} href="/accounting/payables">Mở công nợ phải trả</Link></div>
            <div className={styles.tableWrap}><table className={styles.table}>
              <thead><tr><th>Tiền tệ</th><th>Trạng thái hạn</th><th className={styles.numeric}>Chứng từ</th><th className={styles.numeric}>Còn phải trả</th></tr></thead>
              <tbody>{report.payable.summary.map((row) => <tr key={`${row.currencyCode}:${row.ageBucket}`}><td>{row.currencyCode}</td><td>{apBucket(row.ageBucket)}</td><td className={styles.numeric}>{formatDecimal(row.documentCount)}</td><td className={styles.numeric}>{money(row.remainingAmount, row.currencyCode)}</td></tr>)}{!report.payable.summary.length ? <tr><td className={styles.empty} colSpan={4}>Không có khoản phải trả đang mở.</td></tr> : null}</tbody>
            </table></div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}><div><h2>Nhà cung cấp còn công nợ</h2><p>Ưu tiên số dư lớn và cho biết mức quá hạn lớn nhất.</p></div></div>
            <div className={styles.tableWrap}><table className={styles.table}>
              <thead><tr><th>Nhà cung cấp</th><th>Tiền tệ</th><th className={styles.numeric}>Chứng từ</th><th className={styles.numeric}>Còn phải trả</th><th>Hạn sớm nhất</th><th className={styles.numeric}>Quá hạn lớn nhất</th></tr></thead>
              <tbody>{report.payable.suppliers.map((row) => <tr key={`${row.supplierId}:${row.currencyCode}`}><td><strong>{row.supplierCode}</strong><br />{row.supplierName}</td><td>{row.currencyCode}</td><td className={styles.numeric}>{formatDecimal(row.documentCount)}</td><td className={styles.numeric}>{money(row.remainingAmount, row.currencyCode)}</td><td>{row.earliestDueDate ?? '—'}</td><td className={styles.numeric}>{row.maxOverdueDays ?? '0'} ngày</td></tr>)}{!report.payable.suppliers.length ? <tr><td className={styles.empty} colSpan={6}>Không có dữ liệu.</td></tr> : null}</tbody>
            </table></div>
          </section>
        </> : null}
      </div>
    </AppShell>
  );
}
