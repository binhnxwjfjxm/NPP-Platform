'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createIdempotencyKey } from '@npp/contracts';
import { AppShell } from '../components/app-shell';
import {
  BusinessTableSequenceCell,
  BusinessTableSequenceHeader,
} from '../components/business-table-sequence';
import styles from './inventory-workspace.module.css';
import {
  formatDate,
  formatDateTime,
  formatQuantity,
  matchTerm,
  normalizeSearch,
  type InventoryBalance,
  type InventoryLot,
  type InventoryMovementLine,
  type InventorySnapshot,
  type InventoryTrackingPolicy,
} from '../../lib/inventory-types';
import { collectInventoryPages, withInventoryPage } from '../../lib/inventory-pagination';
import type { InventoryTrackingPolicyCandidate } from '../../lib/inventory-policy-types';

type InventoryScope = 'balances' | 'tracking-policies' | 'lots';

type Props = {
  scope: InventoryScope;
  title: string;
  subtitle: string;
  initialSnapshot: InventorySnapshot;
  initialCandidates?: InventoryTrackingPolicyCandidate[];
  initialError?: string | null;
};

type Notice = { kind: 'success' | 'error'; message: string } | null;

type PolicyDraft = {
  baseVariantId: string;
  lotTrackingMode: 'NONE' | 'REQUIRED';
  expiryTrackingMode: 'NONE' | 'OPTIONAL' | 'REQUIRED';
  locationRequired: boolean;
  expectedVersion: string;
};

type RequestEnvelope<T> = {
  data?: T;
  error?: { message?: string };
};

function emptyPolicyDraft(baseVariantId = ''): PolicyDraft {
  return {
    baseVariantId,
    lotTrackingMode: 'REQUIRED',
    expiryTrackingMode: 'OPTIONAL',
    locationRequired: false,
    expectedVersion: '',
  };
}

function tableEmpty(message: string, colSpan = 8) {
  return <tr><td colSpan={colSpan} className={styles.subtle}>{message}</td></tr>;
}

function balanceKey(balance: InventoryBalance): string {
  return [balance.warehouse_id, balance.location_id ?? '<null>', balance.base_variant_id, balance.lot_id ?? '<null>'].join(':');
}

function joinValues(...values: Array<string | null | undefined>): string {
  return values.filter(Boolean).join(' · ');
}

function lotTrackingLabel(value: InventoryTrackingPolicy['lot_tracking_mode']) {
  return value === 'REQUIRED' ? 'Bắt buộc quản lý theo lô' : 'Không quản lý theo lô';
}

function expiryTrackingLabel(value: InventoryTrackingPolicy['expiry_tracking_mode']) {
  if (value === 'REQUIRED') return 'Bắt buộc nhập hạn sử dụng';
  if (value === 'OPTIONAL') return 'Có thể nhập hạn sử dụng';
  return 'Không quản lý hạn sử dụng';
}

function movementDirectionLabel(value: InventoryMovementLine['direction']) {
  return value === 'IN' ? 'Nhập kho' : 'Xuất kho';
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
  const payload = (await response.json().catch(() => ({}))) as RequestEnvelope<T>;
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message || 'Không thể tải dữ liệu tồn kho. Vui lòng thử lại.');
  }
  return payload.data;
}

async function requestAllInventoryPages<T>(path: string, pageSize: number): Promise<T[]> {
  const endpoint = new URL(path, 'http://inventory.local');
  const baseParams = new URLSearchParams(endpoint.search);
  return collectInventoryPages({
    pageSize,
    loadPage: (page) => {
      const params = withInventoryPage(baseParams, page);
      const query = params.toString();
      return requestJson<T[]>(`${endpoint.pathname}${query ? `?${query}` : ''}`);
    },
  });
}

function enrichedPolicy(
  saved: InventoryTrackingPolicy,
  candidate: InventoryTrackingPolicyCandidate | undefined,
): InventoryTrackingPolicy {
  return {
    ...saved,
    base_sku: saved.base_sku ?? candidate?.base_sku ?? saved.base_variant_id,
    base_variant_name: saved.base_variant_name ?? candidate?.base_variant_name ?? null,
    base_variant_active: saved.base_variant_active ?? candidate?.base_variant_active ?? true,
    is_inventory_base: saved.is_inventory_base ?? candidate?.is_inventory_base ?? true,
    product_code: saved.product_code ?? candidate?.product_code ?? '—',
    product_name: saved.product_name ?? candidate?.product_name ?? '—',
  };
}

export default function InventoryScopedWorkspace({
  scope,
  title,
  subtitle,
  initialSnapshot,
  initialCandidates = [],
  initialError = null,
}: Props) {
  const [balances, setBalances] = useState(initialSnapshot.balances);
  const [lots, setLots] = useState(initialSnapshot.lots);
  const [policies, setPolicies] = useState(initialSnapshot.trackingPolicies);
  const [candidates, setCandidates] = useState(initialCandidates);
  const [selectedBalance, setSelectedBalance] = useState<InventoryBalance | null>(initialSnapshot.balances[0] ?? null);
  const [drillDown, setDrillDown] = useState<InventoryMovementLine[]>([]);
  const [policyDraft, setPolicyDraft] = useState<PolicyDraft>(emptyPolicyDraft());
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<Notice>(null);
  const policyKeys = useRef(new Map<string, string>());

  const normalizedSearch = normalizeSearch(search);
  const filteredBalances = useMemo(() => balances.filter((balance) => !normalizedSearch || matchTerm(
    balance.warehouse_code,
    balance.warehouse_name,
    balance.location_code,
    balance.location_name,
    balance.base_sku,
    balance.base_variant_name,
    balance.lot_code,
    balance.expiry_date,
  ).includes(normalizedSearch)), [balances, normalizedSearch]);
  const filteredLots = useMemo(() => lots.filter((lot) => !normalizedSearch || matchTerm(
    lot.lot_code,
    lot.normalized_lot_code,
    lot.base_sku,
    lot.product_code,
    lot.product_name,
    lot.expiry_date,
    lot.supplier_lot_reference,
  ).includes(normalizedSearch)), [lots, normalizedSearch]);
  const filteredPolicies = useMemo(() => policies.filter((policy) => !normalizedSearch || matchTerm(
    policy.base_sku,
    policy.base_variant_name,
    policy.product_code,
    policy.product_name,
  ).includes(normalizedSearch)), [policies, normalizedSearch]);

  useEffect(() => {
    if (!selectedBalance && balances.length > 0) setSelectedBalance(balances[0]);
  }, [balances, selectedBalance]);

  const searchPlaceholder = scope === 'balances'
    ? 'Tìm theo kho, vị trí, SKU hoặc lô'
    : scope === 'tracking-policies'
      ? 'Tìm theo SKU hoặc tên hàng'
      : 'Tìm theo SKU, mã lô hoặc hạn dùng';

  async function refreshCurrent() {
    setBusy('refresh');
    setError(null);
    setNotice(null);
    try {
      if (scope === 'balances') {
        setBalances(await requestAllInventoryPages<InventoryBalance>('/api/inventory/balances', 1000));
      } else if (scope === 'lots') {
        setLots(await requestAllInventoryPages<InventoryLot>('/api/inventory/lots', 1000));
      } else {
        const [nextPolicies, nextCandidates] = await Promise.all([
          requestAllInventoryPages<InventoryTrackingPolicy>('/api/inventory/tracking-policies', 1000),
          requestAllInventoryPages<InventoryTrackingPolicyCandidate>('/api/inventory/tracking-policies/candidates', 2000),
        ]);
        setPolicies(nextPolicies);
        setCandidates(nextCandidates);
      }
      setNotice({ kind: 'success', message: 'Dữ liệu đã được làm mới.' });
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Không tải được dữ liệu tồn kho');
    } finally {
      setBusy(null);
    }
  }

  async function loadDrillDown(balance: InventoryBalance) {
    setBusy(`drill-${balanceKey(balance)}`);
    setSelectedBalance(balance);
    setError(null);
    try {
      const params = new URLSearchParams({ warehouseId: balance.warehouse_id, baseVariantId: balance.base_variant_id });
      if (balance.location_id) params.set('locationId', balance.location_id);
      if (balance.lot_id) params.set('lotId', balance.lot_id);
      setDrillDown(await requestJson<InventoryMovementLine[]>(`/api/inventory/balances/drill-down?${params.toString()}`));
    } catch (drillError) {
      setError(drillError instanceof Error ? drillError.message : 'Không tải được phần chi tiết');
    } finally {
      setBusy(null);
    }
  }

  function choosePolicyCandidate(baseVariantId: string) {
    const current = policies.find((policy) => policy.base_variant_id === baseVariantId);
    setPolicyDraft(current ? {
      baseVariantId: current.base_variant_id,
      lotTrackingMode: current.lot_tracking_mode,
      expiryTrackingMode: current.expiry_tracking_mode,
      locationRequired: current.location_required,
      expectedVersion: String(current.version),
    } : emptyPolicyDraft(baseVariantId));
  }

  function policyOperationKey(identity: string) {
    const existing = policyKeys.current.get(identity);
    if (existing) return existing;
    const created = createIdempotencyKey('inventory-policy-save');
    policyKeys.current.set(identity, created);
    return created;
  }

  async function savePolicy() {
    if (!policyDraft.baseVariantId) {
      setError('Hãy chọn SKU trước khi lưu chính sách.');
      return;
    }
    setBusy('policy-save');
    setError(null);
    setNotice(null);
    const body = {
      baseVariantId: policyDraft.baseVariantId,
      lotTrackingMode: policyDraft.lotTrackingMode,
      expiryTrackingMode: policyDraft.expiryTrackingMode,
      locationRequired: policyDraft.locationRequired,
      ...(policyDraft.expectedVersion ? { expectedVersion: Number(policyDraft.expectedVersion) } : {}),
    };
    const identity = JSON.stringify(body);
    try {
      const saved = await requestJson<InventoryTrackingPolicy>(`/api/inventory/tracking-policies/${policyDraft.baseVariantId}`, {
        method: 'PUT',
        headers: { 'Idempotency-Key': policyOperationKey(identity) },
        body: JSON.stringify(body),
      });
      policyKeys.current.delete(identity);
      const candidate = candidates.find((item) => item.base_variant_id === policyDraft.baseVariantId);
      const nextPolicy = enrichedPolicy(saved, candidate);
      setPolicies((current) => [...current.filter((item) => item.base_variant_id !== nextPolicy.base_variant_id), nextPolicy]
        .sort((left, right) => left.base_sku.localeCompare(right.base_sku)));
      setCandidates((current) => current.map((item) => item.base_variant_id === nextPolicy.base_variant_id
        ? { ...item, has_policy: true }
        : item));
      setPolicyDraft({
        baseVariantId: nextPolicy.base_variant_id,
        lotTrackingMode: nextPolicy.lot_tracking_mode,
        expiryTrackingMode: nextPolicy.expiry_tracking_mode,
        locationRequired: nextPolicy.location_required,
        expectedVersion: String(nextPolicy.version),
      });
      setNotice({ kind: 'success', message: 'Chính sách lô đã được lưu.' });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không lưu được chính sách lô');
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell title={title} subtitle={subtitle} kicker="Tồn kho, lô và nhập đầu kỳ">
      <div className={styles.page} data-testid={`inventory-${scope}-page`}>
        <section className={`${styles.hero} ${styles.compactHero}`} data-testid="inventory-local-controls">
          <div className={styles.heroControls}>
            <div className={styles.toolbar}>
              <input
                aria-label={searchPlaceholder}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={searchPlaceholder}
                className={styles.searchInput}
                data-testid={`inventory-${scope}-search-input`}
              />
            </div>
            <div className={styles.actionRow}>
              <button type="button" className={styles.primaryAction} onClick={refreshCurrent} disabled={busy === 'refresh'}>
                {busy === 'refresh' ? 'Đang làm mới...' : 'Làm mới dữ liệu'}
              </button>
            </div>
          </div>
          {error ? <div className={`${styles.banner} ${styles.bannerError}`} data-testid="inventory-error">{error}</div> : null}
          {notice ? <div className={`${styles.banner} ${notice.kind === 'success' ? styles.bannerSuccess : styles.bannerError}`}>{notice.message}</div> : null}
        </section>

        {scope === 'balances' ? (
          <section className={styles.section} data-testid="inventory-balances-section">
            <div className={styles.gridTwo}>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><BusinessTableSequenceHeader /><th>Kho / vị trí</th><th>SKU</th><th>Lô</th><th>Hạn dùng</th><th>Tồn thực</th><th>Đã giữ</th><th>Khả dụng</th><th></th></tr></thead>
                  <tbody>
                    {filteredBalances.length === 0 ? tableEmpty('Chưa có số dư tồn kho.', 9) : filteredBalances.map((balance, rowIndex) => (
                      <tr key={balanceKey(balance)}>
                        <BusinessTableSequenceCell rowIndex={rowIndex} />
                        <td><div>{balance.warehouse_code} · {balance.warehouse_name}</div><div className={styles.subtle}>{joinValues(balance.location_code, balance.location_name)}</div></td>
                        <td><div className={styles.mono}>{balance.base_sku}</div><div className={styles.subtle}>{balance.base_variant_name}</div></td>
                        <td className={styles.mono}>{balance.lot_code ?? '—'}</td>
                        <td>{formatDate(balance.expiry_date)}</td>
                        <td className={styles.mono}>{formatQuantity(balance.on_hand_quantity)}</td>
                        <td className={styles.mono}>{formatQuantity(balance.reserved_quantity)}</td>
                        <td className={styles.mono}>{formatQuantity(balance.available_quantity)}</td>
                        <td><button type="button" className={styles.miniButton} onClick={() => loadDrillDown(balance)}>Xem chi tiết</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <aside className={styles.panel} data-testid="inventory-drilldown-panel">
                <h3 className={styles.panelTitle}>Xem chi tiết giao dịch</h3>
                <p className={styles.panelCopy}>{selectedBalance ? `${selectedBalance.warehouse_code} · ${selectedBalance.base_sku}${selectedBalance.lot_code ? ` · Lô ${selectedBalance.lot_code}` : ''}` : 'Chọn một dòng số dư.'}</p>
                {drillDown.length === 0 ? <p className={styles.subtle}>Chưa có giao dịch nào được tải.</p> : (
                  <div className={styles.stack}>{drillDown.map((line) => (
                    <div key={line.id ?? `${line.movement_id}-${line.base_quantity_delta}`} className={styles.banner}>
                      <div className={styles.rowActions}><span className={styles.pill}>{movementDirectionLabel(line.direction)}</span><span className={styles.pill}>{formatQuantity(line.base_quantity_delta)}</span></div>
                      <div className={styles.subtle}>{joinValues(line.base_sku, line.lot_code, line.expiry_date)}</div>
                    </div>
                  ))}</div>
                )}
              </aside>
            </div>
          </section>
        ) : null}

        {scope === 'lots' ? (
          <section className={styles.section} data-testid="inventory-lots-section">
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><BusinessTableSequenceHeader /><th>SKU</th><th>Lô</th><th>Hạn dùng</th><th>Ngày SX</th><th>Tham chiếu nhà cung cấp</th><th>Tạo lúc</th></tr></thead>
                <tbody>
                  {filteredLots.length === 0 ? tableEmpty('Chưa có lô hàng nào.', 7) : filteredLots.map((lot, rowIndex) => (
                    <tr key={lot.id}>
                      <BusinessTableSequenceCell rowIndex={rowIndex} />
                      <td><div className={styles.mono}>{lot.base_sku}</div><div className={styles.subtle}>{lot.product_code} · {lot.product_name}</div></td>
                      <td><div className={styles.mono}>{lot.lot_code}</div><div className={styles.subtle}>{lot.normalized_lot_code}</div></td>
                      <td>{formatDate(lot.expiry_date)}</td>
                      <td>{formatDate(lot.manufactured_date)}</td>
                      <td>{lot.supplier_lot_reference ?? '—'}</td>
                      <td>{formatDateTime(lot.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {scope === 'tracking-policies' ? (
          <section className={styles.section} data-testid="inventory-policies-section">
            <div className={styles.twoColumnForm}>
              <div className={styles.panel}>
                <h3 className={styles.panelTitle}>Danh sách chính sách</h3>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><BusinessTableSequenceHeader /><th>SKU</th><th>Lô</th><th>Hạn dùng</th><th>Vị trí</th><th></th></tr></thead>
                    <tbody>
                      {filteredPolicies.length === 0 ? tableEmpty('Chưa có chính sách lô.', 6) : filteredPolicies.map((policy, rowIndex) => (
                        <tr key={policy.base_variant_id}>
                          <BusinessTableSequenceCell rowIndex={rowIndex} />
                          <td><div className={styles.mono}>{policy.base_sku}</div><div className={styles.subtle}>{policy.product_code} · {policy.product_name}</div></td>
                          <td><span className={styles.pill}>{lotTrackingLabel(policy.lot_tracking_mode)}</span></td>
                          <td><span className={styles.pill}>{expiryTrackingLabel(policy.expiry_tracking_mode)}</span></td>
                          <td>{policy.location_required ? 'Bắt buộc' : 'Không bắt buộc'}</td>
                          <td><button type="button" className={styles.miniButton} onClick={() => choosePolicyCandidate(policy.base_variant_id)}>Sửa</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <form className={styles.panel} onSubmit={(event) => { event.preventDefault(); void savePolicy(); }} data-testid="inventory-policy-editor">
                <h3 className={styles.panelTitle}>Tạo hoặc sửa chính sách</h3>
                <div className={styles.formGrid}>
                  <label className={styles.field}>
                    <span>SKU hàng hóa</span>
                    <select
                      className={styles.selectInput}
                      value={policyDraft.baseVariantId}
                      onChange={(event) => choosePolicyCandidate(event.target.value)}
                      data-testid="inventory-policy-base-variant-select"
                    >
                      <option value="">Chọn SKU</option>
                      {candidates.map((candidate) => (
                        <option
                          key={candidate.base_variant_id}
                          value={candidate.base_variant_id}
                          disabled={!candidate.base_variant_active || !candidate.product_active}
                        >
                          {candidate.base_sku} — {candidate.product_name}{candidate.has_policy ? ' · đã có chính sách' : ''}{!candidate.base_variant_active || !candidate.product_active ? ' · ngừng hoạt động' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span>Chế độ lô</span>
                    <select className={styles.selectInput} value={policyDraft.lotTrackingMode} onChange={(event) => setPolicyDraft((current) => ({ ...current, lotTrackingMode: event.target.value as PolicyDraft['lotTrackingMode'] }))}>
                      <option value="NONE">Không quản lý theo lô</option>
                      <option value="REQUIRED">Bắt buộc quản lý theo lô</option>
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span>Chế độ hạn dùng</span>
                    <select className={styles.selectInput} value={policyDraft.expiryTrackingMode} onChange={(event) => setPolicyDraft((current) => ({ ...current, expiryTrackingMode: event.target.value as PolicyDraft['expiryTrackingMode'] }))}>
                      <option value="NONE">Không quản lý hạn sử dụng</option>
                      <option value="OPTIONAL">Có thể nhập hạn sử dụng</option>
                      <option value="REQUIRED">Bắt buộc nhập hạn sử dụng</option>
                    </select>
                  </label>
                  <label className={`${styles.field} ${styles.fullWidth}`}>
                    <span className={styles.switchRow}>
                      <input type="checkbox" checked={policyDraft.locationRequired} onChange={(event) => setPolicyDraft((current) => ({ ...current, locationRequired: event.target.checked }))} />
                      <span>Bắt buộc vị trí</span>
                    </span>
                  </label>
                </div>
                <div className={styles.rowActions}>
                  <button type="submit" className={styles.primaryAction} disabled={busy === 'policy-save' || !policyDraft.baseVariantId}>
                    {busy === 'policy-save' ? 'Đang lưu...' : 'Lưu chính sách'}
                  </button>
                </div>
              </form>
            </div>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
