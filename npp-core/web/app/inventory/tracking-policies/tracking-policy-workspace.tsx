'use client';

import { useMemo, useRef, useState } from 'react';
import { createIdempotencyKey } from '@npp/contracts';
import { AppShell } from '../../components/app-shell';
import {
  BusinessTableSequenceCell,
  BusinessTableSequenceHeader,
} from '../../components/business-table-sequence';
import styles from '../inventory-workspace.module.css';
import {
  normalizeSearch,
  matchTerm,
  type InventoryTrackingPolicy,
} from '../../../lib/inventory-types';
import type { InventoryTrackingPolicyCandidate } from '../../../lib/inventory-policy-types';

type Props = Readonly<{
  initialPolicies: InventoryTrackingPolicy[];
  initialCandidates: InventoryTrackingPolicyCandidate[];
  initialError?: string | null;
}>;

type Draft = Readonly<{
  baseVariantId: string;
  lotTrackingMode: 'NONE' | 'REQUIRED';
  expiryTrackingMode: 'NONE' | 'OPTIONAL' | 'REQUIRED';
  expectedVersion: string;
}>;

type Envelope<T> = Readonly<{ data?: T; error?: { message?: string } }>;

function emptyDraft(baseVariantId = ''): Draft {
  return { baseVariantId, lotTrackingMode: 'REQUIRED', expiryTrackingMode: 'OPTIONAL', expectedVersion: '' };
}

function lotLabel(value: InventoryTrackingPolicy['lot_tracking_mode']) {
  return value === 'REQUIRED' ? 'Bắt buộc quản lý theo lô' : 'Không quản lý theo lô';
}

function expiryLabel(value: InventoryTrackingPolicy['expiry_tracking_mode']) {
  if (value === 'REQUIRED') return 'Bắt buộc nhập hạn sử dụng';
  if (value === 'OPTIONAL') return 'Có thể nhập hạn sử dụng';
  return 'Không quản lý hạn sử dụng';
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({})) as Envelope<T>;
  if (!response.ok || payload.data === undefined) throw new Error(payload.error?.message || 'Không thực hiện được thao tác.');
  return payload.data;
}

function enrich(saved: InventoryTrackingPolicy, candidate?: InventoryTrackingPolicyCandidate): InventoryTrackingPolicy {
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

export default function TrackingPolicyWorkspace({ initialPolicies, initialCandidates, initialError = null }: Props) {
  const [policies, setPolicies] = useState(initialPolicies);
  const [candidates, setCandidates] = useState(initialCandidates);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const pendingKeys = useRef(new Map<string, string>());
  const term = normalizeSearch(search);

  const filtered = useMemo(() => policies.filter((policy) => !term || matchTerm(
    policy.base_sku,
    policy.base_variant_name,
    policy.product_code,
    policy.product_name,
  ).includes(term)), [policies, term]);

  function choose(baseVariantId: string) {
    const current = policies.find((policy) => policy.base_variant_id === baseVariantId);
    setDraft(current ? {
      baseVariantId: current.base_variant_id,
      lotTrackingMode: current.lot_tracking_mode,
      expiryTrackingMode: current.expiry_tracking_mode,
      expectedVersion: String(current.version),
    } : emptyDraft(baseVariantId));
  }

  async function refresh() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const [nextPolicies, nextCandidates] = await Promise.all([
        requestJson<InventoryTrackingPolicy[]>('/api/inventory/tracking-policies?limit=1000&offset=0'),
        requestJson<InventoryTrackingPolicyCandidate[]>('/api/inventory/tracking-policies/candidates?limit=2000&offset=0'),
      ]);
      setPolicies(nextPolicies);
      setCandidates(nextCandidates);
      setNotice('Dữ liệu đã được làm mới.');
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Không tải được chính sách quản lý lô.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft.baseVariantId) {
      setError('Hãy chọn SKU trước khi lưu chính sách.');
      return;
    }
    const body = {
      baseVariantId: draft.baseVariantId,
      lotTrackingMode: draft.lotTrackingMode,
      expiryTrackingMode: draft.expiryTrackingMode,
      ...(draft.expectedVersion ? { expectedVersion: Number(draft.expectedVersion) } : {}),
    };
    const fingerprint = JSON.stringify(body);
    let key = pendingKeys.current.get(fingerprint);
    if (!key) {
      key = createIdempotencyKey('inventory-policy-save');
      pendingKeys.current.set(fingerprint, key);
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await requestJson<InventoryTrackingPolicy>(`/api/inventory/tracking-policies/${draft.baseVariantId}`, {
        method: 'PUT',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(body),
      });
      pendingKeys.current.delete(fingerprint);
      const candidate = candidates.find((item) => item.base_variant_id === draft.baseVariantId);
      const next = enrich(saved, candidate);
      setPolicies((current) => [...current.filter((item) => item.base_variant_id !== next.base_variant_id), next]
        .sort((left, right) => left.base_sku.localeCompare(right.base_sku)));
      setCandidates((current) => current.map((item) => item.base_variant_id === next.base_variant_id ? { ...item, has_policy: true } : item));
      setDraft({
        baseVariantId: next.base_variant_id,
        lotTrackingMode: next.lot_tracking_mode,
        expiryTrackingMode: next.expiry_tracking_mode,
        expectedVersion: String(next.version),
      });
      setNotice('Chính sách lô và hạn sử dụng đã được lưu.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không lưu được chính sách quản lý lô.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title="Chính sách quản lý lô"
      subtitle="Thiết lập quản lý lô và hạn sử dụng theo SKU. Quản lý vị trí được thiết lập tại Kho hàng."
      kicker="Tồn kho và lô hàng"
    >
      <div className={styles.page} data-testid="inventory-tracking-policies-page">
        <section className={`${styles.hero} ${styles.compactHero}`}>
          <div className={styles.heroControls}>
            <div className={styles.toolbar}>
              <input className={styles.searchInput} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm theo SKU hoặc tên hàng" />
            </div>
            <div className={styles.actionRow}>
              <button type="button" className={styles.primaryAction} disabled={busy} onClick={() => void refresh()}>{busy ? 'Đang xử lý...' : 'Làm mới dữ liệu'}</button>
            </div>
          </div>
          {error ? <div className={`${styles.banner} ${styles.bannerError}`}>{error}</div> : null}
          {notice ? <div className={`${styles.banner} ${styles.bannerSuccess}`}>{notice}</div> : null}
        </section>

        <section className={styles.section}>
          <div className={styles.twoColumnForm}>
            <div className={styles.panel}>
              <h3 className={styles.panelTitle}>Danh sách chính sách</h3>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><BusinessTableSequenceHeader /><th>SKU</th><th>Lô</th><th>Hạn dùng</th><th></th></tr></thead>
                  <tbody>
                    {filtered.length === 0 ? <tr><td colSpan={5} className={styles.subtle}>Chưa có chính sách lô.</td></tr> : filtered.map((policy, rowIndex) => (
                      <tr key={policy.base_variant_id}>
                        <BusinessTableSequenceCell rowIndex={rowIndex} />
                        <td><div className={styles.mono}>{policy.base_sku}</div><div className={styles.subtle}>{policy.product_code} · {policy.product_name}</div></td>
                        <td><span className={styles.pill}>{lotLabel(policy.lot_tracking_mode)}</span></td>
                        <td><span className={styles.pill}>{expiryLabel(policy.expiry_tracking_mode)}</span></td>
                        <td><button type="button" className={styles.miniButton} onClick={() => choose(policy.base_variant_id)}>Sửa</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <form className={styles.panel} onSubmit={(event) => { event.preventDefault(); void save(); }}>
              <h3 className={styles.panelTitle}>Tạo hoặc sửa chính sách</h3>
              <p className={styles.panelCopy}>Vị trí không còn thiết lập theo SKU. Muốn thay đổi cách quản lý vị trí, vào Cơ cấu Công Ty → Kho hàng.</p>
              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span>SKU hàng hóa</span>
                  <select className={styles.selectInput} value={draft.baseVariantId} onChange={(event) => choose(event.target.value)}>
                    <option value="">Chọn SKU</option>
                    {candidates.map((candidate) => (
                      <option key={candidate.base_variant_id} value={candidate.base_variant_id} disabled={!candidate.base_variant_active || !candidate.product_active}>
                        {candidate.base_sku} — {candidate.product_name}{candidate.has_policy ? ' · đã có chính sách' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Quản lý lô</span>
                  <select className={styles.selectInput} value={draft.lotTrackingMode} onChange={(event) => setDraft((current) => ({ ...current, lotTrackingMode: event.target.value as Draft['lotTrackingMode'] }))}>
                    <option value="NONE">Không quản lý theo lô</option>
                    <option value="REQUIRED">Bắt buộc quản lý theo lô</option>
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Hạn sử dụng</span>
                  <select className={styles.selectInput} value={draft.expiryTrackingMode} onChange={(event) => setDraft((current) => ({ ...current, expiryTrackingMode: event.target.value as Draft['expiryTrackingMode'] }))}>
                    <option value="NONE">Không quản lý hạn sử dụng</option>
                    <option value="OPTIONAL">Có thể nhập hạn sử dụng</option>
                    <option value="REQUIRED">Bắt buộc nhập hạn sử dụng</option>
                  </select>
                </label>
              </div>
              <div className={styles.rowActions}>
                <button type="submit" className={styles.primaryAction} disabled={busy || !draft.baseVariantId}>{busy ? 'Đang lưu...' : 'Lưu chính sách'}</button>
              </div>
            </form>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
