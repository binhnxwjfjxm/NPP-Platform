'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/app-shell';
import shellStyles from '../components/app-shell.module.css';
import styles from './organization.module.css';
import type {
  Branch,
  OrganizationResourceKey,
  OrganizationSnapshot,
  Warehouse,
  WarehouseLocation,
} from '../../lib/organization-types';
import {
  formatCompactNumber,
  formatDateTime,
  locationTypes,
  matchTerm,
  normalizeSearch,
  toUpperCode,
  warehouseTypes,
} from '../../lib/organization-types';

type WorkspaceScope = 'overview' | OrganizationResourceKey;
type FilterState = 'all' | 'active' | 'inactive';

type BranchFormState = {
  code: string;
  name: string;
  address: string;
  phone: string;
  email: string;
};

type WarehouseFormState = {
  branchId: string;
  code: string;
  name: string;
  warehouseType: string;
};

type LocationFormState = {
  warehouseId: string;
  code: string;
  name: string;
  locationType: string;
};

type EditorState =
  | { resource: 'branches'; mode: 'create' | 'edit'; entityId: string | null }
  | { resource: 'warehouses'; mode: 'create' | 'edit'; entityId: string | null }
  | { resource: 'locations'; mode: 'create' | 'edit'; entityId: string | null }
  | null;

type ToggleState =
  | { resource: 'branches'; entityId: string; nextActive: boolean }
  | { resource: 'warehouses'; entityId: string; nextActive: boolean }
  | { resource: 'locations'; entityId: string; nextActive: boolean }
  | null;

type ApiEnvelope<T> = {
  data?: T;
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
  };
  requestId?: string;
};

type OrganizationWorkspaceProps = {
  scope: WorkspaceScope;
  title: string;
  subtitle: string;
  initialData: OrganizationSnapshot;
  initialError?: string | null;
};

const warehouseTypeLabels: Record<string, string> = {
  main: 'Kho chính',
  distribution: 'Kho phân phối',
  vehicle: 'Kho xe',
  quarantine: 'Kho cách ly',
  returns: 'Kho hàng trả',
  transit: 'Kho trung chuyển',
  other: 'Loại khác',
};

const locationTypeLabels: Record<string, string> = {
  storage: 'Khu lưu trữ',
  receiving: 'Khu nhận hàng',
  shipping: 'Khu xuất hàng',
  quarantine: 'Khu cách ly',
  returns: 'Khu hàng trả',
  damaged: 'Khu hư hỏng',
  other: 'Loại khác',
};

function apiResource(resource: Exclude<OrganizationResourceKey, 'branches'> | 'branches'): string {
  if (resource === 'locations') return 'warehouse-locations';
  return resource;
}

function joinClasses(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function upper(value: string): string {
  return toUpperCode(value);
}

function entityStatusLabel(active: boolean): string {
  return active ? 'Đang hoạt động' : 'Ngừng hoạt động';
}

function entityStatusTone(active: boolean): 'success' | 'danger' {
  return active ? 'success' : 'danger';
}

function typeLabel(resource: Exclude<OrganizationResourceKey, 'branches'>, value: string): string {
  if (resource === 'warehouses') return warehouseTypeLabels[value] ?? 'Loại khác';
  return locationTypeLabels[value] ?? 'Loại khác';
}

function statusClass(active: boolean): string {
  return active ? styles.toneSuccess : styles.toneDanger;
}

function entitySearchText(
  scope: WorkspaceScope,
  branch: Branch | Warehouse | WarehouseLocation,
  branchMap: Map<string, Branch>,
  warehouseMap: Map<string, Warehouse>,
): string {
  const relationText = scope === 'branches'
    ? matchTerm((branch as Branch).address, (branch as Branch).phone, (branch as Branch).email)
    : scope === 'warehouses'
      ? matchTerm(branchMap.get((branch as Warehouse).branch_id)?.code, branchMap.get((branch as Warehouse).branch_id)?.name, (branch as Warehouse).warehouse_type)
      : matchTerm(
        branchMap.get(warehouseMap.get((branch as WarehouseLocation).warehouse_id)?.branch_id ?? '')?.code,
        branchMap.get(warehouseMap.get((branch as WarehouseLocation).warehouse_id)?.branch_id ?? '')?.name,
        warehouseMap.get((branch as WarehouseLocation).warehouse_id)?.code,
        warehouseMap.get((branch as WarehouseLocation).warehouse_id)?.name,
        (branch as WarehouseLocation).location_type,
      );

  return matchTerm(branch.code, branch.name, relationText);
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
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message || 'Không thể kết nối dịch vụ dữ liệu. Vui lòng thử lại.');
  }

  return payload.data;
}

function emptyBranchForm(): BranchFormState {
  return { code: '', name: '', address: '', phone: '', email: '' };
}

function emptyWarehouseForm(branchId = '', warehouseType = warehouseTypes[0]): WarehouseFormState {
  return { branchId, code: '', name: '', warehouseType };
}

function emptyLocationForm(warehouseId = '', locationType = locationTypes[0]): LocationFormState {
  return { warehouseId, code: '', name: '', locationType };
}

function initialNotice(message: string, kind: 'success' | 'error' = 'success') {
  return { message, kind };
}

export default function OrganizationWorkspace({ scope, title, subtitle, initialData, initialError = null }: OrganizationWorkspaceProps) {
  const [branches, setBranches] = useState<Branch[]>(initialData.branches);
  const [warehouses, setWarehouses] = useState<Warehouse[]>(initialData.warehouses);
  const [locations, setLocations] = useState<WarehouseLocation[]>(initialData.locations);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<{ message: string; kind: 'success' | 'error' } | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterState>('all');
  const [editor, setEditor] = useState<EditorState>(null);
  const [branchDraft, setBranchDraft] = useState<BranchFormState>(emptyBranchForm());
  const [warehouseDraft, setWarehouseDraft] = useState<WarehouseFormState>(emptyWarehouseForm());
  const [locationDraft, setLocationDraft] = useState<LocationFormState>(emptyLocationForm());
  const [toggleState, setToggleState] = useState<ToggleState>(null);

  const branchMap = useMemo(() => new Map(branches.map((branch) => [branch.id, branch])), [branches]);
  const warehouseMap = useMemo(() => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse])), [warehouses]);
  const normalizedSearch = normalizeSearch(search);

  const counts = useMemo(() => {
    const activeBranches = branches.filter((branch) => branch.is_active).length;
    const activeWarehouses = warehouses.filter((warehouse) => warehouse.is_active).length;
    const activeLocations = locations.filter((location) => location.is_active).length;
    return {
      branches: { total: branches.length, active: activeBranches, inactive: branches.length - activeBranches },
      warehouses: { total: warehouses.length, active: activeWarehouses, inactive: warehouses.length - activeWarehouses },
      locations: { total: locations.length, active: activeLocations, inactive: locations.length - activeLocations },
    };
  }, [branches, warehouses, locations]);

  const activeBranches = useMemo(() => branches.filter((branch) => branch.is_active), [branches]);
  const activeWarehouses = useMemo(() => warehouses.filter((warehouse) => warehouse.is_active), [warehouses]);

  const visibleBranches = useMemo(() => {
    const filtered = branches.filter((branch) => {
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? branch.is_active : !branch.is_active);
      const matchesText = !normalizedSearch || matchTerm(branch.code, branch.name, branch.address, branch.phone, branch.email).includes(normalizedSearch);
      return matchesStatus && matchesText;
    });
    return filtered.sort((left, right) => left.code.localeCompare(right.code));
  }, [branches, normalizedSearch, statusFilter]);

  const visibleWarehouses = useMemo(() => {
    const filtered = warehouses.filter((warehouse) => {
      const branch = branchMap.get(warehouse.branch_id);
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? warehouse.is_active : !warehouse.is_active);
      const matchesText = !normalizedSearch || matchTerm(
        warehouse.code,
        warehouse.name,
        warehouse.warehouse_type,
        branch?.code,
        branch?.name,
      ).includes(normalizedSearch);
      return matchesStatus && matchesText;
    });
    return filtered.sort((left, right) => left.code.localeCompare(right.code));
  }, [branchMap, normalizedSearch, statusFilter, warehouses]);

  const visibleLocations = useMemo(() => {
    const filtered = locations.filter((location) => {
      const warehouse = warehouseMap.get(location.warehouse_id);
      const branch = warehouse ? branchMap.get(warehouse.branch_id) : null;
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? location.is_active : !location.is_active);
      const matchesText = !normalizedSearch || matchTerm(
        location.code,
        location.name,
        location.location_type,
        warehouse?.code,
        warehouse?.name,
        branch?.code,
        branch?.name,
      ).includes(normalizedSearch);
      return matchesStatus && matchesText;
    });
    return filtered.sort((left, right) => left.code.localeCompare(right.code));
  }, [branchMap, normalizedSearch, statusFilter, warehouseMap, locations]);

  const overviewItems = useMemo(() => {
    const items = [
      ...branches.map((branch) => ({
        scope: 'branches' as const,
        code: branch.code,
        name: branch.name,
        relation: branch.address || branch.email || 'Không có thông tin liên hệ',
        updated_at: branch.updated_at,
        is_active: branch.is_active,
      })),
      ...warehouses.map((warehouse) => {
        const branch = branchMap.get(warehouse.branch_id);
        return {
          scope: 'warehouses' as const,
          code: warehouse.code,
          name: warehouse.name,
          relation: branch ? `${branch.code} · ${branch.name}` : 'Chưa xác định chi nhánh',
          updated_at: warehouse.updated_at,
          is_active: warehouse.is_active,
        };
      }),
      ...locations.map((location) => {
        const warehouse = warehouseMap.get(location.warehouse_id);
        const branch = warehouse ? branchMap.get(warehouse.branch_id) : null;
        return {
          scope: 'locations' as const,
          code: location.code,
          name: location.name,
          relation: [branch?.code, warehouse?.code, typeLabel('locations', location.location_type)].filter(Boolean).join(' · '),
          updated_at: location.updated_at,
          is_active: location.is_active,
        };
      }),
    ];

    return items.sort((left, right) => right.updated_at.localeCompare(left.updated_at)).slice(0, 8);
  }, [branchMap, branches, locations, warehouseMap, warehouses]);

  const hierarchyOverview = useMemo(() => {
    return branches.map((branch) => {
      const branchWarehouses = warehouses.filter((warehouse) => warehouse.branch_id === branch.id);
      const branchLocations = locations.filter((location) => branchWarehouses.some((warehouse) => warehouse.id === location.warehouse_id));
      return {
        branch,
        warehouseCount: branchWarehouses.length,
        locationCount: branchLocations.length,
        activeWarehouseCount: branchWarehouses.filter((warehouse) => warehouse.is_active).length,
      };
    });
  }, [branches, locations, warehouses]);

  useEffect(() => {
    setLoading(false);
  }, [scope]);

  async function loadAll() {
    setBusy('load');
    setLoading(true);
    setError(null);

    try {
      const [nextBranches, nextWarehouses, nextLocations] = await Promise.all([
        requestJson<Branch[]>('/api/organization/branches?limit=1000'),
        requestJson<Warehouse[]>('/api/organization/warehouses?limit=1000'),
        requestJson<WarehouseLocation[]>('/api/organization/warehouse-locations?limit=1000'),
      ]);

      setBranches(nextBranches);
      setWarehouses(nextWarehouses);
      setLocations(nextLocations);
      setNotice(initialNotice('Dữ liệu đã được cập nhật.'));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được dữ liệu tổ chức');
    } finally {
      setBusy(null);
      setLoading(false);
    }
  }

  function openCreate(resource: Exclude<OrganizationResourceKey, 'overview'>) {
    setError(null);
    setNotice(null);

    if (resource === 'branches') setBranchDraft(emptyBranchForm());
    if (resource === 'warehouses') setWarehouseDraft(emptyWarehouseForm(activeBranches[0]?.id ?? branches[0]?.id ?? '', warehouseTypes[0]));
    if (resource === 'locations') setLocationDraft(emptyLocationForm(activeWarehouses[0]?.id ?? warehouses[0]?.id ?? '', locationTypes[0]));

    setEditor({ resource, mode: 'create', entityId: null });
  }

  function openEdit(resource: Exclude<OrganizationResourceKey, 'overview'>, entityId: string) {
    setError(null);
    setNotice(null);

    if (resource === 'branches') {
      const entity = branches.find((item) => item.id === entityId);
      if (!entity) return;
      setBranchDraft({
        code: entity.code,
        name: entity.name,
        address: entity.address ?? '',
        phone: entity.phone ?? '',
        email: entity.email ?? '',
      });
    }

    if (resource === 'warehouses') {
      const entity = warehouses.find((item) => item.id === entityId);
      if (!entity) return;
      setWarehouseDraft({
        branchId: entity.branch_id,
        code: entity.code,
        name: entity.name,
        warehouseType: entity.warehouse_type,
      });
    }

    if (resource === 'locations') {
      const entity = locations.find((item) => item.id === entityId);
      if (!entity) return;
      setLocationDraft({
        warehouseId: entity.warehouse_id,
        code: entity.code,
        name: entity.name,
        locationType: entity.location_type,
      });
    }

    setEditor({ resource, mode: 'edit', entityId });
  }

  function openToggle(resource: Exclude<OrganizationResourceKey, 'overview'>, entityId: string, nextActive: boolean) {
    setError(null);
    setNotice(null);
    setToggleState({ resource, entityId, nextActive });
  }

  function closeModals() {
    setEditor(null);
    setToggleState(null);
  }

  async function submitBranch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = upper(branchDraft.code);
    const payload = {
      code,
      name: branchDraft.name.trim(),
      address: branchDraft.address.trim(),
      phone: branchDraft.phone.trim(),
      email: branchDraft.email.trim(),
    };

    const current = editor?.mode === 'edit' && editor.resource === 'branches'
      ? branches.find((item) => item.id === editor.entityId)
      : null;
    const path = editor?.mode === 'edit' && current ? `/api/organization/branches/${current.id}` : '/api/organization/branches';

    await runMutation('branch', path, editor?.mode ?? 'create', payload, current?.updated_at);
  }

  async function submitWarehouse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      branchId: warehouseDraft.branchId,
      code: upper(warehouseDraft.code),
      name: warehouseDraft.name.trim(),
      warehouseType: warehouseDraft.warehouseType,
    };
    const current = editor?.mode === 'edit' && editor.resource === 'warehouses'
      ? warehouses.find((item) => item.id === editor.entityId)
      : null;
    const path = editor?.mode === 'edit' && current ? `/api/organization/warehouses/${current.id}` : '/api/organization/warehouses';

    await runMutation('warehouse', path, editor?.mode ?? 'create', payload, current?.updated_at);
  }

  async function submitLocation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      warehouseId: locationDraft.warehouseId,
      code: upper(locationDraft.code),
      name: locationDraft.name.trim(),
      locationType: locationDraft.locationType,
    };
    const current = editor?.mode === 'edit' && editor.resource === 'locations'
      ? locations.find((item) => item.id === editor.entityId)
      : null;
    const path = editor?.mode === 'edit' && current ? `/api/organization/warehouse-locations/${current.id}` : '/api/organization/warehouse-locations';

    await runMutation('location', path, editor?.mode ?? 'create', payload, current?.updated_at);
  }

  async function runMutation(
    resourceLabel: 'branch' | 'warehouse' | 'location',
    path: string,
    mode: 'create' | 'edit',
    payload: Record<string, unknown>,
    expectedUpdatedAt?: string,
  ) {
    setBusy(`${mode}-${resourceLabel}`);
    setError(null);
    setNotice(null);

    try {
      const options: RequestInit = {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: mode === 'create'
          ? { 'Idempotency-Key': `web-${crypto.randomUUID()}` }
          : undefined,
        body: JSON.stringify(mode === 'create'
          ? payload
          : { ...payload, expectedUpdatedAt }),
      };

      await requestJson(path, options);
      await loadAll();
      setEditor(null);
      setNotice(initialNotice(mode === 'create' ? 'Đã tạo mới thành công.' : 'Đã cập nhật thành công.'));
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'Không lưu được dữ liệu');
    } finally {
      setBusy(null);
    }
  }

  async function confirmToggle() {
    if (!toggleState) return;
    const { resource, entityId, nextActive } = toggleState;
    const route = resource === 'locations'
      ? `/api/organization/warehouse-locations/${entityId}`
      : `/api/organization/${resource}/${entityId}`;

    const source = resource === 'branches'
      ? branches.find((item) => item.id === entityId)
      : resource === 'warehouses'
        ? warehouses.find((item) => item.id === entityId)
        : locations.find((item) => item.id === entityId);
    if (!source) {
      setToggleState(null);
      return;
    }

    setBusy(`toggle-${resource}-${entityId}`);
    setError(null);
    setNotice(null);

    try {
      await requestJson(route, {
        method: 'PATCH',
        body: JSON.stringify({
          isActive: nextActive,
          expectedUpdatedAt: source.updated_at,
        }),
      });
      await loadAll();
      setNotice(initialNotice(nextActive ? 'Đã bật trạng thái.' : 'Đã tắt trạng thái.'));
      setToggleState(null);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Không đổi được trạng thái');
    } finally {
      setBusy(null);
    }
  }

  const shellActions = (
    <>
      <button
        type="button"
        data-testid={`${scope}-refresh-button`}
        className={joinClasses(shellStyles.actionButton)}
        onClick={() => void loadAll()}
        disabled={busy !== null}
      >
        {busy === 'load' ? 'Đang cập nhật…' : 'Cập nhật dữ liệu'}
      </button>
      {scope !== 'overview' ? (
        <button
          type="button"
          data-testid={`${scope}-topbar-create-button`}
          className={joinClasses(shellStyles.actionButton, shellStyles.actionButtonPrimary)}
          onClick={() => openCreate(scope)}
        >
          {scope === 'branches' ? 'Thêm chi nhánh' : scope === 'warehouses' ? 'Thêm kho hàng' : 'Thêm vị trí'}
        </button>
      ) : null}
    </>
  );

  return (
    <AppShell title={title} subtitle={subtitle} kicker={scope === 'overview' ? 'Báo cáo quản trị' : 'Danh mục tổ chức và kho'} actions={shellActions}>
      <section className={styles.page} data-testid={scope === 'overview' ? 'organization-overview-page' : `${scope}-page`}>
        {(loading && !branches.length && !warehouses.length && !locations.length) ? (
          <div className={styles.skeletonGrid} aria-hidden="true">
            <div className={styles.skeletonCard} />
            <div className={styles.skeletonCard} />
            <div className={styles.skeletonCard} />
          </div>
        ) : null}

        {(error || notice) ? (
          <div
            className={joinClasses(styles.banner, error ? styles.bannerError : styles.bannerSuccess)}
            role="status"
            data-testid={error ? 'organization-error' : 'organization-notice'}
          >
            {error ?? notice?.message}
          </div>
        ) : null}

        <section className={styles.summaryGrid} aria-label="Số liệu tổng quan">
          <article className={styles.summaryCard}>
            <span>Chi nhánh</span>
            <strong>{formatCompactNumber(counts.branches.total)}</strong>
            <small>{counts.branches.active} đang hoạt động · {counts.branches.inactive} ngừng hoạt động</small>
          </article>
          <article className={styles.summaryCard}>
            <span>Kho hàng</span>
            <strong>{formatCompactNumber(counts.warehouses.total)}</strong>
            <small>{counts.warehouses.active} đang hoạt động · {counts.warehouses.inactive} ngừng hoạt động</small>
          </article>
          <article className={styles.summaryCard}>
            <span>Vị trí kho</span>
            <strong>{formatCompactNumber(counts.locations.total)}</strong>
            <small>{counts.locations.active} đang hoạt động · {counts.locations.inactive} ngừng hoạt động</small>
          </article>
        </section>

        {scope === 'overview' ? (
          <div className={styles.overviewLayout}>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.panelKicker}>Danh mục nghiệp vụ</p>
                  <h2>Truy cập nhanh</h2>
                </div>
                <span className={styles.panelChip}>{counts.branches.total + counts.warehouses.total + counts.locations.total} hồ sơ</span>
              </div>
              <div className={styles.quickLinks}>
                <Link className={styles.quickLink} href="/organization/branches">
                  <strong>Chi nhánh</strong>
                  <span>{counts.branches.total} chi nhánh</span>
                </Link>
                <Link className={styles.quickLink} href="/organization/warehouses">
                  <strong>Kho hàng</strong>
                  <span>{counts.warehouses.total} kho hàng</span>
                </Link>
                <Link className={styles.quickLink} href="/organization/locations">
                  <strong>Vị trí kho</strong>
                  <span>{counts.locations.total} vị trí kho</span>
                </Link>
              </div>
            </section>

            <section className={joinClasses(styles.panel, styles.spanTwo)}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.panelKicker}>Cơ cấu vận hành</p>
                  <h2>Cơ cấu chi nhánh và kho</h2>
                </div>
                <span className={styles.panelChip}>{formatDateTime(initialData.checkedAt)}</span>
              </div>

              {hierarchyOverview.length ? (
                <div className={styles.treeGrid}>
                  {hierarchyOverview.map((item) => (
                    <article key={item.branch.id} className={styles.treeCard}>
                      <div className={styles.treeTop}>
                        <div>
                          <p className={styles.entityCode}>{item.branch.code}</p>
                          <h3>{item.branch.name}</h3>
                        </div>
                        <span className={joinClasses(styles.statusPill, styles[`tone${entityStatusTone(item.branch.is_active)}`])}>
                          {entityStatusLabel(item.branch.is_active)}
                        </span>
                      </div>
                      <p className={styles.treeMeta}>
                        {item.branch.address || 'Chưa có địa chỉ'}
                      </p>
                      <div className={styles.treeStats}>
                        <span>{formatCompactNumber(item.warehouseCount)} kho</span>
                        <span>{formatCompactNumber(item.activeWarehouseCount)} kho đang hoạt động</span>
                        <span>{formatCompactNumber(item.locationCount)} vị trí</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className={styles.emptyState}>Chưa có dữ liệu chi nhánh để hiển thị cơ cấu.</div>
              )}
            </section>

            <section className={joinClasses(styles.panel, styles.spanTwo)}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.panelKicker}>Cập nhật gần đây</p>
                  <h2>Những hồ sơ vừa thay đổi</h2>
                </div>
                <span className={styles.panelChip}>Cập nhật mới nhất</span>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Mã</th>
                      <th>Tên</th>
                      <th>Đơn vị liên quan</th>
                      <th>Trạng thái</th>
                      <th>Cập nhật</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overviewItems.length ? overviewItems.map((item) => (
                      <tr key={`${item.scope}-${item.code}`}>
                        <td><code>{item.code}</code></td>
                        <td>{item.name}</td>
                        <td className={styles.relationCell}>{item.relation}</td>
                        <td><span className={joinClasses(styles.statusPill, styles[`tone${entityStatusTone(item.is_active)}`])}>{entityStatusLabel(item.is_active)}</span></td>
                        <td>{formatDateTime(item.updated_at)}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={5}>
                          <div className={styles.emptyState}>Chưa có hồ sơ nào.</div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : (
          <>
            <section className={styles.toolbar}>
              <div className={styles.toolbarSearch}>
                <label htmlFor={`${scope}-search`}>Tra cứu theo mã hoặc tên</label>
                <input
                  id={`${scope}-search`}
                  data-testid={`${scope}-search-input`}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Nhập mã hoặc tên…"
                />
              </div>
              <div className={styles.toolbarFilter}>
                <label htmlFor={`${scope}-status`}>Trạng thái</label>
                <select
                  id={`${scope}-status`}
                  data-testid={`${scope}-status-filter`}
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as FilterState)}
                >
                  <option value="all">Tất cả</option>
                  <option value="active">Đang hoạt động</option>
                  <option value="inactive">Ngừng hoạt động</option>
                </select>
              </div>
              <div className={styles.toolbarActions}>
                <button type="button" className={joinClasses(shellStyles.actionButton)} onClick={() => void loadAll()} disabled={busy !== null}>
                  {busy === 'load' ? 'Đang cập nhật…' : 'Cập nhật dữ liệu'}
                </button>
                <button
                  type="button"
                  data-testid={`${scope}-toolbar-create-button`}
                  className={joinClasses(shellStyles.actionButton, shellStyles.actionButtonPrimary)}
                  onClick={() => openCreate(scope)}
                >
                  {scope === 'branches' ? 'Thêm chi nhánh' : scope === 'warehouses' ? 'Thêm kho hàng' : 'Thêm vị trí'}
                </button>
              </div>
            </section>

            {scope === 'branches' ? (
              <section className={styles.tableSection}>
                <div className={styles.sectionHeader}>
                  <div>
                    <p className={styles.panelKicker}>Danh mục quản lý</p>
                    <h2>Chi nhánh</h2>
                  </div>
                  <span className={styles.panelChip}>{formatCompactNumber(visibleBranches.length)} hồ sơ</span>
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table} data-testid="branch-table">
                    <thead>
                      <tr>
                        <th>Mã</th>
                        <th>Tên</th>
                        <th>Liên hệ</th>
                        <th>Trạng thái</th>
                        <th>Cập nhật</th>
                        <th>Xử lý</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleBranches.length ? visibleBranches.map((branch) => (
                        <tr key={branch.id} data-testid={`branch-row-${branch.code}`}>
                          <td><code>{branch.code}</code></td>
                          <td>
                            <div className={styles.entityStack}>
                              <strong>{branch.name}</strong>
                              <span>{branch.address || 'Chưa có địa chỉ'}</span>
                            </div>
                          </td>
                          <td className={styles.relationCell}>
                            <div className={styles.entityStack}>
                              <span>{branch.phone || 'Chưa có số điện thoại'}</span>
                              <span>{branch.email || 'Chưa có email'}</span>
                            </div>
                          </td>
                          <td><span className={joinClasses(styles.statusPill, statusClass(branch.is_active))}>{entityStatusLabel(branch.is_active)}</span></td>
                          <td>{formatDateTime(branch.updated_at)}</td>
                          <td>
                            <div className={styles.rowActions}>
                              <button type="button" data-testid={`edit-branch-${branch.code}`} onClick={() => openEdit('branches', branch.id)}>Chỉnh sửa</button>
                              <button type="button" data-testid={`toggle-branch-${branch.code}`} onClick={() => openToggle('branches', branch.id, !branch.is_active)}>
                                {branch.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={6}>
                            <div className={styles.emptyState}>Không tìm thấy chi nhánh phù hợp.</div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            {scope === 'warehouses' ? (
              <section className={styles.tableSection}>
                <div className={styles.sectionHeader}>
                  <div>
                    <p className={styles.panelKicker}>Danh mục quản lý</p>
                    <h2>Kho hàng</h2>
                  </div>
                  <span className={styles.panelChip}>{formatCompactNumber(visibleWarehouses.length)} hồ sơ</span>
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table} data-testid="warehouse-table">
                    <thead>
                      <tr>
                        <th>Mã</th>
                        <th>Tên</th>
                        <th>Thuộc chi nhánh</th>
                        <th>Loại kho</th>
                        <th>Trạng thái</th>
                        <th>Xử lý</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleWarehouses.length ? visibleWarehouses.map((warehouse) => {
                        const branch = branchMap.get(warehouse.branch_id);
                        return (
                          <tr key={warehouse.id} data-testid={`warehouse-row-${warehouse.code}`}>
                            <td><code>{warehouse.code}</code></td>
                            <td>
                              <div className={styles.entityStack}>
                                <strong>{warehouse.name}</strong>
                                <span>{formatDateTime(warehouse.updated_at)}</span>
                              </div>
                            </td>
                            <td className={styles.relationCell}>{branch ? `${branch.code} · ${branch.name}` : 'Chưa xác định chi nhánh'}</td>
                            <td>{typeLabel('warehouses', warehouse.warehouse_type)}</td>
                            <td><span className={joinClasses(styles.statusPill, statusClass(warehouse.is_active))}>{entityStatusLabel(warehouse.is_active)}</span></td>
                            <td>
                              <div className={styles.rowActions}>
                                <button type="button" data-testid={`edit-warehouse-${warehouse.code}`} onClick={() => openEdit('warehouses', warehouse.id)}>Chỉnh sửa</button>
                                <button type="button" data-testid={`toggle-warehouse-${warehouse.code}`} onClick={() => openToggle('warehouses', warehouse.id, !warehouse.is_active)}>
                                  {warehouse.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      }) : (
                        <tr>
                          <td colSpan={6}>
                            <div className={styles.emptyState}>Không tìm thấy kho hàng phù hợp.</div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            {scope === 'locations' ? (
              <section className={styles.tableSection}>
                <div className={styles.sectionHeader}>
                  <div>
                    <p className={styles.panelKicker}>Danh mục quản lý</p>
                    <h2>Vị trí kho</h2>
                  </div>
                  <span className={styles.panelChip}>{formatCompactNumber(visibleLocations.length)} hồ sơ</span>
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table} data-testid="location-table">
                    <thead>
                      <tr>
                        <th>Mã</th>
                        <th>Tên</th>
                        <th>Đơn vị quản lý</th>
                        <th>Loại vị trí</th>
                        <th>Trạng thái</th>
                        <th>Xử lý</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleLocations.length ? visibleLocations.map((location) => {
                        const warehouse = warehouseMap.get(location.warehouse_id);
                        const branch = warehouse ? branchMap.get(warehouse.branch_id) : null;
                        return (
                          <tr key={location.id} data-testid={`location-row-${location.code}`}>
                            <td><code>{location.code}</code></td>
                            <td>
                              <div className={styles.entityStack}>
                                <strong>{location.name}</strong>
                                <span>{formatDateTime(location.updated_at)}</span>
                              </div>
                            </td>
                            <td className={styles.relationCell}>
                              {branch && warehouse ? `${branch.code} · ${warehouse.code} · ${warehouse.name}` : 'Chưa xác định quan hệ kho'}
                            </td>
                            <td>{typeLabel('locations', location.location_type)}</td>
                            <td><span className={joinClasses(styles.statusPill, statusClass(location.is_active))}>{entityStatusLabel(location.is_active)}</span></td>
                            <td>
                              <div className={styles.rowActions}>
                                <button type="button" data-testid={`edit-location-${location.code}`} onClick={() => openEdit('locations', location.id)}>Chỉnh sửa</button>
                                <button type="button" data-testid={`toggle-location-${location.code}`} onClick={() => openToggle('locations', location.id, !location.is_active)}>
                                  {location.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      }) : (
                        <tr>
                          <td colSpan={6}>
                            <div className={styles.emptyState}>Không tìm thấy vị trí kho phù hợp.</div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
          </>
        )}

        {editor ? (
          <div className={styles.modalBackdrop} role="presentation" onClick={closeModals}>
            <div className={styles.modal} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div>
                  <p className={styles.panelKicker}>{editor.mode === 'create' ? 'Thêm mới' : 'Chỉnh sửa'}</p>
                  <h3>
                    {editor.resource === 'branches' ? 'Chi nhánh' : editor.resource === 'warehouses' ? 'Kho hàng' : 'Vị trí kho'}
                  </h3>
                </div>
                <button type="button" className={styles.modalClose} onClick={closeModals}>Đóng</button>
              </div>

              {editor.resource === 'branches' ? (
                <form className={styles.form} onSubmit={(event) => void submitBranch(event)}>
                  <label>
                    Mã chi nhánh
                    <input data-testid="branch-code-input" value={branchDraft.code} onChange={(event) => setBranchDraft((current) => ({ ...current, code: event.target.value }))} required maxLength={64} />
                  </label>
                  <label>
                    Tên chi nhánh
                    <input data-testid="branch-name-input" value={branchDraft.name} onChange={(event) => setBranchDraft((current) => ({ ...current, name: event.target.value }))} required maxLength={256} />
                  </label>
                  <label>
                    Địa chỉ
                    <input data-testid="branch-address-input" value={branchDraft.address} onChange={(event) => setBranchDraft((current) => ({ ...current, address: event.target.value }))} maxLength={512} />
                  </label>
                  <label>
                    Số điện thoại
                    <input data-testid="branch-phone-input" value={branchDraft.phone} onChange={(event) => setBranchDraft((current) => ({ ...current, phone: event.target.value }))} maxLength={20} />
                  </label>
                  <label>
                    Email
                    <input data-testid="branch-email-input" value={branchDraft.email} onChange={(event) => setBranchDraft((current) => ({ ...current, email: event.target.value }))} maxLength={256} />
                  </label>
                  <div className={styles.formActions}>
                    <button type="button" className={styles.secondaryButton} onClick={closeModals}>Hủy</button>
                  <button type="submit" className={styles.primaryButton} disabled={busy !== null}>
                      {editor.mode === 'create' ? 'Tạo chi nhánh' : 'Lưu thay đổi'}
                    </button>
                  </div>
                </form>
              ) : null}

              {editor.resource === 'warehouses' ? (
                <form className={styles.form} onSubmit={(event) => void submitWarehouse(event)}>
                  <label>
                    Chi nhánh quản lý
                    <select
                      data-testid="warehouse-branch-select"
                      value={warehouseDraft.branchId}
                      onChange={(event) => setWarehouseDraft((current) => ({ ...current, branchId: event.target.value }))}
                      required
                    >
                      <option value="">Chọn chi nhánh</option>
                      {branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Mã kho
                    <input data-testid="warehouse-code-input" value={warehouseDraft.code} onChange={(event) => setWarehouseDraft((current) => ({ ...current, code: event.target.value }))} required maxLength={64} />
                  </label>
                  <label>
                    Tên kho
                    <input data-testid="warehouse-name-input" value={warehouseDraft.name} onChange={(event) => setWarehouseDraft((current) => ({ ...current, name: event.target.value }))} required maxLength={256} />
                  </label>
                  <label>
                    Loại kho
                    <select
                      data-testid="warehouse-type-select"
                      value={warehouseDraft.warehouseType}
                      onChange={(event) => setWarehouseDraft((current) => ({ ...current, warehouseType: event.target.value }))}
                    >
                      {warehouseTypes.map((type) => (
                        <option key={type} value={type}>{warehouseTypeLabels[type]}</option>
                      ))}
                    </select>
                  </label>
                  <div className={styles.formActions}>
                    <button type="button" className={styles.secondaryButton} onClick={closeModals}>Hủy</button>
                    <button type="submit" className={styles.primaryButton} disabled={busy !== null}>
                      {editor.mode === 'create' ? 'Tạo kho' : 'Lưu thay đổi'}
                    </button>
                  </div>
                </form>
              ) : null}

              {editor.resource === 'locations' ? (
                <form className={styles.form} onSubmit={(event) => void submitLocation(event)}>
                  <label>
                    Kho quản lý
                    <select
                      data-testid="location-warehouse-select"
                      value={locationDraft.warehouseId}
                      onChange={(event) => setLocationDraft((current) => ({ ...current, warehouseId: event.target.value }))}
                      required
                    >
                      <option value="">Chọn kho</option>
                      {warehouses.map((warehouse) => (
                        <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Mã vị trí
                    <input data-testid="location-code-input" value={locationDraft.code} onChange={(event) => setLocationDraft((current) => ({ ...current, code: event.target.value }))} required maxLength={64} />
                  </label>
                  <label>
                    Tên vị trí
                    <input data-testid="location-name-input" value={locationDraft.name} onChange={(event) => setLocationDraft((current) => ({ ...current, name: event.target.value }))} required maxLength={256} />
                  </label>
                  <label>
                    Loại vị trí
                    <select
                      data-testid="location-type-select"
                      value={locationDraft.locationType}
                      onChange={(event) => setLocationDraft((current) => ({ ...current, locationType: event.target.value }))}
                    >
                      {locationTypes.map((type) => (
                        <option key={type} value={type}>{locationTypeLabels[type]}</option>
                      ))}
                    </select>
                  </label>
                  <div className={styles.formActions}>
                    <button type="button" className={styles.secondaryButton} onClick={closeModals}>Hủy</button>
                    <button type="submit" className={styles.primaryButton} disabled={busy !== null}>
                      {editor.mode === 'create' ? 'Tạo vị trí' : 'Lưu thay đổi'}
                    </button>
                  </div>
                </form>
              ) : null}
            </div>
          </div>
        ) : null}

        {toggleState ? (
          <div className={styles.modalBackdrop} role="presentation" onClick={closeModals}>
            <div className={joinClasses(styles.modal, styles.confirmModal)} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div>
                  <p className={styles.panelKicker}>Xác nhận trạng thái</p>
                  <h3>
                    {toggleState.nextActive ? 'Đưa vào sử dụng' : 'Ngừng sử dụng'}
                  </h3>
                </div>
                <button type="button" className={styles.modalClose} onClick={closeModals}>Đóng</button>
              </div>
              <p className={styles.confirmText}>
                {toggleState.resource === 'branches'
                  ? `Bạn muốn ${toggleState.nextActive ? 'đưa vào sử dụng' : 'ngừng sử dụng'} chi nhánh này?`
                  : toggleState.resource === 'warehouses'
                    ? `Bạn muốn ${toggleState.nextActive ? 'đưa vào sử dụng' : 'ngừng sử dụng'} kho hàng này?`
                    : `Bạn muốn ${toggleState.nextActive ? 'đưa vào sử dụng' : 'ngừng sử dụng'} vị trí kho này?`}
              </p>
              <div className={styles.formActions}>
                <button type="button" className={styles.secondaryButton} onClick={closeModals}>Hủy</button>
                <button type="button" className={styles.primaryButton} onClick={() => void confirmToggle()} disabled={busy !== null}>
                  Xác nhận
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
