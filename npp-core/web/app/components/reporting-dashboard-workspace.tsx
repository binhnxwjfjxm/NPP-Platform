'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from './app-shell';
import type {
  ReportingDashboard,
  ReportingFamily,
  ReportingStatusRow,
} from '../../lib/reporting-dashboard-types';
import styles from './reporting-dashboard-workspace.module.css';

type ApiEnvelope<T> = Readonly<{
  data?: T;
  error?: { message?: string };
}>;

type Filters = Readonly<{ from: string; to: string }>;

const EMPTY_FILTERS: Filters = Object.freeze({ from: '', to: '' });

const STATUS_LABELS: Record<string, string> = {
  draft: 'Nháp',
  confirmed: 'Đã xác nhận',
  cancelled: 'Đã hủy',
  closed: 'Đã đóng',
  unallocated: 'Chưa giữ hàng',
  partially_allocated: 'Giữ một phần',
  allocated: 'Đã giữ đủ',
  partially_fulfilled: 'Hoàn tất một phần',
  fulfilled: 'Đã hoàn tất',
  not_required: 'Không cần giao',
  pending: 'Đang chờ',
  ready_to_dispatch: 'Sẵn sàng giao',
  dispatched: 'Đang giao',
  partially_delivered: 'Giao một phần',
  delivered: 'Đã giao',
  failed: 'Giao thất bại',
  rescheduled: 'Hẹn giao lại',
  returned: 'Đã trả hàng',
  not_due: 'Chưa đến hạn',
  partially_paid: 'Đã trả một phần',
  paid: 'Đã thanh toán',
  overpaid: 'Trả thừa',
  refunded: 'Đã hoàn tiền',
  written_off: 'Đã xóa nợ',
  pending_approval: 'Chờ duyệt',
  approved: 'Đã duyệt',
  partially_received: 'Nhận một phần',
  fully_received: 'Đã nhận đủ',
  posted: 'Đã ghi sổ',
  reversed: 'Đã đảo',
};

const DIMENSION_LABELS: Record<string, string> = {
  order: 'Trạng thái đơn bán',
  fulfillment: 'Chuẩn bị hàng',
  delivery: 'Giao hàng',
  settlement: 'Thanh toán',
  purchase_order: 'Trạng thái đơn mua',
  goods_receipt: 'Phiếu nhận hàng',
};

function label(value: string) {
  return STATUS_LABELS[value] ?? value.replaceAll('_', ' ');
}

function formatDecimal(value: string | null | undefined) {
  const normalized = String(value ?? '0').trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return normalized || '0';

  const [, sign, integer, fraction = ''] = match;
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const trimmedFraction = fraction.replace(/0+$/, '').slice(0, 6);
  return `${sign}${grouped}${trimmedFraction ? `,${trimmedFraction}` : ''}`;
}

function formatMoney(value: string | null | undefined, currencyCode: string) {
  const suffix = currencyCode === 'VND' ? '₫' : currencyCode;
  return `${formatDecimal(value)} ${suffix}`;
}

function formatQuantity(value: string | null | undefined) {
  return formatDecimal(value);
}

function detailRoute(family: ReportingFamily) {
  return family === 'sales' ? '/sales/sales-orders' : '/purchasing/purchase-orders';
}

function entityLabel(family: ReportingFamily) {
  return family === 'sales' ? 'Khách hàng' : 'Nhà cung cấp';
}

async function requestReport(family: ReportingFamily, filters: Filters): Promise<ReportingDashboard> {
  const query = new URLSearchParams();
  if (filters.from) query.set('from', filters.from);
  if (filters.to) query.set('to', filters.to);
  const serializedQuery = query.toString();

  const response = await fetch(
    `/api/reporting/${family}${serializedQuery ? `?${serializedQuery}` : ''}`,
    { method: 'GET', cache: 'no-store' },
  );
  const envelope = await response.json().catch(() => ({})) as ApiEnvelope<ReportingDashboard>;
  if (!response.ok || !envelope.data) {
    throw new Error(envelope.error?.message || 'Không tải được báo cáo vận hành.');
  }
  return envelope.data;
}

function groupStatusRows(rows: readonly ReportingStatusRow[]) {
  const groups = new Map<string, ReportingStatusRow[]>();
  for (const row of rows) {
    const existing = groups.get(row.dimension) ?? [];
    existing.push(row);
    groups.set(row.dimension, existing);
  }
  return groups;
}

export function ReportingDashboardWorkspace({ family }: { family: ReportingFamily }) {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [report, setReport] = useState<ReportingDashboard | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (filters: Filters, initialize = false) => {
    setBusy(true);
    setError('');
    try {
      const next = await requestReport(family, filters);
      setReport(next);
      if (initialize) {
        const canonical = Object.freeze({ from: next.filters.from, to: next.filters.to });
        setDraft(canonical);
        setApplied(canonical);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được báo cáo vận hành.');
    } finally {
      setBusy(false);
    }
  }, [family]);

  useEffect(() => {
    void load(EMPTY_FILTERS, true);
  }, [load]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApplied(draft);
    void load(draft);
  }

  function resetFilters() {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    void load(EMPTY_FILTERS, true);
  }

  const statusGroups = useMemo(
    () => groupStatusRows(report?.statusBreakdown ?? []),
    [report?.statusBreakdown],
  );

  const isSales = family === 'sales';
  const route = detailRoute(family);
  const pageTitle = isSales ? 'Báo cáo bán hàng' : 'Báo cáo mua hàng';
  const pageSubtitle = isSales
    ? 'Theo dõi giá trị đơn đã có hiệu lực, trạng thái chuẩn bị/giao/thanh toán và các nhóm khách/SKU nổi bật từ nguồn đơn bán hàng.'
    : 'Theo dõi giá trị đơn mua đã có hiệu lực, tiến độ duyệt/nhận hàng và các nhà cung cấp/SKU nổi bật từ nguồn đơn đặt hàng và phiếu nhận.';

  const actions = isSales ? (
    <Link className={styles.headerLink} href="/sales/sales-orders">Mở đơn bán hàng</Link>
  ) : (
    <div className={styles.headerActions}>
      <Link className={styles.headerLink} href="/purchasing/purchase-orders">Mở đơn đặt hàng</Link>
      <Link className={styles.headerLink} href="/purchasing/goods-receipts">Mở phiếu nhận hàng</Link>
    </div>
  );

  return (
    <AppShell
      kicker={isSales ? 'Bán hàng · Reporting' : 'Mua hàng · Reporting'}
      title={pageTitle}
      subtitle={pageSubtitle}
      actions={actions}
    >
      <div className={styles.workspace} data-testid={`reporting-dashboard-${family}`}>
        <form className={styles.filters} onSubmit={applyFilters} aria-label={`Bộ lọc ${pageTitle}`}>
          <div className={styles.filterHeading}>
            <div>
              <p className={styles.eyebrow}>Kỳ báo cáo</p>
              <h2>Ngày nghiệp vụ</h2>
            </div>
            <small>
              {applied.from && applied.to
                ? `${applied.from} → ${applied.to}`
                : 'Mặc định tháng hiện tại theo Asia/Ho_Chi_Minh'}
            </small>
          </div>

          <div className={styles.filterGrid}>
            <label>
              Từ ngày
              <input
                type="date"
                value={draft.from}
                onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
              />
            </label>
            <label>
              Đến ngày
              <input
                type="date"
                value={draft.to}
                onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
              />
            </label>
          </div>

          <div className={styles.filterActions}>
            <button type="button" className={styles.secondaryButton} onClick={resetFilters} disabled={busy}>
              Đặt lại
            </button>
            <button type="submit" className={styles.primaryButton} disabled={busy}>
              {busy ? 'Đang tải…' : 'Áp dụng'}
            </button>
          </div>
        </form>

        {error ? <p className={styles.error} role="alert">{error}</p> : null}

        <section className={styles.summaryGrid} aria-label="Tổng hợp báo cáo">
          <article>
            <span>{isSales ? 'Đơn có ngày xác nhận trong kỳ' : 'Tổng đơn mua trong kỳ'}</span>
            <strong>{report?.summary.allOrderCount ?? '0'}</strong>
            <small>
              {isSales
                ? 'Theo sales.sales_orders.confirmed_at; gồm mọi trạng thái sau khi đơn đã được xác nhận.'
                : 'Theo purchasing.purchase_orders.order_date; gồm mọi trạng thái của đơn mua trong kỳ.'}
            </small>
          </article>
          <article>
            <span>{isSales ? 'Đơn bán có hiệu lực' : 'Đơn mua có hiệu lực'}</span>
            <strong>{report?.summary.effectiveOrderCount ?? '0'}</strong>
            <small>{report?.basis.effectiveStates.map(label).join(' · ') || 'Theo source contract'}</small>
          </article>
          <article>
            <span>{isSales ? 'Đã hủy sau xác nhận' : 'Đã hủy'}</span>
            <strong>{report?.summary.cancelledOrderCount ?? '0'}</strong>
            <small>
              {isSales
                ? 'Chỉ tính đơn có confirmed_at nằm trong kỳ; không cộng vào giá trị có hiệu lực.'
                : 'Không cộng vào giá trị có hiệu lực.'}
            </small>
          </article>
          {!isSales ? (
            <>
              <article>
                <span>Chờ duyệt</span>
                <strong>{report?.summary.pendingApprovalCount ?? '0'}</strong>
                <small>Đơn mua chưa vào giá trị có hiệu lực</small>
              </article>
              <article>
                <span>Phiếu nhận đã ghi sổ</span>
                <strong>{report?.summary.postedReceiptCount ?? '0'}</strong>
                <small>Theo receipt_date trong cùng kỳ</small>
              </article>
              <article>
                <span>Phiếu nhận đã đảo</span>
                <strong>{report?.summary.reversedReceiptCount ?? '0'}</strong>
                <small>Giữ riêng khỏi phiếu nhận đang hiệu lực</small>
              </article>
            </>
          ) : null}
        </section>

        <section className={styles.panel}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Giá trị theo tiền tệ</p>
              <h2>Không trộn currency</h2>
            </div>
            <span>{report?.currencyTotals.length ?? 0} tiền tệ</span>
          </div>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Tiền tệ</th>
                  <th>Chứng từ hiệu lực</th>
                  <th>Giá trị</th>
                </tr>
              </thead>
              <tbody>
                {report?.currencyTotals.map((row) => (
                  <tr key={row.currencyCode}>
                    <td><strong>{row.currencyCode}</strong></td>
                    <td>{row.documentCount}</td>
                    <td>{formatMoney(row.totalValue, row.currencyCode)}</td>
                  </tr>
                ))}
                {!busy && !report?.currencyTotals.length ? (
                  <tr><td colSpan={3} className={styles.empty}>Không có giá trị hiệu lực trong kỳ.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.statusGrid} aria-label="Trạng thái vận hành">
          {[...statusGroups.entries()].map(([dimension, rows]) => (
            <article className={styles.statusPanel} key={dimension}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>Trạng thái</p>
                  <h2>{DIMENSION_LABELS[dimension] ?? dimension}</h2>
                </div>
              </div>
              <div className={styles.statusList}>
                {rows.map((row) => (
                  <div className={styles.statusRow} key={`${dimension}-${row.state}`}>
                    <span>{label(row.state)}</span>
                    <strong>{row.documentCount}</strong>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>

        <section className={styles.panel}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Xu hướng theo ngày</p>
              <h2>Giá trị chứng từ có hiệu lực</h2>
            </div>
            <small>Mốc ngày theo {report?.timezone ?? 'Asia/Ho_Chi_Minh'}</small>
          </div>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Tiền tệ</th>
                  <th>Số chứng từ</th>
                  <th>Giá trị</th>
                </tr>
              </thead>
              <tbody>
                {report?.dailyTrend.map((row) => (
                  <tr key={`${row.businessDate}-${row.currencyCode}`}>
                    <td>{row.businessDate}</td>
                    <td>{row.currencyCode}</td>
                    <td>{row.documentCount}</td>
                    <td>{formatMoney(row.totalValue, row.currencyCode)}</td>
                  </tr>
                ))}
                {!busy && !report?.dailyTrend.length ? (
                  <tr><td colSpan={4} className={styles.empty}>Không có dữ liệu xu hướng trong kỳ.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <div className={styles.twoColumns}>
          <section className={styles.panel}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>Top {entityLabel(family).toLowerCase()}</p>
                <h2>Theo giá trị hiệu lực</h2>
              </div>
            </div>
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>{entityLabel(family)}</th>
                    <th>Tiền tệ</th>
                    <th>Chứng từ</th>
                    <th>Giá trị</th>
                  </tr>
                </thead>
                <tbody>
                  {report?.topEntities.map((row) => (
                    <tr key={`${row.currencyCode}-${row.entityId}`}>
                      <td>
                        <Link href={`${route}?search=${encodeURIComponent(row.entityCode)}`}>
                          <strong>{row.entityCode}</strong>
                        </Link>
                        <small>{row.entityName}</small>
                      </td>
                      <td>{row.currencyCode}</td>
                      <td>{row.documentCount}</td>
                      <td>{formatMoney(row.totalValue, row.currencyCode)}</td>
                    </tr>
                  ))}
                  {!busy && !report?.topEntities.length ? (
                    <tr><td colSpan={4} className={styles.empty}>Chưa có dữ liệu xếp hạng.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>Top SKU</p>
                <h2>Theo giá trị hiệu lực</h2>
              </div>
            </div>
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>SL cơ sở</th>
                    <th>Giá trị</th>
                    <th>Nguồn</th>
                  </tr>
                </thead>
                <tbody>
                  {report?.topSkus.map((row) => (
                    <tr key={`${row.currencyCode}-${row.variantId}`}>
                      <td>
                        <strong>{row.sku}</strong>
                        <small>{row.itemName} · {row.currencyCode}</small>
                      </td>
                      <td>{formatQuantity(row.baseQuantity)}</td>
                      <td>{formatMoney(row.totalValue, row.currencyCode)}</td>
                      <td>
                        <Link href={`${route}?search=${encodeURIComponent(row.sampleDocumentNumber)}`}>
                          {row.sampleDocumentNumber}
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {!busy && !report?.topSkus.length ? (
                    <tr><td colSpan={4} className={styles.empty}>Chưa có dữ liệu SKU.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <p className={styles.lineage}>
          Nguồn: <strong>{report?.basis.date ?? 'đang tải'}</strong> · Giá trị: {report?.basis.value ?? 'đang tải'}.
          Các link chi tiết mở đúng màn nghiệp vụ hiện hữu và tự kiểm quyền lại tại route đích.
        </p>
      </div>
    </AppShell>
  );
}
