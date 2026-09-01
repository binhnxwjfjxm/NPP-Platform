'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useMemo, useState } from 'react';
import { AppShell } from '../../../components/app-shell';
import type { AccessUser } from '../../../../lib/access-types';
import type { Branch, Warehouse } from '../../../../lib/organization-types';
import styles from './user-scope-workspace.module.css';

type Props = {
  initialUsers: AccessUser[];
  initialBranches: Branch[];
  initialWarehouses: Warehouse[];
  initialError?: string | null;
};

type ScopeResponse = {
  userId: string;
  scopes: { branchIds: string[]; warehouseIds: string[]; territoryIds: string[] };
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean };
};

const IDEMPOTENCY_INTENT_CACHE_LIMIT = 256;
const scopeKeys = new Map<string, string>();

function sortedIds(ids: string[]) {
  return [...new Set(ids)].sort();
}

function scopeKeyFor(userId: string, payload: unknown) {
  const intent = `replace-scopes:${userId}:${JSON.stringify(payload)}`;
  const existing = scopeKeys.get(intent);
  if (existing) return existing;
  const key = createIdempotencyKey('access-user-scopes');
  if (scopeKeys.size >= IDEMPOTENCY_INTENT_CACHE_LIMIT) {
    const oldest = scopeKeys.keys().next().value;
    if (oldest) scopeKeys.delete(oldest);
  }
  scopeKeys.set(intent, key);
  return key;
}

export default function UserScopeWorkspace({
  initialUsers,
  initialBranches,
  initialWarehouses,
  initialError = null,
}: Props) {
  const [users, setUsers] = useState(initialUsers);
  const [selectedUserId, setSelectedUserId] = useState(initialUsers[0]?.id ?? '');
  const [draftBranchIds, setDraftBranchIds] = useState<string[]>(initialUsers[0]?.branch_ids ?? []);
  const [draftWarehouseIds, setDraftWarehouseIds] = useState<string[]>(initialUsers[0]?.warehouse_ids ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const selectedUser = users.find((user) => user.id === selectedUserId) ?? null;
  const branchMap = useMemo(() => new Map(initialBranches.map((branch) => [branch.id, branch])), [initialBranches]);
  const warehouseMap = useMemo(() => new Map(initialWarehouses.map((warehouse) => [warehouse.id, warehouse])), [initialWarehouses]);
  const visibleUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users
      .filter((user) => !term || [user.login_name, user.employee_code ?? '', user.employee_full_name ?? '']
        .join(' ')
        .toLowerCase()
        .includes(term))
      .sort((left, right) => left.login_name.localeCompare(right.login_name));
  }, [search, users]);

  const branches = useMemo(() => [...initialBranches].sort((a, b) => a.code.localeCompare(b.code)), [initialBranches]);
  const warehouses = useMemo(() => [...initialWarehouses].sort((a, b) => {
    const branchCompare = (branchMap.get(a.branch_id)?.code ?? '').localeCompare(branchMap.get(b.branch_id)?.code ?? '');
    return branchCompare || a.code.localeCompare(b.code);
  }), [branchMap, initialWarehouses]);

  function selectUser(userId: string) {
    const user = users.find((item) => item.id === userId) ?? null;
    setSelectedUserId(userId);
    setDraftBranchIds(user?.branch_ids ?? []);
    setDraftWarehouseIds(user?.warehouse_ids ?? []);
    setError(null);
    setNotice(null);
  }

  function toggleBranch(branchId: string) {
    if (selectedUser?.owner_kind) return;
    setDraftBranchIds((current) => {
      if (current.includes(branchId)) {
        setDraftWarehouseIds((warehouseIds) => warehouseIds.filter((warehouseId) => warehouseMap.get(warehouseId)?.branch_id !== branchId));
        return current.filter((id) => id !== branchId);
      }
      return [...current, branchId];
    });
  }

  function toggleWarehouse(warehouse: Warehouse) {
    if (selectedUser?.owner_kind) return;
    setDraftWarehouseIds((current) => current.includes(warehouse.id)
      ? current.filter((id) => id !== warehouse.id)
      : [...current, warehouse.id]);
    setDraftBranchIds((current) => current.includes(warehouse.branch_id) ? current : [...current, warehouse.branch_id]);
  }

  async function saveScopes() {
    if (!selectedUser || selectedUser.owner_kind) return;
    const payload = {
      scopes: {
        branchIds: sortedIds(draftBranchIds),
        warehouseIds: sortedIds(draftWarehouseIds),
        territoryIds: [],
      },
    };
    const idempotencyKey = scopeKeyFor(selectedUser.id, payload);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/access/users/${selectedUser.id}/scopes`, {
        method: 'PUT',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(payload),
      });
      const envelope = await response.json().catch(() => null) as ApiEnvelope<ScopeResponse> | null;
      if (!response.ok || !envelope?.data) {
        throw new Error(envelope?.error?.message || 'Không cập nhật được phạm vi người dùng');
      }
      const saved = envelope.data.scopes;
      setUsers((current) => current.map((user) => user.id === selectedUser.id
        ? { ...user, branch_ids: saved.branchIds, warehouse_ids: saved.warehouseIds }
        : user));
      setDraftBranchIds(saved.branchIds);
      setDraftWarehouseIds(saved.warehouseIds);
      setNotice(saved.warehouseIds.length === 0
        ? 'Đã lưu phạm vi trống. Tài khoản này sẽ không thấy chứng từ theo kho cho tới khi được cấp lại.'
        : `Đã cấp ${saved.warehouseIds.length} kho cho ${selectedUser.login_name}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không cập nhật được phạm vi người dùng');
    } finally {
      setBusy(false);
    }
  }

  const ownerFullScope = Boolean(selectedUser?.owner_kind);
  const effectiveWarehouseCount = ownerFullScope ? warehouses.length : draftWarehouseIds.length;

  return (
    <AppShell
      title="Phạm vi chi nhánh & kho"
      subtitle="Cấp chi nhánh và kho cho từng tài khoản. Tài khoản quản trị cấp cao tự có phạm vi toàn Công Ty."
    >
      <main className={styles.page}>
        <header className={styles.header}>
          <div>
            <p className={styles.kicker}>Nhân sự &amp; phân quyền</p>
            <h1>Phạm vi chi nhánh &amp; kho</h1>
            <p>Đơn mua hàng, Phiếu nhận hàng và các dữ liệu theo kho chỉ hiển thị trong phạm vi được cấp.</p>
          </div>
        </header>

        {error && <div className={styles.error} role="alert">{error}</div>}
        {notice && <div className={styles.notice} role="status">{notice}</div>}

        <section className={styles.layout}>
          <aside className={styles.userPanel}>
            <label className={styles.searchLabel}>Tìm tài khoản
              <input type="search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Tên đăng nhập hoặc nhân sự" />
            </label>
            <div className={styles.userList}>
              {visibleUsers.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  className={user.id === selectedUserId ? styles.userActive : styles.userButton}
                  onClick={() => selectUser(user.id)}
                >
                  <strong>{user.employee_full_name ?? user.login_name}</strong>
                  <span>{user.login_name}{user.employee_code ? ` · ${user.employee_code}` : ''}</span>
                  <small>{user.owner_kind ? 'Toàn Công Ty' : `${user.warehouse_ids.length} kho`}</small>
                </button>
              ))}
            </div>
          </aside>

          <section className={styles.scopePanel}>
            {!selectedUser ? <div className={styles.empty}>Chọn một người dùng để quản lý phạm vi.</div> : <>
              <div className={styles.scopeHeader}>
                <div>
                  <span className={styles.label}>Tài khoản</span>
                  <h2>{selectedUser.employee_full_name ?? selectedUser.login_name}</h2>
                  <p>{selectedUser.login_name}</p>
                </div>
                <div className={styles.scopeCount}><strong>{effectiveWarehouseCount}</strong><span>kho hiệu lực</span></div>
              </div>

              {ownerFullScope ? (
                <div className={styles.ownerNotice}>
                  <strong>Tài khoản quản trị — toàn Công Ty</strong>
                  <p>Phạm vi được hệ thống tự áp dụng cho toàn bộ chi nhánh và kho, gồm dữ liệu lịch sử. Không cần cấp tay tại đây.</p>
                </div>
              ) : (
                <>
                  <div className={styles.warning}>
                    {draftWarehouseIds.length === 0
                      ? 'Chưa cấp kho: tài khoản sẽ không thấy Đơn mua hàng, Phiếu nhận hàng và dữ liệu theo kho.'
                      : 'Chỉ các kho được chọn bên dưới mới xuất hiện trong dữ liệu nghiệp vụ của tài khoản này.'}
                  </div>

                  <section className={styles.block}>
                    <div className={styles.blockTitle}><h3>Chi nhánh</h3><span>{draftBranchIds.length}/{branches.length}</span></div>
                    <div className={styles.options}>
                      {branches.map((branch) => (
                        <label key={branch.id} className={styles.option}>
                          <input type="checkbox" checked={draftBranchIds.includes(branch.id)} onChange={() => toggleBranch(branch.id)} disabled={busy} />
                          <span><strong>{branch.name}</strong><small>{branch.code}{branch.is_active ? '' : ' · ngừng sử dụng / lịch sử'}</small></span>
                        </label>
                      ))}
                    </div>
                  </section>

                  <section className={styles.block}>
                    <div className={styles.blockTitle}><h3>Kho hàng</h3><span>{draftWarehouseIds.length}/{warehouses.length}</span></div>
                    <div className={styles.options}>
                      {warehouses.map((warehouse) => {
                        const branch = branchMap.get(warehouse.branch_id);
                        return (
                          <label key={warehouse.id} className={styles.option}>
                            <input type="checkbox" checked={draftWarehouseIds.includes(warehouse.id)} onChange={() => toggleWarehouse(warehouse)} disabled={busy} />
                            <span><strong>{warehouse.name}</strong><small>{warehouse.code} · {branch?.name ?? 'Không rõ chi nhánh'}{warehouse.is_active ? '' : ' · ngừng sử dụng / lịch sử'}</small></span>
                          </label>
                        );
                      })}
                    </div>
                  </section>

                  <footer className={styles.footer}>
                    <button className={styles.saveButton} type="button" onClick={saveScopes} disabled={busy}>
                      {busy ? 'Đang lưu…' : 'Lưu phạm vi'}
                    </button>
                  </footer>
                </>
              )}
            </>}
          </section>
        </section>
      </main>
    </AppShell>
  );
}
