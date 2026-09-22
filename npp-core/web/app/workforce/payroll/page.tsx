'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import shellStyles from '../../components/app-shell.module.css';
import sharedStyles from '../../organization/organization.module.css';
import styles from '../overtime/overtime.module.css';

type Tab = 'board' | 'reconcile' | 'settings' | 'components' | 'payslips' | 'history';
type AttemptMap = Record<string, { payload: string; key: string }>;

type AttendanceSource = {
  id: string;
  branch_id: string | null;
  scope_key: string;
  period_start: string;
  period_end: string;
  revision: number;
  source_fingerprint: string;
  branch_code?: string | null;
  branch_name?: string | null;
};

type PayrollPeriod = {
  id: string;
  attendance_period_id: string;
  attendance_revision: number;
  attendance_source_fingerprint: string;
  branch_id: string | null;
  scope_key: string;
  period_start: string;
  period_end: string;
  status: 'AGGREGATING' | 'NEEDS_ACTION' | 'RECONCILED' | 'CLOSED';
  currency_code: string;
  branch_code?: string | null;
  branch_name?: string | null;
};

type PayrollEmployee = {
  id: string;
  code: string;
  full_name: string;
  branch_id: string | null;
  branch_code?: string | null;
  branch_name?: string | null;
};

type ComponentType = {
  id: string;
  code: string;
  name: string;
  category: 'INCOME' | 'DEDUCTION' | 'REIMBURSEMENT';
  recurrence: 'FIXED' | 'PERIOD';
  input_mode: 'AUTOMATIC' | 'MANUAL';
  prorate_by_workdays: boolean;
  include_in_gross: boolean;
  include_in_net: boolean;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
};

type SalaryProfile = {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  monthly_salary: string;
  currency_code: string;
  effective_from: string;
  effective_to: string | null;
  note: string | null;
  branch_id?: string | null;
  branch_name?: string | null;
};

type FixedComponent = {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  component_type_id: string;
  component_code: string;
  component_name: string;
  category: ComponentType['category'];
  amount: string;
  effective_from: string;
  effective_to: string | null;
  note: string | null;
  branch_id?: string | null;
  branch_name?: string | null;
};

type PeriodComponent = {
  id: string;
  payroll_period_id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  component_type_id: string;
  component_code: string;
  component_name: string;
  category: ComponentType['category'];
  amount: string;
  note: string;
  source: string;
  source_reference: string | null;
  created_at: string;
};

type PayrollFoundationData = {
  attendanceSources: AttendanceSource[];
  periods: PayrollPeriod[];
  selectedPeriod: PayrollPeriod | null;
  employees: PayrollEmployee[];
  periodEmployees: PayrollEmployee[];
  componentTypes: ComponentType[];
  salaryProfiles: SalaryProfile[];
  fixedComponents: FixedComponent[];
  periodComponents: PeriodComponent[];
  asOfDate: string;
  capabilities: { canManage: boolean };
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { message?: string };
};

const TAB_LABELS: Array<{ id: Tab; label: string }> = [
  { id: 'board', label: 'Bảng lương' },
  { id: 'reconcile', label: 'Đối soát' },
  { id: 'settings', label: 'Thiết lập lương' },
  { id: 'components', label: 'Khoản thu & khấu trừ' },
  { id: 'payslips', label: 'Phiếu lương' },
  { id: 'history', label: 'Lịch sử kỳ lương' },
];

const PERIOD_STATUS: Record<PayrollPeriod['status'], string> = {
  AGGREGATING: 'Đang tổng hợp',
  NEEDS_ACTION: 'Cần xử lý',
  RECONCILED: 'Đã đối soát',
  CLOSED: 'Đã chốt',
};

const CATEGORY_LABEL: Record<ComponentType['category'], string> = {
  INCOME: 'Thu nhập lương',
  DEDUCTION: 'Khấu trừ',
  REIMBURSEMENT: 'Hoàn chi phí',
};

const RECURRENCE_LABEL: Record<ComponentType['recurrence'], string> = {
  FIXED: 'Cố định',
  PERIOD: 'Theo kỳ',
};

const INPUT_LABEL: Record<ComponentType['input_mode'], string> = {
  AUTOMATIC: 'Tự động',
  MANUAL: 'Nhập tay',
};

function businessDate() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function stableKey(ref: { current: AttemptMap }, operation: string, payload: unknown) {
  const serialized = JSON.stringify(payload);
  const current = ref.current[operation];
  if (current?.payload === serialized) return current.key;
  const key = createIdempotencyKey(operation);
  ref.current[operation] = { payload: serialized, key };
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
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message || 'Không thực hiện được yêu cầu');
  }
  return payload.data;
}

function dateLabel(value: string | null | undefined) {
  if (!value) return '—';
  const raw = String(value).slice(0, 10);
  const [year, month, day] = raw.split('-');
  return year && month && day ? `${day}/${month}/${year}` : String(value);
}

function moneyLabel(value: string | number | null | undefined) {
  const raw = String(value ?? '0').trim();
  const [wholeRaw, fractionRaw = ''] = raw.split('.');
  const negative = wholeRaw.startsWith('-');
  const digits = negative ? wholeRaw.slice(1) : wholeRaw;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = fractionRaw.replace(/0+$/, '');
  return `${negative ? '-' : ''}${grouped}${fraction ? ',' + fraction : ''} ₫`;
}

function periodLabel(period: { period_start: string; period_end: string; branch_name?: string | null }) {
  return `${dateLabel(period.period_start)} – ${dateLabel(period.period_end)} · ${period.branch_name || 'Toàn Công Ty'}`;
}

export default function PayrollPage() {
  const today = useMemo(() => businessDate(), []);
  const attempts = useRef<AttemptMap>({});
  const [tab, setTab] = useState<Tab>('board');
  const [data, setData] = useState<PayrollFoundationData | null>(null);
  const [selectedAttendanceId, setSelectedAttendanceId] = useState('');
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [salaryEmployeeId, setSalaryEmployeeId] = useState('');
  const [salaryAmount, setSalaryAmount] = useState('');
  const [salaryEffectiveFrom, setSalaryEffectiveFrom] = useState(today);
  const [salaryNote, setSalaryNote] = useState('');

  const [typeCode, setTypeCode] = useState('');
  const [typeName, setTypeName] = useState('');
  const [typeCategory, setTypeCategory] = useState<ComponentType['category']>('INCOME');
  const [typeRecurrence, setTypeRecurrence] = useState<ComponentType['recurrence']>('PERIOD');
  const [typeInputMode, setTypeInputMode] = useState<ComponentType['input_mode']>('MANUAL');
  const [typeProrate, setTypeProrate] = useState(false);
  const [typeGross, setTypeGross] = useState(true);
  const [typeNet, setTypeNet] = useState(true);
  const [typeEffectiveFrom, setTypeEffectiveFrom] = useState(today);

  const [fixedEmployeeId, setFixedEmployeeId] = useState('');
  const [fixedComponentTypeId, setFixedComponentTypeId] = useState('');
  const [fixedAmount, setFixedAmount] = useState('');
  const [fixedEffectiveFrom, setFixedEffectiveFrom] = useState(today);
  const [fixedNote, setFixedNote] = useState('');

  const [periodEmployeeId, setPeriodEmployeeId] = useState('');
  const [periodComponentTypeId, setPeriodComponentTypeId] = useState('');
  const [periodAmount, setPeriodAmount] = useState('');
  const [periodNote, setPeriodNote] = useState('');

  const fixedTypes = useMemo(
    () => (data?.componentTypes ?? []).filter((item) => item.is_active && item.recurrence === 'FIXED' && item.input_mode === 'MANUAL'),
    [data],
  );
  const periodTypes = useMemo(
    () => (data?.componentTypes ?? []).filter((item) => item.is_active && item.recurrence === 'PERIOD' && item.input_mode === 'MANUAL'),
    [data],
  );

  async function load(periodId?: string) {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      const target = periodId || selectedPeriodId;
      if (target) params.set('periodId', target);
      const next = await requestJson<PayrollFoundationData>(
        '/api/workforce/payroll' + (params.size ? '?' + params.toString() : ''),
      );
      setData(next);
      setSelectedPeriodId(next.selectedPeriod?.id ?? '');
      if (!selectedAttendanceId && next.attendanceSources.length) {
        setSelectedAttendanceId(next.attendanceSources[0].id);
      }
      if (!salaryEmployeeId && next.employees.length) setSalaryEmployeeId(next.employees[0].id);
      if (!fixedEmployeeId && next.employees.length) setFixedEmployeeId(next.employees[0].id);
      if (next.periodEmployees.length && !next.periodEmployees.some((employee) => employee.id === periodEmployeeId)) {
        setPeriodEmployeeId(next.periodEmployees[0].id);
      }
      if (!fixedComponentTypeId) {
        const first = next.componentTypes.find((item) => item.is_active && item.recurrence === 'FIXED' && item.input_mode === 'MANUAL');
        if (first) setFixedComponentTypeId(first.id);
      }
      if (!periodComponentTypeId) {
        const first = next.componentTypes.find((item) => item.is_active && item.recurrence === 'PERIOD' && item.input_mode === 'MANUAL');
        if (first) setPeriodComponentTypeId(first.id);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được dữ liệu tính lương');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function mutate<T>(operation: string, payload: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const key = stableKey(attempts, operation, payload);
      const result = await requestJson<T>('/api/workforce/payroll', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(payload),
      });
      setNotice(successMessage);
      return result;
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'Không lưu được thay đổi');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createPeriod() {
    if (!selectedAttendanceId) return;
    const result = await mutate<PayrollPeriod>(
      'web-payroll-create-period',
      { command: 'CREATE_PERIOD', attendancePeriodId: selectedAttendanceId },
      'Đã tạo kỳ lương từ bản chốt kỳ công.',
    );
    if (result) {
      setSelectedPeriodId(result.id);
      await load(result.id);
    }
  }

  async function saveSalary(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      command: 'SAVE_SALARY',
      employeeId: salaryEmployeeId,
      monthlySalary: salaryAmount,
      effectiveFrom: salaryEffectiveFrom,
      note: salaryNote,
    };
    const result = await mutate(
      'web-payroll-save-salary',
      payload,
      'Đã lưu mức lương mới theo ngày áp dụng.',
    );
    if (result) {
      setSalaryAmount('');
      setSalaryNote('');
      await load(selectedPeriodId);
    }
  }

  async function createComponentType(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      command: 'CREATE_COMPONENT_TYPE',
      code: typeCode,
      name: typeName,
      category: typeCategory,
      recurrence: typeRecurrence,
      inputMode: typeInputMode,
      prorateByWorkdays: typeProrate,
      includeInGross: typeGross,
      includeInNet: typeNet,
      effectiveFrom: typeEffectiveFrom,
    };
    const result = await mutate(
      'web-payroll-create-component-type',
      payload,
      'Đã thêm khoản dùng cho tính lương.',
    );
    if (result) {
      setTypeCode('');
      setTypeName('');
      await load(selectedPeriodId);
    }
  }

  async function saveFixedComponent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      command: 'ASSIGN_FIXED_COMPONENT',
      employeeId: fixedEmployeeId,
      componentTypeId: fixedComponentTypeId,
      amount: fixedAmount,
      effectiveFrom: fixedEffectiveFrom,
      note: fixedNote,
    };
    const result = await mutate(
      'web-payroll-assign-fixed-component',
      payload,
      'Đã lưu khoản cố định theo ngày áp dụng.',
    );
    if (result) {
      setFixedAmount('');
      setFixedNote('');
      await load(selectedPeriodId);
    }
  }

  async function addPeriodComponent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data?.selectedPeriod) return;
    const payload = {
      command: 'ADD_PERIOD_COMPONENT',
      payrollPeriodId: data.selectedPeriod.id,
      employeeId: periodEmployeeId,
      componentTypeId: periodComponentTypeId,
      amount: periodAmount,
      note: periodNote,
    };
    const result = await mutate(
      'web-payroll-add-period-component',
      payload,
      'Đã ghi khoản phát sinh vào kỳ lương.',
    );
    if (result) {
      setPeriodAmount('');
      setPeriodNote('');
      await load(data.selectedPeriod.id);
    }
  }

  function changeCategory(value: ComponentType['category']) {
    setTypeCategory(value);
    if (value === 'INCOME') {
      setTypeGross(true);
      setTypeNet(true);
    } else {
      setTypeGross(false);
      setTypeNet(true);
    }
  }

  const selectedPeriod = data?.selectedPeriod ?? null;

  return (
    <AppShell
      title="Tính lương"
      subtitle="Thiết lập dữ liệu nền theo kỳ, theo nhân sự và theo ngày áp dụng."
      kicker="Nhân sự"
      actions={<button type="button" className={shellStyles.secondaryButton} disabled={busy} onClick={() => void load(selectedPeriodId)}>Tải lại</button>}
    >
      <section className={styles.stack}>
        <div className={styles.tabs} role="tablist" aria-label="Tính lương">
          {TAB_LABELS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`${styles.tab} ${tab === item.id ? styles.tabActive : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {error ? <div className={sharedStyles.errorBanner} role="alert">{error}</div> : null}
        {notice ? <div className={sharedStyles.successBanner} role="status">{notice}</div> : null}

        {tab === 'board' ? (
          <div className={styles.stack}>
            <section className={sharedStyles.tableSection}>
              <div className={sharedStyles.sectionHeader}>
                <div>
                  <p className={sharedStyles.panelKicker}>Kỳ lương</p>
                  <h2>Bảng lương kỳ hiện tại</h2>
                </div>
                <span className={sharedStyles.panelChip}>{selectedPeriod ? PERIOD_STATUS[selectedPeriod.status] : 'Chưa tạo kỳ'}</span>
              </div>

              {data?.capabilities.canManage ? (
                <div className={styles.actionPanel}>
                  <strong>Tạo kỳ lương từ kỳ công đã chốt</strong>
                  <div className={styles.formGrid}>
                    <label>
                      Kỳ công
                      <select value={selectedAttendanceId} onChange={(event) => setSelectedAttendanceId(event.target.value)}>
                        <option value="">Chọn kỳ công đã chốt</option>
                        {(data?.attendanceSources ?? []).map((source) => (
                          <option key={source.id} value={source.id}>
                            {periodLabel(source)} · Bản chốt lần {source.revision}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className={styles.actions}>
                    <button type="button" className={styles.primary} disabled={busy || !selectedAttendanceId} onClick={() => void createPeriod()}>
                      Tạo kỳ lương
                    </button>
                  </div>
                </div>
              ) : null}

              <div className={sharedStyles.tableWrap}>
                <table className={sharedStyles.table}>
                  <thead>
                    <tr>
                      <th>Kỳ lương</th>
                      <th>Nguồn bảng công</th>
                      <th>Trạng thái</th>
                      <th>Xử lý</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.periods ?? []).map((period) => (
                      <tr key={period.id}>
                        <td><strong>{periodLabel(period)}</strong></td>
                        <td>Bản chốt lần {period.attendance_revision}</td>
                        <td><span className={styles.status}>{PERIOD_STATUS[period.status]}</span></td>
                        <td>
                          <button type="button" className={styles.secondary} disabled={busy} onClick={() => void load(period.id)}>
                            Xem kỳ
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!data?.periods?.length ? (
                      <tr><td colSpan={4}><div className={sharedStyles.emptyState}>Chưa có kỳ lương. Hãy chọn một kỳ công đã chốt để bắt đầu.</div></td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            {selectedPeriod ? (
              <section className={sharedStyles.tableSection}>
                <div className={sharedStyles.sectionHeader}>
                  <div>
                    <p className={sharedStyles.panelKicker}>Kỳ đang xem</p>
                    <h2>{periodLabel(selectedPeriod)}</h2>
                  </div>
                  <span className={sharedStyles.panelChip}>Bản chốt công lần {selectedPeriod.attendance_revision}</span>
                </div>
                <div className={sharedStyles.emptyState}>
                  Kỳ đã có nguồn bảng công cố định và sẵn sàng để tổng hợp khi mức lương, khoản cố định và khoản phát sinh đã được thiết lập đầy đủ.
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        {tab === 'reconcile' ? (
          <section className={sharedStyles.tableSection}>
            <div className={sharedStyles.sectionHeader}>
              <div><p className={sharedStyles.panelKicker}>Đối soát</p><h2>Kiểm tra kỳ lương</h2></div>
              <span className={sharedStyles.panelChip}>{selectedPeriod ? PERIOD_STATUS[selectedPeriod.status] : 'Chưa chọn kỳ'}</span>
            </div>
            <div className={sharedStyles.emptyState}>
              Chưa có số liệu tổng hợp để đối soát. Dữ liệu nền hiện được giữ nguyên để chuẩn bị cho bước tổng hợp lương.
            </div>
          </section>
        ) : null}

        {tab === 'settings' ? (
          <div className={styles.stack}>
            <section className={sharedStyles.tableSection}>
              <div className={sharedStyles.sectionHeader}>
                <div><p className={sharedStyles.panelKicker}>Mức lương</p><h2>Mức lương theo ngày áp dụng</h2></div>
                <span className={sharedStyles.panelChip}>Lưu lịch sử</span>
              </div>

              {data?.capabilities.canManage ? (
                <form className={styles.actionPanel} onSubmit={(event) => void saveSalary(event)}>
                  <div className={styles.formGrid}>
                    <label>
                      Nhân sự
                      <select value={salaryEmployeeId} onChange={(event) => setSalaryEmployeeId(event.target.value)} required>
                        <option value="">Chọn nhân sự</option>
                        {(data?.employees ?? []).map((employee) => (
                          <option key={employee.id} value={employee.id}>{employee.code} · {employee.full_name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Mức lương tháng
                      <input type="number" min="0" step="0.01" value={salaryAmount} onChange={(event) => setSalaryAmount(event.target.value)} required />
                    </label>
                    <label>
                      Ngày áp dụng
                      <input type="date" value={salaryEffectiveFrom} onChange={(event) => setSalaryEffectiveFrom(event.target.value)} required />
                    </label>
                    <label>
                      Ghi chú
                      <input value={salaryNote} onChange={(event) => setSalaryNote(event.target.value)} maxLength={1000} placeholder="Nội dung thay đổi nếu cần" />
                    </label>
                  </div>
                  <div className={styles.actions}>
                    <button type="submit" className={styles.primary} disabled={busy}>Lưu mức lương</button>
                  </div>
                </form>
              ) : null}

              <div className={sharedStyles.tableWrap}>
                <table className={sharedStyles.table}>
                  <thead><tr><th>Nhân sự</th><th>Mức lương</th><th>Hiệu lực</th><th>Ghi chú</th></tr></thead>
                  <tbody>
                    {(data?.salaryProfiles ?? []).map((profile) => (
                      <tr key={profile.id}>
                        <td><div className={styles.meta}><strong>{profile.employee_code} · {profile.employee_name}</strong><small>{profile.branch_name || 'Toàn Công Ty'}</small></div></td>
                        <td><strong>{moneyLabel(profile.monthly_salary)}</strong></td>
                        <td>{dateLabel(profile.effective_from)} – {dateLabel(profile.effective_to)}</td>
                        <td>{profile.note || '—'}</td>
                      </tr>
                    ))}
                    {!data?.salaryProfiles?.length ? <tr><td colSpan={4}><div className={sharedStyles.emptyState}>Chưa thiết lập mức lương cho nhân sự trong phạm vi đang xem.</div></td></tr> : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section className={sharedStyles.tableSection}>
              <div className={sharedStyles.sectionHeader}>
                <div><p className={sharedStyles.panelKicker}>Khoản cố định</p><h2>Khoản áp dụng định kỳ theo nhân sự</h2></div>
                <span className={sharedStyles.panelChip}>Theo ngày áp dụng</span>
              </div>

              {data?.capabilities.canManage ? (
                <form className={styles.actionPanel} onSubmit={(event) => void saveFixedComponent(event)}>
                  <div className={styles.formGrid}>
                    <label>
                      Nhân sự
                      <select value={fixedEmployeeId} onChange={(event) => setFixedEmployeeId(event.target.value)} required>
                        <option value="">Chọn nhân sự</option>
                        {(data?.employees ?? []).map((employee) => <option key={employee.id} value={employee.id}>{employee.code} · {employee.full_name}</option>)}
                      </select>
                    </label>
                    <label>
                      Khoản cố định
                      <select value={fixedComponentTypeId} onChange={(event) => setFixedComponentTypeId(event.target.value)} required>
                        <option value="">Chọn khoản</option>
                        {fixedTypes.map((item) => <option key={item.id} value={item.id}>{item.name} · {CATEGORY_LABEL[item.category]}</option>)}
                      </select>
                    </label>
                    <label>
                      Số tiền
                      <input type="number" min="0" step="0.01" value={fixedAmount} onChange={(event) => setFixedAmount(event.target.value)} required />
                    </label>
                    <label>
                      Ngày áp dụng
                      <input type="date" value={fixedEffectiveFrom} onChange={(event) => setFixedEffectiveFrom(event.target.value)} required />
                    </label>
                    <label>
                      Ghi chú
                      <input value={fixedNote} onChange={(event) => setFixedNote(event.target.value)} maxLength={1000} />
                    </label>
                  </div>
                  <div className={styles.actions}>
                    <button type="submit" className={styles.primary} disabled={busy || !fixedTypes.length}>Lưu khoản cố định</button>
                  </div>
                </form>
              ) : null}

              <div className={sharedStyles.tableWrap}>
                <table className={sharedStyles.table}>
                  <thead><tr><th>Nhân sự</th><th>Khoản</th><th>Số tiền</th><th>Hiệu lực</th></tr></thead>
                  <tbody>
                    {(data?.fixedComponents ?? []).map((item) => (
                      <tr key={item.id}>
                        <td>{item.employee_code} · {item.employee_name}</td>
                        <td><div className={styles.meta}><strong>{item.component_name}</strong><small>{CATEGORY_LABEL[item.category]}</small></div></td>
                        <td><strong>{moneyLabel(item.amount)}</strong></td>
                        <td>{dateLabel(item.effective_from)} – {dateLabel(item.effective_to)}</td>
                      </tr>
                    ))}
                    {!data?.fixedComponents?.length ? <tr><td colSpan={4}><div className={sharedStyles.emptyState}>Chưa có khoản cố định theo nhân sự.</div></td></tr> : null}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : null}

        {tab === 'components' ? (
          <div className={styles.stack}>
            <section className={sharedStyles.tableSection}>
              <div className={sharedStyles.sectionHeader}>
                <div><p className={sharedStyles.panelKicker}>Danh mục khoản</p><h2>Khoản thu, khấu trừ và hoàn chi phí</h2></div>
                <span className={sharedStyles.panelChip}>Công Ty tự thiết lập</span>
              </div>
              <p className={sharedStyles.sectionDescription}>
                Hoàn chi phí được quản lý riêng với thu nhập lương. Mặc định khoản hoàn chi phí không đưa vào tổng thu nhập lương nhưng có thể đưa vào số thực nhận.
              </p>

              {data?.capabilities.canManage ? (
                <form className={styles.actionPanel} onSubmit={(event) => void createComponentType(event)}>
                  <div className={styles.formGrid}>
                    <label>Mã khoản<input value={typeCode} onChange={(event) => setTypeCode(event.target.value.toUpperCase())} maxLength={32} placeholder="VD: THUONG_LE" required /></label>
                    <label>Tên khoản<input value={typeName} onChange={(event) => setTypeName(event.target.value)} maxLength={120} required /></label>
                    <label>
                      Nhóm
                      <select value={typeCategory} onChange={(event) => changeCategory(event.target.value as ComponentType['category'])}>
                        <option value="INCOME">Thu nhập lương</option>
                        <option value="DEDUCTION">Khấu trừ</option>
                        <option value="REIMBURSEMENT">Hoàn chi phí</option>
                      </select>
                    </label>
                    <label>
                      Cách áp dụng
                      <select value={typeRecurrence} onChange={(event) => setTypeRecurrence(event.target.value as ComponentType['recurrence'])}>
                        <option value="FIXED">Cố định theo nhân sự</option>
                        <option value="PERIOD">Phát sinh theo kỳ</option>
                      </select>
                    </label>
                    <label>
                      Cách ghi nhận
                      <select value={typeInputMode} onChange={(event) => setTypeInputMode(event.target.value as ComponentType['input_mode'])}>
                        <option value="MANUAL">Nhập tay</option>
                        <option value="AUTOMATIC">Hệ thống tự tính</option>
                      </select>
                    </label>
                    <label>Ngày áp dụng<input type="date" value={typeEffectiveFrom} onChange={(event) => setTypeEffectiveFrom(event.target.value)} required /></label>
                  </div>
                  <div className={styles.actions}>
                    <label className={styles.check}><input type="checkbox" checked={typeProrate} onChange={(event) => setTypeProrate(event.target.checked)} /><span>Tính theo ngày công</span></label>
                    <label className={styles.check}><input type="checkbox" checked={typeGross} onChange={(event) => setTypeGross(event.target.checked)} /><span>Đưa vào tổng thu nhập lương</span></label>
                    <label className={styles.check}><input type="checkbox" checked={typeNet} onChange={(event) => setTypeNet(event.target.checked)} /><span>Đưa vào thực nhận</span></label>
                  </div>
                  <div className={styles.actions}>
                    <button type="submit" className={styles.primary} disabled={busy}>Thêm khoản</button>
                  </div>
                </form>
              ) : null}

              <div className={sharedStyles.tableWrap}>
                <table className={sharedStyles.table}>
                  <thead><tr><th>Khoản</th><th>Nhóm</th><th>Áp dụng</th><th>Ghi nhận</th><th>Tính vào</th><th>Hiệu lực</th></tr></thead>
                  <tbody>
                    {(data?.componentTypes ?? []).map((item) => (
                      <tr key={item.id}>
                        <td><div className={styles.meta}><strong>{item.name}</strong><small>{item.code}</small></div></td>
                        <td>{CATEGORY_LABEL[item.category]}</td>
                        <td>{RECURRENCE_LABEL[item.recurrence]}{item.prorate_by_workdays ? ' · Theo ngày công' : ''}</td>
                        <td>{INPUT_LABEL[item.input_mode]}</td>
                        <td>{[item.include_in_gross ? 'Tổng thu nhập' : null, item.include_in_net ? 'Thực nhận' : null].filter(Boolean).join(' · ') || 'Không cộng vào tổng'}</td>
                        <td>{dateLabel(item.effective_from)} – {dateLabel(item.effective_to)}</td>
                      </tr>
                    ))}
                    {!data?.componentTypes?.length ? <tr><td colSpan={6}><div className={sharedStyles.emptyState}>Chưa có khoản thu nhập, khấu trừ hoặc hoàn chi phí.</div></td></tr> : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section className={sharedStyles.tableSection}>
              <div className={sharedStyles.sectionHeader}>
                <div><p className={sharedStyles.panelKicker}>Khoản phát sinh</p><h2>Khoản linh động theo kỳ</h2></div>
                <span className={sharedStyles.panelChip}>{selectedPeriod ? periodLabel(selectedPeriod) : 'Chưa chọn kỳ'}</span>
              </div>

              {data?.capabilities.canManage && selectedPeriod ? (
                <form className={styles.actionPanel} onSubmit={(event) => void addPeriodComponent(event)}>
                  <div className={styles.formGrid}>
                    <label>
                      Nhân sự
                      <select value={periodEmployeeId} onChange={(event) => setPeriodEmployeeId(event.target.value)} required>
                        <option value="">Chọn nhân sự</option>
                        {(data?.periodEmployees ?? []).map((employee) => <option key={employee.id} value={employee.id}>{employee.code} · {employee.full_name}</option>)}
                      </select>
                    </label>
                    <label>
                      Khoản phát sinh
                      <select value={periodComponentTypeId} onChange={(event) => setPeriodComponentTypeId(event.target.value)} required>
                        <option value="">Chọn khoản</option>
                        {periodTypes.map((item) => <option key={item.id} value={item.id}>{item.name} · {CATEGORY_LABEL[item.category]}</option>)}
                      </select>
                    </label>
                    <label>Số tiền<input type="number" min="0" step="0.01" value={periodAmount} onChange={(event) => setPeriodAmount(event.target.value)} required /></label>
                    <label>Lý do / ghi chú<input value={periodNote} onChange={(event) => setPeriodNote(event.target.value)} maxLength={1000} required /></label>
                  </div>
                  <div className={styles.actions}>
                    <button type="submit" className={styles.primary} disabled={busy || !periodTypes.length}>Ghi khoản phát sinh</button>
                  </div>
                </form>
              ) : null}

              <div className={sharedStyles.tableWrap}>
                <table className={sharedStyles.table}>
                  <thead><tr><th>Nhân sự</th><th>Khoản</th><th>Nhóm</th><th>Số tiền</th><th>Lý do / ghi chú</th></tr></thead>
                  <tbody>
                    {(data?.periodComponents ?? []).map((item) => (
                      <tr key={item.id}>
                        <td>{item.employee_code} · {item.employee_name}</td>
                        <td>{item.component_name}</td>
                        <td>{CATEGORY_LABEL[item.category]}</td>
                        <td><strong>{moneyLabel(item.amount)}</strong></td>
                        <td>{item.note}</td>
                      </tr>
                    ))}
                    {!data?.periodComponents?.length ? <tr><td colSpan={5}><div className={sharedStyles.emptyState}>Chưa có khoản linh động trong kỳ đang xem.</div></td></tr> : null}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : null}

        {tab === 'payslips' ? (
          <section className={sharedStyles.tableSection}>
            <div className={sharedStyles.sectionHeader}>
              <div><p className={sharedStyles.panelKicker}>Phiếu lương</p><h2>Phiếu lương nhân sự</h2></div>
              <span className={sharedStyles.panelChip}>{selectedPeriod ? PERIOD_STATUS[selectedPeriod.status] : 'Chưa chọn kỳ'}</span>
            </div>
            <div className={sharedStyles.emptyState}>Phiếu lương chỉ xuất hiện sau khi kỳ lương được chốt.</div>
          </section>
        ) : null}

        {tab === 'history' ? (
          <section className={sharedStyles.tableSection}>
            <div className={sharedStyles.sectionHeader}>
              <div><p className={sharedStyles.panelKicker}>Lịch sử</p><h2>Các kỳ lương đã tạo</h2></div>
              <span className={sharedStyles.panelChip}>Giữ nguyên nguồn kỳ công</span>
            </div>
            <div className={sharedStyles.tableWrap}>
              <table className={sharedStyles.table}>
                <thead><tr><th>Kỳ</th><th>Nguồn bảng công</th><th>Trạng thái</th><th>Xử lý</th></tr></thead>
                <tbody>
                  {(data?.periods ?? []).map((period) => (
                    <tr key={period.id}>
                      <td>{periodLabel(period)}</td>
                      <td>Bản chốt lần {period.attendance_revision}</td>
                      <td><span className={styles.status}>{PERIOD_STATUS[period.status]}</span></td>
                      <td><button type="button" className={styles.secondary} disabled={busy} onClick={() => { setTab('board'); void load(period.id); }}>Mở kỳ</button></td>
                    </tr>
                  ))}
                  {!data?.periods?.length ? <tr><td colSpan={4}><div className={sharedStyles.emptyState}>Chưa có lịch sử kỳ lương.</div></td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </section>
    </AppShell>
  );
}
