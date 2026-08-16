'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import type { EmployeeMcpDashboard } from '../../lib/employee-mcp-reporting-types';
import { AppShell } from './app-shell';
import styles from './inventory-reporting-workspace.module.css';

type ApiEnvelope<T> = Readonly<{ data?: T; error?: { message?: string } }>;
type PerformanceTab = 'overview' | 'routes' | 'outlets' | 'orders' | 'effectiveness';

const PERFORMANCE_TABS: ReadonlyArray<Readonly<{ id: PerformanceTab; label: string }>> = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'routes', label: 'Tuyến và phiên' },
  { id: 'outlets', label: 'Điểm bán và lượt ghé' },
  { id: 'orders', label: 'Nhu cầu và đơn hàng' },
  { id: 'effectiveness', label: 'Hiệu quả hoạt động' },
];

function count(value: string | null | undefined) {
  const normalized = String(value ?? '0').trim();
  return /^-?\d+$/.test(normalized) ? normalized.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : normalized;
}

function percent(value: string | null | undefined) {
  const normalized = String(value ?? '').trim();
  return normalized ? `${normalized.replace('.', ',')}%` : '—';
}

function actorLabel(salesLabel: string | null, employeeCode: string | null, employeeName: string | null) {
  if (employeeCode) return `${employeeCode} — ${employeeName ?? salesLabel ?? 'Nhân viên'}`;
  return salesLabel ? `${salesLabel} — chưa liên kết hồ sơ nhân viên` : 'Chưa xác định nhân viên';
}

function exceptionLabel(value: string) {
  return ({
    MISSING_FIELD_ACTOR_CODE: 'Thiếu thông tin nhân viên',
    UNMAPPED_EMPLOYEE_CODE: 'Chưa liên kết hồ sơ nhân viên',
    SESSION_COUNTER_MISMATCH: 'Số liệu phiên cần đối soát',
  } as Record<string, string>)[value] ?? 'Dữ liệu cần kiểm tra';
}

function sessionStatusLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  return ({
    open: 'Đang thực hiện',
    active: 'Đang thực hiện',
    in_progress: 'Đang thực hiện',
    completed: 'Hoàn tất',
    closed: 'Hoàn tất',
    cancelled: 'Đã hủy',
  } as Record<string, string>)[normalized] ?? 'Trạng thái khác';
}

async function requestReport(from = '', to = ''): Promise<EmployeeMcpDashboard> {
  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  const serialized = query.toString();
  const response = await fetch(`/api/reporting/employee-mcp${serialized ? `?${serialized}` : ''}`, { method: 'GET', cache: 'no-store' });
  const envelope = await response.json().catch(() => ({})) as ApiEnvelope<EmployeeMcpDashboard>;
  if (!response.ok || !envelope.data) throw new Error(envelope.error?.message || 'Không tải được báo cáo nhân viên thị trường.');
  return envelope.data;
}

export function EmployeeMcpReportingWorkspace() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [report, setReport] = useState<EmployeeMcpDashboard | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<PerformanceTab>('overview');

  const load = useCallback(async (nextFrom = '', nextTo = '') => {
    setBusy(true);
    setError('');
    try {
      const next = await requestReport(nextFrom, nextTo);
      setReport(next);
      setFrom(next.filters.from);
      setTo(next.filters.to);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được báo cáo nhân viên thị trường.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(from, to);
  }

  function resetFilters() {
    setFrom('');
    setTo('');
    void load();
  }

  const summary = report?.summary ?? {};
  const actions = (
    <div className={styles.headerActions}>
      <Link className={styles.linkButton} href="/access/employees">Danh mục nhân sự</Link>
      <Link className={styles.linkButton} href="/management/customer-onboarding">Đề nghị mở mã khách</Link>
    </div>
  );

  return (
    <AppShell
      title="Hiệu suất nhân viên thị trường"
      subtitle="Theo dõi tuyến, phiên đi thị trường, lượt ghé, ghi nhận có mặt, nhu cầu mua, đề nghị mở mã khách và đơn Công Ty trên cùng nguồn số liệu."
      kicker="Nhân sự thị trường"
      actions={actions}
    >
      <div className={styles.workspace} data-testid="employee-mcp-reporting-workspace">
        <form className={styles.filters} onSubmit={applyFilters}>
          <label className={styles.field}><span>Từ ngày</span><input type="date" value={from} disabled={busy} onChange={(event) => setFrom(event.target.value)} /></label>
          <label className={styles.field}><span>Đến ngày</span><input type="date" value={to} disabled={busy} onChange={(event) => setTo(event.target.value)} /></label>
          <button className={styles.primaryButton} type="submit" disabled={busy}>Áp dụng</button>
          <button className={styles.secondaryButton} type="button" onClick={resetFilters} disabled={busy}>Tháng hiện tại</button>
        </form>

        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        {busy && !report ? <div className={styles.loading}>Đang tải hiệu suất nhân viên thị trường…</div> : null}

        {report ? <>
          <div className={styles.notice}>
            <strong>Nguồn số liệu dùng chung:</strong> báo cáo lấy trực tiếp hoạt động thị trường đã ghi nhận. Điểm bán chưa được duyệt mở hoặc liên kết mã không tự trở thành khách hàng Công Ty.
          </div>

          <div className={styles.tabList}>
            {PERFORMANCE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`${styles.tabButton}${activeTab === tab.id ? ` ${styles.tabButtonActive}` : ''}`}
                onClick={() => setActiveTab(tab.id)}
                data-testid={`employee-mcp-tab-${tab.id}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'overview' ? (
            <div className={styles.cards} data-testid="employee-mcp-overview">
              <div className={styles.card}><p className={styles.cardLabel}>Phiên / tuyến</p><p className={styles.cardValue}>{count(summary.sessionCount)} / {count(summary.routeCount)}</p><p className={styles.cardHint}>Phiên đi thị trường và tuyến có hoạt động trong kỳ.</p></div>
              <div className={styles.card}><p className={styles.cardLabel}>Điểm kế hoạch / đã ghé</p><p className={styles.cardValue}>{count(summary.plannedOutletCount)} / {count(summary.visitedOutletCount)}</p><p className={styles.cardHint}>Hoàn thành điểm kế hoạch: {percent(summary.plannedVisitRatePercent)}.</p></div>
              <div className={styles.card}><p className={styles.cardLabel}>Có mặt / lượt ghé</p><p className={styles.cardValue}>{count(summary.checkedInOutletCount)} / {count(summary.visitCount)}</p><p className={styles.cardHint}>Số điểm đã ghi nhận có mặt và tổng lượt ghé trong kỳ.</p></div>
              <div className={styles.card}><p className={styles.cardLabel}>Nhu cầu mua</p><p className={styles.cardValue}>{count(summary.orderIntentCount)}</p><p className={styles.cardHint}>Tỷ lệ từ điểm đã ghé sang nhu cầu mua: {percent(summary.orderIntentConversionPercent)}.</p></div>
              <div className={styles.card}><p className={styles.cardLabel}>Mở mã khách thành công</p><p className={styles.cardValue}>{count(summary.onboardingConvertedCount)} / {count(summary.onboardingSubmittedCount)}</p><p className={styles.cardHint}>Đã duyệt hoặc liên kết trên tổng đề nghị đã gửi: {percent(summary.onboardingConversionPercent)}.</p></div>
              <div className={styles.card}><p className={styles.cardLabel}>Đơn Công Ty chính thức</p><p className={styles.cardValue}>{count(summary.coreSalesOrderCount)}</p><p className={styles.cardHint}>Nhu cầu mua chuyển thành đơn Công Ty: {percent(summary.coreOrderConversionPercent)}.</p></div>
            </div>
          ) : null}

          {activeTab === 'routes' ? <>
            <section className={styles.section} data-testid="employee-mcp-routes-panel">
              <div className={styles.sectionHeader}><div><h2>Hiệu suất theo tuyến</h2><p>Khu vực hiển thị theo dữ liệu tuyến đã được ghi nhận.</p></div></div>
              <div className={styles.tableWrap}><table className={styles.table}>
                <thead><tr><th>Tuyến</th><th>Khu vực</th><th>Nhân viên</th><th className={styles.numeric}>Phiên</th><th className={styles.numeric}>Kế hoạch</th><th className={styles.numeric}>Đã ghé</th><th className={styles.numeric}>Có mặt</th><th className={styles.numeric}>Nhu cầu mua</th><th className={styles.numeric}>Đơn Công Ty</th><th className={styles.numeric}>Hoàn thành KH</th></tr></thead>
                <tbody>{report.routes.map((row) => <tr key={`${row.routeId}:${row.salesLabel ?? 'missing'}`}><td><strong>{row.routeCode ?? 'Chưa có mã tuyến'}</strong><br />{row.routeName}</td><td>{row.area ?? '—'}</td><td>{actorLabel(row.salesLabel, row.employeeCode, row.employeeName)}</td><td className={styles.numeric}>{count(row.sessionCount)}</td><td className={styles.numeric}>{count(row.plannedOutletCount)}</td><td className={styles.numeric}>{count(row.visitedOutletCount)}</td><td className={styles.numeric}>{count(row.checkedInOutletCount)}</td><td className={styles.numeric}>{count(row.orderIntentCount)}</td><td className={styles.numeric}>{count(row.coreSalesOrderCount)}</td><td className={styles.numeric}>{percent(row.plannedVisitRatePercent)}</td></tr>)}{!report.routes.length ? <tr><td className={styles.empty} colSpan={10}>Không có tuyến phát sinh hoạt động.</td></tr> : null}</tbody>
              </table></div>
            </section>
            <section className={styles.section} data-testid="employee-mcp-sessions-panel">
              <div className={styles.sectionHeader}><div><h2>100 phiên gần nhất trong bộ lọc</h2><p>Đối chiếu hoạt động theo ngày, tuyến và nhân viên.</p></div></div>
              <div className={styles.tableWrap}><table className={styles.table}>
                <thead><tr><th>Ngày</th><th>Tuyến</th><th>Nhân viên</th><th>Trạng thái</th><th className={styles.numeric}>Kế hoạch</th><th className={styles.numeric}>Đã ghé</th><th className={styles.numeric}>Có mặt</th><th className={styles.numeric}>Lượt ghé</th><th className={styles.numeric}>Nhu cầu</th><th className={styles.numeric}>Mở mã khách</th><th className={styles.numeric}>Đơn Công Ty</th></tr></thead>
                <tbody>{report.sessions.map((row) => <tr key={row.sessionId}><td><strong>{row.sessionDate}</strong></td><td>{row.routeCode ?? 'Chưa có mã tuyến'}<br />{row.routeName}</td><td>{actorLabel(row.salesLabel, row.employeeCode, row.employeeName)}</td><td><span className={row.storedCounterMismatch ? styles.statusWarn : styles.statusNeutral}>{sessionStatusLabel(row.status)}</span></td><td className={styles.numeric}>{count(row.plannedOutletCount)}</td><td className={styles.numeric}>{count(row.visitedOutletCount)}</td><td className={styles.numeric}>{count(row.checkedInOutletCount)}</td><td className={styles.numeric}>{count(row.visitCount)}</td><td className={styles.numeric}>{count(row.orderIntentCount)}</td><td className={styles.numeric}>{count(row.onboardingConvertedCount)} / {count(row.onboardingSubmittedCount)}</td><td className={styles.numeric}>{count(row.coreSalesOrderCount)}</td></tr>)}{!report.sessions.length ? <tr><td className={styles.empty} colSpan={11}>Không có phiên trong kỳ.</td></tr> : null}</tbody>
              </table></div>
            </section>
          </> : null}

          {activeTab === 'outlets' ? (
            <section className={styles.section} data-testid="employee-mcp-outlets-panel">
              <div className={styles.sectionHeader}><div><h2>Điểm bán và lượt ghé theo nhân viên</h2><p>Tổng hợp kế hoạch, điểm đã ghé và số lần ghi nhận hoạt động thực tế.</p></div></div>
              <div className={styles.tableWrap}><table className={styles.table}>
                <thead><tr><th>Nhân viên</th><th className={styles.numeric}>Điểm kế hoạch</th><th className={styles.numeric}>Đã ghé</th><th className={styles.numeric}>Có mặt</th><th className={styles.numeric}>Lượt ghé</th><th className={styles.numeric}>Hoàn thành KH</th></tr></thead>
                <tbody>{report.fieldActors.map((row) => <tr key={`${row.salesLabel ?? 'missing'}:${row.employeeId ?? 'unmapped'}`}><td><strong>{actorLabel(row.salesLabel, row.employeeCode, row.employeeName)}</strong></td><td className={styles.numeric}>{count(row.plannedOutletCount)}</td><td className={styles.numeric}>{count(row.visitedOutletCount)}</td><td className={styles.numeric}>{count(row.checkedInOutletCount)}</td><td className={styles.numeric}>{count(row.visitCount)}</td><td className={styles.numeric}>{percent(row.plannedVisitRatePercent)}</td></tr>)}{!report.fieldActors.length ? <tr><td className={styles.empty} colSpan={6}>Không có hoạt động điểm bán trong kỳ.</td></tr> : null}</tbody>
              </table></div>
            </section>
          ) : null}

          {activeTab === 'orders' ? (
            <section className={styles.section} data-testid="employee-mcp-orders-panel">
              <div className={styles.sectionHeader}><div><h2>Nhu cầu và đơn hàng theo nhân viên</h2><p>Theo dõi từ nhu cầu mua, đề nghị mở mã khách đến đơn Công Ty chính thức.</p></div><Link className={styles.linkButton} href="/management/customer-onboarding">Mở đề nghị mã khách</Link></div>
              <div className={styles.tableWrap}><table className={styles.table}>
                <thead><tr><th>Nhân viên</th><th className={styles.numeric}>Nhu cầu mua</th><th className={styles.numeric}>Đề nghị đã gửi</th><th className={styles.numeric}>Mở mã thành công</th><th className={styles.numeric}>Đơn Công Ty</th><th className={styles.numeric}>Nhu cầu / ghé</th><th className={styles.numeric}>Đơn / nhu cầu</th></tr></thead>
                <tbody>{report.fieldActors.map((row) => <tr key={`${row.salesLabel ?? 'missing'}:${row.employeeId ?? 'unmapped'}`}><td><strong>{actorLabel(row.salesLabel, row.employeeCode, row.employeeName)}</strong></td><td className={styles.numeric}>{count(row.orderIntentCount)}</td><td className={styles.numeric}>{count(row.onboardingSubmittedCount)}</td><td className={styles.numeric}>{count(row.onboardingConvertedCount)}</td><td className={styles.numeric}>{count(row.coreSalesOrderCount)}</td><td className={styles.numeric}>{percent(row.orderIntentConversionPercent)}</td><td className={styles.numeric}>{percent(row.coreOrderConversionPercent)}</td></tr>)}{!report.fieldActors.length ? <tr><td className={styles.empty} colSpan={7}>Không có nhu cầu hoặc đơn trong kỳ.</td></tr> : null}</tbody>
              </table></div>
            </section>
          ) : null}

          {activeTab === 'effectiveness' ? <>
            <section className={styles.section} data-testid="employee-mcp-effectiveness-panel">
              <div className={styles.sectionHeader}><div><h2>Hiệu suất theo nhân viên</h2><p>Chỉ gắn số liệu với hồ sơ nhân viên khi mã nhân viên khớp chính xác.</p></div><Link className={styles.linkButton} href="/access/employees">Mở danh mục nhân sự</Link></div>
              <div className={styles.tableWrap}><table className={styles.table}>
                <thead><tr><th>Nhân viên</th><th className={styles.numeric}>Phiên</th><th className={styles.numeric}>Tuyến</th><th className={styles.numeric}>Kế hoạch</th><th className={styles.numeric}>Đã ghé</th><th className={styles.numeric}>Có mặt</th><th className={styles.numeric}>Nhu cầu mua</th><th className={styles.numeric}>Đơn Công Ty</th><th className={styles.numeric}>Hoàn thành KH</th><th className={styles.numeric}>Nhu cầu / ghé</th></tr></thead>
                <tbody>{report.fieldActors.map((row) => <tr key={`${row.salesLabel ?? 'missing'}:${row.employeeId ?? 'unmapped'}`}><td><strong>{actorLabel(row.salesLabel, row.employeeCode, row.employeeName)}</strong></td><td className={styles.numeric}>{count(row.sessionCount)}</td><td className={styles.numeric}>{count(row.routeCount)}</td><td className={styles.numeric}>{count(row.plannedOutletCount)}</td><td className={styles.numeric}>{count(row.visitedOutletCount)}</td><td className={styles.numeric}>{count(row.checkedInOutletCount)}</td><td className={styles.numeric}>{count(row.orderIntentCount)}</td><td className={styles.numeric}>{count(row.coreSalesOrderCount)}</td><td className={styles.numeric}>{percent(row.plannedVisitRatePercent)}</td><td className={styles.numeric}>{percent(row.orderIntentConversionPercent)}</td></tr>)}{!report.fieldActors.length ? <tr><td className={styles.empty} colSpan={10}>Không có hoạt động thị trường trong kỳ.</td></tr> : null}</tbody>
              </table></div>
            </section>
            <section className={styles.section}>
              <div className={styles.sectionHeader}><div><h2>Chất lượng dữ liệu và đối soát</h2><p>Các trường hợp dưới đây cần được kiểm tra hoặc liên kết lại trước khi dùng để đánh giá cá nhân.</p></div></div>
              <div className={styles.tableWrap}><table className={styles.table}>
                <thead><tr><th>Loại</th><th>Nhân viên</th><th>Khoảng ngày / tuyến</th><th className={styles.numeric}>Số liệu ghi nhận</th><th className={styles.numeric}>Số liệu đối chiếu</th></tr></thead>
                <tbody>
                  {report.dataQuality.unmappedActors.map((row) => <tr key={`${row.exceptionCode}:${row.salesLabel ?? 'missing'}`}><td><span className={styles.statusWarn}>{exceptionLabel(row.exceptionCode)}</span></td><td>{row.salesLabel ?? '—'}</td><td>{row.firstSessionDate} → {row.lastSessionDate}</td><td className={styles.numeric}>{count(row.sessionCount)} phiên</td><td className={styles.numeric}>—</td></tr>)}
                  {report.dataQuality.counterMismatches.map((row) => <tr key={row.sessionId}><td><span className={styles.statusWarn}>{exceptionLabel(row.exceptionCode)}</span></td><td>{row.salesLabel ?? '—'}</td><td>{row.sessionDate}<br />{row.routeCode ?? 'Chưa có mã tuyến'}</td><td className={styles.numeric}>KH {count(row.storedPlannedCustomers)} · ghé {count(row.storedVisitedCustomers)} · nhu cầu {count(row.storedOrderCount)}</td><td className={styles.numeric}>KH {count(row.derivedPlannedOutletCount)} · ghé {count(row.derivedVisitedOutletCount)} · nhu cầu {count(row.derivedOrderIntentCount)}</td></tr>)}
                  {!report.dataQuality.unmappedActors.length && !report.dataQuality.counterMismatches.length ? <tr><td className={styles.empty} colSpan={5}>Không có dữ liệu cần đối soát trong kỳ.</td></tr> : null}
                </tbody>
              </table></div>
            </section>
          </> : null}

          <details className={styles.sourceNote}>
            <summary>Thông tin kỹ thuật</summary>
            <span>Phạm vi: {report.scope.basis === 'EMPLOYEE_CODE' ? `nhân viên ${report.scope.employeeCode}` : 'toàn đơn vị theo quyền hiện hành'}.</span>
            <span>Thời điểm tạo: {report.generatedAt} · Múi giờ: {report.timezone}.</span>
          </details>
        </> : null}
      </div>
    </AppShell>
  );
}
