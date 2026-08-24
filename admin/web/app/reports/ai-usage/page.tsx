import Link from 'next/link';
import { AdminShell } from '../../admin-shell';
import {
  AdminFilterChip,
  AdminKpiCard,
  AdminKpiGrid,
  AdminStatePanel,
  AdminStatusBadge,
  AdminToolbar,
  type AdminStatusTone,
} from '../../admin-ui-primitives';
import { CoreApiError } from '../../../lib/core-api';
import {
  loadAiUsageEvents,
  loadAiUsageSummary,
  type AiCustomerUsage,
  type AiUsageEventPage,
  type AiUsageFilters,
  type AiUsageSource,
  type AiUsageSummary,
} from '../../../lib/ai-usage';
import styles from './ai-usage.module.css';

export const dynamic = 'force-dynamic';

type PeriodKey = 'today' | '7d' | 'month' | 'all';

const periodOptions: Array<{ key: PeriodKey; label: string }> = [
  { key: 'today', label: 'Hôm nay' },
  { key: '7d', label: '7 ngày' },
  { key: 'month', label: 'Tháng này' },
  { key: 'all', label: 'Tất cả' },
];

const sourceOptions: Array<{ value: AiUsageSource; label: string }> = [
  { value: 'admin', label: 'Admin' },
  { value: 'website', label: 'Website' },
  { value: 'ordering', label: 'Đặt hàng khách hàng' },
];

const sourceLabels: Record<AiUsageSource, string> = {
  admin: 'Admin',
  website: 'Website',
  ordering: 'Đặt hàng khách hàng',
};

const featureLabels: Record<string, string> = {
  assistant: 'Trợ lý AI',
  'product-help': 'Hỗ trợ sản phẩm',
  'ordering-assistant': 'Trợ lý đặt hàng',
};

function dateParts(now = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const mapped = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(mapped.year), month: Number(mapped.month), day: Number(mapped.day) };
}

function dateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function normalizePeriod(value: string | undefined): PeriodKey {
  return periodOptions.some((item) => item.key === value) ? value as PeriodKey : 'month';
}

function resolvePeriod(period: PeriodKey, now = new Date()): { from?: string; to?: string; label: string } {
  const label = periodOptions.find((item) => item.key === period)?.label ?? 'Tháng này';
  if (period === 'all') return { label };

  const { year, month, day } = dateParts(now);
  const today = new Date(Date.UTC(year, month - 1, day));
  let start = new Date(today);
  if (period === '7d') start.setUTCDate(start.getUTCDate() - 6);
  if (period === 'month') start = new Date(Date.UTC(year, month - 1, 1));
  const endExclusive = new Date(today);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return {
    from: `${dateString(start)}T00:00:00+07:00`,
    to: `${dateString(endExclusive)}T00:00:00+07:00`,
    label,
  };
}

function safeSource(value: string | undefined): AiUsageSource | '' {
  return sourceOptions.some((item) => item.value === value) ? value as AiUsageSource : '';
}

function safeModel(value: string | undefined): string {
  const model = String(value ?? '').trim();
  return /^[A-Za-z0-9._-]{1,128}$/.test(model) ? model : '';
}

function safeCustomerId(value: string | undefined): string {
  const id = String(value ?? '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : '';
}

function safePage(value: string | undefined): number {
  const page = Number(value ?? 1);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function filterHref(
  state: { period: PeriodKey; customerId: string; source: AiUsageSource | ''; model: string; page: number },
  overrides: Partial<{ period: PeriodKey; customerId: string; source: AiUsageSource | ''; model: string; page: number }>,
): string {
  const next = { ...state, ...overrides };
  const query = new URLSearchParams();
  if (next.period !== 'month') query.set('period', next.period);
  if (next.customerId) query.set('customerId', next.customerId);
  if (next.source) query.set('source', next.source);
  if (next.model) query.set('model', next.model);
  if (next.page > 1) query.set('page', String(next.page));
  const text = query.toString();
  return text ? `/reports/ai-usage?${text}` : '/reports/ai-usage';
}

function decimalHundredths(value: string): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return 0n;
  const whole = BigInt(match[1]);
  const fraction = (match[2] ?? '').padEnd(3, '0');
  let cents = whole * 100n + BigInt(fraction.slice(0, 2) || '0');
  if (Number(fraction[2] ?? '0') >= 5) cents += 1n;
  return cents;
}

function usdText(value: string): string {
  const cents = decimalHundredths(value);
  const whole = cents / 100n;
  const fraction = String(cents % 100n).padStart(2, '0');
  return `$${new Intl.NumberFormat('en-US').format(whole)}.${fraction}`;
}

function tokenText(value: number): string {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value);
}

function percentNumber(value: string): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function creditTone(percent: number): AdminStatusTone {
  if (percent >= 90) return 'danger';
  if (percent >= 80) return 'attention';
  return 'success';
}

function creditLabel(percent: number): string {
  if (percent >= 100) return 'Đã dùng hết hạn mức';
  if (percent >= 90) return 'Gần hết hạn mức';
  if (percent >= 80) return 'Sắp tới ngưỡng';
  return 'Bình thường';
}

function sourceLabel(source: AiUsageSource): string {
  return sourceLabels[source];
}

function featureLabel(feature: string): string {
  return featureLabels[feature] ?? 'Trợ lý AI';
}

function dateTimeText(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function customerStatus(customer: AiCustomerUsage): { percent: number; tone: AdminStatusTone; label: string } {
  const percent = percentNumber(customer.usagePercent);
  return { percent, tone: creditTone(percent), label: creditLabel(percent) };
}

export default async function AiUsagePage({
  searchParams,
}: {
  searchParams?: { period?: string; customerId?: string; source?: string; model?: string; page?: string };
}) {
  const period = normalizePeriod(searchParams?.period);
  const range = resolvePeriod(period);
  const customerId = safeCustomerId(searchParams?.customerId);
  const source = safeSource(searchParams?.source);
  const model = safeModel(searchParams?.model);
  const page = safePage(searchParams?.page);
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  const filters: AiUsageFilters = {
    ...(range.from ? { from: range.from } : {}),
    ...(range.to ? { to: range.to } : {}),
    ...(customerId ? { customerId } : {}),
    ...(source ? { source } : {}),
    ...(model ? { model } : {}),
  };
  const optionFilters: AiUsageFilters = {
    ...(range.from ? { from: range.from } : {}),
    ...(range.to ? { to: range.to } : {}),
  };

  let summary: AiUsageSummary | null = null;
  let options: AiUsageSummary | null = null;
  let eventPage: AiUsageEventPage | null = null;
  let loadError: CoreApiError | null = null;
  try {
    [summary, options, eventPage] = await Promise.all([
      loadAiUsageSummary(filters),
      loadAiUsageSummary(optionFilters),
      loadAiUsageEvents(filters, pageSize, offset),
    ]);
  } catch (error) {
    loadError = error instanceof CoreApiError
      ? error
      : new CoreApiError('ADMIN_AI_USAGE_UNAVAILABLE', 'Chưa tải được mức sử dụng AI', 503, true);
  }

  const state = { period, customerId, source, model, page };
  if (loadError || !summary || !options || !eventPage) {
    return (
      <AdminShell
        activeSection="reports"
        title="Mức sử dụng AI"
        subtitle="Theo dõi token, mức quy đổi USD và hạn mức AI của khách hàng."
      >
        <AdminStatePanel
          title={loadError?.statusCode === 403 ? 'Không có quyền xem mức sử dụng AI' : 'Chưa tải được mức sử dụng AI'}
          message={loadError?.statusCode === 403 ? 'Tài khoản hiện tại chưa được cấp quyền quản trị phần này.' : 'Vui lòng thử lại sau.'}
          tone={loadError?.statusCode === 403 ? 'forbidden' : 'error'}
          icon="info"
        />
      </AdminShell>
    );
  }

  const customerNameById = new Map(options.customerBreakdown.map((item) => [item.customerId, item.customerName]));
  const activeCustomerCount = summary.customerBreakdown.filter((item) => item.eventCount > 0).length;
  const hasNextPage = offset + eventPage.events.length < summary.eventCount;
  const selectedCustomer = options.customerBreakdown.find((item) => item.customerId === customerId) ?? null;

  return (
    <AdminShell
      activeSection="reports"
      title="Mức sử dụng AI"
      subtitle="Theo dõi token, mức quy đổi USD và hạn mức 1.000 USD của từng khách hàng."
    >
      <div className={styles.backRow}>
        <Link href="/reports">← Báo cáo quản trị</Link>
        <span>{range.label}</span>
      </div>

      <AdminToolbar label="Kỳ thống kê AI">
        {periodOptions.map((item) => (
          <AdminFilterChip
            key={item.key}
            href={filterHref(state, { period: item.key, page: 1 })}
            label={item.label}
            active={period === item.key}
          />
        ))}
      </AdminToolbar>

      <form className={styles.filters} method="get">
        {period !== 'month' ? <input type="hidden" name="period" value={period} /> : null}
        <label>
          <span>Khách hàng</span>
          <select name="customerId" defaultValue={customerId}>
            <option value="">Tất cả khách hàng</option>
            {options.customerBreakdown.map((item) => (
              <option key={item.customerId} value={item.customerId}>{item.customerCode} · {item.customerName}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Nguồn sử dụng</span>
          <select name="source" defaultValue={source}>
            <option value="">Tất cả nguồn</option>
            {sourceOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>
          <span>Model</span>
          <select name="model" defaultValue={model}>
            <option value="">Tất cả model</option>
            {options.modelBreakdown.map((item) => <option key={item.model} value={item.model}>{item.model}</option>)}
          </select>
        </label>
        <div className={styles.filterActions}>
          <button type="submit">Áp dụng</button>
          {(customerId || source || model) ? <Link href={filterHref(state, { customerId: '', source: '', model: '', page: 1 })}>Xóa bộ lọc</Link> : null}
        </div>
      </form>

      {selectedCustomer ? (
        <section className={styles.selectedCustomer}>
          <span>Đang xem khách hàng</span>
          <strong>{selectedCustomer.customerCode} · {selectedCustomer.customerName}</strong>
        </section>
      ) : null}

      <AdminKpiGrid label="Tổng mức sử dụng AI" className={styles.kpiGrid}>
        <AdminKpiCard label="Mức sử dụng trong kỳ" value={usdText(summary.usageUsd)} note={range.label} icon="coin" />
        <AdminKpiCard label="Token đầu vào" value={tokenText(summary.promptTokens)} note={`Đã lưu bộ nhớ đệm ${tokenText(summary.cachedTokens)}`} icon="document" />
        <AdminKpiCard label="Token đầu ra" value={tokenText(summary.outputTokens + summary.thinkingTokens)} note={`Nội dung trả lời ${tokenText(summary.outputTokens)}`} icon="clipboard" />
        <AdminKpiCard label="Tổng token" value={tokenText(summary.totalTokens)} note={`${summary.eventCount} lượt sử dụng`} icon="overview" />
        <AdminKpiCard label="Khách có sử dụng" value={activeCustomerCount} note={`Trong ${range.label.toLowerCase()}`} icon="user" />
      </AdminKpiGrid>

      <section className={styles.splitGrid}>
        <article className={`card ${styles.breakdownCard}`}>
          <header><span>Nguồn sử dụng</span><h2>Phân bổ theo ứng dụng</h2></header>
          <div className={styles.breakdownList}>
            {summary.sourceBreakdown.length ? summary.sourceBreakdown.map((item) => (
              <div key={item.source}>
                <span><strong>{sourceLabel(item.source)}</strong><small>{tokenText(item.totalTokens)} token · {item.eventCount} lượt</small></span>
                <b>{usdText(item.usageUsd)}</b>
              </div>
            )) : <p>Chưa có lượt sử dụng trong kỳ này.</p>}
          </div>
        </article>
        <article className={`card ${styles.breakdownCard}`}>
          <header><span>Model</span><h2>Phân bổ theo model AI</h2></header>
          <div className={styles.breakdownList}>
            {summary.modelBreakdown.length ? summary.modelBreakdown.map((item) => (
              <div key={item.model}>
                <span><strong>{item.model}</strong><small>{tokenText(item.totalTokens)} token · {item.eventCount} lượt</small></span>
                <b>{usdText(item.usageUsd)}</b>
              </div>
            )) : <p>Chưa có lượt sử dụng trong kỳ này.</p>}
          </div>
        </article>
      </section>

      <p className="sectionEyebrow">Tín dụng AI theo khách hàng</p>
      <section className={styles.customerList} aria-label="Hạn mức AI theo khách hàng">
        {summary.customerBreakdown.length ? summary.customerBreakdown.map((customer) => {
          const status = customerStatus(customer);
          const width = Math.min(100, status.percent);
          return (
            <article className={`card ${styles.customerCard}`} key={customer.customerId}>
              <div className={styles.customerHead}>
                <span>
                  <small>{customer.customerCode}</small>
                  <strong>{customer.customerName}</strong>
                </span>
                <AdminStatusBadge tone={status.tone}>{status.label}</AdminStatusBadge>
              </div>
              <div className={styles.creditLine}>
                <span><small>Đã sử dụng</small><strong>{usdText(customer.usedUsd)}</strong></span>
                <span><small>Còn lại</small><strong>{usdText(customer.remainingUsd)}</strong></span>
                <span><small>Hạn mức</small><strong>{usdText(customer.limitUsd)}</strong></span>
                <span><small>Trong kỳ</small><strong>{usdText(customer.periodUsageUsd)}</strong></span>
              </div>
              <div
                className={styles.creditTrack}
                role="progressbar"
                aria-label={`Tín dụng AI ${customer.customerName}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(100, Math.round(status.percent))}
              >
                <span style={{ width: `${width}%` }} />
              </div>
              <div className={styles.customerFoot}>
                <small>{status.percent.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}% đã dùng</small>
                <Link href={filterHref(state, { customerId: customer.customerId, page: 1 })}>Xem lịch sử</Link>
              </div>
            </article>
          );
        }) : (
          <AdminStatePanel title="Chưa có khách hàng" message="Chưa có khách hàng hoạt động để theo dõi hạn mức AI." tone="empty" />
        )}
      </section>

      <p className="sectionEyebrow">Lịch sử sử dụng</p>
      <section className={`card ${styles.historyCard}`}>
        <div className={styles.historyHeader}>
          <span>
            <strong>Chi tiết từng lượt</strong>
            <small>Đối soát theo thời gian, nguồn, model, token và mức quy đổi USD.</small>
          </span>
          <b>{summary.eventCount} lượt</b>
        </div>
        {eventPage.events.length ? (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Nguồn / tính năng</th>
                  <th>Khách hàng</th>
                  <th>Model</th>
                  <th>Token vào</th>
                  <th>Token ra</th>
                  <th>Tổng token</th>
                  <th>USD</th>
                </tr>
              </thead>
              <tbody>
                {eventPage.events.map((event) => (
                  <tr key={event.id}>
                    <td>{dateTimeText(event.occurredAt)}</td>
                    <td><strong>{sourceLabel(event.source)}</strong><small>{featureLabel(event.feature)}</small></td>
                    <td>{event.customerId ? (customerNameById.get(event.customerId) ?? 'Khách hàng') : 'Nội bộ Công Ty'}</td>
                    <td>{event.model}</td>
                    <td>{tokenText(event.promptTokens)}</td>
                    <td>{tokenText(event.outputTokens + event.thinkingTokens)}</td>
                    <td>{tokenText(event.totalTokens)}</td>
                    <td><strong>{usdText(event.usageUsd)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <AdminStatePanel title="Chưa có lượt sử dụng" message="Không có lượt AI phù hợp với bộ lọc hiện tại." tone="empty" />}
        <nav className={styles.pagination} aria-label="Phân trang lịch sử AI">
          {page > 1 ? <Link href={filterHref(state, { page: page - 1 })}>← Trang trước</Link> : <span />}
          <small>Trang {page}</small>
          {hasNextPage ? <Link href={filterHref(state, { page: page + 1 })}>Trang sau →</Link> : <span />}
        </nav>
      </section>
    </AdminShell>
  );
}
