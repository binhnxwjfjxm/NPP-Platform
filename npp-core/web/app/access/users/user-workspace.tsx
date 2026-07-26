'use client';

import { useMemo, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import shellStyles from '../../components/app-shell.module.css';
import styles from '../../organization/organization.module.css';
import type { AccessUser, AccessRole } from '../../../lib/access-types';
import type { Employee } from '../../../lib/employee-types';
import { formatCompactNumber, formatDateTime, matchTerm, normalizeSearch, toUpperCode } from '../../../lib/organization-types';

type FilterState = 'all' | 'active' | 'inactive';
type EditorState = { mode: 'create' | 'edit'; userId: string | null } | null;
type ToggleState = { userId: string; nextActive: boolean } | null;

type UserDraft = {
  loginName: string;
  employeeId: string;
  isActive: boolean;
  roleIds: string[];
};

type Props = {
  initialUsers: AccessUser[];
  initialRoles: AccessRole[];
  initialEmployees: Employee[];
  initialError?: string | null;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean };
};

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function emptyDraft(): UserDraft {
  return { loginName: '', employeeId: '', isActive: true, roleIds: [] };
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
  const message = payload.error?.message || 'Không thực hiện được yêu cầu người dùng';
  if (!response.ok) {
    throw new Error(message);
  }
  if (payload.data === undefined) {
    throw new Error(message);
  }
  return payload.data;
}

export default function UserWorkspace({
  initialUsers,
  initialRoles,
  initialEmployees,
  initialError = null,
}: Props) {
  const [users, setUsers] = useState(initialUsers);
  const [roles, setRoles] = useState(initialRoles);
  const [employees, setEmployees] = useState(initialEmployees);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterState>('all');
  const [editor, setEditor] = useState<EditorState>(null);
  const [toggleState, setToggleState] = useState<ToggleState>(null);
  const [draft, setDraft] = useState<UserDraft>(emptyDraft());

  const normalizedSearch = normalizeSearch(search);
  const employeeMap = useMemo(() => new Map(employees.map((emp) => [emp.id, emp])), [employees]);
  const roleMap = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles]);

  const visibleUsers = useMemo(() => users
    .filter((user) => {
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'active' ? user.is_active : !user.is_active);
      const employee = employeeMap.get(user.employee_id ?? '');
      const matchesText = !normalizedSearch || matchTerm(
        user.login_name,
        employee?.full_name ?? '',
        employee?.code ?? '',
      ).includes(normalizedSearch);
      return matchesStatus && matchesText;
    })
    .sort((left, right) => left.login_name.localeCompare(right.login_name)), [normalizedSearch, employeeMap, users, statusFilter]);

  const counts = useMemo(() => {
    const active = users.filter((user) => user.is_active).length;
    return {
      total: users.length,
      active,
      inactive: users.length - active,
    };
  }, [users]);

  const handleCreateClick = () => {
    setEditor({ mode: 'create', userId: null });
    setDraft(emptyDraft());
  };

  const handleEditClick = (userId: string) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;
    setEditor({ mode: 'edit', userId });
    setDraft({
      loginName: user.login_name,
      employeeId: user.employee_id ?? '',
      isActive: user.is_active,
      roleIds: user.role_ids ?? [],
    });
  };

  const handleCancel = () => {
    setEditor(null);
    setDraft(emptyDraft());
  };

  const handleDraftChange = (key: keyof UserDraft, value: unknown) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!editor) return;
    setBusy('save');
    setError(null);
    setNotice(null);

    try {
      if (editor.mode === 'create') {
        const payload = {
          loginName: draft.loginName,
          employeeId: draft.employeeId || null,
          isActive: draft.isActive,
          roleIds: draft.roleIds,
        };
        const newUser = await requestJson<AccessUser>('/api/access/users', {
          method: 'POST',
          body: JSON.stringify(payload),
          headers: { 'Idempotency-Key': `web-${Date.now()}-${Math.random()}` },
        });
        setUsers((prev) => [...prev, newUser]);
        setNotice('Người dùng được tạo thành công');
      } else if (editor.userId) {
        const statusPayload = {
          isActive: draft.isActive,
          expectedUpdatedAt: users.find((u) => u.id === editor.userId)?.updated_at,
        };
        const updatedUser = await requestJson<AccessUser>(`/api/access/users/${editor.userId}`, {
          method: 'PATCH',
          body: JSON.stringify(statusPayload),
          headers: { 'Idempotency-Key': `web-${Date.now()}-${Math.random()}` },
        });
        setUsers((prev) => prev.map((u) => (u.id === editor.userId ? updatedUser : u)));

        if (draft.roleIds.length > 0 || (users.find((u) => u.id === editor.userId)?.role_ids?.length ?? 0) > 0) {
          const rolePayload = {
            roleIds: draft.roleIds,
            expectedUpdatedAt: updatedUser.updated_at,
          };
          const updatedUserWithRoles = await requestJson<AccessUser>(`/api/access/users/${editor.userId}/roles`, {
            method: 'PATCH',
            body: JSON.stringify(rolePayload),
            headers: { 'Idempotency-Key': `web-${Date.now()}-${Math.random()}-roles` },
          });
          setUsers((prev) => prev.map((u) => (u.id === editor.userId ? updatedUserWithRoles : u)));
        }

        setNotice('Người dùng được cập nhật thành công');
      }
      setEditor(null);
      setDraft(emptyDraft());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi không xác định');
    } finally {
      setBusy(null);
    }
  };

  const handleToggleClick = (userId: string) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;
    setToggleState({ userId, nextActive: !user.is_active });
  };

  const handleToggleConfirm = async () => {
    if (!toggleState) return;
    setBusy('toggle');
    setError(null);
    setNotice(null);

    try {
      const user = users.find((u) => u.id === toggleState.userId);
      if (!user) throw new Error('Người dùng không tìm thấy');

      const updated = await requestJson<AccessUser>(`/api/access/users/${toggleState.userId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          isActive: toggleState.nextActive,
          expectedUpdatedAt: user.updated_at,
        }),
        headers: { 'Idempotency-Key': `web-${Date.now()}-${toggleState.userId}` },
      });
      setUsers((prev) => prev.map((u) => (u.id === toggleState.userId ? updated : u)));
      setNotice(`Trạng thái người dùng ${toggleState.nextActive ? 'được kích hoạt' : 'bị vô hiệu hóa'}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi khi thay đổi trạng thái');
    } finally {
      setToggleState(null);
      setBusy(null);
    }
  };

  const handleToggleCancel = () => {
    setToggleState(null);
  };

  return (
    <AppShell title="Quản lý Người dùng">
      <div className={shellStyles.container}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <h1>Quản lý Người dùng</h1>
            <div className={styles.stats}>
              <span>Tổng: {formatCompactNumber(counts.total)}</span>
              <span>Đang hoạt động: {formatCompactNumber(counts.active)}</span>
              <span>Không hoạt động: {formatCompactNumber(counts.inactive)}</span>
            </div>
          </div>
          <button className={styles.primaryButton} onClick={handleCreateClick} disabled={busy !== null}>
            Thêm Người dùng
          </button>
        </div>

        {error && <div className={styles.errorNotice}>{error}</div>}
        {notice && <div className={styles.successNotice}>{notice}</div>}

        <div className={styles.controls}>
          <div className={styles.search}>
            <input
              type="text"
              placeholder="Tìm kiếm theo tên đăng nhập hoặc tên nhân sự..."
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              disabled={busy !== null}
            />
          </div>
          <div className={styles.filters}>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.currentTarget.value as FilterState)}
              disabled={busy !== null}
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="active">Đang hoạt động</option>
              <option value="inactive">Không hoạt động</option>
            </select>
          </div>
        </div>

        <div className={styles.list}>
          {visibleUsers.length === 0 ? (
            <div className={styles.empty}>Không có người dùng nào</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Tên đăng nhập</th>
                  <th>Nhân sự</th>
                  <th>Vai trò</th>
                  <th>Trạng thái</th>
                  <th>Cập nhật lần cuối</th>
                  <th>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((user) => {
                  const employee = employeeMap.get(user.employee_id ?? '');
                  const userRoles = (user.role_ids ?? []).map((id) => roleMap.get(id)).filter(Boolean) as AccessRole[];
                  return (
                    <tr key={user.id}>
                      <td className={styles.code}>{user.login_name}</td>
                      <td>{employee?.full_name || employee?.code || '(không liên kết)'}</td>
                      <td>{userRoles.length === 0 ? '(không có)' : userRoles.map((r) => r.code).join(', ')}</td>
                      <td>
                        <span className={joinClasses(styles.badge, user.is_active ? styles.badgeActive : styles.badgeInactive)}>
                          {user.is_active ? 'Hoạt động' : 'Không hoạt động'}
                        </span>
                      </td>
                      <td className={styles.timestamp}>{formatDateTime(user.updated_at)}</td>
                      <td className={styles.actions}>
                        <button
                          className={styles.actionButton}
                          onClick={() => handleEditClick(user.id)}
                          disabled={busy !== null}
                        >
                          Sửa
                        </button>
                        <button
                          className={joinClasses(styles.actionButton, user.is_active ? styles.actionDanger : styles.actionSuccess)}
                          onClick={() => handleToggleClick(user.id)}
                          disabled={busy !== null}
                        >
                          {user.is_active ? 'Vô hiệu hóa' : 'Kích hoạt'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {editor && (
          <div className={styles.editor}>
            <div className={styles.editorContent}>
              <h2>{editor.mode === 'create' ? 'Tạo Người dùng' : 'Sửa Người dùng'}</h2>
              <div className={styles.editorForm}>
                <div className={styles.formGroup}>
                  <label>Tên đăng nhập</label>
                  <input
                    type="text"
                    value={draft.loginName}
                    onChange={(e) => handleDraftChange('loginName', e.currentTarget.value)}
                    disabled={editor.mode === 'edit' || busy !== null}
                    placeholder="ví dụ: john.doe"
                  />
                </div>

                {editor.mode === 'create' && (
                  <div className={styles.formGroup}>
                    <label>Nhân sự (Bắt buộc)</label>
                    <select
                      value={draft.employeeId}
                      onChange={(e) => handleDraftChange('employeeId', e.currentTarget.value)}
                      disabled={busy !== null}
                    >
                      <option value="">-- Chọn nhân sự --</option>
                      {employees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.full_name} ({emp.code})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {editor.mode === 'edit' && (
                  <div className={styles.formGroup}>
                    <label>Vai trò</label>
                    <div className={styles.checkboxGroup}>
                      {roles.map((role) => (
                        <label key={role.id} className={styles.checkboxLabel}>
                          <input
                            type="checkbox"
                            checked={draft.roleIds.includes(role.id)}
                            onChange={(e) => {
                              if (e.currentTarget.checked) {
                                handleDraftChange('roleIds', [...draft.roleIds, role.id]);
                              } else {
                                handleDraftChange('roleIds', draft.roleIds.filter((id) => id !== role.id));
                              }
                            }}
                            disabled={busy !== null}
                          />
                          {role.name} ({role.code})
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div className={styles.formActions}>
                  <button className={styles.primaryButton} onClick={handleSave} disabled={busy !== null}>
                    {busy === 'save' ? 'Đang lưu...' : 'Lưu'}
                  </button>
                  <button className={styles.secondaryButton} onClick={handleCancel} disabled={busy !== null}>
                    Hủy
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {toggleState && (
          <div className={styles.modal}>
            <div className={styles.modalContent}>
              <h3>Xác nhận</h3>
              <p>
                {toggleState.nextActive
                  ? 'Bạn chắc muốn kích hoạt người dùng này?'
                  : 'Bạn chắc muốn vô hiệu hóa người dùng này?'}
              </p>
              <div className={styles.modalActions}>
                <button className={styles.primaryButton} onClick={handleToggleConfirm} disabled={busy !== null}>
                  {busy === 'toggle' ? 'Đang xử lý...' : 'Xác nhận'}
                </button>
                <button className={styles.secondaryButton} onClick={handleToggleCancel} disabled={busy !== null}>
                  Hủy
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
