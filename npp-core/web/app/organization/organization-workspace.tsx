'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import styles from './organization.module.css';

type EntityBase = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  updated_at: string;
};

type Branch = EntityBase & {
  address: string | null;
  phone: string | null;
  email: string | null;
};

type Warehouse = EntityBase & {
  branch_id: string;
  warehouse_type: string;
};

type WarehouseLocation = EntityBase & {
  warehouse_id: string;
  location_type: string;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean };
};

const warehouseTypes = ['main', 'distribution', 'vehicle', 'quarantine', 'returns', 'transit', 'other'];
const locationTypes = ['storage', 'receiving', 'shipping', 'quarantine', 'returns', 'damaged', 'other'];

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message || 'Request failed');
  }
  return payload.data;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString('vi-VN');
}

function StatusBadge({ active }: { active: boolean }) {
  return <span className={`${styles.badge} ${active ? styles.active : styles.inactive}`}>{active ? 'Active' : 'Inactive'}</span>;
}

function EmptyState({ children }: { children: string }) {
  return <div className={styles.empty}>{children}</div>;
}

export default function OrganizationWorkspace() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [branchCode, setBranchCode] = useState('');
  const [branchName, setBranchName] = useState('');
  const [warehouseBranchId, setWarehouseBranchId] = useState('');
  const [warehouseCode, setWarehouseCode] = useState('');
  const [warehouseName, setWarehouseName] = useState('');
  const [warehouseType, setWarehouseType] = useState('main');
  const [locationWarehouseId, setLocationWarehouseId] = useState('');
  const [locationCode, setLocationCode] = useState('');
  const [locationName, setLocationName] = useState('');
  const [locationType, setLocationType] = useState('storage');

  const branchById = useMemo(() => new Map(branches.map((branch) => [branch.id, branch])), [branches]);
  const warehouseById = useMemo(() => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse])), [warehouses]);
  const activeBranches = useMemo(() => branches.filter((branch) => branch.is_active), [branches]);
  const activeWarehouses = useMemo(() => warehouses.filter((warehouse) => warehouse.is_active), [warehouses]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextBranches, nextWarehouses, nextLocations] = await Promise.all([
        apiRequest<Branch[]>('/api/organization/branches?limit=1000'),
        apiRequest<Warehouse[]>('/api/organization/warehouses?limit=1000'),
        apiRequest<WarehouseLocation[]>('/api/organization/warehouse-locations?limit=1000'),
      ]);
      setBranches(nextBranches);
      setWarehouses(nextWarehouses);
      setLocations(nextLocations);
      setWarehouseBranchId((current) => current || nextBranches.find((item) => item.is_active)?.id || '');
      setLocationWarehouseId((current) => current || nextWarehouses.find((item) => item.is_active)?.id || '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load organization data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function runMutation(key: string, action: () => Promise<unknown>, successMessage: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successMessage);
      await loadAll();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'Request failed');
    } finally {
      setBusy(null);
    }
  }

  async function createBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runMutation(
      'create-branch',
      () => apiRequest<Branch>('/api/organization/branches', {
        method: 'POST',
        headers: { 'Idempotency-Key': `web-${crypto.randomUUID()}` },
        body: JSON.stringify({ code: branchCode, name: branchName }),
      }),
      'Branch created.',
    );
    setBranchCode('');
    setBranchName('');
  }

  async function createWarehouse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runMutation(
      'create-warehouse',
      () => apiRequest<Warehouse>('/api/organization/warehouses', {
        method: 'POST',
        headers: { 'Idempotency-Key': `web-${crypto.randomUUID()}` },
        body: JSON.stringify({ branchId: warehouseBranchId, code: warehouseCode, name: warehouseName, warehouseType }),
      }),
      'Warehouse created.',
    );
    setWarehouseCode('');
    setWarehouseName('');
  }

  async function createLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runMutation(
      'create-location',
      () => apiRequest<WarehouseLocation>('/api/organization/warehouse-locations', {
        method: 'POST',
        headers: { 'Idempotency-Key': `web-${crypto.randomUUID()}` },
        body: JSON.stringify({ warehouseId: locationWarehouseId, code: locationCode, name: locationName, locationType }),
      }),
      'Warehouse location created.',
    );
    setLocationCode('');
    setLocationName('');
  }

  async function toggleStatus(resource: string, entity: EntityBase) {
    await runMutation(
      `toggle-${resource}-${entity.id}`,
      () => apiRequest(`/api/organization/${resource}/${entity.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !entity.is_active, expectedUpdatedAt: entity.updated_at }),
      }),
      `${entity.name} ${entity.is_active ? 'deactivated' : 'activated'}.`,
    );
  }

  return (
    <main className={styles.page} data-testid="organization-page">
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>Phase 3 · Master data</p>
          <h1>Organization & warehouse structure</h1>
          <p className={styles.lead}>Manage the installation hierarchy from branches to warehouses and storage locations.</p>
        </div>
        <button type="button" className={styles.refresh} onClick={() => void loadAll()} disabled={loading || busy !== null}>
          {loading ? 'Loading…' : 'Refresh data'}
        </button>
      </header>

      <section className={styles.metrics} aria-label="Organization totals">
        <article><span>Branches</span><strong data-testid="branch-count">{branches.length}</strong><small>{branches.filter((item) => item.is_active).length} active</small></article>
        <article><span>Warehouses</span><strong data-testid="warehouse-count">{warehouses.length}</strong><small>{warehouses.filter((item) => item.is_active).length} active</small></article>
        <article><span>Locations</span><strong data-testid="location-count">{locations.length}</strong><small>{locations.filter((item) => item.is_active).length} active</small></article>
      </section>

      {(error || notice) && (
        <div className={error ? styles.error : styles.notice} role="status" data-testid={error ? 'organization-error' : 'organization-notice'}>
          {error || notice}
        </div>
      )}

      <section className={styles.grid}>
        <article className={styles.panel}>
          <div className={styles.panelHeader}><div><span>Level 1</span><h2>Branches</h2></div><b>{branches.length}</b></div>
          <form className={styles.form} onSubmit={(event) => void createBranch(event)}>
            <label>Code<input data-testid="branch-code-input" value={branchCode} onChange={(event) => setBranchCode(event.target.value)} required maxLength={64} placeholder="HCM" /></label>
            <label>Name<input data-testid="branch-name-input" value={branchName} onChange={(event) => setBranchName(event.target.value)} required maxLength={256} placeholder="Ho Chi Minh branch" /></label>
            <button data-testid="create-branch" disabled={busy !== null || !branchCode.trim() || !branchName.trim()}>{busy === 'create-branch' ? 'Creating…' : 'Create branch'}</button>
          </form>
          <div className={styles.list} data-testid="branch-list">
            {!loading && branches.length === 0 && <EmptyState>No branches yet.</EmptyState>}
            {branches.map((branch) => (
              <div className={styles.row} key={branch.id} data-testid={`branch-${branch.code}`}>
                <div><div className={styles.rowTitle}><code>{branch.code}</code><StatusBadge active={branch.is_active} /></div><strong>{branch.name}</strong><small>Updated {formatDate(branch.updated_at)}</small></div>
                <button type="button" onClick={() => void toggleStatus('branches', branch)} disabled={busy !== null}>{branch.is_active ? 'Deactivate' : 'Activate'}</button>
              </div>
            ))}
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeader}><div><span>Level 2</span><h2>Warehouses</h2></div><b>{warehouses.length}</b></div>
          <form className={styles.form} onSubmit={(event) => void createWarehouse(event)}>
            <label>Branch<select data-testid="warehouse-branch-select" value={warehouseBranchId} onChange={(event) => setWarehouseBranchId(event.target.value)} required><option value="">Select branch</option>{activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>)}</select></label>
            <label>Code<input data-testid="warehouse-code-input" value={warehouseCode} onChange={(event) => setWarehouseCode(event.target.value)} required maxLength={64} placeholder="MAIN-WH" /></label>
            <label>Name<input data-testid="warehouse-name-input" value={warehouseName} onChange={(event) => setWarehouseName(event.target.value)} required maxLength={256} placeholder="Main warehouse" /></label>
            <label>Type<select data-testid="warehouse-type-select" value={warehouseType} onChange={(event) => setWarehouseType(event.target.value)}>{warehouseTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
            <button data-testid="create-warehouse" disabled={busy !== null || !warehouseBranchId || !warehouseCode.trim() || !warehouseName.trim()}>{busy === 'create-warehouse' ? 'Creating…' : 'Create warehouse'}</button>
          </form>
          <div className={styles.list} data-testid="warehouse-list">
            {!loading && warehouses.length === 0 && <EmptyState>No warehouses yet.</EmptyState>}
            {warehouses.map((warehouse) => (
              <div className={styles.row} key={warehouse.id} data-testid={`warehouse-${warehouse.code}`}>
                <div><div className={styles.rowTitle}><code>{warehouse.code}</code><StatusBadge active={warehouse.is_active} /></div><strong>{warehouse.name}</strong><small>{branchById.get(warehouse.branch_id)?.name || 'Unknown branch'} · {warehouse.warehouse_type}</small></div>
                <button type="button" onClick={() => void toggleStatus('warehouses', warehouse)} disabled={busy !== null}>{warehouse.is_active ? 'Deactivate' : 'Activate'}</button>
              </div>
            ))}
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeader}><div><span>Level 3</span><h2>Warehouse locations</h2></div><b>{locations.length}</b></div>
          <form className={styles.form} onSubmit={(event) => void createLocation(event)}>
            <label>Warehouse<select data-testid="location-warehouse-select" value={locationWarehouseId} onChange={(event) => setLocationWarehouseId(event.target.value)} required><option value="">Select warehouse</option>{activeWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
            <label>Code<input data-testid="location-code-input" value={locationCode} onChange={(event) => setLocationCode(event.target.value)} required maxLength={64} placeholder="A-01" /></label>
            <label>Name<input data-testid="location-name-input" value={locationName} onChange={(event) => setLocationName(event.target.value)} required maxLength={256} placeholder="Rack A01" /></label>
            <label>Type<select data-testid="location-type-select" value={locationType} onChange={(event) => setLocationType(event.target.value)}>{locationTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
            <button data-testid="create-location" disabled={busy !== null || !locationWarehouseId || !locationCode.trim() || !locationName.trim()}>{busy === 'create-location' ? 'Creating…' : 'Create location'}</button>
          </form>
          <div className={styles.list} data-testid="location-list">
            {!loading && locations.length === 0 && <EmptyState>No warehouse locations yet.</EmptyState>}
            {locations.map((location) => (
              <div className={styles.row} key={location.id} data-testid={`location-${location.code}`}>
                <div><div className={styles.rowTitle}><code>{location.code}</code><StatusBadge active={location.is_active} /></div><strong>{location.name}</strong><small>{warehouseById.get(location.warehouse_id)?.name || 'Unknown warehouse'} · {location.location_type}</small></div>
                <button data-testid={`toggle-location-${location.code}`} type="button" onClick={() => void toggleStatus('warehouse-locations', location)} disabled={busy !== null}>{location.is_active ? 'Deactivate' : 'Activate'}</button>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
