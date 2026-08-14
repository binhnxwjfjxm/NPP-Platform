'use client';

import { useMemo, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import styles from '../inventory-workspace.module.css';
import {
  formatDate,
  formatQuantity,
  matchTerm,
  normalizeSearch,
  type InventoryBalance,
  type InventoryMovementLine,
  type InventorySnapshot,
} from '../../../lib/inventory-types';

type Props = {
  title: string;
  subtitle: string;
  initialSnapshot: InventorySnapshot;
  initialError?: string | null;
};

type RequestEnvelope<T> = {
  data?: T;
  error?: { message?: string };
};

type Notice = { kind: 'success' | 'error'; message: string } | null;

const QUANTITY_SCALE = 1_000_000_000_000n;
const QUANTITY_PATTERN = /^(-?)(\d+)(?:\.(\d{1,12}))?$/;

function balanceKey(balance: InventoryBalance): string {
  return [balance.warehouse_id, balance.location_id ?? '<null>', balance.base_variant_id, balance.lot_id ?? '<null>'].join(':');
}

function joinValues(...values: Array<string | null | undefined>): string {
  return values.filter(Boolean).join(' · ');
}

function movementDirectionLabel(value: InventoryMovementLine['direction']) {
  return value === 'IN' ? 'Nhập kho' : 'Xuất kho';
}

function quantityToScaled(value: string): bigint {
  const match = QUANTITY_PATTERN.exec(String(value ?? '').trim());
  if (!match) return 0n;
  const sign = match[1] === '-' ? -1n : 1n;
  const whole = BigInt(match[2]);
  const fraction = BigInt((match[3] ?? '').padEnd(12, '0'));
  return sign * (whole * QUANTITY_SCALE + fraction);
}

function scaledToQuantity(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const whole = absolute / QUANTITY_SCALE;
  const fraction = String(absolute % QUANTITY_SCALE).padStart(12, '0');
  return `${sign}${whole}.${fraction}`;
}

function sumQuantities(values: string[]): string {
  return scaledToQuantity(values.reduce((sum, value) => sum + quantityToScaled(value), 0n));
}

function balanceScopeLabel(balance: InventoryBalance): string {
  return joinValues(
    balance.location_code ? `Vị trí ${balance.location_code}` : 'Không vị trí',
    balance.lot_code ? `Lô ${balance.lot_code}` : 'Không lô',
  );
}

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', headers: { Accept: 'application/json' } });
  const payload = (await response.json().catch(() => ({}))) as RequestEnvelope<T>;
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message || 'Không thể tải dữ liệu tồn kho. Vui lòng thử lại.');
  }
  return payload.data;
}

export default function InventoryBalancesWorkspace({ title, subtitle, initialSnapshot, initialError = null }: Props) {
  const [balances, setBalances] = useState(initialSnapshot.balances);
  const [selectedBalance, setSelectedBalance] = useState<InventoryBalance | null>(initialSnapshot.balances[0] ?? null);
  const [drillDown, setDrillDown] = useState<InventoryMovementLine[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<Notice>(null);

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

  const sameSkuAtWarehouse = useMemo(() => {
    if (!selectedBalance) return [];
    return balances
      .filter((balance) => balance.warehouse_id === selectedBalance.warehouse_id
        && balance.base_variant_id === selectedBalance.base_variant_id)
      .sort((left, right) => balanceScopeLabel(left).localeCompare(balanceScopeLabel(right), 'vi'));
  }, [balances, selectedBalance]);

  const sameSkuWarehouseTotal = useMemo(
    () => sumQuantities(sameSkuAtWarehouse.map((balance) => balance.on_hand_quantity)),
    [sameSkuAtWarehouse],
  );

  async function refreshBalances() {
    setBusy('refresh');
    setError(null);
    setNotice(null);
    try {
      const next = await requestJson<InventoryBalance[]>('/api/inventory/balances?limit=500');
      setBalances(next);
      setSelectedBalance((current) => current
        ? next.find((item) => balanceKey(item) === balanceKey(current)) ?? next[0] ?? null
        : next[0] ?? null);
      setNotice({ kind: 'success', message: 'Dữ liệu tồn kho đã được làm mới.' });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không tải được dữ liệu tồn kho');
    } finally {
      setBusy(null);
    }
  }

  async function loadDrillDown(balance: InventoryBalance) {
    setBusy(`drill-${balanceKey(balance)}`);
    setSelectedBalance(balance);
    setError(null);
    try {
      const params = new URLSearchParams({
        warehouseId: balance.warehouse_id,
        baseVariantId: balance.base_variant_id,
      });
      if (balance.location_id) params.set('locationId', balance.location_id);
      if (balance.lot_id) params.set('lotId', balance.lot_id);
      setDrillDown(await requestJson<InventoryMovementLine[]>(`/api/inventory/balances/drill-down?${params.toString()}`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không tải được lịch sử tồn kho');
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell title={title} subtitle={subtitle} kicker="Tồn kho, lô và nhập đầu kỳ">
      <div className={styles.page} data-testid="inventory-balances-page">
        <section className={`${styles.hero} ${styles.compactHero}`} data-testid="inventory-local-controls">
          <div className={styles.heroControls}>
            <div className={styles.toolbar}>
              <input
                aria-label="Tìm theo kho, vị trí, SKU hoặc lô"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Tìm theo kho, vị trí, SKU hoặc lô"
                className={styles.searchInput}
                data-testid="inventory-balances-search-input"
              />
            </div>
            <div className={styles.actionRow}>
              <button type="button" className={styles.primaryAction} onClick={refreshBalances} disabled={busy === 'refresh'}>
                {busy === 'refresh' ? 'Đang làm mới...' : 'Làm mới dữ liệu'}
              </button>
            </div>
          </div>
          {error ? <div className={`${styles.banner} ${styles.bannerError}`} data-testid="inventory-error">{error}</div> : null}
          {notice ? <div className={`${styles.banner} ${notice.kind === 'success' ? styles.bannerSuccess : styles.bannerError}`}>{notice.message}</div> : null}
        </section>

        <section className={styles.section} data-testid="inventory-balances-section">
          <div className={styles.gridTwo}>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr><th>Kho / vị trí</th><th>SKU</th><th>Lô</th><th>Hạn dùng</th><th>Tồn thực</th><th>Đã giữ</th><th>Khả dụng</th><th></th></tr>
                </thead>
                <tbody>
                  {filteredBalances.length === 0 ? (
                    <tr><td colSpan={8} className={styles.subtle}>Chưa có số dư tồn kho.</td></tr>
                  ) : filteredBalances.map((balance) => (
                    <tr key={balanceKey(balance)} data-testid={`inventory-balance-${balanceKey(balance)}`}>
                      <td>
                        <div>{balance.warehouse_code} · {balance.warehouse_name}</div>
                        <div className={styles.subtle}>{joinValues(balance.location_code, balance.location_name) || 'Không vị trí'}</div>
                      </td>
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
              <h3 className={styles.panelTitle}>Lịch sử đúng kho / vị trí / lô</h3>
              {!selectedBalance ? <p className={styles.subtle}>Chọn một dòng số dư để xem lịch sử.</p> : (
                <div className={styles.stack}>
                  <div className={styles.banner} data-testid="inventory-selected-scope">
                    <strong>{selectedBalance.warehouse_code} — {selectedBalance.warehouse_name}</strong>
                    <div className={styles.subtle}>{balanceScopeLabel(selectedBalance)}</div>
                    <div className={styles.mono}>{selectedBalance.base_sku}{selectedBalance.base_variant_name ? ` · ${selectedBalance.base_variant_name}` : ''}</div>
                    <div>Tồn của dòng đang chọn: <strong>{formatQuantity(selectedBalance.on_hand_quantity)}</strong></div>
                    <div>Tổng SKU tại kho: <strong>{formatQuantity(sameSkuWarehouseTotal)}</strong></div>
                  </div>

                  <div>
                    <strong>Phân rã cùng SKU trong kho</strong>
                    <div className={styles.rowActions} data-testid="inventory-lot-breakdown">
                      {sameSkuAtWarehouse.map((balance) => (
                        <button
                          key={balanceKey(balance)}
                          type="button"
                          className={styles.miniButton}
                          onClick={() => loadDrillDown(balance)}
                          disabled={busy === `drill-${balanceKey(balance)}`}
                        >
                          {balanceScopeLabel(balance)} · {formatQuantity(balance.on_hand_quantity)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <p className={styles.subtle}>
                    Lịch sử bên dưới chỉ lọc đúng kho, vị trí và lô đang chọn. Số tổng của SKU có thể gồm nhiều lô hoặc nhiều vị trí khác nhau.
                  </p>

                  {drillDown.length === 0 ? <p className={styles.subtle}>Chưa có giao dịch nào được tải cho phạm vi này.</p> : (
                    <div className={styles.stack}>{drillDown.map((line) => (
                      <div key={line.id ?? `${line.movement_id}-${line.base_quantity_delta}`} className={styles.banner}>
                        <div className={styles.rowActions}>
                          <span className={styles.pill}>{movementDirectionLabel(line.direction)}</span>
                          <span className={styles.pill}>{formatQuantity(line.base_quantity_delta)}</span>
                        </div>
                        <div className={styles.subtle}>
                          <div>{`Kho ${selectedBalance.warehouse_code} · ${balanceScopeLabel(selectedBalance)}`}</div>
                          <div className={styles.mono}>{joinValues(line.base_sku, line.lot_code ? `Lô ${line.lot_code}` : null, line.expiry_date)}</div>
                          <div>{line.source_line_reference ? `Tham chiếu: ${line.source_line_reference}` : 'Biến động tồn kho'}</div>
                        </div>
                      </div>
                    ))}</div>
                  )}
                </div>
              )}
            </aside>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
