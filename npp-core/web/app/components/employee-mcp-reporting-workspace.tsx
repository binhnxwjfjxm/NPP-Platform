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
  { id: 'routes', label: 'Tuyến & phiên' },
  { id: 'outlets', label: 'Điểm bán / lượt ghé' },
  { id: 'orders', label: 'Nhu cầu & đơn hàng' },
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
  return salesLabel ? `${salesLabel} — chưa map mã nhân viên` : 'Chưa có mã field actor';
}

function exceptionLabel(value: string) {
  return ({
    MISSING_FIELD_ACTOR_CODE: 'Thiếu mã field actor',
    UNMAPPED_EMPLOYEE_CODE: 'Chưa map mã nhân viên',
    SESSION_COUNTER_MISMATCH: 'Counter phiên lệch child facts',
  } as Record<string, string>)[value] ?? value;
}

async function requestReport(from = '', to = ''): Promise<EmployeeMcpDashboard> {
  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  const serialized = query.toString();
  const response = await fetch(`/api/reporting/employee-mcp${serialized ? `?${serialized}` : ''}`, { method: 'GET', cache: 'no-store' });
  const envelope = await response.json().catch(() => ({})) as ApiEnvelope<EmployeeMcpDashboard>;
  if (!response.ok || !envelope.data) throw new Error(envelope.error?.message || 'Không tải được báo cáo nhân sự & MCP.');
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
      setError(loadError instanceof Error ? loadError.message : 'Không tải được báo cáo nhân sự & MCP.');
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
      title="Hiệu suất nhân viên / MCP Field"
      subtitle="Theo dõi tuyến, phiên đi thị trường, lượt ghé, check-in và chuyển đổi từ nhu cầu ngoài thị trường tới onboarding và đơn Core bằng cùng nguồn số liệu sẽ dùng cho Admin Control Tower."
      kicker="Nhân sự & MCP Field"
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
        {busy && !report ? <div className={styles.loading}>Đang tải hiệu suất MCP…</div> : null}

        {report ? <>
          <div className={styles.notice}>
            <strong>Nguồn dùng chung cho quản trị:</strong> màn này đọc trực tiếp MCP canonical facts. Admin Control Tower sau này dùng lại chính contract này, không tính lại KPI riêng. `area` chỉ là mô tả khu vực, không được suy thành territory. Field outlet chưa qua onboarding không tự trở thành khách hàng Core.
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
              <div className={styles.card}><p className={styles.cardLabel}>Phiên / tuyến</p><p className={styles.cardValue}>{count(summary.sessionCount)} / {count(summary.routeCount)}</p><p className={styles.cardHint}>Phiên MCP và tuyến có hoạt động trong kỳ.</p></div>
              <div className={styles.card}><p className={styles.cardLabel}>Điểm kế hoạch / đã ghé</p><p className={styles.cardValue}>{count(summary.plannedOutletCount)} / {count(summary.visitedOutletCount)}</p><p className={styles.cardHint}>Hoàn thành điểm kế hoạch: {percent(summary.plannedVisitRatePercent)}.</p></div>
              <div className={styles.card}><p className={styles.cardLabel}>Check-in / visit</p><p className={styles.cardValue}>{count(summary.checkedInOutletCount)} / {count(summary.visitCount)}</p><p className={styles.cardHint}>Check-in lấy từ session customer; visit lấy từ visit facts.</p></div>
              <div className={styles.card}><p className={styles.cardLabel}>Order intent</p><p className={styles.cardValue}>{count(summary.orderIntentCount)}</p><p className={styles.cardHint}>Từ điểm đã ghé sang nhu cầu mua: {percent(summary.orderIntentConversionPercent)}.</p></div>
              <div className={styles.card}><p className={styles.cardLabel}>Onboarding đã chuyển đổi</p><p className={styles.cardValue}>{count(summary.onboardingConvertedCount)} / {count(summary.onboardingSubmittedCount)}</p><p className={styles.cardHint}>Approved/linked trên tổng đã submit: {percent(summary.onboardingConversionPercent)}.</p></div>
              <div className={styles.card}><p className={styles.cardLabel}>Đơn Core chính thức</p><p className={styles.cardValue}>{count(summary.coreSalesOrderCount)}</p><p className={styles.cardHint}>Order intent → Sales Order Core: {percent(summary.coreOrderConversionPercent)}.</p></div>
            </div>
          ) : null}

          {activeTab === 'routes' ? <>
            <section className={styles.section} data-testid="employee-mcp-routes-panel">
              <div className={styles.sectionHeader}><div><h2>Hiệu suất theo tuyến</h2><p>Khu vực hiển thị đúng `area` của MCP và không được dùng làm territory authorization.</p></div></div>
              <div className={styles.tableWrap}><table className={styles.table}>
                <thead><tr><th>Tuyến</th><th>Khu vực</th><th>Field actor</th><th className={styles.numeric}>Phiên</th><th className={styles.numeric}>Kế hoạch</th><th className={styles.numeric}>Đã ghé</th><th className={styles.numeric}>Check-in</th><th className={styles.numeric}>Order intent</th><th className={styles.numeric}>Đơn Core</th><th className={styles.numeric}>Hoàn thành KH</th></tr></thead>
                <tbody>{report.routes.map((row) => <tr key={`${row.routeId}:${row.salesLabel ?? 'missing'}`}><td><strong>{row.routeCode ?? row.routeId}</strong><br />{row.routeName}</td><td>{row.area ?? '—'}</td><td>{actorLabel(row.salesLabel, row.employeeCode, row.employeeName)}</td><td className={styles.numeric}>{count(row.sessionCount)}</td><td className={styles.numeric}>{count(row.plannedOutletCount)}</td><td className={styles.numeric}>{count(row.visitedOutletCount)}</td><td className={styles.numeric}>{count(row.checkedInOutletCount)}</td><td className={styles.numeric}>{count(row.orderIntentCount)}</td><td className={styles.numeric}>{count(row.coreSalesOrderCount)}</td><td className={styles.numeric}>{percent(row.plannedVisitRatePercent)}</td></tr>)}{!report.routes.length ? <tr><td className={styles.empty} colSpan={10}>Không có tuyến phát sinh hoạt động.</td></tr> : null}</tbody>
              </table></div>
            </section>
            <section className={styles.section} data-testid="employee-mcp-sessions-panel">
              <div className={styles.sectionHeader}><div><h2>100 phiên gần nhất trong bộ lọc</h2><p>Giữ source ID thật để đối chiếu, không tạo drill-down giả trong NPP.</p></div></div>
              <div className={styles.tableWrap}><table className={styles.table}>
                <thead><tr><th>Ngày / phiên</th><th>Tuyến</th><th>Field actor</th><th>Trạng thái</th><th className={styles.numeric}>Kế hoạch</th><th className={styles.numeric}>Đã ghé</th><th className={styles.numeric}>Check-in</th><th className={styles.numeric}>Visit</th><th className={styles.numeric}>Intent</th><th className={styles.numeric}>Onboarding</th><th className={styles.numeric}>Đơn Core</th></tr></thead>
                <tbody>{report.sessions.map((row) => <tr key={row.sessionId}><td><strong>{row.sessionDate}</strong><br /><code>{row.sessionId}</code></td><td>{row.routeCode ?? row.routeId}<br />{row.routeName}</td><td>{actorLabel(row.salesLabel, row.employeeCode, row.employeeName)}</td><td><span className={row.storedCounterMismatch ? styles.statusWarn : styles.statusNeutral}>{row.status}</span></td><td className={styles.numeric}>{count(row.plannedOutletCount)}</td><td className={styles.numeric}>{count(row.visitedOutletCount)}</td><td className={styles.numeric}>{count(row.checkedInOutletCount)}</td><td className={styles.numeric}>{count(row.visitCount)}</td><td className={styles.numeric}>{count(row.orderIntentCount)}</td><td className={styles.numeric}>{count(row.onboardingConvertedCount)} / {count(row.onboardingSubmittedCount)}</td><td className={styles.numeric}>{count(row.coreSalesOrderCount)}</td></tr>)}{!report.sessions.length ? <tr><td className={styles.empty} colSpan={11}>Không có phiên trong kỳ.</td></tr> : null}</tbody>
              </table></div>
            </section>
          </> : null}

          {activeTab === 'outlets' ? (
            <section className={styles.section} data-testid="employee-mcp-outlets-panel">
              <div className={styles.sectionHeader}><div><h2>Điểm bán / lượt ghé theo field actor</h2><p>Dùng lại planned/visited/check-in/visit facts từ contract Phase 8.4; không tạo nguồn số liệu thứ hai.</p></div></div>
              <div className={styles.tableWrap}><table className={styles.table}>
                <thead><tr><th>Field actor</th><th className={styles.numeric}>Điểm kế hoạch</th><th className={styles.numeric}>Đã ghé</th><th className={styles.numeric}>Check-in</th><th className={styles.numeric}>Visit facts</th><th className={styles.numeric}>Hoàn thành KH</th></tr></thead>
                <tbody>{report.fieldActors.map((row) => <tr key={`${row.salesLabel ?? 'missing'}:${row.employeeId ?? 'unmapped'}`}><td><strong>{actorLabel(row.salesLabel, row.employeeCode, row.employeeName)}</strong></td><td className={styles.numeric}>{count(row.plannedOutletCount)}</td><td className={styles.numeric}>{count(row.visitedOutletCount)}</td><td className={styles.numeric}>{count(row.checkedInOutletCount)}</td><td className={styles.numeric}>{count(row.visitCount)}</td><td className={styles.numeric}>{percent(row.plannedVisitRatePercent)}</td></tr>)}{!report.fieldActors.length ? <tr><td className={styles.empty} colSpan={6}>Không có hoạt động điểm bán trong kỳ.</td></tr> : null}</tbody>
              </table></div>
            </section>
          ) : null}

          {activeTab === 'orders' ? (
            <section className={styles.section} data-testid="employee-mcp-orders-panel">
              <div className={styles.sectionHeader}><div><h2>Nhu cầu & đơn hàng theo field actor</h2><p>Order intent, onboarding và Core Sales Order cùng lấy từ lineage Phase 8.4 hiện hữu.</p></div><Link className={styles.linkButton} href="/management/customer-onboarding">Mở đề nghị mã khách</Link></div>
              <div className={styles.tableWrap}><table className={styles.table}>
                <thead><tr><th>Field actor</th><th className={styles.numeric}>Order intent</th><th className={styles.numeric}>Onboarding gửi</th><th className={styles.numeric}>Onboarding chuyển đổi</th><th className={styles.numeric}>Đơn Core</th><th className={styles.numeric}>Intent / ghé</th><th className={styles.numeric}>Core / intent</th></tr></thead>
                <tbody>{report.fieldActors.map((row) => <tr key={`${row.salesLabel ?? 'missing'}:${row.employeeId ?? 'unmapped'}`}><td><strong>{actorLabel(row.salesLabel, row.employeeCode, row.employeeName)}</strong></td><td className={styles.numeric}>{count(row.orderIntentCount)}</td><td className={styles.numeric}>{count(row.onboardingSubmittedCount)}</td><td className={styles.numeric}>{count(row.onboardingConvertedCount)}</td><td className={styles.numeric}>{count(row.coreSalesOrderCount)}</td><td className={styles.numeric}>{percent(row.orderIntentConversionPercent)}</td><td className={styles.numeric}>{percent(row.coreOrderConversionPercent)}</td></tr>)}{!report.fieldActors.length ? <tr><td className={styles.empty} colSpan={7}>Không có nhu cầu/đơn trong kỳ.</td></tr> : null}</tbody>
              </table></div>
            </section>
          ) : null}

          {activeTab === 'effectiveness' ? <>
            <section className={styles.section} data-testid="employee-mcp-effectiveness-panel">
              <div className={styles.sectionHeader}><div><h2>Hiệu suất theo field actor / nhân viên</h2><p>Chỉ gắn nhân viên khi `sales` khớp chính xác `shared.employees.code`; không đoán theo tên.</p></div><Link className={styles.linkButton} href="/access/employees">Mở danh mục nhân sự</Link></div>
              <div className={styles.tableWrap}><table className={styles.table}>
                <thead><tr><th>Field actor</th><th className={styles.numeric}>Phiên</th><th className={styles.numeric}>Tuyến</th><th className={styles.numeric}>Kế hoạch</th><th className={styles.numeric}>Đã ghé</th><th className={styles.numeric}>Check-in</th><th className={styles.numeric}>Order intent</th><th className={styles.numeric}>Đơn Core</th><th className={styles.numeric}>Hoàn thành KH</th><th className={styles.numeric}>Intent / ghé</th></tr></thead>
                <tbody>{report.fieldActors.map((row) => <tr key={`${row.salesLabel ?? 'missing'}:${row.employeeId ?? 'unmapped'}`}><td><strong>{actorLabel(row.salesLabel, row.employeeCode, row.employeeName)}</strong></td><td className={styles.numeric}>{count(row.sessionCount)}</td><td className={styles.numeric}>{count(row.routeCount)}</td><td className={styles.numeric}>{count(row.plannedOutletCount)}</td><td className={styles.numeric}>{count(row.visitedOutletCount)}</td><td className={styles.numeric}>{count(row.checkedInOutletCount)}</td><td className={styles.numeric}>{count(row.orderIntentCount)}</td><td className={styles.numeric}>{count(row.coreSalesOrderCount)}</td><td className={styles.numeric}>{percent(row.plannedVisitRatePercent)}</td><td className={styles.numeric}>{percent(row.orderIntentConversionPercent)}</td></tr>)}{!report.fieldActors.length ? <tr><td className={styles.empty} colSpan={10}>Không có hoạt động MCP trong kỳ.</td></tr> : null}</tbody>
              </table></div>
            </section>
            <section className={styles.section}>
              <div className={styles.sectionHeader}><div><h2>Chất lượng dữ liệu / đối soát</h2><p>Các dòng này không bị giấu khỏi KPI. Cần xử lý mapping hoặc kiểm tra counter nguồn trước khi dùng để đánh giá cá nhân.</p></div></div>
              <div className={styles.tableWrap}><table className={styles.table}>
                <thead><tr><th>Loại</th><th>Field actor / phiên</th><th>Khoảng ngày / tuyến</th><th className={styles.numeric}>Số phiên / stored</th><th className={styles.numeric}>Derived</th></tr></thead>
                <tbody>
                  {report.dataQuality.unmappedActors.map((row) => <tr key={`${row.exceptionCode}:${row.salesLabel ?? 'missing'}`}><td><span className={styles.statusWarn}>{exceptionLabel(row.exceptionCode)}</span></td><td>{row.salesLabel ?? '—'}</td><td>{row.firstSessionDate} → {row.lastSessionDate}</td><td className={styles.numeric}>{count(row.sessionCount)}</td><td className={styles.numeric}>—</td></tr>)}
                  {report.dataQuality.counterMismatches.map((row) => <tr key={row.sessionId}><td><span className={styles.statusWarn}>{exceptionLabel(row.exceptionCode)}</span></td><td><code>{row.sessionId}</code><br />{row.salesLabel ?? '—'}</td><td>{row.sessionDate}<br />{row.routeCode ?? row.routeId}</td><td className={styles.numeric}>KH {count(row.storedPlannedCustomers)} · ghé {count(row.storedVisitedCustomers)} · intent {count(row.storedOrderCount)}</td><td className={styles.numeric}>KH {count(row.derivedPlannedOutletCount)} · ghé {count(row.derivedVisitedOutletCount)} · intent {count(row.derivedOrderIntentCount)}</td></tr>)}
                  {!report.dataQuality.unmappedActors.length && !report.dataQuality.counterMismatches.length ? <tr><td className={styles.empty} colSpan={5}>Không có exception mapping/counter trong kỳ.</td></tr> : null}
                </tbody>
              </table></div>
            </section>
          </> : null}

          <div className={styles.sourceNote}>
            <span>Scope hiện tại: {report.scope.basis === 'EMPLOYEE_CODE' ? `nhân viên ${report.scope.employeeCode}` : 'toàn installation theo permission hiện hành'}.</span>
            <span>Generated: {report.generatedAt} · Timezone: {report.timezone}.</span>
          </div>
        </> : null}
      </div>
    </AppShell>
  );
}
