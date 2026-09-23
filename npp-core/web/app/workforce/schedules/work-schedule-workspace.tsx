'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import shellStyles from '../../components/app-shell.module.css';
import styles from '../../organization/organization.module.css';
import type { Employee } from '../../../lib/employee-types';
import type { WorkPolicy, WorkSchedule } from '../../../lib/workforce-types';
import SchedulePlanningPanel from './schedule-planning-panel';

type ApiEnvelope<T> = { data?: T; error?: { message?: string } };
type Attempt = { payload: string; key: string } | null;
type ScheduleDraft = {
  employeeId: string;
  workPolicyId: string;
  workDate: string;
  scheduleKind: 'WORK' | 'OFF';
  startLocal: string;
  endLocal: string;
  overrideReason: string;
  expectedUpdatedAt: string | null;
};

function tomorrowDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function isoToLocalInput(value: string | null, timeZone: string) {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
}
function zonedLocalToIso(value: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error('Giờ làm việc không hợp lệ');
  const parts = match.slice(1).map(Number);
  const guess = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], 0);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const wallAsUtc = (timestamp: number) => {
    const formatted = Object.fromEntries(
      formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
    );
    return Date.UTC(
      Number(formatted.year), Number(formatted.month) - 1, Number(formatted.day),
      Number(formatted.hour), Number(formatted.minute), Number(formatted.second),
    );
  };
  let offset = wallAsUtc(guess) - guess;
  let utc = guess - offset;
  const secondOffset = wallAsUtc(utc) - utc;
  if (secondOffset !== offset) {
    offset = secondOffset;
    utc = guess - offset;
  }
  return new Date(utc).toISOString();
}
function stableKey(ref: React.MutableRefObject<Attempt>, payload: unknown) {
  const serialized = JSON.stringify(payload);
  if (ref.current?.payload === serialized) return ref.current.key;
  const key = createIdempotencyKey('web-work-schedule-save');
  ref.current = { payload: serialized, key };
  return key;
}
async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store', ...init,
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers || {}) },
  });
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || payload.data === undefined) throw new Error(payload.error?.message || 'Không thực hiện được yêu cầu');
  return payload.data;
}
function dateTimeLabel(value: string | null, timeZone: string | null) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: timeZone || 'Asia/Ho_Chi_Minh',
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(new Date(value));
  } catch { return value; }
}

export default function WorkScheduleWorkspace({
  initialEmployees,
  policies,
  initialSchedules,
  initialFrom,
  initialTo,
  initialError,
}: {
  initialEmployees: Employee[];
  policies: WorkPolicy[];
  initialSchedules: WorkSchedule[];
  initialFrom: string;
  initialTo: string;
  initialError: string | null;
}) {
  const [schedules, setSchedules] = useState(initialSchedules);
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const attempt = useRef<Attempt>(null);

  const activeEmployees = useMemo(() => initialEmployees.filter((employee) => employee.is_active), [initialEmployees]);
  const activePolicies = useMemo(() => policies.filter((policy) => policy.is_active), [policies]);
  const policyMap = useMemo(() => new Map(policies.map((policy) => [policy.id, policy])), [policies]);

  async function reload() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const params = new URLSearchParams({ from, to });
      if (employeeFilter) params.set('employeeId', employeeFilter);
      const data = await requestJson<WorkSchedule[]>(`/api/workforce/schedules?${params.toString()}`);
      setSchedules(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được lịch làm việc');
    } finally { setBusy(false); }
  }
  function openCreate() {
    const employeeId = employeeFilter || activeEmployees[0]?.id || '';
    const workPolicyId = activePolicies[0]?.id || '';
    const workDate = tomorrowDate();
    setDraft({
      employeeId, workPolicyId, workDate, scheduleKind: 'WORK',
      startLocal: `${workDate}T08:00`, endLocal: `${workDate}T17:00`,
      overrideReason: '', expectedUpdatedAt: null,
    });
    attempt.current = null; setError(null); setNotice(null);
  }
  function openEdit(schedule: WorkSchedule) {
    const policy = schedule.work_policy_id ? policyMap.get(schedule.work_policy_id) : null;
    const zone = policy?.timezone || schedule.policy_timezone || 'Asia/Ho_Chi_Minh';
    setDraft({
      employeeId: schedule.employee_id,
      workPolicyId: schedule.work_policy_id || activePolicies[0]?.id || '',
      workDate: schedule.work_date,
      scheduleKind: schedule.schedule_kind,
      startLocal: isoToLocalInput(schedule.scheduled_start_at, zone),
      endLocal: isoToLocalInput(schedule.scheduled_end_at, zone),
      overrideReason: schedule.override_reason || '',
      expectedUpdatedAt: schedule.updated_at,
    });
    attempt.current = null; setError(null); setNotice(null);
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const policy = policyMap.get(draft.workPolicyId);
    if (!policy) { setError('Vui lòng chọn chính sách làm việc.'); return; }
    let scheduledStartAt: string | null = null;
    let scheduledEndAt: string | null = null;
    try {
      if (draft.scheduleKind === 'WORK') {
        scheduledStartAt = zonedLocalToIso(draft.startLocal, policy.timezone);
        scheduledEndAt = zonedLocalToIso(draft.endLocal, policy.timezone);
      }
    } catch (timeError) {
      setError(timeError instanceof Error ? timeError.message : 'Giờ làm việc không hợp lệ');
      return;
    }
    const payload = {
      employeeId: draft.employeeId,
      workPolicyId: draft.workPolicyId,
      workDate: draft.workDate,
      scheduleKind: draft.scheduleKind,
      scheduledStartAt,
      scheduledEndAt,
      overrideReason: draft.overrideReason.trim(),
      ...(draft.expectedUpdatedAt ? { expectedUpdatedAt: draft.expectedUpdatedAt } : {}),
    };
    const key = stableKey(attempt, payload);
    setBusy(true); setError(null); setNotice(null);
    try {
      await requestJson<WorkSchedule>('/api/workforce/schedules', {
        method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(payload),
      });
      attempt.current = null;
      setDraft(null);
      setNotice('Lịch làm việc đã được cập nhật.');
      const params = new URLSearchParams({ from, to });
      if (employeeFilter) params.set('employeeId', employeeFilter);
      setSchedules(await requestJson<WorkSchedule[]>(`/api/workforce/schedules?${params.toString()}`));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không lưu được lịch làm việc');
    } finally { setBusy(false); }
  }

  const actions = <button type="button" className={`${shellStyles.actionButton} ${shellStyles.actionButtonPrimary}`} onClick={openCreate}>Xếp lịch</button>;

  return (
    <AppShell title="Ca và lịch làm việc" subtitle="Xem và điều chỉnh lịch làm việc tương lai theo chính sách đã áp dụng." kicker="Nhân sự" actions={actions}>
      <section className={styles.page} data-testid="work-schedules-page">
        {(error || notice) ? <div className={`${styles.banner} ${error ? styles.bannerError : styles.bannerSuccess}`} role="status">{error ?? notice}</div> : null}
        <section className={styles.toolbar}>
          <div className={styles.toolbarFilter}>
            <label htmlFor="schedule-employee">Nhân sự</label>
            <select id="schedule-employee" value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}>
              <option value="">Tất cả nhân sự trong phạm vi</option>
              {activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.code} · {employee.full_name}</option>)}
            </select>
          </div>
          <div className={styles.toolbarFilter}><label htmlFor="schedule-from">Từ ngày</label><input id="schedule-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div>
          <div className={styles.toolbarFilter}><label htmlFor="schedule-to">Đến ngày</label><input id="schedule-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></div>
          <div className={styles.formActions}><button type="button" className={styles.secondaryButton} onClick={() => void reload()} disabled={busy}>{busy ? 'Đang tải…' : 'Xem lịch'}</button></div>
        </section>
        <div className={styles.banner} role="note">Lịch trong hôm nay và quá khứ chỉ dùng để đối chiếu. Điều chỉnh lịch bắt đầu từ ngày mai để không làm thay đổi lịch sử đã chấm.</div>

        <section className={styles.tableSection}>
          <div className={styles.sectionHeader}><div><p className={styles.panelKicker}>Lịch theo ngày</p><h2>Ca và ngày nghỉ</h2></div><span className={styles.panelChip}>{schedules.length} dòng</span></div>
          <div className={styles.tableWrap}>
            <table className={styles.table} data-testid="work-schedule-table">
              <thead><tr><th>Ngày</th><th>Nhân sự</th><th>Chính sách</th><th>Trạng thái</th><th>Bắt đầu</th><th>Kết thúc</th><th>Lý do điều chỉnh</th><th>Thao tác</th></tr></thead>
              <tbody>
                {schedules.map((schedule) => (
                  <tr key={schedule.id}>
                    <td>{schedule.work_date}</td>
                    <td><strong>{schedule.employee_code} · {schedule.employee_name}</strong></td>
                    <td>{schedule.policy_name || 'Chưa xác định'}</td>
                    <td>{schedule.schedule_kind === 'WORK' ? 'Ngày làm việc' : 'Ngày nghỉ'}</td>
                    <td>{dateTimeLabel(schedule.scheduled_start_at, schedule.policy_timezone)}</td>
                    <td>{dateTimeLabel(schedule.scheduled_end_at, schedule.policy_timezone)}</td>
                    <td>{schedule.override_reason || '—'}</td>
                    <td>{schedule.work_date > tomorrowDate() || schedule.work_date === tomorrowDate() ? <button type="button" onClick={() => openEdit(schedule)}>Điều chỉnh</button> : <span>Chỉ xem</span>}</td>
                  </tr>
                ))}
                {!schedules.length ? <tr><td colSpan={8}><div className={styles.emptyState}>Chưa có lịch làm việc trong khoảng đã chọn.</div></td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <SchedulePlanningPanel employees={initialEmployees} onSchedulesChanged={() => void reload()} />

        {draft ? (
          <div className={styles.modalBackdrop} role="presentation" onClick={() => setDraft(null)}>
            <div className={styles.modal} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <div className={styles.modalHeader}><div><p className={styles.panelKicker}>{draft.expectedUpdatedAt ? 'Điều chỉnh lịch' : 'Xếp lịch'}</p><h3>Ca và lịch làm việc</h3></div><button type="button" className={styles.modalClose} onClick={() => setDraft(null)}>Đóng</button></div>
              <form className={styles.form} onSubmit={(event) => void submit(event)}>
                <label>Nhân sự<select value={draft.employeeId} onChange={(event) => setDraft((current) => current ? ({ ...current, employeeId: event.target.value }) : current)} disabled={Boolean(draft.expectedUpdatedAt)} required>{activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.code} · {employee.full_name}</option>)}</select></label>
                <label>Ngày làm việc<input type="date" min={tomorrowDate()} value={draft.workDate} onChange={(event) => setDraft((current) => current ? ({ ...current, workDate: event.target.value }) : current)} disabled={Boolean(draft.expectedUpdatedAt)} required /></label>
                <label>Chính sách<select value={draft.workPolicyId} onChange={(event) => setDraft((current) => current ? ({ ...current, workPolicyId: event.target.value }) : current)} required>{activePolicies.map((policy) => <option key={policy.id} value={policy.id}>{policy.code} · {policy.name}</option>)}</select></label>
                <label>Trạng thái<select value={draft.scheduleKind} onChange={(event) => setDraft((current) => current ? ({ ...current, scheduleKind: event.target.value as 'WORK' | 'OFF' }) : current)}><option value="WORK">Ngày làm việc</option><option value="OFF">Ngày nghỉ</option></select></label>
                {draft.scheduleKind === 'WORK' ? <><label>Bắt đầu<input type="datetime-local" value={draft.startLocal} onChange={(event) => setDraft((current) => current ? ({ ...current, startLocal: event.target.value }) : current)} required /></label><label>Kết thúc<input type="datetime-local" value={draft.endLocal} onChange={(event) => setDraft((current) => current ? ({ ...current, endLocal: event.target.value }) : current)} required /></label></> : null}
                <label>Lý do xếp lịch hoặc điều chỉnh<input value={draft.overrideReason} onChange={(event) => setDraft((current) => current ? ({ ...current, overrideReason: event.target.value }) : current)} maxLength={512} required placeholder="Ví dụ: đổi ca theo kế hoạch tuần" /></label>
                <div className={styles.formActions}><button type="button" className={styles.secondaryButton} onClick={() => setDraft(null)}>Hủy</button><button type="submit" className={styles.primaryButton} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu lịch'}</button></div>
              </form>
            </div>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
