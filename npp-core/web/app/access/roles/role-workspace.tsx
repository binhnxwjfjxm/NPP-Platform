'use client';

import { useMemo, useRef, useState } from 'react';
import { createIdempotencyKey } from '@npp/contracts';
import { AppShell } from '../../components/app-shell';
import shellStyles from '../../components/app-shell.module.css';
import styles from '../../organization/organization.module.css';
import matrixStyles from './role-workspace.module.css';
import type { AccessPermission, AccessRole, AccessSnapshot } from '../../../lib/access-types';
import { formatCompactNumber, formatDateTime, matchTerm, normalizeSearch, toUpperCode } from '../../../lib/organization-types';
import { ROLE_PRESETS, resolveRolePresetPermissionKeys } from './role-presets';

type FilterState = 'all' | 'active' | 'inactive';
type EditorState = { mode: 'create' | 'edit'; roleId: string | null } | null;
type ToggleState = { roleId: string; nextActive: boolean } | null;

type RoleDraft = {
  code: string;
  name: string;
  description: string;
  isActive: boolean;
  webLoginChallengeRequired: boolean;
};

type Props = {
  initialRoles: AccessRole[];
  permissions: AccessPermission[];
  initialSnapshot: AccessSnapshot;
  initialError?: string | null;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean };
};

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function emptyDraft(): RoleDraft {
  return { code: '', name: '', description: '', isActive: true, webLoginChallengeRequired: false };
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
  const message = payload.error?.message || 'Không thực hiện được yêu cầu vai trò';
  if (!response.ok) throw new Error(message);
  if (payload.data === undefined) throw new Error(message);
  return payload.data;
}

function groupPermissions(permissions: AccessPermission[]) {
  const grouped = new Map<string, AccessPermission[]>();
  for (const permission of permissions) {
    const list = grouped.get(permission.module) ?? [];
    list.push(permission);
    grouped.set(permission.module, list);
  }
  return [...grouped.entries()].map(([module, items]) => ({
    module,
    items: items.sort((left, right) => left.permission_key.localeCompare(right.permission_key)),
  }));
}

const MODULE_LABELS: Record<string, string> = {
  organization: 'Tổ chức và kho hàng', access: 'Nhân sự và phân quyền', customers: 'Khách hàng', suppliers: 'Nhà cung cấp',
  products: 'Sản phẩm', pricing: 'Giá bán và khuyến mãi', inventory: 'Tồn kho và lô hàng', document_numbering: 'Số chứng từ',
  sales: 'Bán hàng', purchasing: 'Mua hàng', accounting: 'Kế toán', reporting: 'Báo cáo',
};

function moduleLabel(module: string) {
  return MODULE_LABELS[module] || module || 'Nhóm chức năng khác';
}

export default function RoleWorkspace({ initialRoles, permissions: initialPermissions, initialError = null }: Props) {
  const [roles, setRoles] = useState(initialRoles);
  const [permissions, setPermissions] = useState(initialPermissions);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterState>('all');
  const [editor, setEditor] = useState<EditorState>(null);
  const [toggleState, setToggleState] = useState<ToggleState>(null);
  const [draft, setDraft] = useState<RoleDraft>(emptyDraft());
  const [selectedPermissionKeys, setSelectedPermissionKeys] = useState<string[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const mutationKeys = useRef(new Map<string, string>());

  const normalizedSearch = normalizeSearch(search);
  const permissionGroups = useMemo(() => groupPermissions(permissions), [permissions]);
  const permissionMap = useMemo(() => new Map(permissions.map((permission) => [permission.permission_key, permission])), [permissions]);

  const visibleRoles = useMemo(() => roles
    .filter((role) => {
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? role.is_active : !role.is_active);
      const rolePermissionText = role.permission_keys.map((key) => permissionMap.get(key)?.label ?? key).join(' ');
      const challengeText = role.web_login_challenge_required ? 'đăng nhập cần mã xác nhận' : 'đăng nhập bằng mật khẩu';
      const matchesText = !normalizedSearch || matchTerm(role.code, role.name, role.description, rolePermissionText, challengeText).includes(normalizedSearch);
      return matchesStatus && matchesText;
    })
    .sort((left, right) => left.code.localeCompare(right.code)), [normalizedSearch, permissionMap, roles, statusFilter]);

  const counts = useMemo(() => {
    const active = roles.filter((role) => role.is_active).length;
    return { total: roles.length, active, inactive: roles.length - active, permissions: permissions.length };
  }, [permissions.length, roles]);

  function operationKey(scope: string) {
    const existing = mutationKeys.current.get(scope);
    if (existing) return existing;
    const next = createIdempotencyKey('role-mutation');
    mutationKeys.current.set(scope, next);
    return next;
  }

  async function loadAll(successMessage = 'Danh mục vai trò đã được cập nhật.') {
    setBusy('load');
    setError(null);
    setNotice(null);
    try {
      const [nextRoles, nextPermissions] = await Promise.all([
        (async () => {
          const allRoles: AccessRole[] = [];
          let offset = 0;
          while (true) {
            const page = await requestJson<AccessRole[]>(`/api/access/roles?limit=1000&offset=${offset}`);
            allRoles.push(...page);
            if (page.length < 1000) return allRoles;
            offset += page.length;
          }
        })(),
        requestJson<AccessPermission[]>('/api/access/permissions'),
      ]);
      setRoles(nextRoles);
      setPermissions(nextPermissions);
      setNotice(successMessage);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được danh mục vai trò');
    } finally {
      setBusy(null);
    }
  }

  function openCreate() {
    setError(null);
    setNotice(null);
    setDraft(emptyDraft());
    setSelectedPermissionKeys([]);
    setSelectedPresetId('');
    setEditor({ mode: 'create', roleId: null });
  }

  function openEdit(roleId: string) {
    const role = roles.find((item) => item.id === roleId);
    if (!role) return;
    setError(null);
    setNotice(null);
    setDraft({
      code: role.code,
      name: role.name,
      description: role.description ?? '',
      isActive: role.is_active,
      webLoginChallengeRequired: role.web_login_challenge_required,
    });
    setSelectedPermissionKeys([...role.permission_keys]);
    setSelectedPresetId('');
    setEditor({ mode: 'edit', roleId });
  }

  function applyPreset(presetId: string) {
    setSelectedPresetId(presetId);
    if (!presetId) return;
    setSelectedPermissionKeys(resolveRolePresetPermissionKeys(presetId, permissions));
  }

  function togglePermission(permissionKey: string) {
    setSelectedPermissionKeys((current) => current.includes(permissionKey)
      ? current.filter((item) => item !== permissionKey)
      : [...current, permissionKey]);
  }

  async function submitRole(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('save');
    setError(null);
    setNotice(null);
    const current = editor?.mode === 'edit' ? roles.find((role) => role.id === editor.roleId) : null;
    const payload = {
      ...(editor?.mode === 'create' ? { code: toUpperCode(draft.code) } : {}),
      name: draft.name.trim(),
      description: draft.description.trim(),
      isActive: draft.isActive,
      webLoginChallengeRequired: draft.webLoginChallengeRequired,
      permissionKeys: selectedPermissionKeys,
      ...(current ? { expectedUpdatedAt: current.updated_at } : {}),
    };
    const scope = `save|${current?.id ?? 'create'}|${JSON.stringify(payload)}`;
    try {
      const path = current ? `/api/access/roles/${current.id}` : '/api/access/roles';
      await requestJson<AccessRole>(path, {
        method: current ? 'PATCH' : 'POST',
        headers: { 'Idempotency-Key': operationKey(scope) },
        body: JSON.stringify(payload),
      });
      mutationKeys.current.delete(scope);
      setEditor(null);
      await loadAll(current ? 'Vai trò đã được cập nhật.' : 'Đã tạo vai trò mới.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không lưu được vai trò');
      setBusy(null);
    }
  }

  async function confirmToggle() {
    if (!toggleState) return;
    const role = roles.find((item) => item.id === toggleState.roleId);
    if (!role) return;
    setBusy('toggle');
    setError(null);
    setNotice(null);
    const payload = { isActive: toggleState.nextActive, expectedUpdatedAt: role.updated_at };
    const scope = `toggle|${role.id}|${JSON.stringify(payload)}`;
    try {
      await requestJson<AccessRole>(`/api/access/roles/${role.id}`, {
        method: 'PATCH',
        headers: { 'Idempotency-Key': operationKey(scope) },
        body: JSON.stringify(payload),
      });
      mutationKeys.current.delete(scope);
      setToggleState(null);
      await loadAll(toggleState.nextActive ? 'Vai trò đã được đưa vào sử dụng.' : 'Vai trò đã ngừng sử dụng.');
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Không cập nhật được trạng thái vai trò');
      setBusy(null);
    }
  }

  const shellActions = (
    <>
      <button type="button" className={shellStyles.actionButton} onClick={() => void loadAll()} disabled={busy !== null}>
        {busy === 'load' ? 'Đang cập nhật…' : 'Cập nhật dữ liệu'}
      </button>
      <button type="button" className={joinClasses(shellStyles.actionButton, shellStyles.actionButtonPrimary)} onClick={openCreate} data-testid="roles-topbar-create-button">
        Thêm vai trò
      </button>
    </>
  );

  return (
    <AppShell title="Vai trò và phân quyền" subtitle="Quản lý vai trò, trạng thái sử dụng và phạm vi quyền theo công việc." kicker="Phân quyền" actions={shellActions}>
      <section className={styles.page} data-testid="roles-page">
        {(error || notice) ? <div className={joinClasses(styles.banner, error ? styles.bannerError : styles.bannerSuccess)} role="status">{error ?? notice}</div> : null}

        <section className={styles.summaryGrid} aria-label="Số liệu vai trò">
          <article className={styles.summaryCard}><span>Tổng vai trò</span><strong>{formatCompactNumber(counts.total)}</strong><small>Toàn bộ vai trò đang được quản lý</small></article>
          <article className={styles.summaryCard}><span>Đang sử dụng</span><strong>{formatCompactNumber(counts.active)}</strong><small>{counts.inactive} vai trò đã ngừng sử dụng</small></article>
          <article className={styles.summaryCard}><span>Danh mục quyền</span><strong>{formatCompactNumber(counts.permissions)}</strong><small>Danh mục quyền có thể phân công cho vai trò</small></article>
        </section>

        <section className={styles.toolbar}>
          <div className={styles.toolbarSearch}>
            <label htmlFor="roles-search">Tìm kiếm vai trò</label>
            <input id="roles-search" data-testid="roles-search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ví dụ: Bán hàng, kế toán, duyệt đơn" />
          </div>
          <div className={styles.toolbarFilter}>
            <label htmlFor="roles-status">Trạng thái</label>
            <select id="roles-status" data-testid="roles-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as FilterState)}>
              <option value="all">Tất cả trạng thái</option><option value="active">Đang sử dụng</option><option value="inactive">Ngừng sử dụng</option>
            </select>
          </div>
        </section>

        <section className={styles.tableSection}>
          <div className={styles.sectionHeader}><div><p className={styles.panelKicker}>Danh mục vai trò</p><h2>Vai trò và tập quyền</h2></div><span className={styles.panelChip}>{formatCompactNumber(visibleRoles.length)} vai trò</span></div>
          <div className={styles.tableWrap}>
            <table className={styles.table} data-testid="role-table">
              <thead><tr><th>Mã vai trò</th><th>Tên vai trò</th><th>Quyền</th><th>Trạng thái</th><th>Cập nhật</th><th>Thao tác</th></tr></thead>
              <tbody>
                {visibleRoles.length ? visibleRoles.map((role) => (
                  <tr key={role.id} data-testid={`role-row-${role.code}`}>
                    <td><code>{role.code}</code></td>
                    <td><div className={styles.entityStack}><strong>{role.name}</strong><span>{role.description || 'Không có mô tả'}</span><span>{role.web_login_challenge_required ? 'Đăng nhập trên web/ứng dụng: cần mã xác nhận' : 'Đăng nhập trên web/ứng dụng: dùng mật khẩu'}</span></div></td>
                    <td className={styles.relationCell}><div className={styles.entityStack}><strong>{formatCompactNumber(role.permission_keys.length)} quyền</strong><span>{role.permission_keys.length ? `${role.permission_keys.slice(0, 2).map((key) => permissionMap.get(key)?.label ?? key).join(' · ')}${role.permission_keys.length > 2 ? ` · +${formatCompactNumber(role.permission_keys.length - 2)} quyền khác` : ''}` : 'Chưa gán quyền'}</span></div></td>
                    <td><span className={joinClasses(styles.statusPill, role.is_active ? styles.toneSuccess : styles.toneDanger)}>{role.is_active ? 'Đang sử dụng' : 'Ngừng sử dụng'}</span></td>
                    <td>{formatDateTime(role.updated_at)}</td>
                    <td><div className={styles.rowActions}>
                      <button type="button" data-testid={`edit-role-${role.code}`} onClick={() => openEdit(role.id)}>Chỉnh sửa</button>
                      <button type="button" data-testid={`toggle-role-${role.code}`} onClick={() => setToggleState({ roleId: role.id, nextActive: !role.is_active })}>{role.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}</button>
                    </div></td>
                  </tr>
                )) : <tr><td colSpan={6}><div className={styles.emptyState}>Không tìm thấy vai trò phù hợp.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        {editor ? (
          <div className={styles.modalBackdrop} role="presentation" onClick={() => setEditor(null)}>
            <div className={joinClasses(styles.modal, matrixStyles.editorModal)} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <div className={styles.modalHeader}><div><p className={styles.panelKicker}>{editor.mode === 'create' ? 'Vai trò mới' : 'Cập nhật vai trò'}</p><h3>{editor.mode === 'create' ? 'Thêm vai trò quản trị' : 'Chỉnh sửa vai trò quản trị'}</h3></div><button type="button" className={styles.modalClose} onClick={() => setEditor(null)}>Đóng</button></div>
              <form className={styles.form} onSubmit={(event) => void submitRole(event)}>
                <div className={matrixStyles.editorLayout}>
                  <div className={matrixStyles.editorColumn}>
                    {editor.mode === 'create' ? (
                      <div className={matrixStyles.presetPanel}>
                        <label htmlFor="role-preset">Mẫu quyền gợi ý</label>
                        <select id="role-preset" data-testid="role-preset-select" value={selectedPresetId} onChange={(event) => applyPreset(event.target.value)}>
                          <option value="">Không dùng mẫu — tự chọn quyền</option>
                          {ROLE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                        </select>
                        <p>{selectedPresetId ? ROLE_PRESETS.find((preset) => preset.id === selectedPresetId)?.description : 'Mẫu chỉ tích sẵn quyền để tham khảo. Anh/chị vẫn thêm hoặc bỏ từng quyền trước khi lưu và tự đặt tên vai trò.'}</p>
                      </div>
                    ) : null}
                    <label>Mã vai trò<input data-testid="role-code-input" value={draft.code} onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value }))} disabled={editor.mode === 'edit'} required maxLength={64} /></label>
                    <label>Tên vai trò<input data-testid="role-name-input" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} required maxLength={256} /></label>
                    <label>Mô tả<textarea data-testid="role-description-input" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} maxLength={512} rows={5} /></label>
                    <label className={matrixStyles.inlineToggle}><input data-testid="role-active-toggle" type="checkbox" checked={draft.isActive} onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))} />Đang sử dụng</label>
                    <label className={matrixStyles.inlineToggle}><input data-testid="role-web-login-challenge-toggle" type="checkbox" checked={draft.webLoginChallengeRequired} onChange={(event) => setDraft((current) => ({ ...current, webLoginChallengeRequired: event.target.checked }))} />Yêu cầu mã xác nhận khi đăng nhập trên web/ứng dụng</label>
                    <p>Mã xác nhận chỉ gửi tới các tài khoản quản trị bảo mật đã cấu hình. Vai trò giao nhận hoặc nhân viên thị trường có thể để tắt; vai trò kế toán hoặc có quyền nhạy cảm có thể bật.</p>
                    <div className={styles.formActions}><button type="button" className={styles.secondaryButton} onClick={() => setEditor(null)}>Hủy</button><button type="submit" className={styles.primaryButton} disabled={busy !== null}>{busy === 'save' ? 'Đang lưu…' : editor.mode === 'create' ? 'Tạo vai trò' : 'Lưu thay đổi'}</button></div>
                  </div>

                  <div className={matrixStyles.permissionColumn}>
                    <div className={styles.sectionHeader} style={{ marginBottom: 0 }}><div><p className={styles.panelKicker}>Phạm vi quyền</p><h2>Chọn quyền theo nhóm chức năng</h2></div><span className={styles.panelChip}>{formatCompactNumber(selectedPermissionKeys.length)} quyền đã chọn</span></div>
                    <div className={matrixStyles.permissionList}>
                      {permissionGroups.length ? permissionGroups.map((group) => (
                        <div className={matrixStyles.permissionGroup} key={group.module}>
                          <div className={matrixStyles.permissionGroupHeader}><strong>{moduleLabel(group.module)}</strong><span className={matrixStyles.permissionGroupCount}>{formatCompactNumber(group.items.length)} quyền</span></div>
                          {group.items.map((permission) => (
                            <div className={matrixStyles.permissionItem} key={permission.permission_key}>
                              <label><input type="checkbox" checked={selectedPermissionKeys.includes(permission.permission_key)} onChange={() => togglePermission(permission.permission_key)} data-testid={`permission-${permission.permission_key}`} /><span>{permission.label}</span></label>
                            </div>
                          ))}
                        </div>
                      )) : <div className={matrixStyles.permissionEmpty}>Danh mục quyền đang trống.</div>}
                    </div>
                  </div>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {toggleState ? (
          <div className={styles.modalBackdrop} role="presentation" onClick={() => setToggleState(null)}>
            <div className={joinClasses(styles.modal, styles.confirmModal)} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <div className={styles.modalHeader}><div><p className={styles.panelKicker}>Xác nhận trạng thái</p><h3>{toggleState.nextActive ? 'Đưa vai trò vào sử dụng' : 'Ngừng sử dụng vai trò'}</h3></div></div>
              <p className={styles.confirmText}>{toggleState.nextActive ? 'Vai trò sẽ trở lại trạng thái đang sử dụng.' : 'Vai trò sẽ ngừng sử dụng nhưng vẫn được giữ lại để đối soát và lịch sử chứng từ.'}</p>
              <div className={styles.formActions}><button type="button" className={styles.secondaryButton} onClick={() => setToggleState(null)}>Hủy</button><button type="button" className={styles.primaryButton} onClick={() => void confirmToggle()} disabled={busy !== null}>Xác nhận</button></div>
            </div>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}