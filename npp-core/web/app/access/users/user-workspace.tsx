'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useMemo, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import styles from './user-workspace.module.css';
import type { AccessRole, AccessUser } from '../../../lib/access-types';
import type { Employee } from '../../../lib/employee-types';
import type { Branch, Warehouse } from '../../../lib/organization-types';
import { formatDateTime, matchTerm, normalizeSearch } from '../../../lib/organization-types';

type FilterState = 'all' | 'active' | 'inactive';
type EditorState = { mode: 'create' | 'edit'; userId: string | null } | null;
type ToggleState = { userId: string; nextActive: boolean } | null;
type UserDraft = {
  loginName: string;
  employeeId: string;
  password: string;
  isActive: boolean;
  roleIds: string[];
  branchIds: string[];
  warehouseIds: string[];
};
type Props = {
  initialUsers: AccessUser[];
  initialRoles: AccessRole[];
  initialEmployees: Employee[];
  initialBranches: Branch[];
  initialWarehouses: Warehouse[];
  initialError?: string | null;
};
type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean };
};
type CredentialResult = {
  userId: string;
  credentialUpdated: boolean;
  revokedSessionCount: number;
};
type ScopeResponse = {
  userId: string;
  scopes: {
    branchIds: string[];
    warehouseIds: string[];
    territoryIds: string[];
  };
};

class ApiRequestError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
  }
}

const IDEMPOTENCY_INTENT_CACHE_LIMIT = 256;
const idempotencyKeys = new Map<string, string>();

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function emptyDraft(): UserDraft {
  return {
    loginName: '',
    employeeId: '',
    password: '',
    isActive: true,
    roleIds: [],
    branchIds: [],
    warehouseIds: [],
  };
}

function sortedIds(ids: string[]) {
  return [...new Set(ids)].sort();
}

function sameIds(left: string[], right: string[]) {
  const a = sortedIds(left);
  const b = sortedIds(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function keyFor(operation: string, resourceId: string, payload: unknown): string {
  const fingerprint = JSON.stringify(payload);
  const intent = `${operation}:${resourceId}:${fingerprint}`;
  const existing = idempotencyKeys.get(intent);
  if (existing) return existing;
  const key = createIdempotencyKey(`access-user-${operation}`);
  if (idempotencyKeys.size >= IDEMPOTENCY_INTENT_CACHE_LIMIT) {
    const oldest = idempotencyKeys.keys().next().value;
    if (oldest) idempotencyKeys.delete(oldest);
  }
  idempotencyKeys.set(intent, key);
  return key;
}

function passwordIsValid(password: string) {
  return password.length >= 10 && password.length <= 256;
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
  const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
  const code = payload.error?.code || 'REQUEST_FAILED';
  const message = payload.error?.message || 'Không thực hiện được yêu cầu người dùng';
  if (!response.ok) throw new ApiRequestError(code, message);
  if (payload.data === undefined) throw new ApiRequestError('INVALID_RESPONSE', message);
  return payload.data;
}

function mergeUser(list: AccessUser[], user: AccessUser) {
  return [...list.filter((item) => item.id !== user.id), user];
}

export default function UserWorkspace({
  initialUsers,
  initialRoles,
  initialEmployees,
  initialBranches,
  initialWarehouses,
  initialError = null,
}: Props) {
  const [users, setUsers] = useState(initialUsers);
  const [roles] = useState(initialRoles);
  const [employees] = useState(initialEmployees);
  const [branches] = useState(initialBranches);
  const [warehouses] = useState(initialWarehouses);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterState>('all');
  const [editor, setEditor] = useState<EditorState>(null);
  const [toggleState, setToggleState] = useState<ToggleState>(null);
  const [draft, setDraft] = useState<UserDraft>(emptyDraft());

  const employeeMap = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee])),
    [employees],
  );
  const roleMap = useMemo(
    () => new Map(roles.map((role) => [role.id, role])),
    [roles],
  );
  const branchMap = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch])),
    [branches],
  );
  const normalizedSearch = normalizeSearch(search);

  const eligibleEmployees = useMemo(() => {
    const linkedEmployeeIds = new Set(users.map((user) => user.employee_id).filter(Boolean));
    return employees
      .filter((employee) => employee.is_active && !linkedEmployeeIds.has(employee.id))
      .sort((left, right) => left.code.localeCompare(right.code));
  }, [employees, users]);

  const visibleUsers = useMemo(() => users
    .filter((user) => {
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'active' ? user.is_active : !user.is_active);
      const employee = employeeMap.get(user.employee_id ?? '');
      const roleText = (user.role_ids ?? [])
        .map((roleId) => roleMap.get(roleId)?.name ?? '')
        .join(' ');
      const matchesText = !normalizedSearch || matchTerm(
        user.login_name,
        employee?.full_name ?? '',
        employee?.code ?? '',
        roleText,
      ).includes(normalizedSearch);
      return matchesStatus && matchesText;
    })
    .sort((left, right) => left.login_name.localeCompare(right.login_name)), [
      employeeMap,
      normalizedSearch,
      roleMap,
      statusFilter,
      users,
    ]);

  const counts = useMemo(() => {
    const active = users.filter((user) => user.is_active).length;
    return { total: users.length, active, inactive: users.length - active };
  }, [users]);

  const editingUser = editor?.mode === 'edit'
    ? users.find((user) => user.id === editor.userId) ?? null
    : null;

  const selectableRoles = useMemo(() => {
    const assigned = new Set(editingUser?.role_ids ?? []);
    return roles
      .filter((role) => role.is_active || assigned.has(role.id))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [editingUser?.role_ids, roles]);

  const selectableBranches = useMemo(() => {
    const assigned = new Set(editingUser?.branch_ids ?? []);
    return branches
      .filter((branch) => branch.is_active || assigned.has(branch.id))
      .sort((left, right) => left.code.localeCompare(right.code));
  }, [branches, editingUser?.branch_ids]);

  const selectableWarehouses = useMemo(() => {
    const assigned = new Set(editingUser?.warehouse_ids ?? []);
    return warehouses
      .filter((warehouse) => warehouse.is_active || assigned.has(warehouse.id))
      .sort((left, right) => {
        const branchCompare = (branchMap.get(left.branch_id)?.code ?? '').localeCompare(branchMap.get(right.branch_id)?.code ?? '');
        return branchCompare || left.code.localeCompare(right.code);
      });
  }, [branchMap, editingUser?.warehouse_ids, warehouses]);

  async function reloadUsers(successMessage = 'Dữ liệu người dùng đã được tải lại.') {
    setBusy('reload');
    setError(null);
    setConflict(false);
    try {
      const nextUsers = await requestJson<AccessUser[]>('/api/access/users?limit=1000');
      setUsers(nextUsers);
      setNotice(successMessage);
      return nextUsers;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải lại được dữ liệu người dùng');
      return null;
    } finally {
      setBusy(null);
    }
  }

  function openCreate() {
    setError(null);
    setNotice(null);
    setConflict(false);
    setDraft(emptyDraft());
    setEditor({ mode: 'create', userId: null });
  }

  function openEdit(userId: string) {
    const user = users.find((item) => item.id === userId);
    if (!user) return;
    setError(null);
    setNotice(null);
    setConflict(false);
    setDraft({
      loginName: user.login_name,
      employeeId: user.employee_id ?? '',
      password: '',
      isActive: user.is_active,
      roleIds: [...(user.role_ids ?? [])],
      branchIds: [...(user.branch_ids ?? [])],
      warehouseIds: [...(user.warehouse_ids ?? [])],
    });
    setEditor({ mode: 'edit', userId });
  }

  function closeEditor() {
    if (busy === 'save') return;
    setEditor(null);
    setDraft(emptyDraft());
    setError(null);
    setConflict(false);
  }

  function toggleRole(roleId: string) {
    setDraft((current) => ({
      ...current,
      roleIds: current.roleIds.includes(roleId)
        ? current.roleIds.filter((id) => id !== roleId)
        : [...current.roleIds, roleId],
    }));
  }

  function toggleBranch(branchId: string) {
    setDraft((current) => {
      if (!current.branchIds.includes(branchId)) {
        return { ...current, branchIds: [...current.branchIds, branchId] };
      }
      const warehouseIds = current.warehouseIds.filter(
        (warehouseId) => branchMap.get(warehouses.find((warehouse) => warehouse.id === warehouseId)?.branch_id ?? '')?.id !== branchId,
      );
      return {
        ...current,
        branchIds: current.branchIds.filter((id) => id !== branchId),
        warehouseIds,
      };
    });
  }

  function toggleWarehouse(warehouse: Warehouse) {
    setDraft((current) => ({
      ...current,
      branchIds: current.branchIds.includes(warehouse.branch_id)
        ? current.branchIds
        : [...current.branchIds, warehouse.branch_id],
      warehouseIds: current.warehouseIds.includes(warehouse.id)
        ? current.warehouseIds.filter((id) => id !== warehouse.id)
        : [...current.warehouseIds, warehouse.id],
    }));
  }

  function handleFailure(caught: unknown) {
    if (caught instanceof ApiRequestError && caught.code === 'CONFLICT') {
      setConflict(true);
      setError(`${caught.message}. Hãy tải lại dữ liệu trước khi lưu tiếp.`);
      return;
    }
    setConflict(false);
    setError(caught instanceof Error ? caught.message : 'Lỗi không xác định');
  }

  async function replaceScopes(userId: string) {
    const payload = {
      scopes: {
        branchIds: sortedIds(draft.branchIds),
        warehouseIds: sortedIds(draft.warehouseIds),
        territoryIds: [],
      },
    };
    return requestJson<ScopeResponse>(`/api/access/users/${userId}/scopes`, {
      method: 'PUT',
      body: JSON.stringify(payload),
      headers: { 'Idempotency-Key': keyFor('scopes', userId, payload) },
    });
  }

  async function provisionNewUser() {
    let created: AccessUser | null = null;
    try {
      // New accounts stay disabled until role + credential + scope provisioning finishes.
      const createPayload = {
        loginName: draft.loginName,
        employeeId: draft.employeeId,
        isActive: false,
      };
      created = await requestJson<AccessUser>('/api/access/users', {
        method: 'POST',
        body: JSON.stringify(createPayload),
        headers: { 'Idempotency-Key': keyFor('create', draft.employeeId, createPayload) },
      });

      const rolesPayload = {
        roleIds: sortedIds(draft.roleIds),
        expectedUpdatedAt: created.updated_at,
      };
      let latest = await requestJson<AccessUser>(`/api/access/users/${created.id}/roles`, {
        method: 'PATCH',
        body: JSON.stringify(rolesPayload),
        headers: { 'Idempotency-Key': keyFor('roles', created.id, rolesPayload) },
      });

      await requestJson<CredentialResult>(`/api/access/users/${created.id}/credential`, {
        method: 'PUT',
        body: JSON.stringify({ password: draft.password }),
      });

      const savedScopes = await replaceScopes(created.id);
      latest = {
        ...latest,
        branch_ids: savedScopes.scopes.branchIds,
        warehouse_ids: savedScopes.scopes.warehouseIds,
      };

      if (draft.isActive) {
        const statusPayload = {
          isActive: true,
          expectedUpdatedAt: latest.updated_at,
        };
        latest = await requestJson<AccessUser>(`/api/access/users/${created.id}`, {
          method: 'PATCH',
          body: JSON.stringify(statusPayload),
          headers: { 'Idempotency-Key': keyFor('status', created.id, statusPayload) },
        });
      }

      setUsers((current) => mergeUser(current, latest));
      setNotice('Đã tạo tài khoản, mật khẩu, vai trò và phạm vi chi nhánh/kho. Nhân viên có thể đăng nhập bằng tên đăng nhập vừa cấp.');
      setEditor(null);
      setDraft(emptyDraft());
    } catch (caught) {
      if (!created) throw caught;

      const refreshed = await requestJson<AccessUser[]>('/api/access/users?limit=1000').catch(() => null);
      const latest = refreshed?.find((user) => user.id === created?.id) ?? created;
      setUsers((current) => mergeUser(refreshed ?? current, latest));

      // Crucial recovery rule: the identity already exists. Keep the user's draft and
      // switch the same modal to edit mode so Retry finishes this account instead of
      // creating a duplicate or forcing the operator to start again.
      setEditor({ mode: 'edit', userId: created.id });
      const message = caught instanceof Error ? caught.message : 'Không hoàn tất được việc cấp tài khoản';
      throw new ApiRequestError(
        'USER_PROVISIONING_INCOMPLETE',
        `${message}. Tài khoản đã được giữ an toàn ở trạng thái hiện tại; biểu mẫu vẫn mở để hoàn tất vai trò, mật khẩu, phạm vi và kích hoạt.`,
      );
    }
  }

  async function saveEditor() {
    if (!editor) return;
    if (editor.mode === 'create' && !passwordIsValid(draft.password)) {
      setError('Mật khẩu phải có từ 10 đến 256 ký tự.');
      return;
    }
    if (editor.mode === 'edit' && draft.password && !passwordIsValid(draft.password)) {
      setError('Mật khẩu mới phải có từ 10 đến 256 ký tự.');
      return;
    }

    setBusy('save');
    setError(null);
    setNotice(null);
    setConflict(false);

    try {
      if (editor.mode === 'create') {
        await provisionNewUser();
        return;
      }

      if (!editor.userId) return;
      const original = users.find((user) => user.id === editor.userId);
      if (!original) throw new Error('Người dùng không còn tồn tại trong danh sách hiện tại');

      let latest = original;
      let changed = false;

      if (!sameIds(draft.roleIds, original.role_ids ?? [])) {
        const rolesPayload = {
          roleIds: sortedIds(draft.roleIds),
          expectedUpdatedAt: latest.updated_at,
        };
        latest = await requestJson<AccessUser>(`/api/access/users/${original.id}/roles`, {
          method: 'PATCH',
          body: JSON.stringify(rolesPayload),
          headers: { 'Idempotency-Key': keyFor('roles', original.id, rolesPayload) },
        });
        setUsers((current) => current.map((user) => (user.id === latest.id ? latest : user)));
        changed = true;
      }

      const scopesChanged = !sameIds(draft.branchIds, original.branch_ids ?? [])
        || !sameIds(draft.warehouseIds, original.warehouse_ids ?? []);
      if (!original.owner_kind && scopesChanged) {
        const savedScopes = await replaceScopes(original.id);
        latest = {
          ...latest,
          branch_ids: savedScopes.scopes.branchIds,
          warehouse_ids: savedScopes.scopes.warehouseIds,
        };
        setUsers((current) => current.map((user) => (user.id === latest.id ? latest : user)));
        changed = true;
      }

      if (draft.password) {
        await requestJson<CredentialResult>(`/api/access/users/${original.id}/credential`, {
          method: 'PUT',
          body: JSON.stringify({ password: draft.password }),
        });
        changed = true;
      }

      if (draft.isActive !== latest.is_active) {
        const statusPayload = {
          isActive: draft.isActive,
          expectedUpdatedAt: latest.updated_at,
        };
        latest = await requestJson<AccessUser>(`/api/access/users/${original.id}`, {
          method: 'PATCH',
          body: JSON.stringify(statusPayload),
          headers: { 'Idempotency-Key': keyFor('status', original.id, statusPayload) },
        });
        setUsers((current) => current.map((user) => (user.id === latest.id ? latest : user)));
        changed = true;
      }

      setNotice(changed ? 'Đã cập nhật người dùng.' : 'Không có thay đổi cần lưu.');
      setEditor(null);
      setDraft(emptyDraft());
      setError(null);
    } catch (caught) {
      handleFailure(caught);
    } finally {
      setBusy(null);
    }
  }

  async function confirmToggle() {
    if (!toggleState) return;
    const user = users.find((item) => item.id === toggleState.userId);
    if (!user) return;

    setBusy('toggle');
    setError(null);
    setNotice(null);
    setConflict(false);
    try {
      const statusPayload = {
        isActive: toggleState.nextActive,
        expectedUpdatedAt: user.updated_at,
      };
      const updated = await requestJson<AccessUser>(`/api/access/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify(statusPayload),
        headers: { 'Idempotency-Key': keyFor('status', user.id, statusPayload) },
      });
      setUsers((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setNotice(toggleState.nextActive ? 'Đã kích hoạt người dùng.' : 'Đã ngừng sử dụng người dùng.');
      setToggleState(null);
    } catch (caught) {
      handleFailure(caught);
    } finally {
      setBusy(null);
    }
  }

  const createFormIncomplete = editor?.mode === 'create'
    && (!draft.loginName.trim() || !draft.employeeId || !passwordIsValid(draft.password) || draft.roleIds.length === 0);
  const editPasswordInvalid = editor?.mode === 'edit' && Boolean(draft.password) && !passwordIsValid(draft.password);

  return (
    <AppShell
      title="Người dùng"
      subtitle="Quản lý tài khoản sử dụng hệ thống, liên kết nhân sự, vai trò và phạm vi chi nhánh/kho."
    >
      <main className={styles.page}>
        <header className={styles.header}>
          <div className={styles.headerText}>
            <p className={styles.kicker}>Nhân sự &amp; phân quyền</p>
            <h1 className={styles.title}>Người dùng</h1>
            <p className={styles.subtitle}>Quản lý tài khoản, vai trò và phạm vi dữ liệu chi nhánh/kho ngay trên cùng một màn hình.</p>
          </div>
          <div className={styles.headerActions}>
            <button className={styles.secondaryButton} type="button" onClick={() => reloadUsers()} disabled={busy !== null}>Tải lại</button>
            <button className={styles.primaryButton} type="button" onClick={openCreate} disabled={busy !== null || eligibleEmployees.length === 0}>Thêm người dùng</button>
          </div>
        </header>

        <section className={styles.summaryGrid} aria-label="Tổng quan người dùng">
          <article className={styles.summaryCard}><span>Tổng tài khoản</span><strong>{counts.total}</strong></article>
          <article className={styles.summaryCard}><span>Đang hoạt động</span><strong>{counts.active}</strong></article>
          <article className={styles.summaryCard}><span>Không hoạt động</span><strong>{counts.inactive}</strong></article>
        </section>

        {error && !editor && <div className={styles.errorNotice} role="alert">{error}</div>}
        {notice && <div className={styles.notice} role="status">{notice}</div>}

        <section className={styles.toolbar} aria-label="Bộ lọc người dùng">
          <label className={styles.field}>Tìm kiếm<input type="search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Tên đăng nhập, nhân sự hoặc vai trò" /></label>
          <label className={styles.field}>Trạng thái<select value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value as FilterState)}><option value="all">Tất cả</option><option value="active">Đang hoạt động</option><option value="inactive">Không hoạt động</option></select></label>
          <div className={styles.headerActions}><span className={styles.muted}>{visibleUsers.length} kết quả</span></div>
        </section>

        <section className={styles.tableSection}>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Tên đăng nhập</th><th>Nhân sự</th><th>Vai trò</th><th>Phạm vi kho</th><th>Trạng thái</th><th>Cập nhật</th><th>Hành động</th></tr></thead>
              <tbody>
                {visibleUsers.map((user) => {
                  const employee = employeeMap.get(user.employee_id ?? '');
                  const userRoles = (user.role_ids ?? []).map((roleId) => roleMap.get(roleId)).filter((role): role is AccessRole => Boolean(role));
                  return <tr key={user.id}>
                    <td className={styles.loginName}>{user.login_name}</td>
                    <td><div className={styles.employeeCell}><strong>{employee?.full_name ?? user.employee_full_name ?? 'Không xác định'}</strong><span>{employee?.code ?? user.employee_code ?? ''}</span></div></td>
                    <td>{userRoles.length > 0 ? <div className={styles.roleList}>{userRoles.map((role) => <span key={role.id} className={styles.roleChip}>{role.name}</span>)}</div> : <span className={styles.muted}>Chưa gán vai trò</span>}</td>
                    <td>{user.owner_kind ? <span className={styles.roleChip}>Toàn installation</span> : <span className={styles.muted}>{(user.warehouse_ids ?? []).length} kho · {(user.branch_ids ?? []).length} chi nhánh</span>}</td>
                    <td><span className={joinClasses(styles.statusBadge, user.is_active ? styles.active : styles.inactive)}>{user.is_active ? 'Hoạt động' : 'Không hoạt động'}</span></td>
                    <td>{formatDateTime(user.updated_at)}</td>
                    <td><div className={styles.rowActions}><button className={styles.secondaryButton} type="button" onClick={() => openEdit(user.id)} disabled={busy !== null}>Sửa</button><button className={user.is_active ? styles.dangerButton : styles.successButton} type="button" onClick={() => setToggleState({ userId: user.id, nextActive: !user.is_active })} disabled={busy !== null}>{user.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}</button></div></td>
                  </tr>;
                })}
                {visibleUsers.length === 0 && <tr><td colSpan={7} className={styles.emptyState}>Không có người dùng phù hợp.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        {editor && <div className={styles.modalBackdrop} role="presentation">
          <section className={styles.modalPanel} role="dialog" aria-modal="true" aria-labelledby="user-editor-title">
            <header className={styles.modalHeader}>
              <div><h2 id="user-editor-title">{editor.mode === 'create' ? 'Thêm người dùng' : 'Cập nhật người dùng'}</h2><p>{editor.mode === 'create' ? 'Chọn nhân sự, cấp tên đăng nhập, mật khẩu, vai trò và phạm vi dữ liệu trong một lần.' : 'Cập nhật vai trò, phạm vi chi nhánh/kho, trạng thái hoặc đặt lại mật khẩu đăng nhập.'}</p></div>
              <button className={styles.closeButton} type="button" onClick={closeEditor} aria-label="Đóng" disabled={busy !== null}>×</button>
            </header>
            <div className={styles.modalBody}>
              {error && <div className={styles.errorNotice} role="alert">{error}{conflict && <div className={styles.conflictActions}><button className={styles.secondaryButton} type="button" onClick={() => reloadUsers('Đã tải lại phiên bản mới nhất.')} disabled={busy !== null}>Tải lại dữ liệu</button></div>}</div>}
              <div className={styles.formGrid}>
                <label className={styles.field}>Tên đăng nhập<input value={draft.loginName} onChange={(event) => {
                  const value = event.currentTarget.value;
                  setDraft((current) => ({ ...current, loginName: value }));
                }} disabled={editor.mode === 'edit' || busy !== null} placeholder="vi-du.nguyen" autoComplete="off" /></label>
                {editor.mode === 'create' ? <label className={styles.field}>Nhân sự đang hoạt động chưa có tài khoản<select value={draft.employeeId} onChange={(event) => {
                  const value = event.currentTarget.value;
                  setDraft((current) => ({ ...current, employeeId: value }));
                }} disabled={busy !== null}><option value="">Chọn nhân sự</option>{eligibleEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name} — {employee.code}</option>)}</select></label> : <label className={styles.field}>Nhân sự liên kết<input value={`${editingUser?.employee_full_name ?? employeeMap.get(draft.employeeId)?.full_name ?? ''}${editingUser?.employee_code ? ` — ${editingUser.employee_code}` : employeeMap.get(draft.employeeId)?.code ? ` — ${employeeMap.get(draft.employeeId)?.code}` : ''}`} disabled /></label>}
                <label className={styles.field}>{editor.mode === 'create' ? 'Mật khẩu đăng nhập' : 'Mật khẩu mới'}<input type="password" value={draft.password} onChange={(event) => {
                  const value = event.currentTarget.value;
                  setDraft((current) => ({ ...current, password: value }));
                }} disabled={busy !== null} minLength={10} maxLength={256} autoComplete="new-password" placeholder={editor.mode === 'create' ? 'Ít nhất 10 ký tự' : 'Để trống nếu không đổi'} /><small>{editor.mode === 'create' ? 'Mật khẩu này được cấp trực tiếp cho nhân viên để đăng nhập lần đầu.' : 'Nhập mật khẩu mới sẽ đồng thời thu hồi các phiên đăng nhập cũ của người dùng.'}</small></label>
                <label className={styles.field}>Trạng thái sau khi cấp tài khoản<select value={draft.isActive ? 'active' : 'inactive'} onChange={(event) => {
                  const isActive = event.currentTarget.value === 'active';
                  setDraft((current) => ({ ...current, isActive }));
                }} disabled={busy !== null}><option value="active">Hoạt động</option><option value="inactive">Không hoạt động</option></select></label>
                <div className={styles.field}>Vai trò<div className={styles.checkboxGrid}>{selectableRoles.map((role) => { const assigned = draft.roleIds.includes(role.id); return <label key={role.id} className={styles.roleOption}><input type="checkbox" checked={assigned} onChange={() => toggleRole(role.id)} disabled={busy !== null} /><span><strong>{role.name}</strong>{!role.is_active && <small>Vai trò không hoạt động — bỏ chọn để thu hồi</small>}</span></label>; })}{selectableRoles.length === 0 && <span className={styles.muted}>Không có vai trò đang hoạt động.</span>}</div>{editor.mode === 'create' && <small>Chọn ít nhất một vai trò để tài khoản có quyền sử dụng app.</small>}</div>
                {editingUser?.owner_kind ? <div className={styles.field}>Phạm vi dữ liệu<div className={styles.notice}><strong>Security Owner — toàn installation</strong><div>Owner luôn thấy toàn bộ chi nhánh/kho, kể cả kho ngưng hoạt động có lịch sử. Không giới hạn bằng user scope.</div></div></div> : <>
                  <div className={styles.field}>Chi nhánh<div className={styles.checkboxGrid}>{selectableBranches.map((branch) => { const assigned = draft.branchIds.includes(branch.id); return <label key={branch.id} className={styles.roleOption}><input type="checkbox" checked={assigned} onChange={() => toggleBranch(branch.id)} disabled={busy !== null} /><span><strong>{branch.name}</strong><small>{branch.code}{!branch.is_active ? ' · ngưng hoạt động / lịch sử' : ''}</small></span></label>; })}{selectableBranches.length === 0 && <span className={styles.muted}>Không có chi nhánh để gán.</span>}</div></div>
                  <div className={styles.field}>Kho dữ liệu<div className={styles.checkboxGrid}>{selectableWarehouses.map((warehouse) => { const assigned = draft.warehouseIds.includes(warehouse.id); const branch = branchMap.get(warehouse.branch_id); return <label key={warehouse.id} className={styles.roleOption}><input type="checkbox" checked={assigned} onChange={() => toggleWarehouse(warehouse)} disabled={busy !== null} /><span><strong>{warehouse.name}</strong><small>{warehouse.code}{branch ? ` · ${branch.name}` : ''}{!warehouse.is_active ? ' · ngưng hoạt động / lịch sử' : ''}</small></span></label>; })}{selectableWarehouses.length === 0 && <span className={styles.muted}>Không có kho để gán.</span>}</div><small>Không chọn kho nào = zero-scope: tài khoản vẫn đăng nhập được nhưng dữ liệu theo kho bị deny-by-default.</small></div>
                </>}
              </div>
            </div>
            <footer className={styles.modalFooter}><button className={styles.secondaryButton} type="button" onClick={closeEditor} disabled={busy !== null}>Hủy</button><button className={styles.primaryButton} type="button" onClick={saveEditor} disabled={busy !== null || Boolean(createFormIncomplete) || Boolean(editPasswordInvalid)}>{busy === 'save' ? 'Đang lưu…' : editor.mode === 'create' ? 'Tạo tài khoản' : 'Lưu'}</button></footer>
          </section>
        </div>}

        {toggleState && <div className={styles.modalBackdrop} role="presentation">
          <section className={joinClasses(styles.modalPanel, styles.confirmPanel)} role="dialog" aria-modal="true" aria-labelledby="toggle-user-title">
            <header className={styles.modalHeader}><div><h3 id="toggle-user-title">Xác nhận thay đổi trạng thái</h3></div><button className={styles.closeButton} type="button" onClick={() => setToggleState(null)} aria-label="Đóng" disabled={busy !== null}>×</button></header>
            <div className={styles.modalBody}><p className={styles.confirmText}>{toggleState.nextActive ? 'Đưa người dùng này vào sử dụng? Nhân sự liên kết phải đang hoạt động.' : 'Ngừng sử dụng người dùng này? Các vai trò và phạm vi dữ liệu được giữ nguyên để có thể dùng lại khi cần.'}</p></div>
            <footer className={styles.modalFooter}><button className={styles.secondaryButton} type="button" onClick={() => setToggleState(null)} disabled={busy !== null}>Hủy</button><button className={toggleState.nextActive ? styles.successButton : styles.dangerButton} type="button" onClick={confirmToggle} disabled={busy !== null}>{busy === 'toggle' ? 'Đang xử lý…' : 'Xác nhận'}</button></footer>
          </section>
        </div>}
      </main>
    </AppShell>
  );
}
