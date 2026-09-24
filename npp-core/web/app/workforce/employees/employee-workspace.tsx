'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createIdempotencyKey } from '@npp/contracts';
import { useRouter } from 'next/navigation';
import { AppShell } from '../../components/app-shell';
import shellStyles from '../../components/app-shell.module.css';
import styles from '../../organization/organization.module.css';
import localStyles from './employee-workspace.module.css';
import type { Branch } from '../../../lib/organization-types';
import { formatCompactNumber, formatDateTime, matchTerm, normalizeSearch, toUpperCode } from '../../../lib/organization-types';
import type { Employee, EmployeeOrganizationCatalog, EmploymentType, HrDepartment, HrPosition } from '../../../lib/employee-types';
import type { BulkPolicyAssignmentResult, EmployeeWorkPolicyAssignment, WorkPolicy, WorkPolicyCoverage } from '../../../lib/workforce-types';

type FilterState = 'all' | 'active' | 'inactive';
type EmployeeDraft = {
  code: string;
  fullName: string;
  jobTitle: string;
  phone: string;
  email: string;
  branchId: string;
  departmentId: string;
  positionId: string;
  managerEmployeeId: string;
  employmentStartDate: string;
  employmentEndDate: string;
  employmentType: EmploymentType;
  employmentEndReason: string;
  confirmEmployment: boolean;
  assignmentEffectiveFrom: string;
  assignmentReason: string;
  confirmAssignment: boolean;
};
type EditorState = { mode: 'create' | 'edit'; employeeId: string | null } | null;
type ToggleState = {
  employeeId: string;
  nextActive: boolean;
  effectiveDate: string;
  reason: string;
  employmentType: EmploymentType;
} | null;
type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean };
};
type LoadOptions = {
  silent?: boolean;
  refreshRouter?: boolean;
};

type Props = {
  initialEmployees: Employee[];
  branches: Branch[];
  policies: WorkPolicy[];
  initialCoverage: WorkPolicyCoverage | null;
  initialError?: string | null;
};
type PolicyFilter = 'all' | 'assigned' | 'missing';
type BulkTargetMode = 'ALL_ACTIVE' | 'BRANCH' | 'FILTERED' | 'MISSING';
type ApplyTiming = 'NOW' | 'DATE';
type PolicyAssignmentDraft = {
  workPolicyId: string;
  effectiveMode: ApplyTiming;
  effectiveFrom: string;
  reason: string;
};
type BulkAssignmentDraft = {
  targetMode: BulkTargetMode;
  branchId: string;
  workPolicyId: string;
  effectiveMode: ApplyTiming;
  effectiveFrom: string;
  reason: string;
  bootstrap: boolean;
};
type MutationAttempt = { payload: string; key: string } | null;
type DepartmentDraft = { code: string; name: string; parentDepartmentId: string };
type PositionDraft = { code: string; name: string; departmentId: string };

function mutationKeyForPayload(
  ref: React.MutableRefObject<MutationAttempt>,
  operation: string,
  payload: unknown,
) {
  const serialized = JSON.stringify(payload);
  if (ref.current?.payload === serialized) return ref.current.key;
  const key = createIdempotencyKey(operation);
  ref.current = { payload: serialized, key };
  return key;
}

function localDate(offsetDays = 0) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + offsetDays));
  return date.toISOString().slice(0, 10);
}

function todayDate() {
  return localDate(0);
}

function tomorrowDate() {
  return localDate(1);
}

function effectiveDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : '';
}

function dateLabel(value: string | null | undefined) {
  const date = effectiveDate(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : (value || '—');
}

function nextDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function assignmentMinimumDate(history: EmployeeWorkPolicyAssignment[]) {
  const today = todayDate();
  const futureOrCurrent = history
    .filter((item) => effectiveDate(item.effective_from) > today || !item.effective_to || effectiveDate(item.effective_to) >= today)
    .sort((left, right) => effectiveDate(right.effective_from).localeCompare(effectiveDate(left.effective_from)));
  if (!futureOrCurrent.length) return today;
  const latestFrom = effectiveDate(futureOrCurrent[0].effective_from);
  return latestFrom < today ? today : nextDate(latestFrom);
}

const EMPLOYEE_DIRECTORY_DIRTY_KEY = 'npp-core-employee-directory-dirty';

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  PROBATION: 'Thử việc',
  PERMANENT: 'Chính thức',
  FIXED_TERM: 'Hợp đồng xác định thời hạn',
  PART_TIME: 'Bán thời gian',
  TEMPORARY: 'Thời vụ',
  OTHER: 'Khác',
};

function historyQualityLabel(value: string | null | undefined) {
  if (value === 'CONFIRMED') return 'Đã xác nhận';
  if (value === 'AUDIT_DERIVED') return 'Khôi phục từ lịch sử hệ thống';
  return 'Chờ Nhân sự xác nhận';
}

function emptyDraft(branchId = ''): EmployeeDraft {
  return {
    code: '', fullName: '', jobTitle: '', phone: '', email: '', branchId,
    departmentId: '', positionId: '', managerEmployeeId: '',
    employmentStartDate: todayDate(), employmentEndDate: '', employmentType: 'PERMANENT',
    employmentEndReason: '', confirmEmployment: true,
    assignmentEffectiveFrom: todayDate(), assignmentReason: '', confirmAssignment: true,
  };
}

function upsertEmployee(current: Employee[], next: Employee): Employee[] {
  const index = current.findIndex((employee) => employee.id === next.id);
  if (index === -1) return [...current, next];
  const updated = [...current];
  updated[index] = next;
  return updated;
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

export default function EmployeeWorkspace({ initialEmployees, branches: initialBranches, policies, initialCoverage, initialError = null }: Props) {
  const router = useRouter();
  const loadSequence = useRef(0);
  const [employees, setEmployees] = useState(initialEmployees);
  const [branches, setBranches] = useState(initialBranches);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterState>('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [policyFilter, setPolicyFilter] = useState<PolicyFilter>('all');
  const [coverage, setCoverage] = useState<WorkPolicyCoverage | null>(initialCoverage);
  const [editor, setEditor] = useState<EditorState>(null);
  const [editorDetail, setEditorDetail] = useState<Employee | null>(null);
  const [organization, setOrganization] = useState<EmployeeOrganizationCatalog>({ departments: [], positions: [], managers: [] });
  const [organizationOpen, setOrganizationOpen] = useState(false);
  const [departmentDraft, setDepartmentDraft] = useState<DepartmentDraft>({ code: '', name: '', parentDepartmentId: '' });
  const [positionDraft, setPositionDraft] = useState<PositionDraft>({ code: '', name: '', departmentId: '' });
  const [toggleState, setToggleState] = useState<ToggleState>(null);
  const [draft, setDraft] = useState<EmployeeDraft>(emptyDraft());
  const [policyEmployeeId, setPolicyEmployeeId] = useState<string | null>(null);
  const [assignmentHistory, setAssignmentHistory] = useState<EmployeeWorkPolicyAssignment[]>([]);
  const [assignmentDraft, setAssignmentDraft] = useState<PolicyAssignmentDraft>({ workPolicyId: '', effectiveMode: 'NOW', effectiveFrom: todayDate(), reason: '' });
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const [createPolicyId, setCreatePolicyId] = useState('');
  const [createPolicyMode, setCreatePolicyMode] = useState<ApplyTiming>('NOW');
  const [createPolicyEffectiveFrom, setCreatePolicyEffectiveFrom] = useState(todayDate());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkDraft, setBulkDraft] = useState<BulkAssignmentDraft>({
    targetMode: 'MISSING',
    branchId: '',
    workPolicyId: '',
    effectiveMode: 'NOW',
    effectiveFrom: todayDate(),
    reason: '',
    bootstrap: false,
  });
  const employeeSaveAttempt = useRef<MutationAttempt>(null);
  const employeeStatusAttempt = useRef<MutationAttempt>(null);
  const assignmentAttempt = useRef<MutationAttempt>(null);
  const bulkAssignmentAttempt = useRef<MutationAttempt>(null);
  const organizationSaveAttempt = useRef<MutationAttempt>(null);

  const branchMap = useMemo(() => new Map(branches.map((branch) => [branch.id, branch])), [branches]);
  const activeBranches = useMemo(() => branches.filter((branch) => branch.is_active), [branches]);
  const activeDepartments = useMemo(() => organization.departments.filter((item) => item.is_active), [organization.departments]);
  const activePositions = useMemo(() => organization.positions.filter((item) => item.is_active), [organization.positions]);
  const activePolicies = useMemo(() => {
    const today = todayDate();
    const latest = new Map<string, WorkPolicy>();
    for (const policy of policies) {
      if (!policy.is_active || (policy.effective_to && effectiveDate(policy.effective_to) < today)) continue;
      const current = latest.get(policy.code);
      if (!current || policy.version > current.version) latest.set(policy.code, policy);
    }
    return [...latest.values()].sort((left, right) => left.code.localeCompare(right.code));
  }, [policies]);
  const coverageMap = useMemo(
    () => new Map((coverage?.employees ?? []).map((employee) => [employee.id, employee])),
    [coverage],
  );
  const policyEmployee = useMemo(
    () => employees.find((employee) => employee.id === policyEmployeeId) ?? null,
    [employees, policyEmployeeId],
  );
  const policyAssignmentMinDate = useMemo(
    () => assignmentMinimumDate(assignmentHistory),
    [assignmentHistory],
  );
  const normalizedSearch = normalizeSearch(search);

  const visibleEmployees = useMemo(() => employees
    .filter((employee) => {
      const branch = employee.branch_id ? branchMap.get(employee.branch_id) : null;
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'active' ? employee.is_active : !employee.is_active);
      const matchesBranch = branchFilter === 'all'
        || (branchFilter === 'unassigned' ? !employee.branch_id : employee.branch_id === branchFilter);
      const assignedPolicy = Boolean(coverageMap.get(employee.id)?.assignment);
      const matchesPolicy = policyFilter === 'all'
        || (policyFilter === 'assigned' ? assignedPolicy : !assignedPolicy);
      const matchesText = !normalizedSearch || matchTerm(
        employee.code,
        employee.full_name,
        employee.job_title,
        employee.phone,
        employee.email,
        branch?.code,
        branch?.name,
      ).includes(normalizedSearch);
      return matchesStatus && matchesBranch && matchesPolicy && matchesText;
    })
    .sort((left, right) => left.code.localeCompare(right.code)), [branchFilter, branchMap, coverageMap, employees, normalizedSearch, policyFilter, statusFilter]);

  const counts = useMemo(() => {
    const active = employees.filter((employee) => employee.is_active).length;
    const assigned = employees.filter((employee) => employee.branch_id).length;
    return {
      total: employees.length,
      active,
      inactive: employees.length - active,
      assigned,
      unassigned: employees.length - assigned,
      missingPolicy: coverage?.missingCount ?? 0,
    };
  }, [coverage, employees]);

  const loadAll = useCallback(async (
    successMessage: string | null = 'Danh mục nhân sự đã được cập nhật.',
    options: LoadOptions = {},
  ): Promise<boolean> => {
    const sequence = ++loadSequence.current;
    if (!options.silent) setBusy('load');
    setError(null);
    if (successMessage) setNotice(null);
    try {
      const [nextEmployees, nextBranches, nextCoverage, nextOrganization] = await Promise.all([
        requestJson<Employee[]>('/api/access/employees?limit=1000'),
        requestJson<Branch[]>('/api/organization/branches?limit=1000'),
        requestJson<WorkPolicyCoverage>(`/api/workforce/assignments/coverage?date=${encodeURIComponent(todayDate())}`),
        requestJson<EmployeeOrganizationCatalog>('/api/access/employees/organization'),
      ]);
      if (sequence !== loadSequence.current) return false;
      setEmployees(nextEmployees);
      setBranches(nextBranches);
      setCoverage(nextCoverage);
      setOrganization(nextOrganization);
      window.sessionStorage.removeItem(EMPLOYEE_DIRECTORY_DIRTY_KEY);
      if (successMessage) setNotice(successMessage);
      if (options.refreshRouter !== false) router.refresh();
      return true;
    } catch (loadError) {
      if (sequence !== loadSequence.current) return false;
      setError(loadError instanceof Error ? loadError.message : 'Không tải được danh mục nhân sự');
      return false;
    } finally {
      if (sequence === loadSequence.current && !options.silent) setBusy(null);
    }
  }, [router]);

  const refreshCoverage = useCallback(async () => {
    const nextCoverage = await requestJson<WorkPolicyCoverage>(
      `/api/workforce/assignments/coverage?date=${encodeURIComponent(todayDate())}`,
    );
    setCoverage(nextCoverage);
    return nextCoverage;
  }, []);

  useEffect(() => {
    if (window.sessionStorage.getItem(EMPLOYEE_DIRECTORY_DIRTY_KEY) !== '1') return;
    void loadAll(null, { silent: true, refreshRouter: false });
  }, [loadAll]);

  useEffect(() => {
    let active = true;
    void requestJson<EmployeeOrganizationCatalog>('/api/access/employees/organization')
      .then((value) => { if (active) setOrganization(value); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  function openCreate() {
    setError(null);
    setNotice(null);
    setEditorDetail(null);
    setDraft(emptyDraft(activeBranches[0]?.id ?? ''));
    setCreatePolicyId(activePolicies[0]?.id ?? '');
    setCreatePolicyMode('NOW');
    setCreatePolicyEffectiveFrom(todayDate());
    setEditor({ mode: 'create', employeeId: null });
  }

  async function openEdit(employeeId: string) {
    const summary = employees.find((item) => item.id === employeeId);
    if (!summary) return;
    setBusy('detail');
    setError(null);
    setNotice(null);
    try {
      const employee = await requestJson<Employee>(`/api/access/employees/${employeeId}`);
      const employment = employee.current_employment ?? employee.employment_history?.[0] ?? null;
      const assignment = employee.current_assignment ?? employee.assignment_history?.[0] ?? null;
      setEditorDetail(employee);
      setDraft({
        code: employee.code,
        fullName: employee.full_name,
        jobTitle: employee.job_title ?? '',
        phone: employee.phone ?? '',
        email: employee.email ?? '',
        branchId: employee.branch_id ?? '',
        departmentId: assignment?.department_id ?? '',
        positionId: assignment?.position_id ?? '',
        managerEmployeeId: assignment?.manager_employee_id ?? '',
        employmentStartDate: employment?.effective_from ?? todayDate(),
        employmentEndDate: employment?.effective_to ?? '',
        employmentType: employment?.employment_type ?? 'OTHER',
        employmentEndReason: employment?.end_reason ?? '',
        confirmEmployment: employment?.data_quality === 'CONFIRMED',
        assignmentEffectiveFrom: assignment?.effective_from ?? todayDate(),
        assignmentReason: assignment?.reason ?? '',
        confirmAssignment: false,
      });
      setEditor({ mode: 'edit', employeeId });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được lịch sử hồ sơ nhân sự');
    } finally {
      setBusy(null);
    }
  }

  async function submitEmployee(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('save');
    setError(null);
    setNotice(null);

    const current = editor?.mode === 'edit'
      ? employees.find((employee) => employee.id === editor.employeeId)
      : null;
    const branchChanged = Boolean(current) && (draft.branchId || null) !== (current?.branch_id ?? null);
    const currentAssignment = current?.current_assignment ?? editorDetail?.current_assignment ?? null;
    const organizationChanged = Boolean(current) && (
      (draft.departmentId || null) !== (currentAssignment?.department_id ?? null)
      || (draft.positionId || null) !== (currentAssignment?.position_id ?? null)
      || (draft.managerEmployeeId || null) !== (currentAssignment?.manager_employee_id ?? null)
    );
    const assignmentChanged = branchChanged || organizationChanged;
    const payload = {
      ...(editor?.mode === 'create' ? { code: toUpperCode(draft.code) } : {}),
      fullName: draft.fullName.trim(),
      jobTitle: draft.jobTitle.trim(),
      phone: draft.phone.trim(),
      email: draft.email.trim(),
      branchId: draft.branchId || null,
      departmentId: draft.departmentId || null,
      positionId: draft.positionId || null,
      managerEmployeeId: draft.managerEmployeeId || null,
      ...(current
        ? {
            expectedUpdatedAt: current.updated_at,
            ...(draft.confirmEmployment ? {
              confirmEmployment: true,
              employmentEffectiveFrom: draft.employmentStartDate,
              employmentEffectiveTo: draft.employmentEndDate || null,
              employmentType: draft.employmentType,
              employmentEndReason: draft.employmentEndReason.trim() || null,
            } : {}),
            ...(assignmentChanged || draft.confirmAssignment ? {
              ...(draft.confirmAssignment ? { confirmAssignment: true } : {}),
              assignmentEffectiveFrom: draft.assignmentEffectiveFrom,
              assignmentReason: draft.assignmentReason.trim(),
            } : {}),
          }
        : {
            employmentStartDate: draft.employmentStartDate,
            employmentType: draft.employmentType,
            assignmentEffectiveFrom: draft.assignmentEffectiveFrom,
            assignmentReason: draft.assignmentReason.trim(),
            workPolicyId: createPolicyId,
            policyEffectiveFrom: createPolicyMode === 'NOW' ? todayDate() : createPolicyEffectiveFrom,
          }),
    };

    try {
      const path = current ? `/api/access/employees/${current.id}` : '/api/access/employees';
      const operation = current ? 'web-employee-update' : 'web-employee-create';
      const key = mutationKeyForPayload(employeeSaveAttempt, operation, { path, payload });
      const saved = await requestJson<Employee>(path, {
        method: current ? 'PATCH' : 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(payload),
      });
      loadSequence.current += 1;
      setEmployees((items) => upsertEmployee(items, saved));
      setEditor(null);
      if (!current) await refreshCoverage();
      if (!current) {
        setSearch('');
        setStatusFilter('all');
        setBranchFilter('all');
        setPolicyFilter('all');
      }
      employeeSaveAttempt.current = null;
      setNotice(current ? 'Thông tin nhân sự đã được cập nhật.' : 'Hồ sơ nhân sự đã được tạo.');
      setBusy(null);
      window.sessionStorage.setItem(EMPLOYEE_DIRECTORY_DIRTY_KEY, '1');
      router.refresh();
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
      const statusPayload = {
        isActive: toggleState.nextActive,
        expectedUpdatedAt: employee.updated_at,
        employmentEffectiveDate: toggleState.effectiveDate,
        employmentReason: toggleState.reason.trim(),
        employmentType: toggleState.employmentType,
      };
      const key = mutationKeyForPayload(employeeStatusAttempt, 'web-employee-status', {
        employeeId: employee.id,
        ...statusPayload,
      });
      const saved = await requestJson<Employee>(`/api/access/employees/${employee.id}`, {
        method: 'PATCH',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(statusPayload),
      });
      loadSequence.current += 1;
      setEmployees((items) => upsertEmployee(items, saved));
      employeeStatusAttempt.current = null;
      setToggleState(null);
      setNotice(toggleState.nextActive ? 'Nhân sự đã được đưa trở lại làm việc.' : 'Nhân sự đã ngừng làm việc.');
      setBusy(null);
      window.sessionStorage.setItem(EMPLOYEE_DIRECTORY_DIRTY_KEY, '1');
      router.refresh();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Không cập nhật được trạng thái nhân sự');
      setBusy(null);
    }
  }

  async function openPolicyAssignment(employeeId: string) {
    setPolicyEmployeeId(employeeId);
    setAssignmentHistory([]);
    setAssignmentDraft({
      workPolicyId: activePolicies[0]?.id ?? '',
      effectiveMode: 'NOW',
      effectiveFrom: todayDate(),
      reason: '',
    });
    setAssignmentBusy(true);
    setError(null);
    try {
      const history = await requestJson<EmployeeWorkPolicyAssignment[]>(
        `/api/workforce/assignments?employeeId=${encodeURIComponent(employeeId)}`,
      );
      setAssignmentHistory(history);
      const minimumDate = assignmentMinimumDate(history);
      setAssignmentDraft((current) => ({
        ...current,
        effectiveMode: minimumDate === todayDate() ? 'NOW' : 'DATE',
        effectiveFrom: minimumDate,
      }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được lịch sử chính sách làm việc');
    } finally {
      setAssignmentBusy(false);
    }
  }

  async function submitPolicyAssignment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policyEmployee || !assignmentDraft.workPolicyId) return;
    const effectiveFrom = assignmentDraft.effectiveMode === 'NOW' ? todayDate() : assignmentDraft.effectiveFrom;
    const payload = {
      employeeId: policyEmployee.id,
      workPolicyId: assignmentDraft.workPolicyId,
      effectiveFrom,
      reason: assignmentDraft.reason.trim(),
    };
    const key = mutationKeyForPayload(assignmentAttempt, 'web-employee-policy-assign', payload);
    setAssignmentBusy(true);
    setError(null);
    setNotice(null);
    try {
      await requestJson<EmployeeWorkPolicyAssignment>('/api/workforce/assignments', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(payload),
      });
      assignmentAttempt.current = null;
      const history = await requestJson<EmployeeWorkPolicyAssignment[]>(
        `/api/workforce/assignments?employeeId=${encodeURIComponent(policyEmployee.id)}`,
      );
      setAssignmentHistory(history);
      setAssignmentDraft((current) => ({ ...current, effectiveMode: 'NOW', effectiveFrom: todayDate(), reason: '' }));
      await refreshCoverage();
      setNotice('Chính sách làm việc của nhân sự đã được cập nhật.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không gán được chính sách làm việc');
    } finally {
      setAssignmentBusy(false);
    }
  }

  async function reloadOrganization() {
    const next = await requestJson<EmployeeOrganizationCatalog>('/api/access/employees/organization');
    setOrganization(next);
    return next;
  }

  function openOrganization() {
    setError(null);
    setNotice(null);
    setDepartmentDraft({ code: '', name: '', parentDepartmentId: '' });
    setPositionDraft({ code: '', name: '', departmentId: '' });
    setOrganizationOpen(true);
    void reloadOrganization().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được cơ cấu tổ chức');
    });
  }

  async function saveOrganizationResource(payload: Record<string, unknown>, successMessage: string) {
    const key = mutationKeyForPayload(organizationSaveAttempt, 'web-employee-organization-save', payload);
    setBusy('organization');
    setError(null);
    setNotice(null);
    try {
      await requestJson<unknown>('/api/access/employees/organization', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(payload),
      });
      organizationSaveAttempt.current = null;
      await reloadOrganization();
      setNotice(successMessage);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không lưu được cơ cấu tổ chức');
    } finally {
      setBusy(null);
    }
  }

  async function submitDepartment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      resource: 'DEPARTMENT',
      code: toUpperCode(departmentDraft.code),
      name: departmentDraft.name.trim(),
      parentDepartmentId: departmentDraft.parentDepartmentId || null,
    };
    await saveOrganizationResource(payload, 'Đã thêm Phòng/Bộ phận.');
    setDepartmentDraft({ code: '', name: '', parentDepartmentId: '' });
  }

  async function submitPosition(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      resource: 'POSITION',
      code: toUpperCode(positionDraft.code),
      name: positionDraft.name.trim(),
      departmentId: positionDraft.departmentId || null,
    };
    await saveOrganizationResource(payload, 'Đã thêm Vị trí công việc.');
    setPositionDraft({ code: '', name: '', departmentId: '' });
  }

  async function toggleDepartment(item: HrDepartment) {
    await saveOrganizationResource({
      resource: 'DEPARTMENT',
      id: item.id,
      code: item.code,
      name: item.name,
      parentDepartmentId: item.parent_department_id,
      isActive: !item.is_active,
      expectedUpdatedAt: item.updated_at,
    }, item.is_active ? 'Đã ngừng sử dụng Phòng/Bộ phận.' : 'Đã đưa Phòng/Bộ phận vào sử dụng.');
  }

  async function togglePosition(item: HrPosition) {
    await saveOrganizationResource({
      resource: 'POSITION',
      id: item.id,
      code: item.code,
      name: item.name,
      departmentId: item.department_id,
      isActive: !item.is_active,
      expectedUpdatedAt: item.updated_at,
    }, item.is_active ? 'Đã ngừng sử dụng Vị trí công việc.' : 'Đã đưa Vị trí công việc vào sử dụng.');
  }

  function openBulkAssignment() {
    setBulkDraft({
      targetMode: coverage?.missingCount ? 'MISSING' : 'FILTERED',
      branchId: branchFilter !== 'all' && branchFilter !== 'unassigned' ? branchFilter : '',
      workPolicyId: activePolicies[0]?.id ?? '',
      effectiveMode: 'NOW',
      effectiveFrom: todayDate(),
      reason: '',
      bootstrap: false,
    });
    bulkAssignmentAttempt.current = null;
    setError(null);
    setNotice(null);
    setBulkOpen(true);
  }

  async function submitBulkAssignment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedPolicy = activePolicies.find((policy) => policy.id === bulkDraft.workPolicyId) ?? null;
    if (!selectedPolicy) {
      setError('Vui lòng chọn chính sách làm việc.');
      return;
    }
    const effectiveFrom = bulkDraft.effectiveMode === 'NOW' ? todayDate() : bulkDraft.effectiveFrom;
    const policyEffectiveFrom = effectiveDate(selectedPolicy.effective_from);
    if (!policyEffectiveFrom || effectiveFrom < policyEffectiveFrom) {
      setError(`Chính sách này chỉ có hiệu lực từ ${dateLabel(selectedPolicy.effective_from)}; không thể áp dụng từ ngày sớm hơn.`);
      return;
    }
    const isPast = effectiveFrom < todayDate();
    if (isPast && !bulkDraft.bootstrap) {
      setError('Ngày đã qua chỉ được dùng khi xác nhận đây là khởi tạo chính sách ban đầu.');
      return;
    }
    if (isPast && !bulkDraft.reason.trim()) {
      setError('Khởi tạo cho giai đoạn trước phải nhập lý do.');
      return;
    }

    let targetMode: 'ALL_ACTIVE' | 'BRANCH' | 'EMPLOYEES' = 'ALL_ACTIVE';
    let employeeIds: string[] | undefined;
    if (bulkDraft.targetMode === 'BRANCH') {
      if (!bulkDraft.branchId) {
        setError('Vui lòng chọn chi nhánh.');
        return;
      }
      targetMode = 'BRANCH';
    } else if (bulkDraft.targetMode === 'FILTERED') {
      targetMode = 'EMPLOYEES';
      employeeIds = visibleEmployees.filter((employee) => employee.is_active).map((employee) => employee.id);
    } else if (bulkDraft.targetMode === 'MISSING') {
      targetMode = 'EMPLOYEES';
      employeeIds = (coverage?.employees ?? []).filter((employee) => !employee.assignment).map((employee) => employee.id);
    }
    if (targetMode === 'EMPLOYEES' && !employeeIds?.length) {
      setError('Không có nhân sự phù hợp trong phạm vi đã chọn.');
      return;
    }

    const payload = {
      targetMode,
      branchId: targetMode === 'BRANCH' ? bulkDraft.branchId : null,
      employeeIds: targetMode === 'EMPLOYEES' ? employeeIds : null,
      workPolicyId: bulkDraft.workPolicyId,
      effectiveFrom,
      reason: bulkDraft.reason.trim(),
      bootstrap: isPast && bulkDraft.bootstrap,
    };
    const key = mutationKeyForPayload(bulkAssignmentAttempt, 'web-employee-policy-bulk-assign', payload);
    setAssignmentBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await requestJson<BulkPolicyAssignmentResult>('/api/workforce/assignments/bulk', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(payload),
      });
      bulkAssignmentAttempt.current = null;
      setBulkOpen(false);
      await loadAll(null, { silent: true, refreshRouter: false });
      setNotice(`Đã áp dụng chính sách cho ${result.affectedCount} nhân sự.`);
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không áp dụng được chính sách hàng loạt');
    } finally {
      setAssignmentBusy(false);
    }
  }

  const shellActions = (
    <>
      <button type="button" className={shellStyles.actionButton} onClick={() => void loadAll()} disabled={busy !== null}>
        {busy === 'load' ? 'Đang làm mới…' : 'Làm mới dữ liệu'}
      </button>
      <button
        type="button"
        className={shellStyles.actionButton}
        onClick={openBulkAssignment}
        disabled={!activePolicies.length || assignmentBusy}
        data-testid="employees-bulk-policy-button"
      >
        Áp dụng chính sách hàng loạt
      </button>
      <button
        type="button"
        className={shellStyles.actionButton}
        onClick={openOrganization}
        data-testid="employees-organization-button"
      >
        Cơ cấu tổ chức
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
      subtitle="Quản lý hồ sơ nhân sự, Phòng/Bộ phận, Vị trí công việc, quản lý trực tiếp và đơn vị công tác."
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
            <span>Tổng nhân sự</span>
            <strong>{formatCompactNumber(counts.total)}</strong>
            <small>Toàn bộ nhân sự trong danh mục</small>
          </article>
          <article className={styles.summaryCard}>
            <span>Đang làm việc</span>
            <strong>{formatCompactNumber(counts.active)}</strong>
            <small>{counts.inactive} nhân sự đã ngừng làm việc</small>
          </article>
          <article className={styles.summaryCard}>
            <span>Đã phân công chi nhánh</span>
            <strong>{formatCompactNumber(counts.assigned)}</strong>
            <small>{counts.unassigned} nhân sự chưa được phân công chi nhánh</small>
          </article>
          <article className={styles.summaryCard}>
            <span>Chưa có chính sách</span>
            <strong>{formatCompactNumber(counts.missingPolicy)}</strong>
            <small>Tính tại ngày {coverage?.asOfDate ?? todayDate()}</small>
          </article>
        </section>

        {coverage && coverage.missingCount > 0 ? (
          <div className={styles.banner} role="note">
            Có {coverage.missingCount} nhân sự đang làm việc chưa có chính sách làm việc hiệu lực. Hãy áp dụng chính sách hàng loạt trước khi sử dụng bảng công.
          </div>
        ) : null}

        <section className={styles.toolbar}>
          <div className={styles.toolbarSearch}>
            <label htmlFor="employees-search">Tìm kiếm nhân sự</label>
            <input
              id="employees-search"
              data-testid="employees-search-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Ví dụ: NV001, Nguyễn Văn An, Kế toán"
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
              <option value="inactive">Ngừng làm việc</option>
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
          <div className={styles.toolbarFilter}>
            <label htmlFor="employees-policy">Chính sách làm việc</label>
            <select
              id="employees-policy"
              value={policyFilter}
              onChange={(event) => setPolicyFilter(event.target.value as PolicyFilter)}
            >
              <option value="all">Tất cả</option>
              <option value="assigned">Đã có chính sách</option>
              <option value="missing">Chưa có chính sách</option>
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
                  <th>Chính sách làm việc</th>
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
                          <span>{employee.current_assignment?.position_name || employee.job_title || 'Chưa phân công vị trí'}</span>
                          {employee.current_assignment?.department_name ? <small>{employee.current_assignment.department_name}</small> : null}
                        </div>
                      </td>
                      <td className={styles.relationCell}>
                        <div className={styles.entityStack}>
                          <span>{branch ? `${branch.code} · ${branch.name}` : 'Chưa phân công chi nhánh'}</span>
                          <span>{employee.current_assignment?.department_name || 'Chưa phân công Phòng/Bộ phận'}</span>
                          <small>{employee.current_assignment?.manager_name ? `Quản lý: ${employee.current_assignment.manager_name}` : 'Chưa có quản lý trực tiếp'}</small>
                        </div>
                      </td>
                      <td>
                        {coverageMap.get(employee.id)?.assignment ? (
                          <div className={styles.entityStack}>
                            <strong>{coverageMap.get(employee.id)?.assignment?.policyName}</strong>
                            <span>{coverageMap.get(employee.id)?.assignment?.policyCode} · lần cập nhật {coverageMap.get(employee.id)?.assignment?.policyVersion}</span>
                          </div>
                        ) : employee.is_active ? (
                          <span className={joinClasses(styles.statusPill, styles.toneDanger)}>Chưa có chính sách</span>
                        ) : <span>Không áp dụng</span>}
                      </td>
                      <td>
                        <div className={styles.entityStack}>
                          <span>{employee.phone || 'Chưa có số điện thoại'}</span>
                          <span>{employee.email || 'Chưa có email'}</span>
                        </div>
                      </td>
                      <td>
                        <span className={joinClasses(styles.statusPill, employee.is_active ? styles.toneSuccess : styles.toneDanger)}>
                          {employee.is_active ? 'Đang làm việc' : 'Ngừng làm việc'}
                        </span>
                      </td>
                      <td>{formatDateTime(employee.updated_at)}</td>
                      <td>
                        <div className={styles.rowActions}>
                          <button type="button" data-testid={`edit-employee-${employee.code}`} onClick={() => void openEdit(employee.id)}>Chỉnh sửa</button>
                          <button type="button" data-testid={`policy-employee-${employee.code}`} onClick={() => void openPolicyAssignment(employee.id)}>Chính sách làm việc</button>
                          <button
                            type="button"
                            data-testid={`toggle-employee-${employee.code}`}
                            onClick={() => setToggleState({
                              employeeId: employee.id,
                              nextActive: !employee.is_active,
                              effectiveDate: todayDate(),
                              reason: '',
                              employmentType: employee.current_employment?.employment_type ?? 'OTHER',
                            })}
                          >
                            {employee.is_active ? 'Ngừng làm việc' : 'Đưa trở lại làm việc'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={8}><div className={styles.emptyState}>Không tìm thấy hồ sơ nhân sự phù hợp.</div></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {organizationOpen ? (
          <div className={styles.modalBackdrop} role="presentation" onClick={() => setOrganizationOpen(false)}>
            <div className={styles.modal} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div>
                  <p className={styles.panelKicker}>Thiết lập nhân sự</p>
                  <h3>Cơ cấu tổ chức</h3>
                </div>
                <button type="button" className={styles.modalClose} onClick={() => setOrganizationOpen(false)}>Đóng</button>
              </div>

              <section className={styles.tableSection}>
                <div className={styles.sectionHeader}><div><p className={styles.panelKicker}>Đơn vị nội bộ</p><h2>Phòng/Bộ phận</h2></div></div>
                <form className={styles.form} onSubmit={(event) => void submitDepartment(event)}>
                  <label>Mã<input value={departmentDraft.code} onChange={(event) => setDepartmentDraft((current) => ({ ...current, code: event.target.value }))} required maxLength={64} /></label>
                  <label>Tên Phòng/Bộ phận<input value={departmentDraft.name} onChange={(event) => setDepartmentDraft((current) => ({ ...current, name: event.target.value }))} required maxLength={256} /></label>
                  <label>Cấp trên
                    <select value={departmentDraft.parentDepartmentId} onChange={(event) => setDepartmentDraft((current) => ({ ...current, parentDepartmentId: event.target.value }))}>
                      <option value="">Không có</option>
                      {activeDepartments.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
                    </select>
                  </label>
                  <div className={styles.formActions}><button type="submit" className={styles.primaryButton} disabled={busy !== null}>Thêm Phòng/Bộ phận</button></div>
                </form>
                <div className={styles.tableWrap}>
                  <table className={styles.table} data-testid="employee-departments-table">
                    <thead><tr><th>Mã</th><th>Phòng/Bộ phận</th><th>Cấp trên</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
                    <tbody>{organization.departments.length ? organization.departments.map((item) => (
                      <tr key={item.id}>
                        <td><code>{item.code}</code></td><td>{item.name}</td><td>{item.parent_name || '—'}</td>
                        <td>{item.is_active ? 'Đang sử dụng' : 'Ngừng sử dụng'}</td>
                        <td><button type="button" onClick={() => void toggleDepartment(item)} disabled={busy !== null}>{item.is_active ? 'Ngừng sử dụng' : 'Sử dụng lại'}</button></td>
                      </tr>
                    )) : <tr><td colSpan={5}><div className={styles.emptyState}>Chưa có Phòng/Bộ phận.</div></td></tr>}</tbody>
                  </table>
                </div>
              </section>

              <section className={styles.tableSection}>
                <div className={styles.sectionHeader}><div><p className={styles.panelKicker}>Chức năng công việc</p><h2>Vị trí công việc</h2></div></div>
                <form className={styles.form} onSubmit={(event) => void submitPosition(event)}>
                  <label>Mã<input value={positionDraft.code} onChange={(event) => setPositionDraft((current) => ({ ...current, code: event.target.value }))} required maxLength={64} /></label>
                  <label>Tên Vị trí<input value={positionDraft.name} onChange={(event) => setPositionDraft((current) => ({ ...current, name: event.target.value }))} required maxLength={256} /></label>
                  <label>Thuộc Phòng/Bộ phận
                    <select value={positionDraft.departmentId} onChange={(event) => setPositionDraft((current) => ({ ...current, departmentId: event.target.value }))}>
                      <option value="">Dùng chung</option>
                      {activeDepartments.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
                    </select>
                  </label>
                  <div className={styles.formActions}><button type="submit" className={styles.primaryButton} disabled={busy !== null}>Thêm Vị trí</button></div>
                </form>
                <div className={styles.tableWrap}>
                  <table className={styles.table} data-testid="employee-positions-table">
                    <thead><tr><th>Mã</th><th>Vị trí</th><th>Phòng/Bộ phận</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
                    <tbody>{organization.positions.length ? organization.positions.map((item) => (
                      <tr key={item.id}>
                        <td><code>{item.code}</code></td><td>{item.name}</td><td>{item.department_name || 'Dùng chung'}</td>
                        <td>{item.is_active ? 'Đang sử dụng' : 'Ngừng sử dụng'}</td>
                        <td><button type="button" onClick={() => void togglePosition(item)} disabled={busy !== null}>{item.is_active ? 'Ngừng sử dụng' : 'Sử dụng lại'}</button></td>
                      </tr>
                    )) : <tr><td colSpan={5}><div className={styles.emptyState}>Chưa có Vị trí công việc.</div></td></tr>}</tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>
        ) : null}

        {bulkOpen ? (
          <div className={styles.modalBackdrop} role="presentation" onClick={() => setBulkOpen(false)}>
            <div className={styles.modal} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div>
                  <p className={styles.panelKicker}>Thiết lập hàng loạt</p>
                  <h3>Áp dụng Chính sách làm việc</h3>
                </div>
                <button type="button" className={styles.modalClose} onClick={() => setBulkOpen(false)}>Đóng</button>
              </div>
              <form className={styles.form} onSubmit={(event) => void submitBulkAssignment(event)}>
                <label>
                  Phạm vi áp dụng
                  <select value={bulkDraft.targetMode} onChange={(event) => setBulkDraft((current) => ({ ...current, targetMode: event.target.value as BulkTargetMode }))}>
                    <option value="MISSING">Nhân sự chưa có chính sách ({coverage?.missingCount ?? 0})</option>
                    <option value="FILTERED">Danh sách đang lọc ({visibleEmployees.filter((employee) => employee.is_active).length})</option>
                    <option value="BRANCH">Theo chi nhánh</option>
                    <option value="ALL_ACTIVE">Toàn bộ nhân sự đang làm việc</option>
                  </select>
                </label>
                {bulkDraft.targetMode === 'BRANCH' ? (
                  <label>
                    Chi nhánh
                    <select value={bulkDraft.branchId} onChange={(event) => setBulkDraft((current) => ({ ...current, branchId: event.target.value }))} required>
                      <option value="">Chọn chi nhánh</option>
                      {activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>)}
                    </select>
                  </label>
                ) : null}
                <label>
                  Chính sách áp dụng
                  <select value={bulkDraft.workPolicyId} onChange={(event) => setBulkDraft((current) => ({ ...current, workPolicyId: event.target.value }))} required>
                    <option value="">Chọn chính sách</option>
                    {activePolicies.map((policy) => (
                      <option key={policy.id} value={policy.id}>{policy.code} · {policy.name} · lần cập nhật {policy.version}</option>
                    ))}
                  </select>
                </label>
                <fieldset className={localStyles.timingFieldset} data-testid="bulk-policy-effective-mode">
                  <legend>Thời điểm áp dụng</legend>
                  <label className={localStyles.checkOption}>
                    <input type="radio" name="bulk-policy-effective-mode" checked={bulkDraft.effectiveMode === 'NOW'} onChange={() => setBulkDraft((current) => ({ ...current, effectiveMode: 'NOW', effectiveFrom: todayDate(), bootstrap: false }))} />
                    <span><strong>Áp dụng ngay</strong><small>Có hiệu lực từ hôm nay.</small></span>
                  </label>
                  <label className={localStyles.checkOption}>
                    <input type="radio" name="bulk-policy-effective-mode" checked={bulkDraft.effectiveMode === 'DATE'} onChange={() => setBulkDraft((current) => ({ ...current, effectiveMode: 'DATE', effectiveFrom: current.effectiveFrom || todayDate() }))} />
                    <span><strong>Chọn ngày áp dụng</strong><small>Dùng khi cần lên lịch trước hoặc khởi tạo có kiểm soát.</small></span>
                  </label>
                </fieldset>
                {bulkDraft.effectiveMode === 'DATE' ? (
                  <label>
                    Ngày áp dụng
                    <input
                      type="date"
                      value={bulkDraft.effectiveFrom}
                      onChange={(event) => setBulkDraft((current) => ({
                        ...current,
                        effectiveFrom: event.target.value,
                        bootstrap: event.target.value < todayDate() ? current.bootstrap : false,
                      }))}
                      required
                    />
                  </label>
                ) : null}
                {bulkDraft.effectiveMode === 'DATE' && bulkDraft.effectiveFrom < todayDate() ? (
                  <label className={localStyles.checkOption}>
                    <input
                      type="checkbox"
                      checked={bulkDraft.bootstrap}
                      onChange={(event) => setBulkDraft((current) => ({ ...current, bootstrap: event.target.checked }))}
                    />
                    <span>
                      <strong>Áp dụng chính sách ban đầu cho giai đoạn trước</strong>
                      <small>Chỉ dùng cho nhân sự chưa từng có chính sách. Không làm thay đổi dữ liệu đã ghi nhận trước đó.</small>
                    </span>
                  </label>
                ) : null}
                <label>
                  Lý do / ghi chú
                  <input
                    value={bulkDraft.reason}
                    onChange={(event) => setBulkDraft((current) => ({ ...current, reason: event.target.value }))}
                    maxLength={512}
                    required={bulkDraft.effectiveMode === 'DATE' && bulkDraft.effectiveFrom < todayDate()}
                    placeholder={bulkDraft.effectiveMode === 'DATE' && bulkDraft.effectiveFrom < todayDate() ? 'Bắt buộc khi khởi tạo giai đoạn trước' : 'Ví dụ: áp dụng chính sách văn phòng mới'}
                  />
                </label>
                <div className={localStyles.bulkInfo}>
                  <strong>Nguyên tắc an toàn</strong>
                  <span>Thao tác được lưu trong lịch sử hệ thống. Nếu có một hồ sơ không hợp lệ, toàn bộ danh sách sẽ không được áp dụng.</span>
                </div>
                <div className={styles.formActions}>
                  <button type="button" className={styles.secondaryButton} onClick={() => setBulkOpen(false)}>Hủy</button>
                  <button type="submit" className={styles.primaryButton} disabled={assignmentBusy || !bulkDraft.workPolicyId}>
                    {assignmentBusy ? 'Đang áp dụng…' : 'Áp dụng chính sách'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {policyEmployee ? (
          <div className={styles.modalBackdrop} role="presentation" onClick={() => setPolicyEmployeeId(null)}>
            <div className={styles.modal} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div>
                  <p className={styles.panelKicker}>Hồ sơ làm việc</p>
                  <h3>{policyEmployee.code} · {policyEmployee.full_name}</h3>
                </div>
                <button type="button" className={styles.modalClose} onClick={() => setPolicyEmployeeId(null)}>Đóng</button>
              </div>

              <section className={styles.tableSection}>
                <div className={styles.sectionHeader}>
                  <div><p className={styles.panelKicker}>Lịch sử hiệu lực</p><h2>Chính sách làm việc đã áp dụng</h2></div>
                  <span className={styles.panelChip}>{assignmentHistory.length} lần gán</span>
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table} data-testid="employee-policy-history">
                    <thead><tr><th>Chính sách</th><th>Hiệu lực từ</th><th>Hiệu lực đến</th><th>Lý do</th></tr></thead>
                    <tbody>
                      {assignmentHistory.length ? assignmentHistory.map((assignment) => (
                        <tr key={assignment.id}>
                          <td><strong>{assignment.policy_name}</strong><br /><small>{assignment.policy_code} · lần cập nhật {assignment.policy_version}</small></td>
                          <td>{dateLabel(assignment.effective_from)}</td>
                          <td>{assignment.effective_to ? dateLabel(assignment.effective_to) : 'Đang áp dụng'}</td>
                          <td>{assignment.reason || 'Không có ghi chú'}</td>
                        </tr>
                      )) : <tr><td colSpan={4}><div className={styles.emptyState}>{assignmentBusy ? 'Đang tải lịch sử…' : 'Chưa có chính sách làm việc.'}</div></td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>

              <form className={styles.form} onSubmit={(event) => void submitPolicyAssignment(event)}>
                <label>
                  Chính sách áp dụng
                  <select
                    value={assignmentDraft.workPolicyId}
                    onChange={(event) => setAssignmentDraft((current) => ({ ...current, workPolicyId: event.target.value }))}
                    required
                    data-testid="employee-policy-select"
                  >
                    <option value="">Chọn chính sách</option>
                    {activePolicies.map((policy) => (
                      <option key={policy.id} value={policy.id}>{policy.code} · {policy.name} · lần cập nhật {policy.version}</option>
                    ))}
                  </select>
                </label>
                <fieldset className={localStyles.timingFieldset} data-testid="employee-policy-effective-mode">
                  <legend>Thời điểm áp dụng</legend>
                  <label className={localStyles.checkOption}>
                    <input
                      type="radio"
                      name="employee-policy-effective-mode"
                      checked={assignmentDraft.effectiveMode === 'NOW'}
                      disabled={policyAssignmentMinDate > todayDate()}
                      onChange={() => setAssignmentDraft((current) => ({ ...current, effectiveMode: 'NOW', effectiveFrom: todayDate() }))}
                    />
                    <span>
                      <strong>Áp dụng ngay</strong>
                      <small>{policyAssignmentMinDate > todayDate() ? `Đã có mốc chính sách từ ${dateLabel(policyAssignmentMinDate)}; hãy chọn ngày sau mốc đó.` : 'Có hiệu lực từ hôm nay.'}</small>
                    </span>
                  </label>
                  <label className={localStyles.checkOption}>
                    <input
                      type="radio"
                      name="employee-policy-effective-mode"
                      checked={assignmentDraft.effectiveMode === 'DATE'}
                      onChange={() => setAssignmentDraft((current) => ({ ...current, effectiveMode: 'DATE', effectiveFrom: current.effectiveFrom < policyAssignmentMinDate ? policyAssignmentMinDate : current.effectiveFrom }))}
                    />
                    <span><strong>Chọn ngày áp dụng</strong><small>Dùng khi cần lên lịch thay đổi chính sách.</small></span>
                  </label>
                </fieldset>
                {assignmentDraft.effectiveMode === 'DATE' ? (
                  <label>
                    Ngày áp dụng
                    <input
                      type="date"
                      min={policyAssignmentMinDate}
                      value={assignmentDraft.effectiveFrom}
                      onChange={(event) => setAssignmentDraft((current) => ({ ...current, effectiveFrom: event.target.value }))}
                      required
                    />
                  </label>
                ) : null}
                <label>
                  Lý do / ghi chú
                  <input
                    value={assignmentDraft.reason}
                    onChange={(event) => setAssignmentDraft((current) => ({ ...current, reason: event.target.value }))}
                    maxLength={512}
                    placeholder="Ví dụ: chuyển sang lịch làm việc mới"
                  />
                </label>
                <div className={styles.formActions}>
                  <button type="button" className={styles.secondaryButton} onClick={() => setPolicyEmployeeId(null)}>Đóng</button>
                  <button type="submit" className={styles.primaryButton} disabled={assignmentBusy || !assignmentDraft.workPolicyId}>
                    {assignmentBusy ? 'Đang lưu…' : 'Áp dụng chính sách'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

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

              {editor.mode === 'edit' && editorDetail ? (
                <>
                  <section className={styles.tableSection}>
                    <div className={styles.sectionHeader}><div><p className={styles.panelKicker}>Lịch sử hiệu lực</p><h2>Lịch sử lao động</h2></div></div>
                    <div className={styles.tableWrap}>
                      <table className={styles.table} data-testid="employee-employment-history">
                        <thead><tr><th>Từ ngày</th><th>Đến ngày</th><th>Hình thức</th><th>Trạng thái dữ liệu</th><th>Lý do kết thúc</th></tr></thead>
                        <tbody>{(editorDetail.employment_history ?? []).map((item) => (
                          <tr key={item.id}>
                            <td>{dateLabel(item.effective_from)}</td>
                            <td>{item.effective_to ? dateLabel(item.effective_to) : 'Đang làm việc'}</td>
                            <td>{EMPLOYMENT_TYPE_LABEL[item.employment_type]}</td>
                            <td>{historyQualityLabel(item.data_quality)}</td>
                            <td>{item.end_reason || '—'}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </section>
                  <section className={styles.tableSection}>
                    <div className={styles.sectionHeader}><div><p className={styles.panelKicker}>Lịch sử hiệu lực</p><h2>Lịch sử điều chuyển</h2></div></div>
                    <div className={styles.tableWrap}>
                      <table className={styles.table} data-testid="employee-assignment-history">
                        <thead><tr><th>Từ ngày</th><th>Đến ngày</th><th>Chi nhánh</th><th>Phòng/Bộ phận</th><th>Vị trí</th><th>Quản lý trực tiếp</th><th>Trạng thái dữ liệu</th><th>Lý do</th></tr></thead>
                        <tbody>{(editorDetail.assignment_history ?? []).map((item) => (
                          <tr key={item.id}>
                            <td>{dateLabel(item.effective_from)}</td>
                            <td>{item.effective_to ? dateLabel(item.effective_to) : 'Đang áp dụng'}</td>
                            <td>{item.branch_id ? `${item.branch_code || ''} · ${item.branch_name || ''}` : 'Chưa phân công'}</td>
                            <td>{item.department_name || '—'}</td>
                            <td>{item.position_name || '—'}</td>
                            <td>{item.manager_name || '—'}</td>
                            <td>{historyQualityLabel(item.data_quality)}</td>
                            <td>{item.reason || '—'}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </section>
                </>
              ) : null}

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
                  Ngày bắt đầu làm việc
                  <input
                    type="date"
                    data-testid="employee-employment-start"
                    value={draft.employmentStartDate}
                    onChange={(event) => setDraft((current) => ({ ...current, employmentStartDate: event.target.value }))}
                    required
                  />
                </label>
                <label>
                  Hình thức lao động
                  <select
                    value={draft.employmentType}
                    onChange={(event) => setDraft((current) => ({ ...current, employmentType: event.target.value as EmploymentType }))}
                  >
                    {(Object.keys(EMPLOYMENT_TYPE_LABEL) as EmploymentType[]).map((value) => (
                      <option key={value} value={value}>{EMPLOYMENT_TYPE_LABEL[value]}</option>
                    ))}
                  </select>
                </label>
                {editor.mode === 'edit' && editorDetail?.current_employment?.data_quality !== 'CONFIRMED' ? (
                  <label className={localStyles.checkOption}>
                    <input
                      type="checkbox"
                      checked={draft.confirmEmployment}
                      onChange={(event) => setDraft((current) => ({ ...current, confirmEmployment: event.target.checked }))}
                    />
                    <span>
                      <strong>Xác nhận lịch sử lao động</strong>
                      <small>Dữ liệu cũ đang ở trạng thái “Chờ Nhân sự xác nhận”. Hãy kiểm tra ngày thực tế trước khi xác nhận.</small>
                    </span>
                  </label>
                ) : null}
                {editor.mode === 'edit' && !employees.find((item) => item.id === editor.employeeId)?.is_active ? (
                  <>
                    <label>
                      Ngày nghỉ việc
                      <input type="date" value={draft.employmentEndDate} onChange={(event) => setDraft((current) => ({ ...current, employmentEndDate: event.target.value }))} />
                    </label>
                    <label>
                      Lý do nghỉ việc
                      <input value={draft.employmentEndReason} onChange={(event) => setDraft((current) => ({ ...current, employmentEndReason: event.target.value }))} maxLength={1000} />
                    </label>
                  </>
                ) : null}
                <label>
                  Phòng/Bộ phận
                  <select
                    data-testid="employee-department-select"
                    value={draft.departmentId}
                    onChange={(event) => setDraft((current) => {
                      const departmentId = event.target.value;
                      const selectedPosition = organization.positions.find((item) => item.id === current.positionId);
                      return {
                        ...current,
                        departmentId,
                        positionId: selectedPosition?.department_id && selectedPosition.department_id !== departmentId ? '' : current.positionId,
                      };
                    })}
                  >
                    <option value="">Chưa phân công</option>
                    {activeDepartments.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
                  </select>
                </label>
                <label>
                  Vị trí công việc
                  <select
                    data-testid="employee-position-select"
                    value={draft.positionId}
                    onChange={(event) => {
                      const positionId = event.target.value;
                      const selected = organization.positions.find((item) => item.id === positionId);
                      setDraft((current) => ({
                        ...current,
                        positionId,
                        departmentId: selected?.department_id || current.departmentId,
                        jobTitle: selected?.name || current.jobTitle,
                      }));
                    }}
                  >
                    <option value="">Chưa phân công</option>
                    {activePositions
                      .filter((item) => !draft.departmentId || !item.department_id || item.department_id === draft.departmentId)
                      .map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
                  </select>
                  {!draft.positionId && draft.jobTitle ? <small>Chức danh cũ: {draft.jobTitle}. Hãy chọn Vị trí công việc để chuẩn hóa.</small> : null}
                </label>
                <label>
                  Quản lý trực tiếp
                  <select
                    data-testid="employee-manager-select"
                    value={draft.managerEmployeeId}
                    onChange={(event) => setDraft((current) => ({ ...current, managerEmployeeId: event.target.value }))}
                  >
                    <option value="">Chưa phân công</option>
                    {organization.managers
                      .filter((item) => item.id !== editor.employeeId)
                      .map((item) => <option key={item.id} value={item.id}>{item.code} · {item.full_name}{item.position_name ? ` · ${item.position_name}` : ''}{item.is_active ? '' : ' · Đã nghỉ'}</option>)}
                  </select>
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
                  {editor.mode === 'create' ? 'Phân công từ ngày' : 'Ngày hiệu lực thay đổi phân công hoặc xác nhận'}
                  <input
                    type="date"
                    data-testid="employee-assignment-effective-from"
                    value={draft.assignmentEffectiveFrom}
                    onChange={(event) => setDraft((current) => ({ ...current, assignmentEffectiveFrom: event.target.value }))}
                    required
                  />
                </label>
                <label>
                  Lý do phân công / điều chuyển
                  <input
                    value={draft.assignmentReason}
                    onChange={(event) => setDraft((current) => ({ ...current, assignmentReason: event.target.value }))}
                    maxLength={1000}
                    placeholder="Ví dụ: Điều chuyển sang Chi nhánh B từ 01/10/2026"
                  />
                </label>
                {editor.mode === 'edit' && editorDetail?.current_assignment?.data_quality !== 'CONFIRMED'
                  && (draft.branchId || null) === (employees.find((item) => item.id === editor.employeeId)?.branch_id ?? null) ? (
                  <label className={localStyles.checkOption}>
                    <input
                      type="checkbox"
                      checked={draft.confirmAssignment}
                      onChange={(event) => setDraft((current) => ({ ...current, confirmAssignment: event.target.checked }))}
                    />
                    <span>
                      <strong>Xác nhận lịch sử đơn vị công tác</strong>
                      <small>Chỉ xác nhận sau khi đã kiểm tra đúng ngày bắt đầu tại chi nhánh hiện tại.</small>
                    </span>
                  </label>
                ) : null}
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
                {editor.mode === 'create' ? (
                  <>
                    <label>
                      Chính sách làm việc
                      <select value={createPolicyId} onChange={(event) => setCreatePolicyId(event.target.value)} required data-testid="employee-create-policy-select">
                        <option value="">Chọn chính sách</option>
                        {activePolicies.map((policy) => (
                          <option key={policy.id} value={policy.id}>{policy.code} · {policy.name} · lần cập nhật {policy.version}</option>
                        ))}
                      </select>
                    </label>
                    <fieldset className={localStyles.timingFieldset} data-testid="employee-create-policy-effective-mode">
                      <legend>Thời điểm áp dụng chính sách</legend>
                      <label className={localStyles.checkOption}>
                        <input type="radio" name="employee-create-policy-effective-mode" checked={createPolicyMode === 'NOW'} onChange={() => { setCreatePolicyMode('NOW'); setCreatePolicyEffectiveFrom(todayDate()); }} />
                        <span><strong>Áp dụng ngay</strong><small>Có hiệu lực từ ngày tạo hồ sơ.</small></span>
                      </label>
                      <label className={localStyles.checkOption}>
                        <input type="radio" name="employee-create-policy-effective-mode" checked={createPolicyMode === 'DATE'} onChange={() => setCreatePolicyMode('DATE')} />
                        <span><strong>Chọn ngày áp dụng</strong><small>Dùng khi chính sách bắt đầu vào ngày khác.</small></span>
                      </label>
                    </fieldset>
                    {createPolicyMode === 'DATE' ? (
                      <label>
                        Ngày áp dụng chính sách
                        <input
                          type="date"
                          min={todayDate()}
                          value={createPolicyEffectiveFrom}
                          onChange={(event) => setCreatePolicyEffectiveFrom(event.target.value)}
                          required
                        />
                      </label>
                    ) : null}
                    {!activePolicies.length ? <div className={styles.banner}>Chưa có chính sách làm việc đang hoạt động. Hãy tạo chính sách trước khi thêm nhân sự.</div> : null}
                  </>
                ) : null}
                <div className={styles.formActions}>
                  <button type="button" className={styles.secondaryButton} onClick={() => setEditor(null)}>Hủy</button>
                  <button type="submit" className={styles.primaryButton} disabled={busy !== null || (editor.mode === 'create' && !createPolicyId)}>
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
                  <h3>{toggleState.nextActive ? 'Đưa trở lại làm việc' : 'Ngừng làm việc'}</h3>
                </div>
              </div>
              <p className={styles.confirmText}>
                {toggleState.nextActive
                  ? 'Hồ sơ sẽ được đưa trở lại trạng thái đang làm việc.'
                  : 'Hồ sơ sẽ chuyển sang trạng thái ngừng làm việc nhưng vẫn được giữ lại để đối soát và liên kết lịch sử.'}
              </p>
              <label className={styles.form}>
                Ngày hiệu lực
                <input
                  type="date"
                  value={toggleState.effectiveDate}
                  onChange={(event) => setToggleState((current) => current ? ({ ...current, effectiveDate: event.target.value }) : current)}
                  required
                />
              </label>
              {toggleState.nextActive ? (
                <label className={styles.form}>
                  Hình thức lao động
                  <select
                    value={toggleState.employmentType}
                    onChange={(event) => setToggleState((current) => current ? ({ ...current, employmentType: event.target.value as EmploymentType }) : current)}
                  >
                    {(Object.keys(EMPLOYMENT_TYPE_LABEL) as EmploymentType[]).map((value) => <option key={value} value={value}>{EMPLOYMENT_TYPE_LABEL[value]}</option>)}
                  </select>
                </label>
              ) : null}
              <label className={styles.form}>
                Lý do
                <input
                  value={toggleState.reason}
                  onChange={(event) => setToggleState((current) => current ? ({ ...current, reason: event.target.value }) : current)}
                  maxLength={1000}
                  required
                  placeholder={toggleState.nextActive ? 'Ví dụ: Quay lại làm việc' : 'Ví dụ: Kết thúc quan hệ lao động'}
                />
              </label>
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