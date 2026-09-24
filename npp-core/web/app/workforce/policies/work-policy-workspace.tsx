'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import shellStyles from '../../components/app-shell.module.css';
import styles from '../../organization/organization.module.css';
import localStyles from './work-policy.module.css';
import type { WorkPolicy } from '../../../lib/workforce-types';

type ApiEnvelope<T> = { data?: T; error?: { message?: string } };
type Attempt = { payload: string; key: string } | null;
type PolicyDraft = {
  code: string;
  name: string;
  workNature: string;
  timeMode: WorkPolicy['time_mode'];
  fixedStartTime: string;
  fixedEndTime: string;
  workingDays: number[];
  breakMinutes: string;
  lateGraceMinutes: string;
  earlyLeaveGraceMinutes: string;
  overtimeEnabled: boolean;
  overtimeRequiresApproval: boolean;
  attendanceMethod: WorkPolicy['attendance_method'];
  attendanceBasis: WorkPolicy['attendance_basis'];
  timezone: string;
  roundingMinutes: string;
  minimumFullDayMinutes: string;
  minimumHalfDayMinutes: string;
  effectiveMode: 'NOW' | 'DATE';
  effectiveFrom: string;
};

const DAY_OPTIONS = [
  { value: 1, label: 'Thứ 2' }, { value: 2, label: 'Thứ 3' }, { value: 3, label: 'Thứ 4' },
  { value: 4, label: 'Thứ 5' }, { value: 5, label: 'Thứ 6' }, { value: 6, label: 'Thứ 7' },
  { value: 0, label: 'Chủ nhật' },
];
const TIME_MODE_LABEL: Record<WorkPolicy['time_mode'], string> = {
  FIXED: 'Giờ cố định', SHIFT: 'Theo ca', FLEXIBLE: 'Linh hoạt', NO_ATTENDANCE: 'Không bắt buộc chấm công',
};
const ATTENDANCE_LABEL: Record<WorkPolicy['attendance_method'], string> = {
  QR: 'Mã QR', FACE: 'Quét khuôn mặt', QR_FACE: 'Mã QR và quét khuôn mặt', MANUAL: 'Chấm công trực tiếp', BOTH: 'Mã QR và chấm công trực tiếp', FACE_MANUAL: 'Quét khuôn mặt và chấm công trực tiếp', ALL: 'Mã QR, quét khuôn mặt và chấm công trực tiếp', NONE: 'Không chấm công',
};
const ATTENDANCE_BASIS_LABEL: Record<WorkPolicy['attendance_basis'], string> = {
  TIME: 'Theo giờ vào và giờ ra',
  PRESENCE: 'Chỉ xác nhận có mặt',
  NONE: 'Không chấm công',
};

type AttendanceChoice = 'QR' | 'FACE' | 'MANUAL';
function attendanceChoices(method: WorkPolicy['attendance_method']): AttendanceChoice[] {
  if (method === 'ALL') return ['QR', 'FACE', 'MANUAL'];
  if (method === 'QR_FACE') return ['QR', 'FACE'];
  if (method === 'BOTH') return ['QR', 'MANUAL'];
  if (method === 'FACE_MANUAL') return ['FACE', 'MANUAL'];
  if (method === 'QR' || method === 'FACE' || method === 'MANUAL') return [method];
  return [];
}
function attendanceMethodFromChoices(choices: AttendanceChoice[]): WorkPolicy['attendance_method'] {
  const selected = new Set(choices);
  if (selected.size === 3) return 'ALL';
  if (selected.has('QR') && selected.has('FACE')) return 'QR_FACE';
  if (selected.has('QR') && selected.has('MANUAL')) return 'BOTH';
  if (selected.has('FACE') && selected.has('MANUAL')) return 'FACE_MANUAL';
  if (selected.has('QR')) return 'QR';
  if (selected.has('FACE')) return 'FACE';
  if (selected.has('MANUAL')) return 'MANUAL';
  return 'NONE';
}
function todayPlus(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function emptyDraft(): PolicyDraft {
  return {
    code: '', name: '', workNature: '', timeMode: 'FIXED',
    fixedStartTime: '08:00', fixedEndTime: '17:00', workingDays: [1, 2, 3, 4, 5],
    breakMinutes: '60', lateGraceMinutes: '0', earlyLeaveGraceMinutes: '0',
    overtimeEnabled: false, overtimeRequiresApproval: true, attendanceMethod: 'QR', attendanceBasis: 'TIME',
    timezone: 'Asia/Ho_Chi_Minh', roundingMinutes: '0',
    minimumFullDayMinutes: '', minimumHalfDayMinutes: '', effectiveMode: 'NOW', effectiveFrom: todayPlus(0),
  };
}
function fromPolicy(policy: WorkPolicy): PolicyDraft {
  return {
    code: policy.code, name: policy.name, workNature: policy.work_nature ?? '',
    timeMode: policy.time_mode, fixedStartTime: policy.fixed_start_time?.slice(0, 5) ?? '',
    fixedEndTime: policy.fixed_end_time?.slice(0, 5) ?? '', workingDays: [...policy.working_days],
    breakMinutes: String(policy.break_minutes), lateGraceMinutes: String(policy.late_grace_minutes),
    earlyLeaveGraceMinutes: String(policy.early_leave_grace_minutes),
    overtimeEnabled: policy.overtime_enabled, overtimeRequiresApproval: policy.overtime_requires_approval,
    attendanceMethod: policy.attendance_method, attendanceBasis: policy.attendance_basis ?? (policy.time_mode === 'NO_ATTENDANCE' ? 'NONE' : 'TIME'), timezone: policy.timezone,
    roundingMinutes: String(policy.rounding_minutes),
    minimumFullDayMinutes: policy.minimum_full_day_minutes == null ? '' : String(policy.minimum_full_day_minutes),
    minimumHalfDayMinutes: policy.minimum_half_day_minutes == null ? '' : String(policy.minimum_half_day_minutes),
    effectiveMode: 'NOW', effectiveFrom: todayPlus(0),
  };
}
function dateLabel(value: string | null | undefined) {
  if (!value) return '—';
  const date = value.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function stableKey(ref: React.MutableRefObject<Attempt>, payload: unknown) {
  const serialized = JSON.stringify(payload);
  if (ref.current?.payload === serialized) return ref.current.key;
  const key = createIdempotencyKey('web-work-policy-save');
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

export default function WorkPolicyWorkspace({ initialPolicies, initialError }: { initialPolicies: WorkPolicy[]; initialError: string | null }) {
  const [policies, setPolicies] = useState(initialPolicies);
  const [draft, setDraft] = useState<PolicyDraft>(emptyDraft());
  const [basePolicyId, setBasePolicyId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const attempt = useRef<Attempt>(null);

  const latestPolicies = useMemo(() => {
    const map = new Map<string, WorkPolicy>();
    for (const policy of policies) if (!map.has(policy.code)) map.set(policy.code, policy);
    return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [policies]);

  function openCreate() {
    setBasePolicyId(null); setDraft(emptyDraft()); setEditing(true); setError(null); setNotice(null); attempt.current = null;
  }
  function openVersion(policy: WorkPolicy) {
    setBasePolicyId(policy.id); setDraft(fromPolicy(policy)); setEditing(true); setError(null); setNotice(null); attempt.current = null;
  }
  async function reload() {
    const data = await requestJson<WorkPolicy[]>('/api/workforce/policies');
    setPolicies(data);
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const effectiveFrom = draft.effectiveMode === 'NOW' ? todayPlus(0) : draft.effectiveFrom;
    const payload = {
      ...(basePolicyId ? { basePolicyId } : { code: draft.code.trim().toUpperCase() }),
      name: draft.name.trim(),
      workNature: draft.workNature.trim(),
      timeMode: draft.timeMode,
      fixedStartTime: draft.timeMode === 'FIXED' ? draft.fixedStartTime : null,
      fixedEndTime: draft.timeMode === 'FIXED' ? draft.fixedEndTime : null,
      workingDays: draft.workingDays,
      breakMinutes: Number(draft.breakMinutes || 0),
      lateGraceMinutes: Number(draft.lateGraceMinutes || 0),
      earlyLeaveGraceMinutes: Number(draft.earlyLeaveGraceMinutes || 0),
      overtimeEnabled: draft.overtimeEnabled,
      overtimeRequiresApproval: draft.overtimeRequiresApproval,
      attendanceMethod: draft.timeMode === 'NO_ATTENDANCE' ? 'NONE' : draft.attendanceMethod,
      attendanceBasis: draft.timeMode === 'NO_ATTENDANCE' ? 'NONE' : draft.attendanceBasis,
      timezone: draft.timezone.trim(),
      roundingMinutes: Number(draft.roundingMinutes || 0),
      minimumFullDayMinutes: draft.minimumFullDayMinutes ? Number(draft.minimumFullDayMinutes) : null,
      minimumHalfDayMinutes: draft.minimumHalfDayMinutes ? Number(draft.minimumHalfDayMinutes) : null,
      effectiveFrom,
    };
    const key = stableKey(attempt, payload);
    setBusy(true); setError(null); setNotice(null);
    try {
      await requestJson<WorkPolicy>('/api/workforce/policies', {
        method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(payload),
      });
      attempt.current = null;
      await reload();
      setEditing(false);
      setNotice(basePolicyId ? 'Chính sách đã được cập nhật và lưu lịch sử.' : 'Chính sách làm việc đã được tạo.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không lưu được chính sách làm việc');
    } finally { setBusy(false); }
  }
  function toggleDay(day: number) {
    setDraft((current) => ({
      ...current,
      workingDays: current.workingDays.includes(day)
        ? current.workingDays.filter((item) => item !== day)
        : [...current.workingDays, day].sort((a, b) => a - b),
    }));
  }

  const actions = <button type="button" className={`${shellStyles.actionButton} ${shellStyles.actionButtonPrimary}`} onClick={openCreate}>Thêm chính sách</button>;

  return (
    <AppShell title="Chính sách làm việc" subtitle="Thiết lập giờ làm, ngày làm việc, chấm công và lịch sử thay đổi theo thời gian." kicker="Nhân sự" actions={actions}>
      <section className={styles.page} data-testid="work-policies-page">
        {(error || notice) ? <div className={`${styles.banner} ${error ? styles.bannerError : styles.bannerSuccess}`} role="status">{error ?? notice}</div> : null}
        <section className={styles.summaryGrid}>
          <article className={styles.summaryCard}><span>Chính sách</span><strong>{latestPolicies.length}</strong><small>Đang quản lý theo mã chính sách</small></article>
          <article className={styles.summaryCard}><span>Lịch sử chính sách</span><strong>{policies.length}</strong><small>Mỗi thay đổi được lưu theo thời gian</small></article>
          <article className={styles.summaryCard}><span>Đang áp dụng</span><strong>{latestPolicies.filter((p) => p.is_active).length}</strong><small>Có thể gán cho nhân sự theo thời gian</small></article>
        </section>

        <section className={styles.tableSection}>
          <div className={styles.sectionHeader}><div><p className={styles.panelKicker}>Danh sách</p><h2>Chính sách hiện hành</h2></div></div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Mã</th><th>Tên chính sách</th><th>Hình thức giờ làm</th><th>Chấm công</th><th>Ghi nhận công</th><th>Hiệu lực</th><th>Lần cập nhật</th><th>Thao tác</th></tr></thead>
              <tbody>
                {latestPolicies.map((policy) => (
                  <tr key={policy.id}>
                    <td><code>{policy.code}</code></td>
                    <td><strong>{policy.name}</strong><br /><small>{policy.work_nature || 'Chưa ghi tính chất công việc'}</small></td>
                    <td>{TIME_MODE_LABEL[policy.time_mode]}</td>
                    <td>{ATTENDANCE_LABEL[policy.attendance_method]}</td>
                    <td>{ATTENDANCE_BASIS_LABEL[policy.attendance_basis ?? (policy.time_mode === 'NO_ATTENDANCE' ? 'NONE' : 'TIME')]}</td>
                    <td>{dateLabel(policy.effective_from)} → {policy.effective_to ? dateLabel(policy.effective_to) : 'Không thời hạn'}</td>
                    <td>Lần {policy.version} <small>({policies.filter((item) => item.code === policy.code).length} lần cập nhật)</small></td>
                    <td><button type="button" onClick={() => openVersion(policy)}>Cập nhật chính sách</button></td>
                  </tr>
                ))}
                {!latestPolicies.length ? <tr><td colSpan={8}><div className={styles.emptyState}>Chưa có chính sách làm việc.</div></td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.tableSection}>
          <div className={styles.sectionHeader}><div><p className={styles.panelKicker}>Lịch sử hiệu lực</p><h2>Lịch sử thay đổi</h2></div></div>
          <div className={styles.tableWrap}>
            <table className={styles.table} data-testid="work-policy-history">
              <thead><tr><th>Mã</th><th>Lần cập nhật</th><th>Tên</th><th>Từ ngày</th><th>Đến ngày</th><th>Người cập nhật</th></tr></thead>
              <tbody>{policies.map((policy) => <tr key={policy.id}><td>{policy.code}</td><td>{policy.version}</td><td>{policy.name}</td><td>{dateLabel(policy.effective_from)}</td><td>{policy.effective_to ? dateLabel(policy.effective_to) : 'Không thời hạn'}</td><td>{policy.created_by}</td></tr>)}</tbody>
            </table>
          </div>
        </section>

        {editing ? (
          <div className={styles.modalBackdrop} role="presentation" onClick={() => setEditing(false)}>
            <div className={styles.modal} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <div className={styles.modalHeader}><div><p className={styles.panelKicker}>{basePolicyId ? 'Cập nhật chính sách' : 'Chính sách mới'}</p><h3>{basePolicyId ? draft.code : 'Thêm chính sách làm việc'}</h3></div><button type="button" className={styles.modalClose} onClick={() => setEditing(false)}>Đóng</button></div>
              <form className={styles.form} onSubmit={(event) => void submit(event)}>
                {!basePolicyId ? <label>Mã chính sách<input value={draft.code} onChange={(e) => setDraft((c) => ({ ...c, code: e.target.value }))} maxLength={64} required /></label> : null}
                <label>Tên chính sách<input value={draft.name} onChange={(e) => setDraft((c) => ({ ...c, name: e.target.value }))} maxLength={256} required /></label>
                <label>Tính chất công việc<input value={draft.workNature} onChange={(e) => setDraft((c) => ({ ...c, workNature: e.target.value }))} maxLength={128} /></label>
                <label>Hình thức giờ làm<select value={draft.timeMode} onChange={(e) => setDraft((c) => ({ ...c, timeMode: e.target.value as WorkPolicy['time_mode'] }))}><option value="FIXED">Giờ cố định</option><option value="SHIFT">Theo ca</option><option value="FLEXIBLE">Linh hoạt</option><option value="NO_ATTENDANCE">Không bắt buộc chấm công</option></select></label>
                {draft.timeMode === 'FIXED' ? <><label>Giờ bắt đầu<input type="time" value={draft.fixedStartTime} onChange={(e) => setDraft((c) => ({ ...c, fixedStartTime: e.target.value }))} required /></label><label>Giờ kết thúc<input type="time" value={draft.fixedEndTime} onChange={(e) => setDraft((c) => ({ ...c, fixedEndTime: e.target.value }))} required /></label></> : null}
                <fieldset className={localStyles.workingDaysFieldset}>
                  <legend>Ngày làm việc</legend>
                  <div className={localStyles.workingDaysGrid}>
                    {DAY_OPTIONS.map((day) => (
                      <label className={localStyles.workingDayOption} key={day.value}>
                        <input type="checkbox" checked={draft.workingDays.includes(day.value)} onChange={() => toggleDay(day.value)} />
                        <span>{day.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label>Nghỉ giữa ca (phút)<input type="number" min={0} max={720} value={draft.breakMinutes} onChange={(e) => setDraft((c) => ({ ...c, breakMinutes: e.target.value }))} /></label>
                <label>Ngưỡng ghi nhận đi trễ (phút)<input type="number" min={0} max={240} value={draft.lateGraceMinutes} onChange={(e) => setDraft((c) => ({ ...c, lateGraceMinutes: e.target.value }))} /></label>
                <label>Ngưỡng ghi nhận về sớm (phút)<input type="number" min={0} max={240} value={draft.earlyLeaveGraceMinutes} onChange={(e) => setDraft((c) => ({ ...c, earlyLeaveGraceMinutes: e.target.value }))} /></label>
                <div className={styles.banner} role="note">Các ngưỡng này dùng để ghi nhận sai lệch công. Bảng công không tự điều chỉnh thu nhập; xử lý vi phạm là quy trình riêng.</div>
                {draft.timeMode !== 'NO_ATTENDANCE' ? <>
                  <fieldset className={localStyles.workingDaysFieldset}>
                    <legend>Phương thức chấm công</legend>
                    <div className={localStyles.workingDaysGrid}>
                      {([['QR', 'Mã QR'], ['FACE', 'Quét khuôn mặt'], ['MANUAL', 'Chấm công trực tiếp']] as Array<[AttendanceChoice, string]>).map(([method, label]) => {
                        const selected = attendanceChoices(draft.attendanceMethod);
                        return <label className={localStyles.workingDayOption} key={method}>
                          <input type="checkbox" checked={selected.includes(method)} onChange={() => {
                            const next = selected.includes(method) ? selected.filter((item) => item !== method) : [...selected, method];
                            setDraft((current) => ({ ...current, attendanceMethod: attendanceMethodFromChoices(next) }));
                          }} />
                          <span>{label}</span>
                        </label>;
                      })}
                    </div>
                    {draft.attendanceMethod === 'NONE' ? <small>Chọn ít nhất một hình thức chấm công.</small> : null}
                  </fieldset>
                  <label>
                    Cách ghi nhận công
                    <select value={draft.attendanceBasis} onChange={(e) => setDraft((c) => ({ ...c, attendanceBasis: e.target.value as WorkPolicy['attendance_basis'] }))}>
                      <option value="TIME">Theo giờ vào và giờ ra</option>
                      <option value="PRESENCE">Chỉ xác nhận có mặt</option>
                    </select>
                  </label>
                  {draft.attendanceBasis === 'PRESENCE' ? (
                    <div className={localStyles.bootstrapNote}>Nhân sự chỉ cần ghi nhận có mặt. Bảng công không dùng khoảng thời gian giữa giờ vào và giờ ra làm căn cứ tính công và không ghi nhận vi phạm về sớm.</div>
                  ) : null}
                </> : null}
                <label>Múi giờ<input value={draft.timezone} onChange={(e) => setDraft((c) => ({ ...c, timezone: e.target.value }))} maxLength={64} /></label>
                <fieldset className={localStyles.workingDaysFieldset} data-testid="work-policy-effective-mode">
                  <legend>Thời điểm áp dụng</legend>
                  <div className={localStyles.workingDaysGrid}>
                    <label className={localStyles.workingDayOption}>
                      <input
                        type="radio"
                        name="work-policy-effective-mode"
                        checked={draft.effectiveMode === 'NOW'}
                        onChange={() => setDraft((current) => ({ ...current, effectiveMode: 'NOW', effectiveFrom: todayPlus(0) }))}
                      />
                      <span>Áp dụng ngay</span>
                    </label>
                    <label className={localStyles.workingDayOption}>
                      <input
                        type="radio"
                        name="work-policy-effective-mode"
                        checked={draft.effectiveMode === 'DATE'}
                        onChange={() => setDraft((current) => ({ ...current, effectiveMode: 'DATE', effectiveFrom: current.effectiveFrom || todayPlus(0) }))}
                      />
                      <span>Chọn ngày áp dụng</span>
                    </label>
                  </div>
                </fieldset>
                {draft.effectiveMode === 'DATE' ? (
                  <label>Ngày áp dụng<input type="date" min={basePolicyId ? todayPlus(0) : undefined} value={draft.effectiveFrom} onChange={(e) => setDraft((c) => ({ ...c, effectiveFrom: e.target.value }))} required /></label>
                ) : (
                  <div className={localStyles.bootstrapNote}>Chính sách có hiệu lực từ hôm nay.</div>
                )}
                {draft.effectiveMode === 'DATE' && !basePolicyId && draft.effectiveFrom < todayPlus(0) ? (
                  <div className={localStyles.bootstrapNote}>Ngày hiệu lực trong quá khứ chỉ nên dùng khi khởi tạo hệ thống lần đầu. Việc áp dụng cho nhân sự vẫn phải đi qua thao tác “Áp dụng chính sách ban đầu” có lý do và được lưu trong lịch sử hệ thống.</div>
                ) : null}
                <label className={localStyles.inlineCheckbox}><input type="checkbox" checked={draft.overtimeEnabled} onChange={(e) => setDraft((c) => ({ ...c, overtimeEnabled: e.target.checked }))} /><span>Có áp dụng tăng ca</span></label>
                {draft.overtimeEnabled ? <label className={localStyles.inlineCheckbox}><input type="checkbox" checked={draft.overtimeRequiresApproval} onChange={(e) => setDraft((c) => ({ ...c, overtimeRequiresApproval: e.target.checked }))} /><span>Tăng ca cần duyệt</span></label> : null}
                <div className={styles.formActions}><button type="button" className={styles.secondaryButton} onClick={() => setEditing(false)}>Hủy</button><button type="submit" className={styles.primaryButton} disabled={busy}>{busy ? 'Đang lưu…' : basePolicyId ? 'Cập nhật chính sách' : 'Tạo chính sách'}</button></div>
              </form>
            </div>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
