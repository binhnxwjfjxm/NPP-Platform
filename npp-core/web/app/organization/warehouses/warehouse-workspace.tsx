'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey } from '@npp/contracts';
import { AppShell } from '../../components/app-shell';
import shellStyles from '../../components/app-shell.module.css';
import orgStyles from '../organization.module.css';
import styles from './warehouse-workspace.module.css';
import WarehouseTabs from './warehouse-tabs';
import {
  formatDateTime,
  locationTypes,
  matchTerm,
  normalizeSearch,
  toUpperCode,
  warehouseTypes,
  type Branch,
  type OrganizationSnapshot,
  type Warehouse,
  type WarehouseLocation,
} from '../../../lib/organization-types';

export type WarehouseWorkspaceTab = 'list' | 'quick' | 'layout';

type Props = Readonly<{
  initialData: OrganizationSnapshot;
  initialError?: string | null;
  initialTab: WarehouseWorkspaceTab;
  initialWarehouseId?: string;
}>;

type ApiEnvelope<T> = { data?: T; error?: { message?: string; details?: unknown } };
type Notice = { kind: 'success' | 'error'; message: string } | null;
type WarehouseDraft = { branchId: string; code: string; name: string; warehouseType: string; allowNegativeStock: boolean };
type LocationDraft = { warehouseId: string; code: string; name: string; locationType: string };
type LocationEditor = { mode: 'create' | 'edit'; entityId: string | null } | null;
type ConfirmState = { resource: 'warehouse' | 'location'; entityId: string; nextActive: boolean } | null;
type LocationManagementMode = 'MANAGED' | 'UNMANAGED';
type LocationModePreview = {
  targetMode: LocationManagementMode;
  destinationLocation: { id: string; code: string; name: string } | null;
  summary: { affectedSkuCount: number; affectedScopeCount: number; totalBaseQuantity: string; relocatedReservationCount: number };
  blockers: Array<{ code: string; message?: string }>;
  canConvert: boolean;
  previewHash: string;
};
type LocationModeState = {
  warehouseId: string;
  targetMode: LocationManagementMode;
  destinationLocationId: string;
  preview: LocationModePreview | null;
} | null;

const warehouseTypeLabels: Record<string, string> = {
  main: 'Kho chính', distribution: 'Kho phân phối', vehicle: 'Kho xe', quarantine: 'Kho cách ly',
  returns: 'Kho hàng trả', transit: 'Kho trung chuyển', other: 'Loại khác',
};

const locationTypeLabels: Record<string, string> = {
  storage: 'Khu lưu trữ', receiving: 'Khu nhận hàng', shipping: 'Khu xuất hàng', quarantine: 'Khu cách ly',
  returns: 'Khu hàng trả', damaged: 'Khu hư hỏng', other: 'Khu vực khác',
};

function emptyWarehouse(branchId = ''): WarehouseDraft {
  return { branchId, code: '', name: '', warehouseType: warehouseTypes[0], allowNegativeStock: false };
}

function emptyLocation(warehouseId = ''): LocationDraft {
  return { warehouseId, code: '', name: '', locationType: locationTypes[0] };
}

function warehouseLayoutLabel(warehouse: Warehouse) {
  if (warehouse.location_management_mode === 'MANAGED') return 'Có sơ đồ kho';
  if (warehouse.location_management_mode === 'UNMANAGED') return 'Không dùng sơ đồ';
  return 'Chưa thiết lập sơ đồ';
}

function statusLabel(active: boolean) {
  return active ? 'Đang hoạt động' : 'Ngừng hoạt động';
}

function statusClass(active: boolean) {
  return active ? orgStyles.toneSuccess : orgStyles.toneDanger;
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
  if (!response.ok || payload.data === undefined) throw new Error(payload.error?.message || 'Không thể tải dữ liệu kho.');
  return payload.data;
}

export default function WarehouseWorkspace({ initialData, initialError = null, initialTab, initialWarehouseId = '' }: Props) {
  const router = useRouter();
  const [branches, setBranches] = useState<Branch[]>(initialData.branches);
  const [warehouses, setWarehouses] = useState<Warehouse[]>(initialData.warehouses);
  const [locations, setLocations] = useState<WarehouseLocation[]>(initialData.locations);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<Notice>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const firstWarehouseId = initialWarehouseId && initialData.warehouses.some((item) => item.id === initialWarehouseId)
    ? initialWarehouseId
    : initialData.warehouses.find((item) => item.is_active)?.id ?? initialData.warehouses[0]?.id ?? '';
  const [selectedWarehouseId, setSelectedWarehouseId] = useState(firstWarehouseId);
  const firstBranchId = initialData.branches.find((item) => item.is_active)?.id ?? initialData.branches[0]?.id ?? '';
  const [warehouseDraft, setWarehouseDraft] = useState<WarehouseDraft>(emptyWarehouse(firstBranchId));
  const [warehouseEditorId, setWarehouseEditorId] = useState<string | null>(null);
  const [locationDraft, setLocationDraft] = useState<LocationDraft>(emptyLocation(firstWarehouseId));
  const [locationEditor, setLocationEditor] = useState<LocationEditor>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [locationModeState, setLocationModeState] = useState<LocationModeState>(null);
  const mutationKeys = useRef(new Map<string, string>());

  const branchMap = useMemo(() => new Map(branches.map((branch) => [branch.id, branch])), [branches]);
  const normalizedSearch = normalizeSearch(search);
  const visibleWarehouses = useMemo(() => warehouses.filter((warehouse) => {
    const branch = branchMap.get(warehouse.branch_id);
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? warehouse.is_active : !warehouse.is_active);
    const matchesText = !normalizedSearch || matchTerm(warehouse.code, warehouse.name, warehouse.warehouse_type, branch?.code, branch?.name).includes(normalizedSearch);
    return matchesStatus && matchesText;
  }).sort((left, right) => left.code.localeCompare(right.code)), [branchMap, normalizedSearch, statusFilter, warehouses]);
  const selectedWarehouse = warehouses.find((warehouse) => warehouse.id === selectedWarehouseId) ?? null;
  const selectedLocations = locations.filter((location) => location.warehouse_id === selectedWarehouseId).sort((left, right) => left.code.localeCompare(right.code));
  const storageLocations = selectedLocations.filter((location) => location.is_active && location.location_type === 'storage');

  async function loadAll(message = 'Dữ liệu kho đã được cập nhật.') {
    setBusy('load');
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
      if (!nextWarehouses.some((warehouse) => warehouse.id === selectedWarehouseId)) {
        setSelectedWarehouseId(nextWarehouses.find((warehouse) => warehouse.is_active)?.id ?? nextWarehouses[0]?.id ?? '');
      }
      setNotice({ kind: 'success', message });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được dữ liệu kho');
    } finally {
      setBusy(null);
    }
  }

  function operationKey(identity: string, scope: string) {
    const existing = mutationKeys.current.get(identity);
    if (existing) return existing;
    const created = createIdempotencyKey(scope);
    mutationKeys.current.set(identity, created);
    return created;
  }

  async function createWarehouse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      branchId: warehouseDraft.branchId,
      code: toUpperCode(warehouseDraft.code),
      name: warehouseDraft.name.trim(),
      warehouseType: warehouseDraft.warehouseType,
      allowNegativeStock: warehouseDraft.allowNegativeStock,
    };
    const identity = `warehouse-create|${JSON.stringify(payload)}`;
    setBusy('create-warehouse');
    setError(null);
    setNotice(null);
    try {
      const created = await requestJson<Warehouse>('/api/organization/warehouses', {
        method: 'POST',
        headers: { 'Idempotency-Key': operationKey(identity, 'organization-create') },
        body: JSON.stringify(payload),
      });
      mutationKeys.current.delete(identity);
      setSelectedWarehouseId(created.id);
      setWarehouseDraft(emptyWarehouse(payload.branchId));
      await loadAll(`Đã tạo kho ${created.code} · ${created.name}.`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Không tạo được kho');
      setBusy(null);
    }
  }

  function openWarehouseEdit(warehouse: Warehouse) {
    setWarehouseEditorId(warehouse.id);
    setWarehouseDraft({
      branchId: warehouse.branch_id,
      code: warehouse.code,
      name: warehouse.name,
      warehouseType: warehouse.warehouse_type,
      allowNegativeStock: warehouse.allow_negative_stock === true,
    });
    setError(null);
  }

  async function saveWarehouseEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = warehouses.find((warehouse) => warehouse.id === warehouseEditorId);
    if (!current) return;
    setBusy('edit-warehouse');
    setError(null);
    try {
      await requestJson(`/api/organization/warehouses/${current.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          branchId: warehouseDraft.branchId,
          code: toUpperCode(warehouseDraft.code),
          name: warehouseDraft.name.trim(),
          warehouseType: warehouseDraft.warehouseType,
          allowNegativeStock: warehouseDraft.allowNegativeStock,
          expectedUpdatedAt: current.updated_at,
        }),
      });
      setWarehouseEditorId(null);
      await loadAll('Đã cập nhật kho hàng.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không cập nhật được kho');
      setBusy(null);
    }
  }

  function openLocationCreate() {
    if (!selectedWarehouseId) return;
    setLocationDraft(emptyLocation(selectedWarehouseId));
    setLocationEditor({ mode: 'create', entityId: null });
    setError(null);
  }

  function openLocationEdit(location: WarehouseLocation) {
    setLocationDraft({ warehouseId: location.warehouse_id, code: location.code, name: location.name, locationType: location.location_type });
    setLocationEditor({ mode: 'edit', entityId: location.id });
    setError(null);
  }

  async function saveLocation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = locationEditor?.mode === 'edit' ? locations.find((location) => location.id === locationEditor.entityId) : null;
    const payload = {
      warehouseId: locationDraft.warehouseId,
      code: toUpperCode(locationDraft.code),
      name: locationDraft.name.trim(),
      locationType: locationDraft.locationType,
    };
    const path = current ? `/api/organization/warehouse-locations/${current.id}` : '/api/organization/warehouse-locations';
    const identity = `warehouse-area|${path}|${JSON.stringify(payload)}`;
    setBusy(current ? 'edit-location' : 'create-location');
    setError(null);
    try {
      await requestJson(path, {
        method: current ? 'PATCH' : 'POST',
        headers: current ? undefined : { 'Idempotency-Key': operationKey(identity, 'organization-create') },
        body: JSON.stringify(current ? { ...payload, expectedUpdatedAt: current.updated_at } : payload),
      });
      if (!current) mutationKeys.current.delete(identity);
      setLocationEditor(null);
      await loadAll(current ? 'Đã cập nhật khu vực trong kho.' : 'Đã thêm khu vực vào sơ đồ kho.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không lưu được khu vực trong kho');
      setBusy(null);
    }
  }

  async function confirmStatusChange() {
    if (!confirmState) return;
    const source = confirmState.resource === 'warehouse'
      ? warehouses.find((item) => item.id === confirmState.entityId)
      : locations.find((item) => item.id === confirmState.entityId);
    if (!source) return;
    const path = confirmState.resource === 'warehouse'
      ? `/api/organization/warehouses/${source.id}`
      : `/api/organization/warehouse-locations/${source.id}`;
    setBusy('toggle-status');
    setError(null);
    try {
      await requestJson(path, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: confirmState.nextActive, expectedUpdatedAt: source.updated_at }),
      });
      setConfirmState(null);
      await loadAll(confirmState.nextActive ? 'Đã đưa vào sử dụng.' : 'Đã ngừng sử dụng.');
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Không đổi được trạng thái');
      setBusy(null);
    }
  }

  function openLayoutMode(warehouse: Warehouse) {
    setLocationModeState({
      warehouseId: warehouse.id,
      targetMode: warehouse.location_management_mode === 'MANAGED' ? 'UNMANAGED' : 'MANAGED',
      destinationLocationId: '',
      preview: null,
    });
  }

  async function previewLayoutMode() {
    if (!locationModeState) return;
    const query = new URLSearchParams({ targetMode: locationModeState.targetMode });
    if (locationModeState.destinationLocationId) query.set('destinationLocationId', locationModeState.destinationLocationId);
    setBusy('preview-layout');
    setError(null);
    try {
      const preview = await requestJson<LocationModePreview>(`/api/organization/warehouses/${locationModeState.warehouseId}/location-mode/preview?${query}`);
      setLocationModeState((current) => current ? { ...current, preview } : current);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Không xem trước được thay đổi sơ đồ kho.');
    } finally {
      setBusy(null);
    }
  }

  async function confirmLayoutMode() {
    if (!locationModeState?.preview?.canConvert) return;
    const identity = `warehouse-layout-mode|${locationModeState.warehouseId}|${locationModeState.targetMode}|${locationModeState.destinationLocationId}|${locationModeState.preview.previewHash}`;
    setBusy('confirm-layout');
    setError(null);
    try {
      await requestJson(`/api/organization/warehouses/${locationModeState.warehouseId}/location-mode/convert`, {
        method: 'POST',
        headers: { 'Idempotency-Key': operationKey(identity, 'warehouse-location-mode-convert') },
        body: JSON.stringify({
          targetMode: locationModeState.targetMode,
          destinationLocationId: locationModeState.destinationLocationId || null,
          previewHash: locationModeState.preview.previewHash,
        }),
      });
      mutationKeys.current.delete(identity);
      setLocationModeState(null);
      await loadAll('Đã cập nhật chế độ sơ đồ kho.');
    } catch (convertError) {
      setError(convertError instanceof Error ? convertError.message : 'Không cập nhật được sơ đồ kho');
      setBusy(null);
    }
  }

  const actions = (
    <button type="button" className={shellStyles.actionButton} onClick={() => void loadAll()} disabled={busy !== null}>
      {busy === 'load' ? 'Đang cập nhật…' : 'Cập nhật dữ liệu'}
    </button>
  );

  return (
    <AppShell
      title="Kho hàng"
      subtitle="Quản lý kho, thiết lập nhanh và sơ đồ hàng hóa bên trong từng kho."
      kicker="Danh mục quản lý"
      actions={actions}
    >
      <section className={orgStyles.page} data-testid="warehouses-page">
        <WarehouseTabs active={initialTab} />

        {(error || notice) ? (
          <div className={`${orgStyles.banner} ${error ? orgStyles.bannerError : orgStyles.bannerSuccess}`} role="status">
            {error ?? notice?.message}
          </div>
        ) : null}

        {initialTab === 'list' ? (
          <>
            <section className={orgStyles.toolbar}>
              <div className={orgStyles.toolbarSearch}>
                <label htmlFor="warehouse-search">Tra cứu kho</label>
                <input id="warehouse-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tên kho, mã kho hoặc chi nhánh" />
              </div>
              <div className={orgStyles.toolbarFilter}>
                <label htmlFor="warehouse-status">Trạng thái</label>
                <select id="warehouse-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | 'active' | 'inactive')}>
                  <option value="all">Tất cả</option><option value="active">Đang hoạt động</option><option value="inactive">Ngừng hoạt động</option>
                </select>
              </div>
              <div className={orgStyles.toolbarActions}>
                <button className={shellStyles.actionButtonPrimary} type="button" onClick={() => router.push('/organization/warehouses?tab=quick')}>Tạo kho nhanh</button>
              </div>
            </section>

            <section className={orgStyles.tableSection}>
              <div className={orgStyles.sectionHeader}>
                <div><p className={orgStyles.panelKicker}>Danh mục quản lý</p><h2>Kho hàng</h2></div>
                <span className={orgStyles.panelChip}>{visibleWarehouses.length} kho</span>
              </div>
              <div className={orgStyles.tableWrap}>
                <table className={orgStyles.table} data-testid="warehouse-table">
                  <thead><tr><th>Mã</th><th>Tên</th><th>Thuộc chi nhánh</th><th>Loại kho</th><th>Sơ đồ kho</th><th>Xuất vượt tồn</th><th>Trạng thái</th><th>Xử lý</th></tr></thead>
                  <tbody>
                    {visibleWarehouses.map((warehouse) => {
                      const branch = branchMap.get(warehouse.branch_id);
                      return (
                        <tr key={warehouse.id} data-testid={`warehouse-row-${warehouse.code}`}>
                          <td><code>{warehouse.code}</code></td>
                          <td><div className={orgStyles.entityStack}><strong>{warehouse.name}</strong><span>{formatDateTime(warehouse.updated_at)}</span></div></td>
                          <td className={orgStyles.relationCell}>{branch ? `${branch.code} · ${branch.name}` : 'Chưa xác định chi nhánh'}</td>
                          <td>{warehouseTypeLabels[warehouse.warehouse_type] ?? 'Loại khác'}</td>
                          <td>{warehouseLayoutLabel(warehouse)}</td>
                          <td><span className={`${orgStyles.statusPill} ${statusClass(warehouse.allow_negative_stock === true)}`}>{warehouse.allow_negative_stock ? 'Đang bật' : 'Đang tắt'}</span></td>
                          <td><span className={`${orgStyles.statusPill} ${statusClass(warehouse.is_active)}`}>{statusLabel(warehouse.is_active)}</span></td>
                          <td><div className={orgStyles.rowActions}>
                            <button type="button" onClick={() => openWarehouseEdit(warehouse)}>Chỉnh sửa</button>
                            <button type="button" data-testid={`warehouse-layout-${warehouse.code}`} onClick={() => router.push(`/organization/warehouses?tab=layout&warehouseId=${encodeURIComponent(warehouse.id)}`)}>Quản lý sơ đồ</button>
                            <button type="button" onClick={() => setConfirmState({ resource: 'warehouse', entityId: warehouse.id, nextActive: !warehouse.is_active })}>{warehouse.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}</button>
                          </div></td>
                        </tr>
                      );
                    })}
                    {!visibleWarehouses.length ? <tr><td colSpan={8}><div className={orgStyles.emptyState}>Không tìm thấy kho hàng phù hợp.</div></td></tr> : null}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}

        {initialTab === 'quick' ? (
          <section className={styles.quickCard} data-testid="warehouse-quick-setup">
            <div className={styles.headingRow}>
              <div><p className={styles.eyebrow}>Thao tác nhanh</p><h2>Thiết lập nhanh kho hàng</h2><p>Tạo kho mới trên dữ liệu hiện có. Sau khi tạo có thể sang tab Sơ đồ kho để chia khu vực chứa hàng.</p></div>
            </div>
            <form className={styles.quickForm} onSubmit={(event) => void createWarehouse(event)}>
              <label className={styles.field}>Chi nhánh quản lý<select value={warehouseDraft.branchId} onChange={(event) => setWarehouseDraft((current) => ({ ...current, branchId: event.target.value }))} required><option value="">Chọn chi nhánh</option>{branches.filter((branch) => branch.is_active).map((branch) => <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>)}</select></label>
              <label className={styles.field}>Loại kho<select value={warehouseDraft.warehouseType} onChange={(event) => setWarehouseDraft((current) => ({ ...current, warehouseType: event.target.value }))}>{warehouseTypes.map((type) => <option key={type} value={type}>{warehouseTypeLabels[type]}</option>)}</select></label>
              <label className={styles.field}>Mã kho<input value={warehouseDraft.code} onChange={(event) => setWarehouseDraft((current) => ({ ...current, code: event.target.value }))} required maxLength={64} placeholder="Ví dụ: YS-003" /></label>
              <label className={styles.field}>Tên kho<input value={warehouseDraft.name} onChange={(event) => setWarehouseDraft((current) => ({ ...current, name: event.target.value }))} required maxLength={256} placeholder="Tên kho dễ nhận biết" /></label>
              <label className={`${styles.field} ${styles.fullRow}`}>Xuất vượt tồn<select value={warehouseDraft.allowNegativeStock ? 'allow' : 'deny'} onChange={(event) => setWarehouseDraft((current) => ({ ...current, allowNegativeStock: event.target.value === 'allow' }))}><option value="deny">Không cho phép xuất vượt tồn</option><option value="allow">Cho phép xuất vượt tồn khả dụng</option></select><small>Mặc định tắt. Bật chính sách không tự cấp quyền cho người dùng.</small></label>
              <div className={styles.formFooter}><button type="submit" className={orgStyles.primaryButton} disabled={busy !== null}>{busy === 'create-warehouse' ? 'Đang tạo…' : 'Tạo kho'}</button></div>
            </form>
          </section>
        ) : null}

        {initialTab === 'layout' ? (
          <section className={styles.layoutCard} data-testid="warehouse-layout-workspace">
            <div className={styles.headingRow}><div><p className={styles.eyebrow}>Bố trí hàng hóa</p><h2>Sơ đồ kho</h2><p>Chọn một kho để quản lý các khu lưu trữ, khu nhận hàng, khu xuất hàng và các khu vực đặc biệt bên trong kho.</p></div></div>
            <div className={styles.layoutToolbar}>
              <label className={`${styles.field} ${styles.warehousePicker}`}>Kho<select value={selectedWarehouseId} onChange={(event) => { setSelectedWarehouseId(event.target.value); setLocationDraft(emptyLocation(event.target.value)); }}><option value="">Chọn kho</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
              <div className={orgStyles.toolbarActions}>
                <button type="button" className={orgStyles.secondaryButton} onClick={() => selectedWarehouse && openLayoutMode(selectedWarehouse)} disabled={!selectedWarehouse}>Thiết lập sơ đồ</button>
                <button type="button" className={orgStyles.primaryButton} onClick={openLocationCreate} disabled={!selectedWarehouse}>Thêm khu vực</button>
              </div>
            </div>
            {selectedWarehouse ? (
              <>
                <div className={styles.layoutSummary}>
                  <div className={styles.summaryItem}><span>Kho</span><strong>{selectedWarehouse.code} · {selectedWarehouse.name}</strong></div>
                  <div className={styles.summaryItem}><span>Chế độ sơ đồ</span><strong>{warehouseLayoutLabel(selectedWarehouse)}</strong></div>
                  <div className={styles.summaryItem}><span>Khu vực</span><strong>{selectedLocations.length} khu vực</strong></div>
                </div>
                <p className={styles.layoutHelp}>Sơ đồ kho là cách chia khu/kệ/điểm chứa hàng bên trong kho; không phải địa chỉ vật lý của kho.</p>
                <div className={orgStyles.tableWrap}>
                  <table className={orgStyles.table} data-testid="warehouse-layout-table">
                    <thead><tr><th>Mã khu vực</th><th>Tên khu vực</th><th>Loại khu vực</th><th>Trạng thái</th><th>Xử lý</th></tr></thead>
                    <tbody>
                      {selectedLocations.map((location) => (
                        <tr key={location.id}><td><code>{location.code}</code></td><td><div className={orgStyles.entityStack}><strong>{location.name}</strong><span>{formatDateTime(location.updated_at)}</span></div></td><td>{locationTypeLabels[location.location_type] ?? 'Khu vực khác'}</td><td><span className={`${orgStyles.statusPill} ${statusClass(location.is_active)}`}>{statusLabel(location.is_active)}</span></td><td><div className={orgStyles.rowActions}><button type="button" onClick={() => openLocationEdit(location)}>Chỉnh sửa</button><button type="button" onClick={() => setConfirmState({ resource: 'location', entityId: location.id, nextActive: !location.is_active })}>{location.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}</button></div></td></tr>
                      ))}
                      {!selectedLocations.length ? <tr><td colSpan={5}><div className={orgStyles.emptyState}>Kho này chưa có khu vực trong sơ đồ.</div></td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </>
            ) : <div className={orgStyles.emptyState}>Chọn kho để xem sơ đồ.</div>}
          </section>
        ) : null}

        {warehouseEditorId ? (
          <div className={orgStyles.modalBackdrop} role="presentation" onClick={() => setWarehouseEditorId(null)}><div className={orgStyles.modal} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><div className={orgStyles.modalHeader}><div><p className={orgStyles.panelKicker}>Chỉnh sửa</p><h3>Kho hàng</h3></div><button type="button" className={orgStyles.modalClose} onClick={() => setWarehouseEditorId(null)}>Đóng</button></div><form className={orgStyles.form} onSubmit={(event) => void saveWarehouseEdit(event)}><label>Chi nhánh quản lý<select value={warehouseDraft.branchId} onChange={(event) => setWarehouseDraft((current) => ({ ...current, branchId: event.target.value }))} required>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>)}</select></label><label>Mã kho<input value={warehouseDraft.code} onChange={(event) => setWarehouseDraft((current) => ({ ...current, code: event.target.value }))} required /></label><label>Tên kho<input value={warehouseDraft.name} onChange={(event) => setWarehouseDraft((current) => ({ ...current, name: event.target.value }))} required /></label><label>Loại kho<select value={warehouseDraft.warehouseType} onChange={(event) => setWarehouseDraft((current) => ({ ...current, warehouseType: event.target.value }))}>{warehouseTypes.map((type) => <option key={type} value={type}>{warehouseTypeLabels[type]}</option>)}</select></label><label>Xuất vượt tồn<select value={warehouseDraft.allowNegativeStock ? 'allow' : 'deny'} onChange={(event) => setWarehouseDraft((current) => ({ ...current, allowNegativeStock: event.target.value === 'allow' }))}><option value="deny">Không cho phép xuất vượt tồn</option><option value="allow">Cho phép xuất vượt tồn khả dụng</option></select></label><div className={orgStyles.formActions}><button type="button" className={orgStyles.secondaryButton} onClick={() => setWarehouseEditorId(null)}>Hủy</button><button type="submit" className={orgStyles.primaryButton} disabled={busy !== null}>Lưu thay đổi</button></div></form></div></div>
        ) : null}

        {locationEditor ? (
          <div className={orgStyles.modalBackdrop} role="presentation" onClick={() => setLocationEditor(null)}><div className={orgStyles.modal} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><div className={orgStyles.modalHeader}><div><p className={orgStyles.panelKicker}>{locationEditor.mode === 'create' ? 'Thêm mới' : 'Chỉnh sửa'}</p><h3>Khu vực trong kho</h3></div><button type="button" className={orgStyles.modalClose} onClick={() => setLocationEditor(null)}>Đóng</button></div><form className={orgStyles.form} onSubmit={(event) => void saveLocation(event)}><label>Kho<select value={locationDraft.warehouseId} onChange={(event) => setLocationDraft((current) => ({ ...current, warehouseId: event.target.value }))} required disabled={locationEditor.mode === 'create'}>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label><label>Mã khu vực<input value={locationDraft.code} onChange={(event) => setLocationDraft((current) => ({ ...current, code: event.target.value }))} required maxLength={64} /></label><label>Tên khu vực<input value={locationDraft.name} onChange={(event) => setLocationDraft((current) => ({ ...current, name: event.target.value }))} required maxLength={256} /></label><label>Loại khu vực<select value={locationDraft.locationType} onChange={(event) => setLocationDraft((current) => ({ ...current, locationType: event.target.value }))}>{locationTypes.map((type) => <option key={type} value={type}>{locationTypeLabels[type]}</option>)}</select></label><div className={orgStyles.formActions}><button type="button" className={orgStyles.secondaryButton} onClick={() => setLocationEditor(null)}>Hủy</button><button type="submit" className={orgStyles.primaryButton} disabled={busy !== null}>{locationEditor.mode === 'create' ? 'Thêm khu vực' : 'Lưu thay đổi'}</button></div></form></div></div>
        ) : null}

        {locationModeState && selectedWarehouse ? (
          <div className={orgStyles.modalBackdrop} role="presentation" onClick={() => setLocationModeState(null)}><div className={orgStyles.modal} role="dialog" aria-modal="true" aria-labelledby="warehouse-layout-mode-title" onClick={(event) => event.stopPropagation()}><div className={orgStyles.modalHeader}><div><p className={orgStyles.panelKicker}>Thiết lập kho</p><h3 id="warehouse-layout-mode-title">Thiết lập sơ đồ kho</h3></div><button type="button" className={orgStyles.modalClose} onClick={() => setLocationModeState(null)}>Đóng</button></div><p className={orgStyles.confirmText}>Kho {selectedWarehouse.code} · {selectedWarehouse.name} hiện {warehouseLayoutLabel(selectedWarehouse).toLowerCase()}. Hệ thống chỉ thay đổi sau khi xem trước và xác nhận.</p><div className={orgStyles.form}><label>Chế độ sơ đồ kho<select value={locationModeState.targetMode} onChange={(event) => setLocationModeState((current) => current ? { ...current, targetMode: event.target.value as LocationManagementMode, destinationLocationId: '', preview: null } : current)}><option value="MANAGED">Có sơ đồ kho</option><option value="UNMANAGED">Không dùng sơ đồ</option></select></label>{locationModeState.targetMode === 'MANAGED' ? <label>Khu vực nhận hàng ban đầu<select value={locationModeState.destinationLocationId} onChange={(event) => setLocationModeState((current) => current ? { ...current, destinationLocationId: event.target.value, preview: null } : current)} required><option value="">Chọn khu vực lưu trữ</option>{storageLocations.map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</select><small>Chọn khu vực nhận hàng ban đầu để chuyển tồn chung vào sơ đồ. Hệ thống không tự gán khu vực.</small></label> : null}{locationModeState.preview ? <section><p className={orgStyles.panelKicker}>Kết quả xem trước</p><p className={orgStyles.confirmText}>{locationModeState.preview.targetMode === 'MANAGED' ? `Tồn chung sẽ được chuyển vào ${locationModeState.preview.destinationLocation?.code ?? 'khu vực đã chọn'}.` : 'Tồn tại các khu vực sẽ được gộp về tồn chung.'}</p><p className={orgStyles.confirmText}>{locationModeState.preview.summary.affectedSkuCount} sản phẩm · {locationModeState.preview.summary.affectedScopeCount} phạm vi tồn · tổng số lượng {locationModeState.preview.summary.totalBaseQuantity}.</p>{locationModeState.preview.blockers.length ? <ul>{locationModeState.preview.blockers.map((blocker) => <li key={blocker.code}>{blocker.message ?? 'Dữ liệu kho cần được đối soát trước khi thay đổi sơ đồ.'}</li>)}</ul> : null}</section> : null}<div className={orgStyles.formActions}><button type="button" className={orgStyles.secondaryButton} onClick={() => setLocationModeState(null)}>Hủy</button><button type="button" className={orgStyles.secondaryButton} onClick={() => void previewLayoutMode()} disabled={busy !== null || (locationModeState.targetMode === 'MANAGED' && !locationModeState.destinationLocationId)}>Xem trước thay đổi</button><button type="button" className={orgStyles.primaryButton} onClick={() => void confirmLayoutMode()} disabled={busy !== null || !locationModeState.preview?.canConvert}>Xác nhận thay đổi</button></div></div></div></div>
        ) : null}

        {confirmState ? (
          <div className={orgStyles.modalBackdrop} role="presentation" onClick={() => setConfirmState(null)}><div className={`${orgStyles.modal} ${orgStyles.confirmModal}`} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><div className={orgStyles.modalHeader}><div><p className={orgStyles.panelKicker}>Xác nhận trạng thái</p><h3>{confirmState.nextActive ? 'Đưa vào sử dụng' : 'Ngừng sử dụng'}</h3></div><button type="button" className={orgStyles.modalClose} onClick={() => setConfirmState(null)}>Đóng</button></div><p className={orgStyles.confirmText}>{confirmState.resource === 'warehouse' ? `Bạn muốn ${confirmState.nextActive ? 'đưa vào sử dụng' : 'ngừng sử dụng'} kho hàng này?` : `Bạn muốn ${confirmState.nextActive ? 'đưa vào sử dụng' : 'ngừng sử dụng'} khu vực trong kho này?`}</p><div className={orgStyles.formActions}><button type="button" className={orgStyles.secondaryButton} onClick={() => setConfirmState(null)}>Hủy</button><button type="button" className={orgStyles.primaryButton} onClick={() => void confirmStatusChange()} disabled={busy !== null}>Xác nhận</button></div></div></div>
        ) : null}
      </section>
    </AppShell>
  );
}
