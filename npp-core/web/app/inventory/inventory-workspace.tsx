'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/app-shell';
import shellStyles from '../components/app-shell.module.css';
import styles from './inventory-workspace.module.css';
import {
  formatCompactNumber,
  formatDate,
  formatDateTime,
  formatQuantity,
  inventoryTabs,
  matchTerm,
  normalizeSearch,
  type InventoryBalance,
  type InventoryLot,
  type InventoryMovementLine,
  type InventorySnapshot,
  type InventoryTrackingPolicy,
  type OpeningBalanceImport,
} from '../../lib/inventory-types';

type InventoryScope = 'overview' | 'balances' | 'tracking-policies' | 'lots' | 'opening-balances';

type InventoryWorkspaceProps = {
  scope: InventoryScope;
  title: string;
  subtitle: string;
  initialSnapshot: InventorySnapshot;
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
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
  };
  requestId?: string;
};

function joinValues(...values: Array<string | null | undefined>): string {
  return values.filter(Boolean).join(' · ');
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

function emptyPolicyDraft(): PolicyDraft {
  return {
    baseVariantId: '',
    lotTrackingMode: 'REQUIRED',
    expiryTrackingMode: 'OPTIONAL',
    locationRequired: false,
    expectedVersion: '',
  };
}

function tableEmpty(message: string) {
  return (
    <tr>
      <td colSpan={8} className={styles.subtle}>{message}</td>
    </tr>
  );
}

function policyLabel(policy: InventoryTrackingPolicy): string {
  return `${policy.base_sku}${policy.base_variant_name ? ` — ${policy.base_variant_name}` : ''}`;
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

function balanceKey(balance: InventoryBalance): string {
  return [balance.warehouse_id, balance.location_id ?? '<null>', balance.base_variant_id, balance.lot_id ?? '<null>'].join(':');
}

function isCurrentSection(scope: InventoryScope, target: InventoryScope): boolean {
  return scope === target || (scope === 'overview' && target === 'balances');
}

export default function InventoryWorkspace({ scope, title, subtitle, initialSnapshot, initialError = null }: InventoryWorkspaceProps) {
  const [trackingPolicies, setTrackingPolicies] = useState<InventoryTrackingPolicy[]>(initialSnapshot.trackingPolicies);
  const [lots, setLots] = useState<InventoryLot[]>(initialSnapshot.lots);
  const [balances, setBalances] = useState<InventoryBalance[]>(initialSnapshot.balances);
  const [openingBalances, setOpeningBalances] = useState(initialSnapshot.openingBalances);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<Notice>(null);
  const [search, setSearch] = useState('');
  const [selectedBalance, setSelectedBalance] = useState<InventoryBalance | null>(balances[0] ?? null);
  const [drillDown, setDrillDown] = useState<InventoryMovementLine[]>([]);
  const [policyDraft, setPolicyDraft] = useState<PolicyDraft>(emptyPolicyDraft());

  const normalizedSearch = normalizeSearch(search);

  const counts = useMemo(() => ({
    balances: balances.length,
    lots: lots.length,
    policies: trackingPolicies.length,
    imports: openingBalances.length,
  }), [balances.length, lots.length, trackingPolicies.length, openingBalances.length]);

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
    lot.expiry_date,
    lot.supplier_lot_reference,
  ).includes(normalizedSearch)), [lots, normalizedSearch]);

  const filteredPolicies = useMemo(() => trackingPolicies.filter((policy) => !normalizedSearch || matchTerm(
    policy.base_sku,
    policy.base_variant_name,
    policy.product_code,
    policy.product_name,
  ).includes(normalizedSearch)), [normalizedSearch, trackingPolicies]);

  const filteredImports = useMemo(() => openingBalances.filter((item) => !normalizedSearch || matchTerm(
    item.source_key,
    item.source_filename,
    item.document_date,
    item.request_id,
  ).includes(normalizedSearch)), [normalizedSearch, openingBalances]);

  const activeTab = inventoryTabs.find((tab) => tab.href === (scope === 'overview' ? '/inventory/balances' : `/inventory/${scope}`)) ?? inventoryTabs[0];

  useEffect(() => {
    if (!selectedBalance && balances.length > 0) {
      setSelectedBalance(balances[0]);
    }
  }, [balances, selectedBalance]);

  async function refreshAll() {
    setBusy('refresh');
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const [nextBalances, nextLots, nextPolicies, nextImports] = await Promise.all([
        requestJson<InventoryBalance[]>('/api/inventory/balances?limit=500'),
        requestJson<InventoryLot[]>('/api/inventory/lots?limit=500'),
        requestJson<InventoryTrackingPolicy[]>('/api/inventory/tracking-policies?limit=500'),
        requestJson<OpeningBalanceImport[]>('/api/inventory/opening-balances?limit=200'),
      ]);
      setBalances(nextBalances);
      setLots(nextLots);
      setTrackingPolicies(nextPolicies);
      setOpeningBalances(nextImports);
      setNotice({ kind: 'success', message: 'Dữ liệu tồn kho đã được làm mới.' });
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Không tải được dữ liệu tồn kho');
    } finally {
      setBusy(null);
      setLoading(false);
    }
  }

  async function loadDrillDown(balance: InventoryBalance) {
    setBusy(`drill-${balanceKey(balance)}`);
    setSelectedBalance(balance);
    try {
      const params = new URLSearchParams({
        warehouseId: balance.warehouse_id,
        baseVariantId: balance.base_variant_id,
      });
      if (balance.location_id) params.set('locationId', balance.location_id);
      if (balance.lot_id) params.set('lotId', balance.lot_id);
      const lines = await requestJson<InventoryMovementLine[]>(`/api/inventory/balances/drill-down?${params.toString()}`);
      setDrillDown(lines);
    } catch (drillError) {
      setError(drillError instanceof Error ? drillError.message : 'Không tải được phần chi tiết');
    } finally {
      setBusy(null);
    }
  }

  async function savePolicy() {
    setBusy('policy-save');
    setError(null);
    try {
      const body = {
        baseVariantId: policyDraft.baseVariantId,
        lotTrackingMode: policyDraft.lotTrackingMode,
        expiryTrackingMode: policyDraft.expiryTrackingMode,
        locationRequired: policyDraft.locationRequired,
        ...(policyDraft.expectedVersion.trim() ? { expectedVersion: Number(policyDraft.expectedVersion) } : {}),
      };
      const saved = await requestJson<InventoryTrackingPolicy>(`/api/inventory/tracking-policies/${policyDraft.baseVariantId}`, {
        method: 'PUT',
        headers: { 'Idempotency-Key': `policy-${policyDraft.baseVariantId}-${Date.now()}` },
        body: JSON.stringify(body),
      });
      setTrackingPolicies((current) => {
        const next = current.filter((item) => item.base_variant_id !== saved.base_variant_id);
        return [...next, saved].sort((left, right) => left.base_sku.localeCompare(right.base_sku));
      });
      setNotice({ kind: 'success', message: 'Chính sách lô đã được lưu.' });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không lưu được chính sách lô');
    } finally {
      setBusy(null);
    }
  }

  const sectionTitle = scope === 'overview'
    ? 'Tổng hợp tồn kho'
    : scope === 'balances'
      ? 'Số dư tồn kho'
      : scope === 'tracking-policies'
        ? 'Chính sách lô và hạn dùng'
        : scope === 'lots'
          ? 'Danh sách lô hàng'
          : 'Nhập tồn đầu kỳ';

  const sectionDescription = scope === 'overview'
    ? 'Tổng hợp số lượng tồn, lô hàng, chính sách quản lý và lịch sử nhập tồn đầu kỳ.'
    : scope === 'balances'
      ? 'Xem số lượng theo kho, vị trí, SKU, lô và hạn dùng. Chọn một dòng để xem lịch sử biến động.'
      : scope === 'tracking-policies'
        ? 'Thiết lập yêu cầu quản lý lô, hạn sử dụng và vị trí cho từng SKU.'
        : scope === 'lots'
          ? 'Danh sách lô hàng đã được ghi nhận để tra cứu và theo dõi hạn sử dụng.'
          : 'Nhập dữ liệu tồn đầu kỳ từ tệp, kiểm tra trước rồi xác nhận ghi nhận.';

  return (
    <AppShell title={title} subtitle={subtitle} kicker="Tồn kho, lô và nhập đầu kỳ">
      <div className={styles.page} data-testid="inventory-page">
        <section className={styles.hero}>
          <div className={styles.topRow}>
            <div className={styles.titleBlock}>
              <p className={styles.kicker}>Quản lý tồn kho</p>
              <h1 className={styles.title}>{sectionTitle}</h1>
              <p className={styles.subtitle}>{sectionDescription}</p>
            </div>
            <div className={styles.actionRow}>
              <button type="button" className={styles.primaryAction} onClick={refreshAll} disabled={busy === 'refresh'}>
                {loading ? 'Đang làm mới...' : 'Làm mới dữ liệu'}
              </button>
              <Link href="/inventory/balances" className={styles.secondaryAction}>Về tồn kho</Link>
            </div>
          </div>

          <div className={styles.tabs} aria-label="Điều hướng tồn kho">
            {inventoryTabs.map((tab) => (
              <Link key={tab.href} href={tab.href} className={`${styles.tab} ${activeTab.href === tab.href ? styles.tabActive : ''}`} data-testid={`inventory-tab-${tab.href.split('/').pop()}`}>
                <span className={styles.tabLabel}>{tab.label}</span>
                <span className={styles.tabHint}>{tab.hint}</span>
              </Link>
            ))}
          </div>

          {error ? <div className={`${styles.banner} ${styles.bannerError}`} data-testid="inventory-error">{error}</div> : null}
          {notice ? <div className={`${styles.banner} ${notice.kind === 'success' ? styles.bannerSuccess : styles.bannerError}`} data-testid="inventory-notice">{notice.message}</div> : null}
        </section>

        <section className={styles.cards} aria-label="Thống kê tồn kho">
          <article className={styles.card}>
            <p className={styles.cardLabel}>Số dư</p>
            <p className={styles.cardValue}>{formatCompactNumber(counts.balances)}</p>
            <p className={styles.cardHint}>Các dòng số dư chính xác đang hiển thị.</p>
          </article>
          <article className={styles.card}>
            <p className={styles.cardLabel}>Lô hàng</p>
            <p className={styles.cardValue}>{formatCompactNumber(counts.lots)}</p>
            <p className={styles.cardHint}>Các lô hàng đang được theo dõi theo SKU.</p>
          </article>
          <article className={styles.card}>
            <p className={styles.cardLabel}>Chính sách</p>
            <p className={styles.cardValue}>{formatCompactNumber(counts.policies)}</p>
              <p className={styles.cardHint}>Chính sách theo dõi lô đang áp dụng.</p>
          </article>
          <article className={styles.card}>
            <p className={styles.cardLabel}>Nhập tồn</p>
            <p className={styles.cardValue}>{formatCompactNumber(counts.imports)}</p>
            <p className={styles.cardHint}>Lần nhập đầu kỳ đã ghi nhận.</p>
          </article>
        </section>

        <section className={styles.section} id="balances" data-testid="inventory-balances-section">
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitleBlock}>
              <h2 className={styles.sectionTitle}>Tồn kho</h2>
              <p className={styles.sectionCopy}>Bảng số dư theo kho, vị trí, SKU, lô và hạn dùng. Nhấn dòng để mở phần chi tiết.</p>
            </div>
            <div className={styles.toolbar}>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Tìm theo kho, vị trí, SKU hoặc lô"
                className={styles.searchInput}
                data-testid="inventory-search-input"
              />
            </div>
          </div>
          <div className={styles.gridTwo}>
            <div className={styles.stack}>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Kho / vị trí</th>
                      <th>SKU</th>
                      <th>Lô</th>
                      <th>Hạn dùng</th>
                      <th>Tồn thực</th>
                      <th>Đã giữ</th>
                      <th>Khả dụng</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBalances.length === 0 ? tableEmpty('Chưa có số dư tồn kho.') : filteredBalances.map((balance) => (
                      <tr key={balanceKey(balance)} data-testid={`inventory-balance-row-${balanceKey(balance)}`}>
                        <td>
                          <div>{balance.warehouse_code} · {balance.warehouse_name}</div>
                          <div className={styles.subtle}>{joinValues(balance.location_code, balance.location_name)}</div>
                        </td>
                        <td>
                          <div className={styles.mono}>{balance.base_sku}</div>
                          <div className={styles.subtle}>{balance.base_variant_name}</div>
                        </td>
                        <td className={styles.mono}>{balance.lot_code ?? '—'}</td>
                        <td>{formatDate(balance.expiry_date)}</td>
                        <td className={styles.mono}>{formatQuantity(balance.on_hand_quantity)}</td>
                        <td className={styles.mono}>{formatQuantity(balance.reserved_quantity)}</td>
                        <td className={styles.mono}>{formatQuantity(balance.available_quantity)}</td>
                        <td>
                          <button
                            type="button"
                            className={styles.miniButton}
                            onClick={() => loadDrillDown(balance)}
                            data-testid={`inventory-drilldown-button-${balanceKey(balance)}`}
                          >
                            Xem chi tiết
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <aside className={styles.panel} data-testid="inventory-drilldown-panel">
              <div className={styles.sectionTitleBlock}>
                <h3 className={styles.panelTitle}>Xem chi tiết giao dịch</h3>
                <p className={styles.panelCopy}>
                  {selectedBalance
                    ? `${selectedBalance.warehouse_code} · ${selectedBalance.base_sku}${selectedBalance.lot_code ? ` · Lô ${selectedBalance.lot_code}` : ''}`
                    : 'Chọn một dòng số dư để xem các dòng giao dịch.'}
                </p>
              </div>
              {drillDown.length === 0 ? (
                <p className={styles.subtle}>Chưa có giao dịch nào được tải.</p>
              ) : (
                <div className={styles.stack}>
                  {drillDown.map((line) => (
                    <div key={line.id ?? `${line.movement_id}-${line.base_quantity_delta}`} className={styles.banner}>
                      <div className={styles.rowActions}>
                        <span className={styles.pill}>{movementDirectionLabel(line.direction)}</span>
                        <span className={styles.pill}>{formatQuantity(line.base_quantity_delta)}</span>
                      </div>
                      <div className={styles.subtle}>
                        <div className={styles.mono}>{joinValues(line.base_sku, line.lot_code, line.expiry_date)}</div>
                        <div>{line.source_line_reference ? `Tham chiếu: ${line.source_line_reference}` : 'Biến động tồn kho'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </aside>
          </div>
        </section>

        <section className={styles.section} id="tracking-policies" data-testid="inventory-policies-section">
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitleBlock}>
              <h2 className={styles.sectionTitle}>Chính sách lô</h2>
              <p className={styles.sectionCopy}>Chỉnh chính sách bằng form bên dưới. Mỗi SKU chỉ có một chính sách hiện hành.</p>
            </div>
          </div>
          <div className={styles.twoColumnForm}>
            <div className={styles.panel}>
              <h3 className={styles.panelTitle}>Danh sách chính sách</h3>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Lô</th>
                      <th>Hạn dùng</th>
                      <th>Vị trí</th>
                      <th>Phiên bản</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPolicies.length === 0 ? tableEmpty('Chưa có chính sách lô.') : filteredPolicies.map((policy) => (
                      <tr key={policy.base_variant_id} data-testid={`inventory-policy-row-${policy.base_sku}`}>
                        <td>
                          <div className={styles.mono}>{policy.base_sku}</div>
                          <div className={styles.subtle}>{policyLabel(policy)}</div>
                        </td>
                        <td><span className={styles.pill}>{lotTrackingLabel(policy.lot_tracking_mode)}</span></td>
                        <td><span className={styles.pill}>{expiryTrackingLabel(policy.expiry_tracking_mode)}</span></td>
                        <td>{policy.location_required ? 'Bắt buộc' : 'Không bắt buộc'}</td>
                        <td className={styles.mono}>{String(policy.version)}</td>
                        <td>
                          <button
                            type="button"
                            className={styles.miniButton}
                            onClick={() => setPolicyDraft({
                              baseVariantId: policy.base_variant_id,
                              lotTrackingMode: policy.lot_tracking_mode,
                              expiryTrackingMode: policy.expiry_tracking_mode,
                              locationRequired: policy.location_required,
                              expectedVersion: String(policy.version),
                            })}
                            data-testid={`edit-policy-${policy.base_sku}`}
                          >
                            Sửa
                          </button>
                        </td>
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
                  <span>Mã tham chiếu hàng hóa</span>
                  <input
                    className={styles.textInput}
                    value={policyDraft.baseVariantId}
                    onChange={(event) => setPolicyDraft((current) => ({ ...current, baseVariantId: event.target.value }))}
                    placeholder="Nhập mã tham chiếu của SKU"
                    data-testid="inventory-policy-base-variant-input"
                  />
                </label>
                <label className={styles.field}>
                  <span>Chế độ lô</span>
                  <select
                    className={styles.selectInput}
                    value={policyDraft.lotTrackingMode}
                    onChange={(event) => setPolicyDraft((current) => ({ ...current, lotTrackingMode: event.target.value as PolicyDraft['lotTrackingMode'] }))}
                    data-testid="inventory-policy-lot-mode-select"
                  >
                    <option value="NONE">Không quản lý theo lô</option>
                    <option value="REQUIRED">Bắt buộc quản lý theo lô</option>
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Chế độ hạn dùng</span>
                  <select
                    className={styles.selectInput}
                    value={policyDraft.expiryTrackingMode}
                    onChange={(event) => setPolicyDraft((current) => ({ ...current, expiryTrackingMode: event.target.value as PolicyDraft['expiryTrackingMode'] }))}
                    data-testid="inventory-policy-expiry-mode-select"
                  >
                    <option value="NONE">Không quản lý hạn sử dụng</option>
                    <option value="OPTIONAL">Có thể nhập hạn sử dụng</option>
                    <option value="REQUIRED">Bắt buộc nhập hạn sử dụng</option>
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Lần cập nhật</span>
                  <input
                    className={styles.textInput}
                    value={policyDraft.expectedVersion}
                    onChange={(event) => setPolicyDraft((current) => ({ ...current, expectedVersion: event.target.value }))}
                    placeholder="Tự điền khi chọn chính sách"
                    data-testid="inventory-policy-expected-version-input"
                  />
                </label>
                <label className={`${styles.field} ${styles.fullWidth}`}>
                  <span className={styles.switchRow}>
                    <input
                      type="checkbox"
                      checked={policyDraft.locationRequired}
                      onChange={(event) => setPolicyDraft((current) => ({ ...current, locationRequired: event.target.checked }))}
                      data-testid="inventory-policy-location-required"
                    />
                    <span>Bắt buộc vị trí</span>
                  </span>
                </label>
              </div>
              <div className={styles.rowActions}>
                <button type="submit" className={styles.primaryAction} disabled={busy === 'policy-save'} data-testid="inventory-policy-save-button">
                  {busy === 'policy-save' ? 'Đang lưu...' : 'Lưu chính sách'}
                </button>
              </div>
            </form>
          </div>
        </section>

        <section className={styles.section} id="lots" data-testid="inventory-lots-section">
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitleBlock}>
              <h2 className={styles.sectionTitle}>Lô hàng</h2>
              <p className={styles.sectionCopy}>Danh sách lô hàng theo SKU, ngày sản xuất, hạn sử dụng và thông tin nguồn.</p>
            </div>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                      <th>SKU</th>
                  <th>Lô</th>
                  <th>Hạn dùng</th>
                  <th>Ngày SX</th>
                  <th>Tham chiếu NCC</th>
                  <th>Tạo lúc</th>
                </tr>
              </thead>
              <tbody>
                {filteredLots.length === 0 ? tableEmpty('Chưa có lô hàng nào.') : filteredLots.map((lot) => (
                  <tr key={lot.id} data-testid={`inventory-lot-row-${lot.normalized_lot_code}`}>
                    <td>
                      <div className={styles.mono}>{lot.base_sku}</div>
                      <div className={styles.subtle}>{lot.product_code} · {lot.product_name}</div>
                    </td>
                    <td>
                      <div className={styles.mono}>{lot.lot_code}</div>
                      <div className={styles.subtle}>{lot.normalized_lot_code}</div>
                    </td>
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

        <section className={styles.section} id="opening-balances" data-testid="inventory-opening-section">
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitleBlock}>
              <h2 className={styles.sectionTitle}>Thiết lập tồn đầu kỳ</h2>
              <p className={styles.sectionCopy}>Tải tệp mẫu, điền dữ liệu bằng Excel, kiểm tra và xác nhận trước khi ghi nhận.</p>
            </div>
            <Link href="/inventory/opening-balances" className={styles.primaryAction}>Mở màn hình nhập tồn đầu kỳ</Link>
          </div>
          <div className={styles.panel}>
            <h3 className={styles.panelTitle}>Lịch sử nhập tồn đầu kỳ</h3>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Mã đợt</th><th>Tệp nguồn</th><th>Số dòng</th><th>Thời gian</th></tr></thead>
                <tbody>
                  {filteredImports.length === 0 ? tableEmpty('Chưa có lần nhập nào.') : filteredImports.map((item) => (
                    <tr key={item.id} data-testid={`inventory-opening-row-${item.source_key}`}>
                      <td><strong>{item.source_key}</strong></td>
                      <td>{item.source_filename ?? '—'}</td>
                      <td>{item.row_count}</td>
                      <td>{formatDateTime(item.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
