import 'server-only';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { CoreApiError, requestCore } from '../../lib/core-api';
import { resolveReportRange, reportPeriods, type ReportPeriod } from './report-data';
import styles from './mcp-supervision.module.css';

type Row = Record<string, unknown>;
type View = 'overview' | 'people' | 'person' | 'routes' | 'outlets' | 'outlet' | 'checkin' | 'map' | 'anomalies';

export type McpReportSearchParams = {
  view?: string;
  actor?: string;
  route?: string;
  outlet?: string;
  q?: string;
  status?: string;
  page?: string;
  returnTo?: string;
};

const PAGE_SIZE = 25;
const ANOMALY_PAGE_SIZE = 20;

function isRow(value: unknown): value is Row {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter(isRow) : [];
}

function record(value: unknown): Row {
  return isRow(value) ? value : {};
}

function text(row: Row, key: string, fallback = 'Chưa có dữ liệu'): string {
  const value = row[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function optionalText(row: Row, key: string): string | null {
  const value = row[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function bool(row: Row, key: string): boolean {
  return row[key] === true;
}

function numberValue(row: Row, key: string): number | null {
  const raw = optionalText(row, key);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function integer(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
}

function formattedNumber(value: number): string {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value);
}

function dateTime(value: unknown): string {
  if (!value) return 'Chưa có dữ liệu';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(date);
}

function shortDate(value: unknown): string {
  if (!value) return 'Chưa có dữ liệu';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(date);
}

function stateLabel(value: string): string {
  const labels: Record<string, string> = {
    active: 'Đang thực hiện',
    completed: 'Đã hoàn tất',
    closed: 'Đã hoàn tất',
    visited: 'Đã ghé',
    pending: 'Chưa ghé',
    skipped: 'Bỏ qua',
  };
  return labels[value] ?? 'Đang xử lý';
}

function locationLabel(value: string): string {
  const labels: Record<string, string> = {
    consistent: 'Vị trí phù hợp',
    review: 'Cần kiểm tra vị trí',
    insufficient: 'Chưa đủ bằng chứng vị trí',
    not_checked_in: 'Chưa check-in',
  };
  return labels[value] ?? 'Chưa đủ bằng chứng vị trí';
}

function locationTone(value: string): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (value === 'consistent') return 'ok';
  if (value === 'review') return 'danger';
  if (value === 'insufficient') return 'warn';
  return 'neutral';
}

function identityCandidates(row: Row): string[] {
  return ['employeeId', 'employeeCode', 'salesLabel', 'employeeName']
    .map((key) => optionalText(row, key))
    .filter((value): value is string => Boolean(value));
}

function actorKey(row: Row): string {
  return identityCandidates(row)[0] ?? 'actor-unmapped';
}

function actorMatches(row: Row, key: string): boolean {
  return identityCandidates(row).includes(key);
}

function sameActor(left: Row, right: Row): boolean {
  const rightKeys = new Set(identityCandidates(right));
  return identityCandidates(left).some((value) => rightKeys.has(value));
}

function routeKey(row: Row): string {
  return optionalText(row, 'routeId')
    ?? `${actorKey(row)}::${text(row, 'routeName', 'Tuyến chưa có tên')}`;
}

function routeMatchesSession(route: Row, session: Row): boolean {
  const routeId = optionalText(route, 'routeId');
  const sessionRouteId = optionalText(session, 'routeId');
  if (routeId && sessionRouteId) return routeId === sessionRouteId && sameActor(route, session);
  return text(route, 'routeName', '') === text(session, 'routeName', '') && sameActor(route, session);
}

function customerKey(row: Row): string {
  return optionalText(row, 'routeCustomerId')
    ?? optionalText(row, 'customerId')
    ?? `${text(row, 'customerName', 'Điểm bán chưa có tên')}::${text(row, 'address', '')}`;
}

function latestOutletRows(input: Row[]): Row[] {
  const seen = new Set<string>();
  const result: Row[] = [];
  input.forEach((row) => {
    const key = customerKey(row);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(row);
  });
  return result;
}

function sumRows(input: Row[], key: string): number {
  return input.reduce((total, row) => total + (numberValue(row, key) ?? 0), 0);
}

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)));
}

function safePage(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function paginate<T>(input: T[], requestedPage: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(input.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (page - 1) * pageSize;
  return {
    page,
    totalPages,
    total: input.length,
    items: input.slice(start, start + pageSize),
  };
}

function normalizeSearch(value: string | undefined): string {
  return String(value ?? '').trim().slice(0, 80);
}

function includesSearch(row: Row, query: string, keys: string[]): boolean {
  if (!query) return true;
  const normalized = query.toLocaleLowerCase('vi-VN');
  return keys.some((key) => text(row, key, '').toLocaleLowerCase('vi-VN').includes(normalized));
}

function buildHref(
  period: ReportPeriod,
  current: McpReportSearchParams,
  patch: Record<string, string | null | undefined>,
): string {
  const params = new URLSearchParams();
  params.set('period', period);
  if (current.returnTo) params.set('returnTo', current.returnTo);

  for (const key of ['view', 'actor', 'route', 'outlet', 'q', 'status', 'page'] as const) {
    const value = current[key];
    if (value) params.set(key, value);
  }

  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === '') params.delete(key);
    else params.set(key, value);
  }
  return `?${params.toString()}`;
}

function parentView(view: View): 'overview' | 'people' | 'routes' | 'outlets' | 'anomalies' {
  if (view === 'person') return 'people';
  if (view === 'map') return 'routes';
  if (view === 'outlet' || view === 'checkin') return 'outlets';
  if (view === 'overview' || view === 'people' || view === 'routes' || view === 'outlets' || view === 'anomalies') return view;
  return 'overview';
}

function viewFrom(value: string | undefined): View {
  const allowed: View[] = ['overview', 'people', 'person', 'routes', 'outlets', 'outlet', 'checkin', 'map', 'anomalies'];
  return allowed.includes(value as View) ? value as View : 'overview';
}

function outletStatus(row: Row): 'visited' | 'pending' | 'review' | 'insufficient' {
  const location = text(row, 'locationStatus', 'not_checked_in');
  if (location === 'review') return 'review';
  if (location === 'insufficient') return 'insufficient';
  return text(row, 'visitStatus', '') === 'visited' ? 'visited' : 'pending';
}

function mapCoordinate(row: Row): { lat: number; lng: number; source: string } | null {
  const checkinLat = numberValue(row, 'checkinLat');
  const checkinLng = numberValue(row, 'checkinLng');
  if (bool(row, 'checkedIn') && checkinLat !== null && checkinLng !== null) {
    return { lat: checkinLat, lng: checkinLng, source: 'GPS check-in' };
  }
  const outletLat = numberValue(row, 'outletLat');
  const outletLng = numberValue(row, 'outletLng');
  if (outletLat !== null && outletLng !== null) {
    return { lat: outletLat, lng: outletLng, source: 'GPS điểm bán' };
  }
  return null;
}

function googleMapsHref(lat: string | null, lng: string | null): string | null {
  if (!lat || !lng) return null;
  const latValue = Number(lat);
  const lngValue = Number(lng);
  if (!Number.isFinite(latValue) || !Number.isFinite(lngValue)) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latValue},${lngValue}`)}`;
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return 'NV';
  return parts.slice(-2).map((part) => part.charAt(0).toLocaleUpperCase('vi-VN')).join('');
}

function toneClass(tone: 'ok' | 'warn' | 'danger' | 'neutral'): string {
  if (tone === 'ok') return styles.badgeOk;
  if (tone === 'warn') return styles.badgeWarn;
  if (tone === 'danger') return styles.badgeDanger;
  return styles.badgeNeutral;
}

function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'ok' | 'warn' | 'danger' | 'neutral' }) {
  return <span className={`${styles.badge} ${toneClass(tone)}`}>{label}</span>;
}

function Pagination({
  page,
  totalPages,
  hrefForPage,
}: {
  page: number;
  totalPages: number;
  hrefForPage: (page: number) => string;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className={styles.pagination} aria-label="Phân trang">
      {page > 1 ? <Link className={styles.secondaryAction} href={hrefForPage(page - 1)}>← Trang trước</Link> : <span />}
      <span>Trang {page}/{totalPages}</span>
      {page < totalPages ? <Link className={styles.secondaryAction} href={hrefForPage(page + 1)}>Trang sau →</Link> : <span />}
    </nav>
  );
}

function SearchBar({
  period,
  searchParams,
  placeholder,
}: {
  period: ReportPeriod;
  searchParams: McpReportSearchParams;
  placeholder: string;
}) {
  return (
    <form className={styles.searchBar} method="get">
      <input type="hidden" name="period" value={period} />
      <input type="hidden" name="view" value={searchParams.view ?? 'overview'} />
      {searchParams.returnTo ? <input type="hidden" name="returnTo" value={searchParams.returnTo} /> : null}
      {searchParams.actor ? <input type="hidden" name="actor" value={searchParams.actor} /> : null}
      {searchParams.route ? <input type="hidden" name="route" value={searchParams.route} /> : null}
      {searchParams.status ? <input type="hidden" name="status" value={searchParams.status} /> : null}
      <label className={styles.searchField}>
        <span className={styles.srOnly}>Tìm kiếm</span>
        <input name="q" defaultValue={searchParams.q ?? ''} placeholder={placeholder} maxLength={80} />
      </label>
      <button className={styles.secondaryAction} type="submit">Tìm kiếm</button>
    </form>
  );
}

async function load(period: ReportPeriod): Promise<{ data: Row | null; message: string | null }> {
  const range = resolveReportRange(period);
  const query = new URLSearchParams({ from: range.from, to: range.to });
  try {
    const value = await requestCore<unknown>(`/api/reporting/mcp-supervision?${query.toString()}`);
    return isRow(value)
      ? { data: value, message: null }
      : { data: null, message: 'Dữ liệu giám sát chưa sẵn sàng.' };
  } catch (error) {
    if (error instanceof CoreApiError && error.statusCode === 403) {
      return { data: null, message: 'Tài khoản hiện tại không có quyền xem giám sát MCP.' };
    }
    return { data: null, message: 'Không thể tải giám sát MCP ở thời điểm hiện tại.' };
  }
}

export async function McpSupervision({
  period,
  searchParams = {},
  backHref = '/reports',
  backLabel = '← Quay lại báo cáo',
}: {
  period: ReportPeriod;
  searchParams?: McpReportSearchParams;
  backHref?: string;
  backLabel?: string;
}) {
  const view = viewFrom(searchParams.view);
  const rootView = parentView(view);
  const result = await load(period);
  const data = result.data ?? {};
  const summary = record(data.summary);
  const actors = rows(data.fieldActors);
  const routes = rows(data.routes);
  const sessions = rows(data.sessions);
  const outlets = rows(data.outlets);
  const anomalies = rows(data.anomalies);
  const query = normalizeSearch(searchParams.q);
  const requestedPage = safePage(searchParams.page);

  const sessionById = new Map(
    sessions
      .map((session) => [optionalText(session, 'sessionId'), session] as const)
      .filter((entry): entry is [string, Row] => Boolean(entry[0])),
  );

  const routeForOutlet = (outlet: Row): Row | null => {
    const session = sessionById.get(optionalText(outlet, 'sessionId') ?? '');
    if (!session) return null;
    return routes.find((route) => routeMatchesSession(route, session)) ?? null;
  };

  const tabs: Array<{ view: 'overview' | 'people' | 'routes' | 'outlets' | 'anomalies'; label: string }> = [
    { view: 'overview', label: 'Tổng quan' },
    { view: 'people', label: 'Nhân viên' },
    { view: 'routes', label: 'Tuyến' },
    { view: 'outlets', label: 'Điểm bán' },
    { view: 'anomalies', label: 'Bất thường' },
  ];

  const plannedOutletCount = sumRows(actors, 'plannedOutletCount');
  const plannedVisitedCount = sumRows(actors, 'plannedVisitedOutletCount');
  const plannedCompletion = percent(plannedVisitedCount, plannedOutletCount);

  const selectedActor = searchParams.actor
    ? actors.find((actor) => actorKey(actor) === searchParams.actor) ?? null
    : null;
  const selectedRoute = searchParams.route
    ? routes.find((route) => routeKey(route) === searchParams.route) ?? null
    : null;
  const selectedOutlet = searchParams.outlet
    ? outlets.find((outlet) => optionalText(outlet, 'sessionCustomerId') === searchParams.outlet) ?? null
    : null;

  const top = (
    <>
      <div className={styles.topline}>
        <Link className={styles.backLink} href={backHref}>{backLabel}</Link>
        <span className={styles.readOnlyNote}>Dữ liệu giám sát · chỉ xem</span>
      </div>

      <nav className={styles.tabBar} aria-label="Báo cáo MCP">
        {tabs.map((tab) => (
          <Link
            aria-current={rootView === tab.view ? 'page' : undefined}
            className={`${styles.tab} ${rootView === tab.view ? styles.tabActive : ''}`}
            href={buildHref(period, searchParams, {
              view: tab.view,
              actor: null,
              route: null,
              outlet: null,
              q: null,
              status: null,
              page: null,
            })}
            key={tab.view}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className={styles.periodBar}>
        <span>Kỳ xem</span>
        <div className={styles.periodChoices}>
          {reportPeriods.map((candidate) => (
            <Link
              aria-current={candidate === period ? 'page' : undefined}
              className={`${styles.periodChoice} ${candidate === period ? styles.periodChoiceActive : ''}`}
              href={buildHref(candidate, searchParams, { page: null })}
              key={candidate}
            >
              {candidate}
            </Link>
          ))}
        </div>
      </div>
    </>
  );

  if (result.message || !result.data) {
    return (
      <div className={styles.experience}>
        {top}
        <section className={styles.emptyState} role="status">
          <h2>Chưa thể mở giám sát MCP</h2>
          <p>{result.message ?? 'Dữ liệu giám sát chưa sẵn sàng.'}</p>
        </section>
      </div>
    );
  }

  let content: ReactNode = null;

  if (view === 'overview') {
    const visited = integer(text(summary, 'visitedOutletCount', '0'));
    const checkins = integer(text(summary, 'checkinCount', '0'));
    const anomalyCount = integer(text(summary, 'anomalyCount', '0'));
    const reviewLocations = integer(text(summary, 'reviewLocationCount', '0'));
    content = (
      <>
        <section className={styles.kpiGrid} aria-label="Chỉ số tổng quan MCP">
          <Link className={styles.kpiCard} href={buildHref(period, searchParams, { view: 'people', page: null })}>
            <span>Nhân viên</span>
            <strong>{formattedNumber(integer(text(summary, 'employeeCount', '0')))}</strong>
            <small>{actors.filter((actor) => integer(text(actor, 'sessionCount', '0')) > 0).length} có hoạt động</small>
            <b>Xem nhân viên →</b>
          </Link>
          <Link className={styles.kpiCard} href={buildHref(period, searchParams, { view: 'routes', page: null })}>
            <span>Tuyến</span>
            <strong>{formattedNumber(integer(text(summary, 'routeCount', '0')))}</strong>
            <small>{routes.filter((route) => integer(text(route, 'sessionCount', '0')) > 0).length} có phiên</small>
            <b>Xem tuyến →</b>
          </Link>
          <Link className={styles.kpiCard} href={buildHref(period, searchParams, { view: 'outlets', page: null })}>
            <span>Điểm kế hoạch</span>
            <strong>{formattedNumber(plannedOutletCount)}</strong>
            <small>Đã ghé {formattedNumber(plannedVisitedCount)} · {plannedCompletion}%</small>
            <b>Xem điểm bán →</b>
          </Link>
          <Link className={`${styles.kpiCard} ${anomalyCount ? styles.kpiAttention : ''}`} href={buildHref(period, searchParams, { view: 'anomalies', page: null })}>
            <span>Bất thường</span>
            <strong>{formattedNumber(anomalyCount)}</strong>
            <small>{reviewLocations} vị trí cần kiểm tra</small>
            <b>Xem bất thường →</b>
          </Link>
        </section>

        <section className={styles.surface}>
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.eyebrow}>Tiến độ thực địa</span>
              <h2>{plannedCompletion}% điểm kế hoạch đã ghé</h2>
            </div>
            <Badge label={`${formattedNumber(checkins)} check-in`} tone={checkins ? 'ok' : 'neutral'} />
          </div>
          <progress className={styles.progress} max={100} value={plannedCompletion}>{plannedCompletion}%</progress>
          <div className={styles.summaryRows}>
            <div><span>Điểm đã ghé trong dữ liệu giám sát</span><strong>{formattedNumber(visited)}</strong></div>
            <div><span>Phiên đi tuyến</span><strong>{formattedNumber(integer(text(summary, 'sessionCount', '0')))}</strong></div>
            <div><span>Check-in đã ghi nhận</span><strong>{formattedNumber(checkins)}</strong></div>
            <div><span>Vị trí cần kiểm tra</span><strong>{formattedNumber(reviewLocations)}</strong></div>
          </div>
        </section>

        <section className={styles.surface}>
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.eyebrow}>Cần chú ý</span>
              <h2>Bất thường mới trong kỳ</h2>
            </div>
            <Link className={styles.textAction} href={buildHref(period, searchParams, { view: 'anomalies', page: null })}>Xem tất cả →</Link>
          </div>
          <div className={styles.compactList}>
            {anomalies.slice(0, 5).map((row, index) => {
              const alertId = text(row, 'id', '');
              return (
                <div className={styles.compactRow} key={`${alertId || index}-${index}`}>
                  <div>
                    <strong>{text(row, 'title', 'Cần kiểm tra')}</strong>
                    <span>{text(row, 'entity', 'Điểm bán')} · {text(row, 'employeeName', 'Chưa xác định nhân viên')}</span>
                  </div>
                  {alertId ? <Link className={styles.textAction} href={`/alerts/${encodeURIComponent(alertId)}?period=${encodeURIComponent(period)}`}>Mở cảnh báo</Link> : null}
                </div>
              );
            })}
            {!anomalies.length ? <p className={styles.emptyInline}>Không phát hiện bất thường MCP trong kỳ đang xem.</p> : null}
          </div>
        </section>
      </>
    );
  }

  if (view === 'people') {
    const filtered = actors.filter((row) => includesSearch(row, query, ['employeeName', 'employeeCode', 'salesLabel']));
    const page = paginate(filtered, requestedPage, PAGE_SIZE);
    content = (
      <section className={styles.surface}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>Nhân viên thị trường</span>
            <h2>{formattedNumber(filtered.length)} nhân viên</h2>
          </div>
        </div>
        <SearchBar period={period} searchParams={{ ...searchParams, view: 'people' }} placeholder="Tìm tên hoặc mã nhân viên" />
        <div className={styles.list}>
          {page.items.map((row) => {
            const key = actorKey(row);
            const actorAnomalies = anomalies.filter((alert) => actorMatches(alert, key)).length;
            const visitRate = integer(text(row, 'plannedVisitRatePercent', '0'));
            return (
              <div className={styles.listRow} key={key}>
                <div className={styles.personCell}>
                  <span className={styles.avatar}>{initials(text(row, 'employeeName', text(row, 'salesLabel', 'Nhân viên')))}</span>
                  <div>
                    <strong>{text(row, 'employeeName', text(row, 'salesLabel', 'Nhân viên chưa khớp hồ sơ'))}</strong>
                    <span>{text(row, 'employeeCode', text(row, 'salesLabel', 'Chưa có mã'))}</span>
                    <small>{text(row, 'routeCount', '0')} tuyến · {text(row, 'plannedVisitedOutletCount', '0')}/{text(row, 'plannedOutletCount', '0')} điểm kế hoạch</small>
                  </div>
                </div>
                <div className={styles.rowMetrics}>
                  <Badge label={`${visitRate}% đã ghé`} tone={visitRate >= 90 ? 'ok' : visitRate >= 70 ? 'warn' : 'danger'} />
                  {actorAnomalies ? <Badge label={`${actorAnomalies} bất thường`} tone="danger" /> : <Badge label="Không có bất thường" tone="ok" />}
                </div>
                <div className={styles.rowActions}>
                  <Link className={styles.primaryAction} href={buildHref(period, searchParams, { view: 'person', actor: key, route: null, outlet: null, q: null, page: null })}>Xem chi tiết</Link>
                </div>
              </div>
            );
          })}
          {!page.items.length ? <p className={styles.emptyInline}>Không tìm thấy nhân viên phù hợp.</p> : null}
        </div>
        <Pagination page={page.page} totalPages={page.totalPages} hrefForPage={(candidate) => buildHref(period, searchParams, { view: 'people', page: String(candidate) })} />
      </section>
    );
  }

  if (view === 'person') {
    if (!selectedActor) {
      content = (
        <section className={styles.emptyState}>
          <h2>Không tìm thấy nhân viên</h2>
          <p>Dữ liệu có thể đã thay đổi. Quay lại danh sách để chọn lại nhân viên.</p>
          <Link className={styles.primaryAction} href={buildHref(period, searchParams, { view: 'people', actor: null, page: null })}>Quay lại danh sách nhân viên</Link>
        </section>
      );
    } else {
      const key = actorKey(selectedActor);
      const actorRoutes = routes.filter((route) => actorMatches(route, key));
      const actorSessions = sessions.filter((session) => actorMatches(session, key));
      const actorAnomalies = anomalies.filter((alert) => actorMatches(alert, key));
      const visitRate = integer(text(selectedActor, 'plannedVisitRatePercent', '0'));
      content = (
        <>
          <section className={styles.surface}>
            <Link className={styles.backLink} href={buildHref(period, searchParams, { view: 'people', actor: null, route: null, outlet: null, page: null })}>← Danh sách nhân viên</Link>
            <div className={styles.profileHeader}>
              <span className={styles.avatarLarge}>{initials(text(selectedActor, 'employeeName', text(selectedActor, 'salesLabel', 'NV')))}</span>
              <div>
                <span className={styles.eyebrow}>Chi tiết nhân viên</span>
                <h2>{text(selectedActor, 'employeeName', text(selectedActor, 'salesLabel', 'Nhân viên chưa khớp hồ sơ'))}</h2>
                <p>{text(selectedActor, 'employeeCode', text(selectedActor, 'salesLabel', 'Chưa có mã nhân viên'))}</p>
              </div>
              <Badge label={actorSessions.length ? 'Có hoạt động trong kỳ' : 'Chưa có hoạt động'} tone={actorSessions.length ? 'ok' : 'neutral'} />
            </div>
            <div className={styles.statsGrid}>
              <div><span>Số tuyến</span><strong>{actorRoutes.length}</strong></div>
              <div><span>Điểm kế hoạch</span><strong>{text(selectedActor, 'plannedOutletCount', '0')}</strong></div>
              <div><span>Đã ghé</span><strong>{text(selectedActor, 'plannedVisitedOutletCount', '0')} ({visitRate}%)</strong></div>
              <div><span>Bất thường</span><strong>{actorAnomalies.length}</strong></div>
            </div>
          </section>

          <section className={styles.surface}>
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.eyebrow}>Hiệu suất theo tuyến</span>
                <h2>{actorRoutes.length} tuyến trong kỳ</h2>
              </div>
            </div>
            <div className={styles.list}>
              {actorRoutes.map((route) => {
                const ref = routeKey(route);
                const rate = integer(text(route, 'plannedVisitRatePercent', '0'));
                return (
                  <div className={styles.listRow} key={ref}>
                    <div>
                      <strong>{text(route, 'routeName', 'Tuyến chưa có tên')}</strong>
                      <span>{text(route, 'area', 'Chưa có khu vực')} · {text(route, 'plannedVisitedOutletCount', '0')}/{text(route, 'plannedOutletCount', '0')} điểm</span>
                    </div>
                    <Badge label={`${rate}%`} tone={rate >= 90 ? 'ok' : rate >= 70 ? 'warn' : 'danger'} />
                    <div className={styles.rowActions}>
                      <Link className={styles.primaryAction} href={buildHref(period, searchParams, { view: 'outlets', actor: key, route: ref, outlet: null, q: null, page: null })}>Xem điểm bán</Link>
                      <Link className={styles.secondaryAction} href={buildHref(period, searchParams, { view: 'map', actor: key, route: ref, outlet: null, q: null, page: null })}>Bản đồ tuyến</Link>
                    </div>
                  </div>
                );
              })}
              {!actorRoutes.length ? <p className={styles.emptyInline}>Nhân viên chưa có tuyến trong kỳ đang xem.</p> : null}
            </div>
          </section>

          <section className={styles.surface}>
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.eyebrow}>Hoạt động gần nhất</span>
                <h2>Các phiên đi tuyến</h2>
              </div>
            </div>
            <div className={styles.timeline}>
              {actorSessions.slice(0, 8).map((session, index) => {
                const route = routes.find((candidate) => routeMatchesSession(candidate, session));
                const ref = route ? routeKey(route) : null;
                return (
                  <div className={styles.timelineRow} key={optionalText(session, 'sessionId') ?? `session-${index}`}>
                    <time>{shortDate(optionalText(session, 'sessionDate'))}</time>
                    <div>
                      <strong>{text(session, 'routeName', 'Tuyến chưa có tên')}</strong>
                      <span>{stateLabel(text(session, 'status', ''))} · bắt đầu {dateTime(session.openedAt)}</span>
                    </div>
                    {ref ? <Link className={styles.textAction} href={buildHref(period, searchParams, { view: 'outlets', actor: key, route: ref, page: null })}>Xem điểm bán →</Link> : null}
                  </div>
                );
              })}
              {!actorSessions.length ? <p className={styles.emptyInline}>Chưa có phiên đi tuyến trong kỳ.</p> : null}
            </div>
          </section>
        </>
      );
    }
  }

  if (view === 'routes') {
    const filtered = routes.filter((row) => includesSearch(row, query, ['routeName', 'routeCode', 'area', 'employeeName', 'employeeCode', 'salesLabel']));
    const page = paginate(filtered, requestedPage, PAGE_SIZE);
    content = (
      <section className={styles.surface}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>Danh sách tuyến</span>
            <h2>{formattedNumber(filtered.length)} tuyến</h2>
          </div>
        </div>
        <SearchBar period={period} searchParams={{ ...searchParams, view: 'routes' }} placeholder="Tìm tuyến, khu vực hoặc nhân viên" />
        <div className={styles.list}>
          {page.items.map((row) => {
            const ref = routeKey(row);
            const rate = integer(text(row, 'plannedVisitRatePercent', '0'));
            return (
              <div className={styles.listRow} key={ref}>
                <div>
                  <strong>{text(row, 'routeName', 'Tuyến chưa có tên')}</strong>
                  <span>{text(row, 'area', 'Chưa có khu vực')}</span>
                  <small>{text(row, 'employeeName', text(row, 'salesLabel', 'Chưa phân công'))} · {text(row, 'plannedVisitedOutletCount', '0')}/{text(row, 'plannedOutletCount', '0')} điểm</small>
                </div>
                <Badge label={`${rate}% đã ghé`} tone={rate >= 90 ? 'ok' : rate >= 70 ? 'warn' : 'danger'} />
                <div className={styles.rowActions}>
                  <Link className={styles.primaryAction} href={buildHref(period, searchParams, { view: 'outlets', route: ref, actor: actorKey(row), outlet: null, q: null, page: null })}>Xem điểm bán</Link>
                  <Link className={styles.secondaryAction} href={buildHref(period, searchParams, { view: 'map', route: ref, actor: actorKey(row), outlet: null, q: null, page: null })}>Bản đồ tuyến</Link>
                </div>
              </div>
            );
          })}
          {!page.items.length ? <p className={styles.emptyInline}>Không tìm thấy tuyến phù hợp.</p> : null}
        </div>
        <Pagination page={page.page} totalPages={page.totalPages} hrefForPage={(candidate) => buildHref(period, searchParams, { view: 'routes', page: String(candidate) })} />
      </section>
    );
  }

  if (view === 'outlets') {
    let scopedRows = outlets;
    if (selectedActor) {
      const key = actorKey(selectedActor);
      scopedRows = scopedRows.filter((row) => actorMatches(row, key));
    } else if (searchParams.actor) {
      scopedRows = scopedRows.filter((row) => actorMatches(row, searchParams.actor as string));
    }
    if (selectedRoute) {
      const routeSessionIds = new Set(
        sessions
          .filter((session) => routeMatchesSession(selectedRoute, session))
          .map((session) => optionalText(session, 'sessionId'))
          .filter((value): value is string => Boolean(value)),
      );
      scopedRows = scopedRows.filter((row) => routeSessionIds.has(optionalText(row, 'sessionId') ?? ''));
    }

    const uniqueRows = latestOutletRows(scopedRows);
    const status = ['all', 'visited', 'pending', 'review', 'insufficient'].includes(String(searchParams.status))
      ? String(searchParams.status)
      : 'all';
    const filtered = uniqueRows
      .filter((row) => status === 'all' || outletStatus(row) === status)
      .filter((row) => {
        if (!query) return true;
        const route = routeForOutlet(row);
        return includesSearch(row, query, ['customerName', 'address', 'employeeName', 'employeeCode'])
          || (route ? includesSearch(route, query, ['routeName', 'routeCode', 'area']) : false);
      });
    const page = paginate(filtered, requestedPage, PAGE_SIZE);
    const scopeTitle = selectedRoute
      ? text(selectedRoute, 'routeName', 'Tuyến')
      : selectedActor
        ? text(selectedActor, 'employeeName', 'Nhân viên')
        : 'Toàn bộ điểm bán';

    content = (
      <section className={styles.surface}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>Danh sách điểm bán</span>
            <h2>{scopeTitle}</h2>
            <p>{formattedNumber(filtered.length)} điểm phù hợp bộ lọc</p>
          </div>
          {selectedRoute ? <Link className={styles.secondaryAction} href={buildHref(period, searchParams, { view: 'map', route: searchParams.route, page: null })}>Bản đồ tuyến</Link> : null}
        </div>

        <SearchBar period={period} searchParams={{ ...searchParams, view: 'outlets' }} placeholder="Tìm tên hoặc địa chỉ điểm bán" />

        <nav className={styles.filterBar} aria-label="Lọc trạng thái điểm bán">
          {[
            ['all', 'Tất cả'],
            ['visited', 'Đã ghé'],
            ['pending', 'Chưa ghé'],
            ['review', 'GPS cần kiểm tra'],
            ['insufficient', 'Thiếu bằng chứng'],
          ].map(([key, label]) => (
            <Link
              aria-current={status === key ? 'page' : undefined}
              className={`${styles.filterChip} ${status === key ? styles.filterChipActive : ''}`}
              href={buildHref(period, searchParams, { view: 'outlets', status: key === 'all' ? null : key, page: null })}
              key={key}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className={styles.list}>
          {page.items.map((row) => {
            const session = sessionById.get(optionalText(row, 'sessionId') ?? '');
            const route = routeForOutlet(row);
            const location = text(row, 'locationStatus', 'not_checked_in');
            return (
              <div className={styles.listRow} key={optionalText(row, 'sessionCustomerId') ?? customerKey(row)}>
                <div>
                  <strong>{text(row, 'customerName', 'Điểm bán chưa có tên')}</strong>
                  <span>{text(row, 'address', 'Chưa có địa chỉ')}</span>
                  <small>{text(row, 'employeeName', 'Chưa xác định nhân viên')} · {route ? text(route, 'routeName', 'Chưa có tuyến') : text(session ?? {}, 'routeName', 'Chưa có tuyến')}</small>
                </div>
                <div className={styles.rowMetrics}>
                  <Badge label={text(row, 'visitStatus', '') === 'visited' ? 'Đã ghé' : 'Chưa ghé'} tone={text(row, 'visitStatus', '') === 'visited' ? 'ok' : 'neutral'} />
                  <Badge label={locationLabel(location)} tone={locationTone(location)} />
                </div>
                <div className={styles.rowActions}>
                  <Link className={styles.primaryAction} href={buildHref(period, searchParams, { view: 'outlet', outlet: optionalText(row, 'sessionCustomerId'), page: null })}>Xem chi tiết</Link>
                </div>
              </div>
            );
          })}
          {!page.items.length ? <p className={styles.emptyInline}>Không có điểm bán phù hợp bộ lọc.</p> : null}
        </div>

        <Pagination page={page.page} totalPages={page.totalPages} hrefForPage={(candidate) => buildHref(period, searchParams, { view: 'outlets', page: String(candidate) })} />
      </section>
    );
  }

  if (view === 'outlet') {
    if (!selectedOutlet) {
      content = (
        <section className={styles.emptyState}>
          <h2>Không tìm thấy điểm bán</h2>
          <p>Dữ liệu có thể đã thay đổi. Quay lại danh sách để chọn lại.</p>
          <Link className={styles.primaryAction} href={buildHref(period, searchParams, { view: 'outlets', outlet: null, page: null })}>Quay lại danh sách điểm bán</Link>
        </section>
      );
    } else {
      const key = customerKey(selectedOutlet);
      const history = outlets.filter((row) => customerKey(row) === key);
      const session = sessionById.get(optionalText(selectedOutlet, 'sessionId') ?? '');
      const route = routeForOutlet(selectedOutlet);
      const location = text(selectedOutlet, 'locationStatus', 'not_checked_in');
      const relatedAlerts = anomalies.filter((alert) => optionalText(alert, 'sessionCustomerId') === optionalText(selectedOutlet, 'sessionCustomerId'));
      content = (
        <>
          <section className={styles.surface}>
            <Link className={styles.backLink} href={buildHref(period, searchParams, { view: 'outlets', outlet: null, page: null })}>← Danh sách điểm bán</Link>
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.eyebrow}>Chi tiết điểm bán</span>
                <h2>{text(selectedOutlet, 'customerName', 'Điểm bán chưa có tên')}</h2>
                <p>{text(selectedOutlet, 'address', 'Chưa có địa chỉ')}</p>
              </div>
              <Badge label={text(selectedOutlet, 'visitStatus', '') === 'visited' ? 'Đã ghé' : 'Chưa ghé'} tone={text(selectedOutlet, 'visitStatus', '') === 'visited' ? 'ok' : 'neutral'} />
            </div>

            <div className={styles.detailGrid}>
              <div><span>Nhân viên</span><strong>{text(selectedOutlet, 'employeeName', 'Chưa xác định')}</strong></div>
              <div><span>Tuyến</span><strong>{route ? text(route, 'routeName', 'Chưa có tuyến') : text(session ?? {}, 'routeName', 'Chưa có tuyến')}</strong></div>
              <div><span>Ngày phiên</span><strong>{shortDate(optionalText(selectedOutlet, 'sessionDate'))}</strong></div>
              <div><span>Hoạt động liên kết</span><strong>{bool(selectedOutlet, 'hasLinkedActivity') ? 'Có ghi nhận' : 'Chưa ghi nhận'}</strong></div>
            </div>
          </section>

          <section className={styles.surface}>
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.eyebrow}>Check-in gần nhất</span>
                <h2>{locationLabel(location)}</h2>
              </div>
              <Badge label={bool(selectedOutlet, 'checkedIn') ? 'Đã check-in' : 'Chưa check-in'} tone={bool(selectedOutlet, 'checkedIn') ? locationTone(location) : 'neutral'} />
            </div>
            <div className={styles.summaryRows}>
              <div><span>Thời gian check-in</span><strong>{bool(selectedOutlet, 'checkedIn') ? dateTime(selectedOutlet.checkinAt) : 'Chưa check-in'}</strong></div>
              <div><span>Khoảng cách GPS</span><strong>{optionalText(selectedOutlet, 'distanceMeters') ? `${text(selectedOutlet, 'distanceMeters')} m` : 'Chưa có dữ liệu'}</strong></div>
              <div><span>Vùng sai số tổng</span><strong>{optionalText(selectedOutlet, 'uncertaintyMeters') ? `${text(selectedOutlet, 'uncertaintyMeters')} m` : 'Chưa có dữ liệu'}</strong></div>
            </div>
            <div className={styles.actionBar}>
              <Link className={styles.primaryAction} href={buildHref(period, searchParams, { view: 'checkin', outlet: optionalText(selectedOutlet, 'sessionCustomerId') })}>Xem chi tiết check-in</Link>
              {route ? <Link className={styles.secondaryAction} href={buildHref(period, searchParams, { view: 'map', route: routeKey(route), actor: actorKey(route), outlet: null })}>Bản đồ tuyến</Link> : null}
            </div>
          </section>

          {relatedAlerts.length ? (
            <section className={styles.surface}>
              <div className={styles.sectionHeading}>
                <div>
                  <span className={styles.eyebrow}>Cần chú ý</span>
                  <h2>{relatedAlerts.length} bất thường liên quan</h2>
                </div>
              </div>
              <div className={styles.compactList}>
                {relatedAlerts.map((row, index) => {
                  const alertId = text(row, 'id', '');
                  return (
                    <div className={styles.compactRow} key={`${alertId || index}-${index}`}>
                      <div><strong>{text(row, 'title', 'Cần kiểm tra')}</strong><span>{text(row, 'actual', '')}</span></div>
                      {alertId ? <Link className={styles.primaryAction} href={`/alerts/${encodeURIComponent(alertId)}?period=${encodeURIComponent(period)}`}>Mở cảnh báo</Link> : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section className={styles.surface}>
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.eyebrow}>Lịch sử trong kỳ</span>
                <h2>{history.length} phiên có điểm bán này</h2>
              </div>
            </div>
            <div className={styles.timeline}>
              {history.slice(0, 10).map((row, index) => (
                <div className={styles.timelineRow} key={optionalText(row, 'sessionCustomerId') ?? `history-${index}`}>
                  <time>{shortDate(optionalText(row, 'sessionDate'))}</time>
                  <div>
                    <strong>{text(row, 'visitStatus', '') === 'visited' ? 'Đã ghé' : 'Chưa ghé'}</strong>
                    <span>{locationLabel(text(row, 'locationStatus', 'not_checked_in'))}</span>
                  </div>
                  <Link className={styles.textAction} href={buildHref(period, searchParams, { view: 'checkin', outlet: optionalText(row, 'sessionCustomerId') })}>Xem check-in →</Link>
                </div>
              ))}
            </div>
          </section>
        </>
      );
    }
  }

  if (view === 'checkin') {
    if (!selectedOutlet) {
      content = (
        <section className={styles.emptyState}>
          <h2>Không tìm thấy dữ liệu check-in</h2>
          <p>Dữ liệu có thể đã thay đổi. Quay lại danh sách điểm bán để chọn lại.</p>
          <Link className={styles.primaryAction} href={buildHref(period, searchParams, { view: 'outlets', outlet: null })}>Quay lại điểm bán</Link>
        </section>
      );
    } else {
      const location = text(selectedOutlet, 'locationStatus', 'not_checked_in');
      const outletMap = googleMapsHref(optionalText(selectedOutlet, 'outletLat'), optionalText(selectedOutlet, 'outletLng'));
      const checkinMap = googleMapsHref(optionalText(selectedOutlet, 'checkinLat'), optionalText(selectedOutlet, 'checkinLng'));
      content = (
        <section className={styles.surface}>
          <Link className={styles.backLink} href={buildHref(period, searchParams, { view: 'outlet', outlet: optionalText(selectedOutlet, 'sessionCustomerId') })}>← Chi tiết điểm bán</Link>
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.eyebrow}>Chi tiết check-in</span>
              <h2>{text(selectedOutlet, 'customerName', 'Điểm bán')}</h2>
              <p>Phiên {shortDate(optionalText(selectedOutlet, 'sessionDate'))}</p>
            </div>
            <Badge label={locationLabel(location)} tone={locationTone(location)} />
          </div>

          <div className={styles.detailSections}>
            <section>
              <h3>Thông tin phiên</h3>
              <div className={styles.detailGrid}>
                <div><span>Nhân viên</span><strong>{text(selectedOutlet, 'employeeName', 'Chưa xác định')}</strong></div>
                <div><span>Check-in</span><strong>{bool(selectedOutlet, 'checkedIn') ? dateTime(selectedOutlet.checkinAt) : 'Chưa check-in'}</strong></div>
                <div><span>Trạng thái ghé</span><strong>{stateLabel(text(selectedOutlet, 'visitStatus', 'pending'))}</strong></div>
                <div><span>Hoạt động liên kết</span><strong>{bool(selectedOutlet, 'hasLinkedActivity') ? 'Có ghi nhận' : 'Chưa ghi nhận'}</strong></div>
              </div>
            </section>

            <section>
              <h3>GPS điểm bán</h3>
              <div className={styles.detailGrid}>
                <div><span>Tọa độ</span><strong>{optionalText(selectedOutlet, 'outletLat') && optionalText(selectedOutlet, 'outletLng') ? `${text(selectedOutlet, 'outletLat')}, ${text(selectedOutlet, 'outletLng')}` : 'Chưa có dữ liệu'}</strong></div>
                <div><span>Độ chính xác</span><strong>{optionalText(selectedOutlet, 'outletAccuracy') ? `${text(selectedOutlet, 'outletAccuracy')} m` : 'Chưa có dữ liệu'}</strong></div>
                <div><span>Nguồn</span><strong>{text(selectedOutlet, 'outletGeoSource', 'Chưa có dữ liệu')}</strong></div>
                <div><span>Ghi nhận lúc</span><strong>{dateTime(selectedOutlet.outletGeoCapturedAt)}</strong></div>
              </div>
              {outletMap ? <a className={styles.secondaryAction} href={outletMap} target="_blank" rel="noreferrer">Mở GPS điểm bán trên bản đồ</a> : null}
            </section>

            <section>
              <h3>GPS check-in</h3>
              <div className={styles.detailGrid}>
                <div><span>Tọa độ</span><strong>{optionalText(selectedOutlet, 'checkinLat') && optionalText(selectedOutlet, 'checkinLng') ? `${text(selectedOutlet, 'checkinLat')}, ${text(selectedOutlet, 'checkinLng')}` : 'Chưa có dữ liệu'}</strong></div>
                <div><span>Độ chính xác</span><strong>{optionalText(selectedOutlet, 'checkinAccuracy') ? `${text(selectedOutlet, 'checkinAccuracy')} m` : 'Chưa có dữ liệu'}</strong></div>
                <div><span>Nguồn</span><strong>{text(selectedOutlet, 'checkinSource', 'Chưa có dữ liệu')}</strong></div>
                <div><span>Khoảng cách</span><strong>{optionalText(selectedOutlet, 'distanceMeters') ? `${text(selectedOutlet, 'distanceMeters')} m` : 'Chưa có dữ liệu'}</strong></div>
                <div><span>Vùng sai số tổng</span><strong>{optionalText(selectedOutlet, 'uncertaintyMeters') ? `${text(selectedOutlet, 'uncertaintyMeters')} m` : 'Chưa có dữ liệu'}</strong></div>
                <div><span>Kết luận vị trí</span><strong>{locationLabel(location)}</strong></div>
              </div>
              {checkinMap ? <a className={styles.secondaryAction} href={checkinMap} target="_blank" rel="noreferrer">Mở GPS check-in trên bản đồ</a> : null}
            </section>
          </div>

          <p className={styles.evidenceNote}>Kết luận vị trí dựa trên tọa độ và độ chính xác GPS do hệ thống ghi nhận. Đây là bằng chứng hỗ trợ rà soát, không tự động kết luận hành vi của nhân viên.</p>
        </section>
      );
    }
  }

  if (view === 'map') {
    if (!selectedRoute) {
      content = (
        <section className={styles.emptyState}>
          <h2>Chưa chọn tuyến để xem bản đồ</h2>
          <p>Chọn một tuyến trong danh sách để xem các vị trí GPS đã ghi nhận.</p>
          <Link className={styles.primaryAction} href={buildHref(period, searchParams, { view: 'routes', route: null, page: null })}>Chọn tuyến</Link>
        </section>
      );
    } else {
      const routeSessions = sessions.filter((session) => routeMatchesSession(selectedRoute, session));
      const latestSession = routeSessions[0] ?? null;
      const latestSessionId = latestSession ? optionalText(latestSession, 'sessionId') : null;
      const routeRows = latestSessionId
        ? outlets.filter((row) => optionalText(row, 'sessionId') === latestSessionId)
        : [];
      const rawPoints = routeRows
        .map((row, index) => {
          const coordinate = mapCoordinate(row);
          return coordinate ? { row, index, ...coordinate } : null;
        })
        .filter((value): value is { row: Row; index: number; lat: number; lng: number; source: string } => Boolean(value));

      const latitudes = rawPoints.map((point) => point.lat);
      const longitudes = rawPoints.map((point) => point.lng);
      const minLat = latitudes.length ? Math.min(...latitudes) : 0;
      const maxLat = latitudes.length ? Math.max(...latitudes) : 1;
      const minLng = longitudes.length ? Math.min(...longitudes) : 0;
      const maxLng = longitudes.length ? Math.max(...longitudes) : 1;
      const latSpan = Math.max(maxLat - minLat, 0.0001);
      const lngSpan = Math.max(maxLng - minLng, 0.0001);
      const points = rawPoints.map((point) => ({
        ...point,
        x: 60 + ((point.lng - minLng) / lngSpan) * 880,
        y: 540 - ((point.lat - minLat) / latSpan) * 480,
      }));

      content = (
        <>
          <section className={styles.surface}>
            <Link className={styles.backLink} href={buildHref(period, searchParams, { view: 'routes', route: null, page: null })}>← Danh sách tuyến</Link>
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.eyebrow}>Bản đồ tuyến</span>
                <h2>{text(selectedRoute, 'routeName', 'Tuyến chưa có tên')}</h2>
                <p>{text(selectedRoute, 'area', 'Chưa có khu vực')} · phiên gần nhất {latestSession ? shortDate(optionalText(latestSession, 'sessionDate')) : 'chưa có dữ liệu'}</p>
              </div>
              <Link className={styles.primaryAction} href={buildHref(period, searchParams, { view: 'outlets', route: searchParams.route, actor: searchParams.actor, page: null })}>Xem danh sách điểm bán</Link>
            </div>

            {points.length ? (
              <div className={styles.mapCanvas}>
                <svg aria-label="Sơ đồ tương đối các vị trí GPS trên tuyến" role="img" viewBox="0 0 1000 600">
                  <polyline className={styles.routeLine} points={points.map((point) => `${point.x},${point.y}`).join(' ')} />
                  {points.map((point, index) => {
                    const status = outletStatus(point.row);
                    const className = status === 'review'
                      ? styles.mapPointDanger
                      : status === 'insufficient'
                        ? styles.mapPointWarn
                        : status === 'visited'
                          ? styles.mapPointOk
                          : styles.mapPointNeutral;
                    return (
                      <g key={optionalText(point.row, 'sessionCustomerId') ?? `map-${index}`}>
                        <circle className={`${styles.mapPoint} ${className}`} cx={point.x} cy={point.y} r="14">
                          <title>{`${index + 1}. ${text(point.row, 'customerName', 'Điểm bán')} · ${point.source}`}</title>
                        </circle>
                        <text className={styles.mapPointLabel} x={point.x} y={point.y + 4} textAnchor="middle">{index + 1}</text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            ) : <p className={styles.emptyInline}>Phiên gần nhất chưa có tọa độ GPS để dựng sơ đồ tuyến.</p>}

            <div className={styles.legend}>
              <span><i className={styles.legendOk} />Đã ghé / vị trí phù hợp</span>
              <span><i className={styles.legendWarn} />Thiếu bằng chứng</span>
              <span><i className={styles.legendDanger} />GPS cần kiểm tra</span>
              <span><i className={styles.legendNeutral} />Chưa ghé</span>
            </div>
            <p className={styles.evidenceNote}>Bản đồ tuyến dùng tọa độ GPS điểm bán hoặc check-in đã ghi nhận trong phiên gần nhất. Hệ thống hiện chưa có định vị nhân viên theo thời gian thực.</p>
          </section>

          <section className={styles.surface}>
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.eyebrow}>Điểm trên tuyến</span>
                <h2>{routeRows.length} điểm trong phiên</h2>
              </div>
            </div>
            <div className={styles.compactList}>
              {routeRows.slice(0, 12).map((row, index) => (
                <div className={styles.compactRow} key={optionalText(row, 'sessionCustomerId') ?? `route-point-${index}`}>
                  <div>
                    <strong>{index + 1}. {text(row, 'customerName', 'Điểm bán')}</strong>
                    <span>{text(row, 'address', 'Chưa có địa chỉ')} · {locationLabel(text(row, 'locationStatus', 'not_checked_in'))}</span>
                  </div>
                  <Link className={styles.textAction} href={buildHref(period, searchParams, { view: 'outlet', outlet: optionalText(row, 'sessionCustomerId') })}>Xem chi tiết →</Link>
                </div>
              ))}
            </div>
          </section>
        </>
      );
    }
  }

  if (view === 'anomalies') {
    const group = ['all', 'location', 'checkin', 'activity'].includes(String(searchParams.status))
      ? String(searchParams.status)
      : 'all';
    const filtered = anomalies
      .filter((row) => {
        const rule = text(row, 'ruleCode', '');
        if (group === 'location') return rule.includes('LOCATION');
        if (group === 'checkin') return rule.includes('VISITED_WITHOUT_CHECKIN');
        if (group === 'activity') return rule.includes('CHECKIN_WITHOUT_ACTIVITY');
        return true;
      })
      .filter((row) => includesSearch(row, query, ['title', 'entity', 'employeeName', 'employeeCode', 'routeName', 'actual']));
    const page = paginate(filtered, requestedPage, ANOMALY_PAGE_SIZE);

    content = (
      <section className={styles.surface}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>Bất thường MCP</span>
            <h2>{formattedNumber(filtered.length)} trường hợp cần chú ý</h2>
          </div>
        </div>

        <SearchBar period={period} searchParams={{ ...searchParams, view: 'anomalies' }} placeholder="Tìm điểm bán, nhân viên hoặc tuyến" />
        <nav className={styles.filterBar} aria-label="Lọc loại bất thường">
          {[
            ['all', 'Tất cả'],
            ['location', 'GPS / vị trí'],
            ['checkin', 'Thiếu check-in'],
            ['activity', 'Thiếu hoạt động'],
          ].map(([key, label]) => (
            <Link
              aria-current={group === key ? 'page' : undefined}
              className={`${styles.filterChip} ${group === key ? styles.filterChipActive : ''}`}
              href={buildHref(period, searchParams, { view: 'anomalies', status: key === 'all' ? null : key, page: null })}
              key={key}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className={styles.list}>
          {page.items.map((row, index) => {
            const alertId = text(row, 'id', '');
            const outletId = optionalText(row, 'sessionCustomerId');
            const severity = text(row, 'severity', 'attention');
            return (
              <div className={styles.listRow} key={`${alertId || index}-${index}`}>
                <div>
                  <strong>{text(row, 'title', 'Cần kiểm tra')}</strong>
                  <span>{text(row, 'entity', 'Điểm bán')} · {text(row, 'employeeName', 'Chưa xác định nhân viên')}</span>
                  <small>{text(row, 'routeName', 'Chưa có tuyến')} · {dateTime(row.detectedAt)} · {text(row, 'actual', '')}</small>
                </div>
                <Badge label={severity === 'high' ? 'Ưu tiên cao' : 'Cần chú ý'} tone={severity === 'high' ? 'danger' : 'warn'} />
                <div className={styles.rowActions}>
                  {outletId ? <Link className={styles.secondaryAction} href={buildHref(period, searchParams, { view: 'outlet', outlet: outletId })}>Xem điểm bán</Link> : null}
                  {alertId ? <Link className={styles.primaryAction} href={`/alerts/${encodeURIComponent(alertId)}?period=${encodeURIComponent(period)}`}>Mở cảnh báo</Link> : null}
                </div>
              </div>
            );
          })}
          {!page.items.length ? <p className={styles.emptyInline}>Không có bất thường phù hợp bộ lọc.</p> : null}
        </div>
        <Pagination page={page.page} totalPages={page.totalPages} hrefForPage={(candidate) => buildHref(period, searchParams, { view: 'anomalies', page: String(candidate) })} />
      </section>
    );
  }

  return (
    <div className={styles.experience}>
      {top}
      {content}
    </div>
  );
}
