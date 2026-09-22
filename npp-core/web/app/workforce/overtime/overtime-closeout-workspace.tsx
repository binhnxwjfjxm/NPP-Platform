'use client';

import { createIdempotencyKey } from '@npp/contracts';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import shellStyles from '../../components/app-shell.module.css';
import sharedStyles from '../../organization/organization.module.css';
import styles from './overtime.module.css';
import type {
  AttendancePayrollInput,
  AttendancePeriod,
  AttendancePeriodIssueSummary,
  AttendancePeriodListResponse,
  OvertimeListResponse,
  OvertimeRequest,
  OvertimeStatus,
} from '../../../lib/workforce-types';

type ApiEnvelope<T> = { data?: T; error?: { message?: string } };
type Attempt = { payload: string; key: string } | null;
type Tab = 'overtime' | 'closeout';

const OT_STATUS: Record<OvertimeStatus, string> = {
  SUBMITTED: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  ACTUAL_RECORDED: 'Đã ghi nhận thực tế',
  CONFIRMED: 'Đã xác nhận giờ tính',
};
const PERIOD_STATUS: Record<AttendancePeriod['status'], string> = {
  AGGREGATING: 'Đang tổng hợp',
  NEEDS_ACTION: 'Cần xử lý',
  RECONCILED: 'Đã đối soát',
  CLOSED: 'Đã chốt',
};

function stableKey(ref: React.MutableRefObject<Attempt>, operation: string, payload: unknown) {
  const serialized = JSON.stringify(payload);
  if (ref.current?.payload === serialized) return ref.current.key;
  const key = createIdempotencyKey(operation);
  ref.current = { payload: serialized, key };
  return key;
}
async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || payload.data === undefined) throw new Error(payload.error?.message || 'Không thực hiện được yêu cầu');
  return payload.data;
}
function dateLabel(value: string | null | undefined) {
  if (!value) return '—';
  const raw = String(value).slice(0, 10);
  const [year, month, day] = raw.split('-');
  return year && month && day ? `${day}/${month}/${year}` : String(value);
}
function hours(minutes: number | null | undefined) {
  return (Number(minutes ?? 0) / 60).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}
function issueTotal(group: Record<string, number | undefined> | undefined) {
  return Object.values(group ?? {}).reduce<number>((sum, value) => sum + Number(value ?? 0), 0);
}

export default function OvertimeCloseoutWorkspace({
  initialFrom,
  initialTo,
  initialToday,
}: {
  initialFrom: string;
  initialTo: string;
  initialToday: string;
}) {
  const [tab, setTab] = useState<Tab>('overtime');
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [branchId, setBranchId] = useState('');
  const [status, setStatus] = useState('');
  const [overtime, setOvertime] = useState<OvertimeListResponse | null>(null);
  const [periods, setPeriods] = useState<AttendancePeriodListResponse | null>(null);
  const [selectedOvertime, setSelectedOvertime] = useState<OvertimeRequest | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<AttendancePeriod | null>(null);
  const [payroll, setPayroll] = useState<AttendancePayrollInput | null>(null);
  const [workDate, setWorkDate] = useState(initialToday);
  const [requestedHours, setRequestedHours] = useState('1');
  const [requestReason, setRequestReason] = useState('');
  const [actionHours, setActionHours] = useState('');
  const [actionNote, setActionNote] = useState('');
  const [periodNote, setPeriodNote] = useState('');
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const overtimeAttempt = useRef<Attempt>(null);
  const reviewAttempt = useRef<Attempt>(null);
  const actualAttempt = useRef<Attempt>(null);
  const confirmAttempt = useRef<Attempt>(null);
  const periodAttempt = useRef<Attempt>(null);

  const branches = useMemo(() => periods?.branches?.length ? periods.branches : (overtime?.branches ?? []), [periods, overtime]);

  async function loadAll() {
    setBusy(true); setError(null);
    try {
      const overtimeParams = new URLSearchParams({ from, to, limit: '100', offset: '0' });
      const periodParams = new URLSearchParams({ from, to });
      if (branchId) { overtimeParams.set('branchId', branchId); periodParams.set('branchId', branchId); }
      if (status) overtimeParams.set('status', status);
      const [nextOvertime, nextPeriods] = await Promise.all([
        requestJson<OvertimeListResponse>('/api/workforce/overtime?' + overtimeParams.toString()),
        requestJson<AttendancePeriodListResponse>('/api/workforce/attendance/periods?' + periodParams.toString()),
      ]);
      setOvertime(nextOvertime);
      setPeriods(nextPeriods);
      if (branchId && !nextPeriods.branches.some((branch) => branch.id === branchId)) setBranchId('');
      if (selectedOvertime) setSelectedOvertime(nextOvertime.requests.find((row) => row.id === selectedOvertime.id) ?? null);
      if (selectedPeriod) setSelectedPeriod(nextPeriods.periods.find((row) => row.id === selectedPeriod.id) ?? selectedPeriod);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được dữ liệu tăng ca và kỳ công');
    } finally { setBusy(false); }
  }

  useEffect(() => { void loadAll(); }, []);

  async function submitOvertime(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const hoursValue = Number(requestedHours);
    if (!Number.isFinite(hoursValue) || hoursValue <= 0 || hoursValue > 24) { setError('Số giờ đăng ký phải lớn hơn 0 và không quá 24 giờ.'); return; }
    if (!requestReason.trim()) { setError('Vui lòng nhập lý do tăng ca.'); return; }
    const payload = { workDate, requestedMinutes: Math.round(hoursValue * 60), reason: requestReason.trim() };
    const key = stableKey(overtimeAttempt, 'web-overtime-submit', payload);
    setBusy(true); setError(null); setNotice(null);
    try {
      await requestJson<OvertimeRequest>('/api/workforce/overtime', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(payload) });
      overtimeAttempt.current = null;
      setRequestReason('');
      await loadAll();
      setNotice('Đăng ký tăng ca đã được ghi nhận.');
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Không gửi được đăng ký tăng ca'); }
    finally { setBusy(false); }
  }

  function chooseOvertime(row: OvertimeRequest) {
    setSelectedOvertime(row);
    setActionNote('');
    setActionHours(row.actual_minutes ? hours(row.actual_minutes) : row.requested_minutes ? hours(row.requested_minutes) : '');
    setNotice(null); setError(null);
  }

  async function review(action: 'APPROVE' | 'REJECT') {
    if (!selectedOvertime) return;
    if (action === 'REJECT' && !actionNote.trim()) { setError('Vui lòng nhập lý do từ chối.'); return; }
    const payload = { requestId: selectedOvertime.id, expectedVersion: selectedOvertime.version, action, reviewReason: actionNote.trim() };
    const key = stableKey(reviewAttempt, 'web-overtime-review', payload);
    setBusy(true); setError(null);
    try {
      await requestJson<OvertimeRequest>('/api/workforce/overtime/review', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(payload) });
      reviewAttempt.current = null; setSelectedOvertime(null); await loadAll();
      setNotice(action === 'APPROVE' ? 'Đăng ký tăng ca đã được duyệt.' : 'Đăng ký tăng ca đã bị từ chối.');
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Không xử lý được tăng ca'); }
    finally { setBusy(false); }
  }

  async function recordActual() {
    if (!selectedOvertime) return;
    const value = Number(actionHours);
    if (!Number.isFinite(value) || value <= 0 || value > 24) { setError('Số giờ thực tế phải lớn hơn 0 và không quá 24 giờ.'); return; }
    const payload = { requestId: selectedOvertime.id, expectedVersion: selectedOvertime.version, actualMinutes: Math.round(value * 60), actualNote: actionNote.trim() };
    const key = stableKey(actualAttempt, 'web-overtime-actual', payload);
    setBusy(true); setError(null);
    try {
      await requestJson<OvertimeRequest>('/api/workforce/overtime/actual', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(payload) });
      actualAttempt.current = null; setSelectedOvertime(null); await loadAll();
      setNotice('Thời gian tăng ca thực tế đã được ghi nhận.');
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Không ghi nhận được thời gian thực tế'); }
    finally { setBusy(false); }
  }

  async function confirmHours() {
    if (!selectedOvertime) return;
    const value = Number(actionHours);
    if (!Number.isFinite(value) || value < 0 || value > 24) { setError('Số giờ được tính phải từ 0 đến 24 giờ.'); return; }
    const payload = { requestId: selectedOvertime.id, expectedVersion: selectedOvertime.version, confirmedMinutes: Math.round(value * 60), confirmNote: actionNote.trim() };
    const key = stableKey(confirmAttempt, 'web-overtime-confirm', payload);
    setBusy(true); setError(null);
    try {
      await requestJson<OvertimeRequest>('/api/workforce/overtime/confirm', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(payload) });
      confirmAttempt.current = null; setSelectedOvertime(null); await loadAll();
      setNotice('Giờ tăng ca được tính đã được xác nhận.');
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Không xác nhận được giờ tăng ca'); }
    finally { setBusy(false); }
  }

  async function periodAction(action: 'REFRESH' | 'RECONCILE' | 'CLOSE', period?: AttendancePeriod) {
    const target = period ?? selectedPeriod;
    const payload = {
      action,
      periodStart: target?.period_start ?? from,
      periodEnd: target?.period_end ?? to,
      branchId: target?.branch_id ?? (branchId || null),
      note: periodNote.trim(),
      acknowledgeWarnings,
    };
    const key = stableKey(periodAttempt, 'web-attendance-period-action', payload);
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await requestJson<{ period: AttendancePeriod; issues: AttendancePeriodIssueSummary }>('/api/workforce/attendance/periods', {
        method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(payload),
      });
      periodAttempt.current = null;
      setSelectedPeriod(result.period);
      setPayroll(null);
      await loadAll();
      setNotice(action === 'CLOSE' ? 'Kỳ công đã được chốt.' : action === 'RECONCILE' ? 'Kỳ công đã được đối soát.' : 'Dữ liệu kỳ công đã được tổng hợp lại.');
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Không cập nhật được kỳ công'); }
    finally { setBusy(false); }
  }

  async function viewPayroll(period: AttendancePeriod) {
    setBusy(true); setError(null);
    try {
      const data = await requestJson<AttendancePayrollInput>('/api/workforce/attendance/payroll-input?periodId=' + encodeURIComponent(period.id));
      setSelectedPeriod(period); setPayroll(data);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Không tải được đầu vào tính lương'); }
    finally { setBusy(false); }
  }

  const totalOvertime = overtime?.pagination.total ?? 0;
  const pendingOvertime = overtime?.requests.filter((row) => row.status === 'SUBMITTED').length ?? 0;
  const confirmedOvertime = overtime?.requests.filter((row) => row.status === 'CONFIRMED').reduce((sum, row) => sum + Number(row.confirmed_minutes ?? 0), 0) ?? 0;

  return (
    <AppShell
      title="Tăng ca & chốt công"
      subtitle="Quản lý tăng ca theo phê duyệt và chốt kỳ công thành đầu vào sạch cho tính lương."
      kicker="Nhân sự"
      actions={<Link className={shellStyles.actionButton + ' ' + shellStyles.actionButtonPrimary} href="/workforce/timesheet">Mở Bảng công</Link>}
    >
      <section className={sharedStyles.page} data-testid="workforce-overtime-closeout-page">
        {(error || notice) ? <div className={sharedStyles.banner + ' ' + (error ? sharedStyles.bannerError : sharedStyles.bannerSuccess)} role="status">{error ?? notice}</div> : null}

        <div className={styles.tabs} role="tablist" aria-label="Tăng ca và chốt công">
          <button type="button" className={styles.tab + ' ' + (tab === 'overtime' ? styles.tabActive : '')} onClick={() => setTab('overtime')}>Tăng ca</button>
          <button type="button" className={styles.tab + ' ' + (tab === 'closeout' ? styles.tabActive : '')} onClick={() => setTab('closeout')}>Chốt công</button>
        </div>

        <section className={sharedStyles.summaryGrid}>
          <article className={sharedStyles.summaryCard}><span>Hồ sơ tăng ca</span><strong>{totalOvertime}</strong><small>{dateLabel(from)} – {dateLabel(to)}</small></article>
          <article className={sharedStyles.summaryCard}><span>Chờ duyệt</span><strong>{pendingOvertime}</strong><small>Trong trang đang xem</small></article>
          <article className={sharedStyles.summaryCard}><span>Giờ tăng ca đã xác nhận</span><strong>{hours(confirmedOvertime)}</strong><small>Chỉ số đã đủ điều kiện đầu vào lương</small></article>
          <article className={sharedStyles.summaryCard}><span>Kỳ đã chốt</span><strong>{periods?.periods.filter((row) => row.status === 'CLOSED').length ?? 0}</strong><small>Trong phạm vi đang xem</small></article>
        </section>

        <section className={sharedStyles.toolbar}>
          <div className={sharedStyles.toolbarFilter}><label htmlFor="lot5-from">Từ ngày</label><input id="lot5-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div>
          <div className={sharedStyles.toolbarFilter}><label htmlFor="lot5-to">Đến ngày</label><input id="lot5-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></div>
          {branches.length ? <div className={sharedStyles.toolbarFilter}><label htmlFor="lot5-branch">Chi nhánh</label><select id="lot5-branch" value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">Toàn bộ phạm vi được cấp</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>)}</select></div> : null}
          {tab === 'overtime' ? <div className={sharedStyles.toolbarFilter}><label htmlFor="lot5-status">Trạng thái</label><select id="lot5-status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Tất cả</option>{Object.entries(OT_STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div> : null}
          <div className={sharedStyles.formActions}><button type="button" className={sharedStyles.secondaryButton} onClick={() => void loadAll()} disabled={busy}>{busy ? 'Đang tải…' : 'Xem dữ liệu'}</button></div>
        </section>

        {tab === 'overtime' ? <div className={styles.stack}>
          {overtime?.capabilities.canSubmitOwn ? <section className={sharedStyles.tableSection}>
            <div className={sharedStyles.sectionHeader}><div><p className={sharedStyles.panelKicker}>Đăng ký tăng ca</p><h2>Gửi đề nghị theo chính sách hiệu lực</h2></div></div>
            <form onSubmit={(event) => void submitOvertime(event)}>
              <div className={styles.formGrid}>
                <label>Ngày tăng ca<input type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} required /></label>
                <label>Số giờ đăng ký<input type="number" min="0.25" max="24" step="0.25" value={requestedHours} onChange={(event) => setRequestedHours(event.target.value)} required /></label>
                <label>Lý do<textarea value={requestReason} onChange={(event) => setRequestReason(event.target.value)} maxLength={1000} required /></label>
              </div>
              <div className={styles.actions}><button className={styles.primary} type="submit" disabled={busy}>Gửi đăng ký</button></div>
            </form>
          </section> : null}

          <section className={sharedStyles.tableSection}>
            <div className={sharedStyles.sectionHeader}><div><p className={sharedStyles.panelKicker}>Tăng ca</p><h2>Đăng ký → duyệt → thực tế → xác nhận giờ tính</h2></div><span className={sharedStyles.panelChip}>{totalOvertime} hồ sơ</span></div>
            <div className={sharedStyles.tableWrap}>
              <table className={sharedStyles.table}>
                <thead><tr><th>Ngày</th><th>Nhân sự</th><th>Đăng ký</th><th>Thực tế</th><th>Được tính</th><th>Trạng thái</th><th>Xử lý</th></tr></thead>
                <tbody>
                  {overtime?.requests.map((row) => <tr key={row.id}>
                    <td>{dateLabel(row.work_date)}</td>
                    <td><div className={styles.meta}><strong>{row.employee_code ? row.employee_code + ' · ' + row.employee_name : 'Bản thân'}</strong><small>{row.branch_name || '—'}</small></div></td>
                    <td>{hours(row.requested_minutes)} giờ</td>
                    <td>{row.actual_minutes == null ? '—' : hours(row.actual_minutes) + ' giờ'}</td>
                    <td>{row.confirmed_minutes == null ? '—' : hours(row.confirmed_minutes) + ' giờ'}</td>
                    <td><span className={styles.status}>{OT_STATUS[row.status]}</span></td>
                    <td>{((row.status === 'SUBMITTED' && overtime.capabilities.canApprove)
                      || (row.status === 'APPROVED' && overtime.capabilities.canApprove)
                      || (row.status === 'ACTUAL_RECORDED' && overtime.capabilities.canConfirm))
                      ? <button type="button" className={styles.secondary} onClick={() => chooseOvertime(row)}>Xử lý</button>
                      : <span>{row.review_reason || row.confirm_note || '—'}</span>}</td>
                  </tr>)}
                  {!overtime?.requests.length ? <tr><td colSpan={7}><div className={sharedStyles.emptyState}>Chưa có hồ sơ tăng ca trong khoảng đang xem.</div></td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          {selectedOvertime ? <section className={styles.actionPanel}>
            <div><strong>{selectedOvertime.employee_code || 'Bản thân'} · {dateLabel(selectedOvertime.work_date)}</strong><div><span className={styles.status}>{OT_STATUS[selectedOvertime.status]}</span></div></div>
            {selectedOvertime.status === 'APPROVED' || selectedOvertime.status === 'ACTUAL_RECORDED' ? <label>{selectedOvertime.status === 'APPROVED' ? 'Số giờ thực tế' : 'Số giờ được tính'}<input type="number" min="0" max="24" step="0.25" value={actionHours} onChange={(event) => setActionHours(event.target.value)} /></label> : null}
            <label>Ghi chú<textarea value={actionNote} onChange={(event) => setActionNote(event.target.value)} maxLength={1000} placeholder="Nhập khi cần giải thích hoặc từ chối" /></label>
            <div className={styles.actions}>
              {selectedOvertime.status === 'SUBMITTED' && overtime?.capabilities.canApprove ? <><button className={styles.primary} type="button" disabled={busy} onClick={() => void review('APPROVE')}>Duyệt</button><button className={styles.danger} type="button" disabled={busy} onClick={() => void review('REJECT')}>Từ chối</button></> : null}
              {selectedOvertime.status === 'APPROVED' && overtime?.capabilities.canApprove ? <button className={styles.primary} type="button" disabled={busy} onClick={() => void recordActual()}>Ghi nhận thực tế</button> : null}
              {selectedOvertime.status === 'ACTUAL_RECORDED' && overtime?.capabilities.canConfirm ? <button className={styles.primary} type="button" disabled={busy} onClick={() => void confirmHours()}>Xác nhận giờ tính</button> : null}
              <button className={styles.secondary} type="button" disabled={busy} onClick={() => setSelectedOvertime(null)}>Đóng</button>
            </div>
          </section> : null}
        </div> : null}

        {tab === 'closeout' ? <div className={styles.stack}>
          <section className={sharedStyles.tableSection}>
            <div className={sharedStyles.sectionHeader}><div><p className={sharedStyles.panelKicker}>Kỳ công</p><h2>Đang tổng hợp → Cần xử lý → Đã đối soát → Đã chốt</h2></div></div>
            {periods?.capabilities.canReconcile ? <div className={styles.actions}><button type="button" className={styles.primary} disabled={busy} onClick={() => void periodAction('REFRESH')}>Tổng hợp kỳ đang chọn</button></div> : null}
            <div className={sharedStyles.tableWrap}>
              <table className={sharedStyles.table}>
                <thead><tr><th>Kỳ</th><th>Phạm vi</th><th>Trạng thái</th><th>Việc cần xử lý</th><th>Cảnh báo</th><th>Lần chốt</th><th>Xử lý</th></tr></thead>
                <tbody>
                  {periods?.periods.map((row) => {
                    const blockers = issueTotal(row.issue_summary?.blockers);
                    const warnings = issueTotal(row.issue_summary?.warnings);
                    return <tr key={row.id}>
                      <td>{dateLabel(row.period_start)} – {dateLabel(row.period_end)}</td>
                      <td>{row.branch_name || 'Toàn Công Ty'}</td>
                      <td><span className={styles.status}>{PERIOD_STATUS[row.status]}</span></td>
                      <td>{blockers}</td><td>{warnings}</td><td>{row.revision || '—'}</td>
                      <td><div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => { setSelectedPeriod(row); setPayroll(null); setPeriodNote(''); setAcknowledgeWarnings(false); }}>Mở</button>{row.status === 'CLOSED' ? <button type="button" className={styles.secondary} onClick={() => void viewPayroll(row)}>Xem đầu vào lương</button> : null}</div></td>
                    </tr>;
                  })}
                  {!periods?.periods.length ? <tr><td colSpan={7}><div className={sharedStyles.emptyState}>Chưa có kỳ công nghiệp vụ. Bấm “Tổng hợp kỳ đang chọn” để bắt đầu.</div></td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          {selectedPeriod ? <section className={styles.actionPanel}>
            <div><strong>{dateLabel(selectedPeriod.period_start)} – {dateLabel(selectedPeriod.period_end)} · {selectedPeriod.branch_name || 'Toàn Công Ty'}</strong><div><span className={styles.status}>{PERIOD_STATUS[selectedPeriod.status]}</span></div></div>
            <div className={styles.issueGrid}>
              <div className={styles.issueCard}><strong>Việc cần xử lý trước đối soát</strong><p>Thiếu cấu hình: {selectedPeriod.issue_summary?.blockers?.configurationIssueDays ?? 0}</p><p>Điều chỉnh đang chờ: {selectedPeriod.issue_summary?.blockers?.pendingAdjustmentDays ?? 0}</p><p>Đơn nghỉ đang chờ: {selectedPeriod.issue_summary?.blockers?.pendingLeaveDays ?? 0}</p><p>Tăng ca chưa xác nhận: {selectedPeriod.issue_summary?.blockers?.outstandingOvertimeRequests ?? 0}</p></div>
              <div className={styles.issueCard}><strong>Cảnh báo cần kiểm tra</strong><p>Ngày công chưa đủ: {selectedPeriod.issue_summary?.warnings?.incompleteDays ?? 0}</p><p>Vắng không phép: {selectedPeriod.issue_summary?.warnings?.unexcusedAbsenceDays ?? 0}</p><p>Ngày có vi phạm: {selectedPeriod.issue_summary?.warnings?.violationDays ?? 0}</p></div>
            </div>
            <label>Ghi chú đối soát<textarea value={periodNote} onChange={(event) => setPeriodNote(event.target.value)} maxLength={1000} /></label>
            <label className={styles.check}><input type="checkbox" checked={acknowledgeWarnings} onChange={(event) => setAcknowledgeWarnings(event.target.checked)} /><span>Tôi đã kiểm tra các cảnh báo còn lại trong kỳ</span></label>
            <div className={styles.actions}>
              {periods?.capabilities.canReconcile ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => void periodAction('REFRESH', selectedPeriod)}>Tổng hợp lại</button> : null}
              {periods?.capabilities.canReconcile && selectedPeriod.status !== 'CLOSED' ? <button type="button" className={styles.primary} disabled={busy} onClick={() => void periodAction('RECONCILE', selectedPeriod)}>Xác nhận đã đối soát</button> : null}
              {periods?.capabilities.canClose && selectedPeriod.status === 'RECONCILED' ? <button type="button" className={styles.primary} disabled={busy} onClick={() => void periodAction('CLOSE', selectedPeriod)}>Chốt kỳ công</button> : null}
              {selectedPeriod.status === 'CLOSED' ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => void viewPayroll(selectedPeriod)}>Xem đầu vào lương</button> : null}
              <button type="button" className={styles.secondary} onClick={() => { setSelectedPeriod(null); setPayroll(null); }}>Đóng</button>
            </div>
          </section> : null}

          {payroll ? <section className={sharedStyles.tableSection}>
            <div className={sharedStyles.sectionHeader}><div><p className={sharedStyles.panelKicker}>Đầu vào tính lương</p><h2>Bản chốt kỳ công lần {payroll.revision}</h2></div><span className={sharedStyles.panelChip}>Chỉ đọc</span></div>
            <div className={styles.payrollGrid}>
              <div className={styles.payrollRow}><strong>Nhân sự</strong><strong>Phút tính công</strong><strong>Phép hưởng lương</strong><strong>Vắng không phép</strong><strong>Tăng ca xác nhận</strong></div>
              {payroll.payrollInput.employees.map((row) => <div className={styles.payrollRow} key={row.employeeId}><span>{row.employeeCode} · {row.employeeName}</span><span>{row.countedMinutes}</span><span>{row.paidLeaveDays.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ngày</span><span>{row.unexcusedAbsenceDays.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ngày</span><span>{hours(row.confirmedOvertimeMinutes)} giờ</span></div>)}
            </div>
          </section> : null}
        </div> : null}
      </section>
    </AppShell>
  );
}
