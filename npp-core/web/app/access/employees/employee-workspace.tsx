'use client';

import { useMemo, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import shellStyles from '../../components/app-shell.module.css';
import styles from '../../organization/organization.module.css';
import type { Branch } from '../../../lib/organization-types';
import { formatCompactNumber, formatDateTime, matchTerm, normalizeSearch, toUpperCode } from '../../../lib/organization-types';
import type { Employee } from '../../../lib/employee-types';

type FilterState = 'all' | 'active' | 'inactive';
type EmployeeDraft = {
  code: string;
  fullName: string;
  jobTitle: string;
  phone: string;
  email: string;
  branchId: string;
};
type EditorState = { mode: 'create' | 'edit'; employeeId: string | null } | null;
type ToggleState = { employeeId: string; nextActive: boolean } | null;
type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean };
};

type Props = {
  initialEmployees: Employee[];
  branches: Branch[];
  initialError?: string | null;
};

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function emptyDraft(branchId = ''): EmployeeDraft {
  return { code: '', fullName: '', jobTitle: '', phone: '', email: '', branchId };
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
    throw new Error(payload.error?.message || 'Không thực hiện được yêu cầu dữ liệu nhân sự');
  }
  return payload.data;
}

export default function EmployeeWorkspace({ initialEmployees, branches: initialBranches, initialError = null }: Props) {
  const [employees, setEmployees] = useState(initialEmployees);
  const [branches, setBranches] = useState(initialBranches);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterState>('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [editor, setEditor] = useState<EditorState>(null);
  const [toggleState, setToggleState] = useState<ToggleState>(null);
  const [draft, setDraft] = useState<EmployeeDraft>(emptyDraft());

  const branchMap = useMemo(() => new Map(branches.map((branch) => [branch.id, branch])), [branches]);
  const activeBranches = useMemo(() => branches.filter((branch) => branch.is_active), [branches]);
  const normalizedSearch = normalizeSearch(search);

  const visibleEmployees = useMemo(() => employees
    .filter((employee) => {
      const branch = employee.branch_id ? branchMap.get(employee.branch_id) : null;
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'active' ? employee.is_active : !employee.is_active);
      const matchesBranch = branchFilter === 'all'
        || (branchFilter === 'unassigned' ? !employee.branch_id : employee.branch_id === branchFilter);
      const matchesText = !normalizedSearch || matchTerm(
        employee.code,
        employee.full_name,
        employee.job_title,
        employee.phone,
        employee.email,
        branch?.code,
        branch?.name,
      ).includes(normalizedSearch);
      return matchesStatus && matchesBranch && matchesText;
    })
    .sort((left, right) => left.code.localeCompare(right.code)), [branchFilter, branchMap, employees, normalizedSearch, statusFilter]);

  const counts = useMemo(() => {
    const active = employees.filter((employee) => employee.is_active).length;
    const assigned = employees.filter((employee) => employee.branch_id).length;
    return {
      total: employees.length,
      active,
      inactive: employees.length - active,
      assigned,
      unassigned: employees.length - assigned,
    };
  }, [employees]);

  async function loadAll(successMessage = 'Danh mục nhân sự đã được cập nhật.') {
    setBusy('load');
    setError(null);
    setNotice(null);
    try {
      const [nextEmployees, nextBranches] = await Promise.all([
        requestJson<Employee[]>('/api/access/employees?limit=1000'),
        requestJson<Branch[]>('/api/organization/branches?limit=1000'),
      ]);
      setEmployees(nextEmployees);
      setBranches(nextBranches);
      setNotice(successMessage);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được danh mục nhân sự');
    } finally {
      setBusy(null);
    }
  }

  function openCreate() {
    setError(null);
    setNotice(null);
    setDraft(emptyDraft(activeBranches[0]?.id ?? ''));
    setEditor({ mode: 'create', employeeId: null });
  }

  function openEdit(employeeId: string) {
    const employee = employees.find((item) => item.id === employeeId);
    if (!employee) return;
    setError(null);
    setNotice(null);
    setDraft({
      code: employee.code,
      fullName: employee.full_name,
      jobTitle: employee.job_title ?? '',
      phone: employee.phone ?? '',
      email: employee.email ?? '',
      branchId: employee.branch_id ?? '',
    });
    setEditor({ mode: 'edit', employeeId });
  }

  async function submitEmployee(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('save');
    setError(null);
    setNotice(null);

    const current = editor?.mode === 'edit'
      ? employees.find((employee) => employee.id === editor.employeeId)
      : null;
    const payload = {
      ...(editor?.mode === 'create' ? { code: toUpperCode(draft.code) } : {}),
      fullName: draft.fullName.trim(),
      jobTitle: draft.jobTitle.trim(),
      phone: draft.phone.trim(),
      email: draft.email.trim(),
      branchId: draft.branchId || null,
      ...(current ? { expectedUpdatedAt: current.updated_at } : {}),
    };

    try {
      const path = current ? `/api/access/employees/${current.id}` : '/api/access/employees';
      await requestJson<Employee>(path, {
        method: current ? 'PATCH' : 'POST',
        headers: current ? undefined : { 'Idempotency-Key': `web-${crypto.randomUUID()}` },
        body: JSON.stringify(payload),
      });
      setEditor(null);
      await loadAll(current ? 'Thông tin nhân sự đã được cập nhật.' : 'Hồ sơ nhân sự đã được tạo.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không lưu được hồ sơ nhân sự');
      setBusy(null);
    }
  }

  async function confirmToggle() {
    if (!toggleState) return;
    const employee = employees.find((item) => item.id === toggleState.employeeId);
    if (!employee) return;

    setBusy('toggle');
    setError(null);
    setNotice(null);
    try {
      await requestJson<Employee>(`/api/access/employees/${employee.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          isActive: toggleState.nextActive,
          expectedUpdatedAt: employee.updated_at,
        }),
      });
      setToggleState(null);
      await loadAll(toggleState.nextActive ? 'Nhân sự đã được đưa vào sử dụng.' : 'Nhân sự đã ngừng làm việc.');
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Không cập nhật được trạng thái nhân sự');
      setBusy(null);
    }
  }

  const shellActions = (
    <>
      <button type="button" className={shellStyles.actionButton} onClick={() => void loadAll()} disabled={busy !== null}>
        {busy === 'load' ? 'Đang cập nhật…' : 'Cập nhật dữ liệu'}
      </button>
      <button
        type="button"
        className={joinClasses(shellStyles.actionButton, shellStyles.actionButtonPrimary)}
        onClick={openCreate}
        data-testid="employees-topbar-create-button"
      >
        Thêm nhân sự
      </button>
    </>
  );

  return (
    <AppShell
      title="Danh mục nhân sự"
      subtitle="Quản lý hồ sơ nhân sự, chức danh, thông tin liên hệ và đơn vị công tác."
      kicker="Nhân sự"
      actions={shellActions}
    >
      <section className={styles.page} data-testid="employees-page">
        {(error || notice) ? (
          <div className={joinClasses(styles.banner, error ? styles.bannerError : styles.bannerSuccess)} role="status">
            {error ?? notice}
          </div>
        ) : null}

        <section className={styles.summaryGrid} aria-label="Số liệu nhân sự">
          <article className={styles.summaryCard}>
            <span>Tổng hồ sơ</span>
            <strong>{formatCompactNumber(counts.total)}</strong>
            <small>Toàn bộ hồ sơ nhân sự đang được quản lý</small>
          </article>
          <article className={styles.summaryCard}>
            <span>Đang làm việc</span>
            <strong>{formatCompactNumber(counts.active)}</strong>
            <small>{counts.inactive} hồ sơ đã ngừng hoạt động</small>
          </article>
          <article className={styles.summaryCard}>
            <span>Đã phân công</span>
            <strong>{formatCompactNumber(counts.assigned)}</strong>
            <small>{counts.unassigned} hồ sơ chưa gắn chi nhánh</small>
          </article>
        </section>

        <section className={styles.toolbar}>
          <div className={styles.toolbarSearch}>
            <label htmlFor="employees-search">Tìm kiếm nhân sự</label>
            <input
              id="employees-search"
              data-testid="employees-search-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Mã, họ tên, chức danh, liên hệ…"
            />
          </div>
          <div className={styles.toolbarFilter}>
            <label htmlFor="employees-status">Trạng thái làm việc</label>
            <select
              id="employees-status"
              data-testid="employees-status-filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as FilterState)}
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="active">Đang làm việc</option>
              <option value="inactive">Ngừng hoạt động</option>
            </select>
          </div>
          <div className={styles.toolbarFilter}>
            <label htmlFor="employees-branch">Đơn vị công tác</label>
            <select
              id="employees-branch"
              data-testid="employees-branch-filter"
              value={branchFilter}
              onChange={(event) => setBranchFilter(event.target.value)}
            >
              <option value="all">Tất cả chi nhánh</option>
              <option value="unassigned">Chưa phân công</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>
              ))}
            </select>
          </div>
        </section>

        <section className={styles.tableSection}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.panelKicker}>Danh mục nhân sự</p>
              <h2>Hồ sơ và đơn vị công tác</h2>
            </div>
            <span className={styles.panelChip}>{formatCompactNumber(visibleEmployees.length)} hồ sơ</span>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table} data-testid="employee-table">
              <thead>
                <tr>
                  <th>Mã nhân sự</th>
                  <th>Họ và tên</th>
                  <th>Đơn vị công tác</th>
                  <th>Liên hệ</th>
                  <th>Trạng thái</th>
                  <th>Cập nhật</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {visibleEmployees.length ? visibleEmployees.map((employee) => {
                  const branch = employee.branch_id ? branchMap.get(employee.branch_id) : null;
                  return (
                    <tr key={employee.id} data-testid={`employee-row-${employee.code}`}>
                      <td><code>{employee.code}</code></td>
                      <td>
                        <div className={styles.entityStack}>
                          <strong>{employee.full_name}</strong>
                          <span>{employee.job_title || 'Chưa khai báo chức danh'}</span>
                        </div>
                      </td>
                      <td className={styles.relationCell}>
                        {branch ? `${branch.code} · ${branch.name}` : 'Chưa phân công chi nhánh'}
                      </td>
                      <td>
                        <div className={styles.entityStack}>
                          <span>{employee.phone || 'Chưa có số điện thoại'}</span>
                          <span>{employee.email || 'Chưa có email'}</span>
                        </div>
                      </td>
                      <td>
                        <span className={joinClasses(styles.statusPill, employee.is_active ? styles.toneSuccess : styles.toneDanger)}>
                          {employee.is_active ? 'Đang làm việc' : 'Ngừng hoạt động'}
                        </span>
                      </td>
                      <td>{formatDateTime(employee.updated_at)}</td>
                      <td>
                        <div className={styles.rowActions}>
                          <button type="button" data-testid={`edit-employee-${employee.code}`} onClick={() => openEdit(employee.id)}>Chỉnh sửa</button>
                          <button
                            type="button"
                            data-testid={`toggle-employee-${employee.code}`}
                            onClick={() => setToggleState({ employeeId: employee.id, nextActive: !employee.is_active })}
                          >
                            {employee.is_active ? 'Ngừng' : 'Kích hoạt'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={7}><div className={styles.emptyState}>Không tìm thấy hồ sơ nhân sự phù hợp.</div></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {editor ? (
          <div className={styles.modalBackdrop} role="presentation" onClick={() => setEditor(null)}>
            <div className={styles.modal} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div>
                  <p className={styles.panelKicker}>{editor.mode === 'create' ? 'Hồ sơ mới' : 'Cập nhật hồ sơ'}</p>
                  <h3>{editor.mode === 'create' ? 'Thêm nhân sự' : 'Chỉnh sửa nhân sự'}</h3>
                </div>
                <button type="button" className={styles.modalClose} onClick={() => setEditor(null)}>Đóng</button>
              </div>

              <form className={styles.form} onSubmit={(event) => void submitEmployee(event)}>
                <label>
                  Mã nhân sự
                  <input
                    data-testid="employee-code-input"
                    value={draft.code}
                    onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value }))}
                    disabled={editor.mode === 'edit'}
                    required
                    maxLength={64}
                  />
                </label>
                <label>
                  Họ và tên
                  <input
                    data-testid="employee-name-input"
                    value={draft.fullName}
                    onChange={(event) => setDraft((current) => ({ ...current, fullName: event.target.value }))}
                    required
                    maxLength={256}
                  />
                </label>
                <label>
                  Chức danh công việc
                  <input
                    data-testid="employee-title-input"
                    value={draft.jobTitle}
                    onChange={(event) => setDraft((current) => ({ ...current, jobTitle: event.target.value }))}
                    maxLength={128}
                  />
                </label>
                <label>
                  Chi nhánh công tác
                  <select
                    data-testid="employee-branch-select"
                    value={draft.branchId}
                    onChange={(event) => setDraft((current) => ({ ...current, branchId: event.target.value }))}
                  >
                    <option value="">Chưa phân công</option>
                    {activeBranches.map((branch) => (
                      <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Số điện thoại
                  <input
                    data-testid="employee-phone-input"
                    value={draft.phone}
                    onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))}
                    maxLength={20}
                  />
                </label>
                <label>
                  Email công việc
                  <input
                    data-testid="employee-email-input"
                    type="email"
                    value={draft.email}
                    onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
                    maxLength={256}
                  />
                </label>
                <div className={styles.formActions}>
                  <button type="button" className={styles.secondaryButton} onClick={() => setEditor(null)}>Hủy</button>
                  <button type="submit" className={styles.primaryButton} disabled={busy !== null}>
                    {busy === 'save' ? 'Đang lưu…' : editor.mode === 'create' ? 'Tạo hồ sơ' : 'Lưu thay đổi'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {toggleState ? (
          <div className={styles.modalBackdrop} role="presentation" onClick={() => setToggleState(null)}>
            <div className={joinClasses(styles.modal, styles.confirmModal)} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div>
                  <p className={styles.panelKicker}>Xác nhận trạng thái</p>
                  <h3>{toggleState.nextActive ? 'Kích hoạt nhân sự' : 'Ngừng hoạt động'}</h3>
                </div>
              </div>
              <p className={styles.confirmText}>
                {toggleState.nextActive
                  ? 'Hồ sơ sẽ được đưa trở lại trạng thái đang làm việc.'
                  : 'Hồ sơ sẽ ngừng hoạt động nhưng vẫn được giữ lại để đối soát và liên kết lịch sử.'}
              </p>
              <div className={styles.formActions}>
                <button type="button" className={styles.secondaryButton} onClick={() => setToggleState(null)}>Hủy</button>
                <button type="button" className={styles.primaryButton} onClick={() => void confirmToggle()} disabled={busy !== null}>
                  {busy === 'toggle' ? 'Đang cập nhật…' : 'Xác nhận'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
