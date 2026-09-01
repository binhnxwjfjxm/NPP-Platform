'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '../../components/app-shell';
import {
  BusinessTableSequenceCell,
  BusinessTableSequenceHeader,
} from '../../components/business-table-sequence';
import styles from '../inventory-workspace.module.css';
import {
  formatDate,
  formatDateTime,
  formatQuantity,
  matchTerm,
  normalizeSearch,
  type InventoryBalance,
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

type InventoryMovementHistoryRow = {
  movement_id: string;
  movement_type: string;
  source_domain: string;
  source_document_type: string | null;
  source_document_id: string | null;
  source_document_number: string | null;
  document_number: string | null;
  document_date: string | null;
  posted_at: string;
  posted_by: string;
  posted_by_name: string | null;
  reason_code: string | null;
  reason_note: string | null;
  reversal_of_movement_id: string | null;
  warehouse_id: string;
  warehouse_code: string;
  warehouse_name: string;
  base_variant_id: string;
  base_sku: string;
  base_quantity_delta: string;
  stock_after: string;
  line_count: number;
  location_summary: string | null;
  lot_summary: string | null;
};

const QUANTITY_SCALE = 1_000_000_000_000n;
const QUANTITY_PATTERN = /^(-?)(\d+)(?:\.(\d{1,12}))?$/;
const INVENTORY_BALANCE_BATCH_SIZE = 1000;
const INVENTORY_BALANCE_MAX_OFFSET = 100000;
const INVENTORY_TABLE_PAGE_SIZE = 100;
const HISTORY_PAGE_SIZE = 50;
const HISTORY_FETCH_SIZE = HISTORY_PAGE_SIZE + 1;

function balanceKey(balance: InventoryBalance): string {
  return [balance.warehouse_id, balance.location_id ?? '<null>', balance.base_variant_id, balance.lot_id ?? '<null>'].join(':');
}

function joinValues(...values: Array<string | null | undefined>): string {
  return values.filter(Boolean).join(' · ');
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

function unitLabel(name: string | null, symbol: string | null, code: string | null): string {
  return String(name || symbol || code || '').trim();
}

function baseUnitLabel(balance: InventoryBalance): string {
  return unitLabel(balance.base_unit_name, balance.base_unit_symbol, balance.base_unit_code);
}

function packageUnitLabel(balance: InventoryBalance): string {
  return unitLabel(balance.package_unit_name, balance.package_unit_symbol, balance.package_unit_code);
}

function canonicalQuantityLabel(value: string, balance: InventoryBalance): string {
  const unit = baseUnitLabel(balance);
  return joinValues(formatQuantity(value), unit).replace(' · ', ' ');
}

function packageRuleLabel(balance: InventoryBalance): string | null {
  const baseUnit = baseUnitLabel(balance);
  const packageUnit = packageUnitLabel(balance);
  const conversion = balance.package_conversion_to_base;
  if (!baseUnit || !packageUnit || !conversion || quantityToScaled(conversion) <= QUANTITY_SCALE) return null;
  return `Quy cách: 1 ${packageUnit} = ${formatQuantity(conversion)} ${baseUnit}`;
}

function packageBreakdown(value: string, balance: InventoryBalance): string | null {
  const baseUnit = baseUnitLabel(balance);
  const packageUnit = packageUnitLabel(balance);
  const conversion = balance.package_conversion_to_base;
  if (!baseUnit || !packageUnit || !conversion) return null;

  const quantityScaled = quantityToScaled(value);
  const conversionScaled = quantityToScaled(conversion);
  if (quantityScaled <= 0n || conversionScaled <= QUANTITY_SCALE || quantityScaled < conversionScaled) return null;

  const packageCount = quantityScaled / conversionScaled;
  const remainder = quantityScaled % conversionScaled;
  const packageText = `${packageCount} ${packageUnit}`;
  if (remainder === 0n) return packageText;
  return `${packageText} + ${formatQuantity(scaledToQuantity(remainder))} ${baseUnit}`;
}

function InventoryQuantity({ balance, value }: { balance: InventoryBalance; value: string }) {
  const breakdown = packageBreakdown(value, balance);
  return (
    <div>
      <div className={styles.mono}>{canonicalQuantityLabel(value, balance)}</div>
      {breakdown ? <div className={styles.subtle}>{breakdown}</div> : null}
    </div>
  );
}

function movementLabel(row: InventoryMovementHistoryRow): string {
  const labels: Record<string, string> = {
    SALES_DELIVERY_ISSUE: 'Xuất kho giao khách',
    PURCHASE_RECEIPT: 'Nhập hàng',
    SUPPLIER_RETURN: 'Xuất trả nhà cung cấp',
    TRANSFER_ISSUE: 'Xuất chuyển kho',
    TRANSFER_RECEIPT: 'Nhập chuyển kho',
    OPENING_BALANCE: 'Thiết lập tồn đầu kỳ',
    MANUAL_INBOUND: 'Nhập kho thủ công',
    STOCKTAKE_ADJUSTMENT: 'Cân bằng sau kiểm kê',
    STOCKTAKE_ADJUSTMENT_REVERSAL: 'Hoàn tác cân bằng kiểm kê',
    LOGISTICS_TRIP_RETURN: 'Nhập hàng hoàn',
    REVERSAL: 'Hoàn tác giao dịch kho',
  };
  if (labels[row.movement_type]) return labels[row.movement_type];
  if (row.movement_type.startsWith('MANUAL_ADJUSTMENT_')) return 'Điều chỉnh tồn kho';
  return quantityToScaled(row.base_quantity_delta) >= 0n ? 'Nhập kho' : 'Xuất kho';
}

function documentTypeLabel(value: string | null): string {
  const labels: Record<string, string> = {
    SALES_ORDER: 'Đơn bán hàng',
    DELIVERY_ORDER: 'Phiếu giao hàng',
    PURCHASE_RECEIPT: 'Phiếu nhận hàng',
    SUPPLIER_RETURN: 'Phiếu trả nhà cung cấp',
    INVENTORY_TRANSFER: 'Phiếu chuyển kho',
    INVENTORY_TRANSFER_RECEIPT: 'Phiếu nhận chuyển kho',
    INVENTORY_ADJUSTMENT: 'Phiếu điều chỉnh tồn',
    OPENING_BALANCE_IMPORT: 'Thiết lập tồn đầu kỳ',
    MANUAL_INBOUND: 'Phiếu nhập kho',
    STOCKTAKE: 'Phiếu kiểm kê',
    INVENTORY_REVERSAL: 'Phiếu hoàn tác kho',
  };
  return value ? labels[value] ?? 'Chứng từ kho' : 'Chứng từ kho';
}

function historyDocumentNumber(row: InventoryMovementHistoryRow): string | null {
  return row.source_document_number || row.document_number || null;
}

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', headers: { Accept: 'application/json' } });
  const payload = (await response.json().catch(() => ({}))) as RequestEnvelope<T>;
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message || 'Không thể tải dữ liệu tồn kho. Vui lòng thử lại.');
  }
  return payload.data;
}

async function loadAllBalances(): Promise<InventoryBalance[]> {
  const balances: InventoryBalance[] = [];
  for (let offset = 0; offset <= INVENTORY_BALANCE_MAX_OFFSET; offset += INVENTORY_BALANCE_BATCH_SIZE) {
    const batch = await requestJson<InventoryBalance[]>(
      `/api/inventory/balances?limit=${INVENTORY_BALANCE_BATCH_SIZE}&offset=${offset}`,
    );
    balances.push(...batch);
    if (batch.length < INVENTORY_BALANCE_BATCH_SIZE) return balances;
  }
  throw new Error('Dữ liệu tồn kho vượt phạm vi tra cứu an toàn. Vui lòng liên hệ quản trị hệ thống.');
}

export default function InventoryBalancesWorkspace({ title, subtitle, initialSnapshot, initialError = null }: Props) {
  const searchParams = useSearchParams();
  const requestedSku = (searchParams.get('sku') ?? '').trim();
  const requestedWarehouseId = (searchParams.get('warehouseId') ?? '').trim();
  const [balances, setBalances] = useState(initialSnapshot.balances);
  const [selectedBalance, setSelectedBalance] = useState<InventoryBalance | null>(null);
  const [historyRows, setHistoryRows] = useState<InventoryMovementHistoryRow[]>([]);
  const [historyAllScopes, setHistoryAllScopes] = useState(false);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState<InventoryMovementHistoryRow | null>(null);
  const [search, setSearch] = useState(requestedSku);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<Notice>(null);

  const normalizedSearch = normalizeSearch(search);
  const filteredBalances = useMemo(() => balances.filter((balance) => !normalizedSearch || matchTerm(
    balance.product_name,
    balance.product_code,
    balance.warehouse_code,
    balance.warehouse_name,
    balance.location_code,
    balance.location_name,
    balance.base_sku,
    balance.base_variant_name,
    balance.base_unit_code,
    balance.base_unit_name,
    balance.package_sku,
    balance.package_variant_name,
    balance.package_unit_code,
    balance.package_unit_name,
    balance.lot_code,
    balance.expiry_date,
  ).includes(normalizedSearch)), [balances, normalizedSearch]);
  const pageCount = Math.max(1, Math.ceil(filteredBalances.length / INVENTORY_TABLE_PAGE_SIZE));
  const effectivePage = Math.min(page, pageCount - 1);
  const pageStart = effectivePage * INVENTORY_TABLE_PAGE_SIZE;
  const visibleBalances = filteredBalances.slice(pageStart, pageStart + INVENTORY_TABLE_PAGE_SIZE);

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

  const loadDrillDown = useCallback(async (balance: InventoryBalance, allScopes = false, nextPage = 0) => {
    setBusy(`history-${balanceKey(balance)}`);
    setSelectedBalance(balance);
    setHistoryAllScopes(allScopes);
    setError(null);
    try {
      const params = new URLSearchParams({
        warehouseId: balance.warehouse_id,
        baseVariantId: balance.base_variant_id,
        limit: String(HISTORY_FETCH_SIZE),
        offset: String(nextPage * HISTORY_PAGE_SIZE),
      });
      if (allScopes) params.set('scope', 'warehouse');
      if (!allScopes && balance.location_id) params.set('locationId', balance.location_id);
      if (!allScopes && balance.lot_id) params.set('lotId', balance.lot_id);
      const rows = await requestJson<InventoryMovementHistoryRow[]>(`/api/inventory/balances/history?${params.toString()}`);
      setHistoryRows(rows.slice(0, HISTORY_PAGE_SIZE));
      setHistoryPage(nextPage);
      setHistoryHasMore(rows.length > HISTORY_PAGE_SIZE);
      setSelectedHistory(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không tải được lịch sử tồn kho');
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    if (!requestedSku || selectedBalance) return;
    const normalizedRequestedSku = normalizeSearch(requestedSku);
    const candidate = balances.find((balance) => {
      if (requestedWarehouseId && balance.warehouse_id !== requestedWarehouseId) return false;
      return [balance.base_sku, balance.package_sku]
        .filter(Boolean)
        .some((sku) => normalizeSearch(String(sku)) === normalizedRequestedSku);
    });
    if (!candidate) return;
    setSearch(requestedSku);
    setPage(0);
    void loadDrillDown(candidate, true, 0);
  }, [balances, loadDrillDown, requestedSku, requestedWarehouseId, selectedBalance]);

  useEffect(() => {
    if (!selectedHistory) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedHistory(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedHistory]);

  async function refreshBalances() {
    setBusy('refresh');
    setError(null);
    setNotice(null);
    try {
      const next = await loadAllBalances();
      setBalances(next);
      setSelectedBalance((current) => current
        ? next.find((item) => balanceKey(item) === balanceKey(current)) ?? null
        : null);
      setNotice({ kind: 'success', message: `Đã làm mới ${next.length} dòng tồn kho.` });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không tải được dữ liệu tồn kho');
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
                aria-label="Tìm theo sản phẩm, SKU, kho, vị trí hoặc lô"
                value={search}
                onChange={(event) => { setSearch(event.target.value); setPage(0); }}
                placeholder="Tìm theo sản phẩm, SKU, kho, vị trí hoặc lô"
                className={styles.searchInput}
                data-testid="inventory-balances-search-input"
              />
            </div>
            <div className={styles.actionRow}>
              <span className={styles.subtle}>{filteredBalances.length} dòng · Trang {effectivePage + 1}/{pageCount}</span>
              <button type="button" className={styles.miniButton} onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={effectivePage === 0}>Trang trước</button>
              <button type="button" className={styles.miniButton} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={effectivePage >= pageCount - 1}>Trang sau</button>
              <button type="button" className={styles.primaryAction} onClick={refreshBalances} disabled={busy === 'refresh'}>
                {busy === 'refresh' ? 'Đang làm mới...' : 'Làm mới dữ liệu'}
              </button>
            </div>
          </div>
          {error ? <div className={`${styles.banner} ${styles.bannerError}`} data-testid="inventory-error">{error}</div> : null}
          {notice ? <div className={`${styles.banner} ${notice.kind === 'success' ? styles.bannerSuccess : styles.bannerError}`}>{notice.message}</div> : null}
        </section>

        <section className={styles.balanceSection} data-testid="inventory-balances-section">
          <div className={styles.balanceLayout}>
            <div className={`${styles.tableWrap} ${styles.balanceTableWrap}`}>
              <table className={styles.table}>
                <thead>
                  <tr><BusinessTableSequenceHeader /><th>Kho / vị trí</th><th>Sản phẩm / SKU</th><th>Lô</th><th>Hạn dùng</th><th>Tồn kho</th><th>Đã giữ cho đơn</th><th>Có thể xuất</th><th></th></tr>
                </thead>
                <tbody>
                  {visibleBalances.length === 0 ? (
                    <tr><td colSpan={9} className={styles.subtle}>Chưa có dữ liệu tồn kho.</td></tr>
                  ) : visibleBalances.map((balance, rowIndex) => {
                    const packageRule = packageRuleLabel(balance);
                    return (
                      <tr key={balanceKey(balance)} data-testid={`inventory-balance-${balanceKey(balance)}`}>
                        <BusinessTableSequenceCell rowIndex={pageStart + rowIndex} />
                        <td>
                          <div>{balance.warehouse_code} · {balance.warehouse_name}</div>
                          <div className={styles.subtle}>{joinValues(balance.location_code, balance.location_name) || 'Không vị trí'}</div>
                        </td>
                        <td>
                          <div><strong>{balance.product_name}</strong></div>
                          <div className={styles.mono}>{balance.base_sku}</div>
                          {balance.package_sku && balance.package_sku !== balance.base_sku ? <div className={styles.subtle}>SKU thùng: {balance.package_sku}</div> : null}
                          {balance.base_variant_name ? <div className={styles.subtle}>{balance.base_variant_name}</div> : null}
                          {packageRule ? <div className={styles.subtle}>{packageRule}</div> : null}
                        </td>
                        <td className={styles.mono}>{balance.lot_code ?? '—'}</td>
                        <td>{formatDate(balance.expiry_date)}</td>
                        <td><InventoryQuantity balance={balance} value={balance.on_hand_quantity} /></td>
                        <td><InventoryQuantity balance={balance} value={balance.reserved_quantity} /></td>
                        <td><InventoryQuantity balance={balance} value={balance.available_quantity} /></td>
                        <td><button type="button" className={styles.miniButton} onClick={() => void loadDrillDown(balance, false, 0)}>Xem lịch sử</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {selectedBalance ? <aside className={`${styles.panel} ${styles.balanceDetailPanel}`} data-testid="inventory-drilldown-panel">
              <div className={styles.historySummary} data-testid="inventory-selected-scope">
                <div>
                  <h3 className={styles.panelTitle}>Lịch sử xuất nhập tồn</h3>
                  <strong>{selectedBalance.product_name}</strong>
                  <div className={styles.mono}>{selectedBalance.base_sku}</div>
                  <div className={styles.subtle}>{selectedBalance.warehouse_code} · {selectedBalance.warehouse_name}</div>
                </div>
                <div className={styles.historyStock}>
                  <span className={styles.subtle}>Tồn hiện tại</span>
                  <InventoryQuantity balance={selectedBalance} value={historyAllScopes ? sameSkuWarehouseTotal : selectedBalance.on_hand_quantity} />
                </div>
              </div>

              <div className={styles.historyScopeBar} data-testid="inventory-lot-breakdown">
                <span className={styles.subtle}>Phạm vi:</span>
                <button
                  type="button"
                  className={`${styles.miniButton} ${historyAllScopes ? styles.scopeButtonActive : ''}`}
                  onClick={() => void loadDrillDown(selectedBalance, true, 0)}
                >Toàn kho</button>
                {sameSkuAtWarehouse.map((balance) => (
                  <button
                    key={balanceKey(balance)}
                    type="button"
                    className={`${styles.miniButton} ${!historyAllScopes && balanceKey(balance) === balanceKey(selectedBalance) ? styles.scopeButtonActive : ''}`}
                    onClick={() => void loadDrillDown(balance, false, 0)}
                    disabled={busy === `history-${balanceKey(balance)}`}
                  >{balanceScopeLabel(balance)}</button>
                ))}
              </div>

              <div className={styles.historyTableHeader}>
                <div className={styles.subtle}>{historyAllScopes ? 'Toàn bộ vị trí / lô của SKU tại kho' : balanceScopeLabel(selectedBalance)}</div>
                <div className={styles.actionRow}>
                  <span className={styles.subtle}>Trang {historyPage + 1}</span>
                  <button type="button" className={styles.miniButton} disabled={historyPage === 0} onClick={() => void loadDrillDown(selectedBalance, historyAllScopes, historyPage - 1)}>Trang trước</button>
                  <button type="button" className={styles.miniButton} disabled={!historyHasMore} onClick={() => void loadDrillDown(selectedBalance, historyAllScopes, historyPage + 1)}>Trang sau</button>
                </div>
              </div>

              {historyRows.length === 0 ? <p className={styles.subtle}>Chưa có giao dịch nào trong phạm vi này.</p> : (
                <div className={`${styles.tableWrap} ${styles.historyTableWrap}`}>
                  <table className={`${styles.table} ${styles.historyTable}`} data-testid="inventory-history-table">
                    <thead>
                      <tr>
                        <th>Ngày ghi nhận</th>
                        <th>Nhân viên</th>
                        <th>Thao tác</th>
                        <th>Số lượng thay đổi</th>
                        <th>Tồn kho</th>
                        <th>Mã chứng từ</th>
                        <th>Kho</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyRows.map((row) => {
                        const delta = quantityToScaled(row.base_quantity_delta);
                        const documentNumber = historyDocumentNumber(row);
                        return (
                          <tr key={row.movement_id} data-testid={`inventory-history-${row.movement_id}`}>
                            <td>{formatDateTime(row.posted_at)}</td>
                            <td>{row.posted_by_name || 'Hệ thống'}</td>
                            <td>{movementLabel(row)}</td>
                            <td className={`${styles.historyNumber} ${delta >= 0n ? styles.historyIncrease : styles.historyDecrease}`}>{canonicalQuantityLabel(row.base_quantity_delta, selectedBalance)}</td>
                            <td className={styles.historyNumber}>{canonicalQuantityLabel(row.stock_after, selectedBalance)}</td>
                            <td>{documentNumber ? <button type="button" className={styles.documentButton} onClick={() => setSelectedHistory(row)}>{documentNumber}</button> : '—'}</td>
                            <td>{row.warehouse_code} · {row.warehouse_name}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </aside> : null}
          </div>
        </section>

        {selectedHistory && selectedBalance ? (
          <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedHistory(null); }}>
            <section className={styles.documentDialog} role="dialog" aria-modal="true" aria-labelledby="inventory-document-dialog-title">
              <div className={styles.documentDialogHeader}>
                <div>
                  <div className={styles.subtle}>{documentTypeLabel(selectedHistory.source_document_type)}</div>
                  <h3 id="inventory-document-dialog-title" className={styles.panelTitle}>{historyDocumentNumber(selectedHistory) || 'Chi tiết chứng từ kho'}</h3>
                </div>
                <button type="button" className={styles.miniButton} onClick={() => setSelectedHistory(null)}>Đóng</button>
              </div>
              <div className={styles.documentGrid}>
                <div><span>Ngày ghi nhận</span><strong>{formatDateTime(selectedHistory.posted_at)}</strong></div>
                <div><span>Nhân viên</span><strong>{selectedHistory.posted_by_name || 'Hệ thống'}</strong></div>
                <div><span>Thao tác</span><strong>{movementLabel(selectedHistory)}</strong></div>
                <div><span>Số lượng thay đổi</span><strong>{canonicalQuantityLabel(selectedHistory.base_quantity_delta, selectedBalance)}</strong></div>
                <div><span>Tồn sau giao dịch</span><strong>{canonicalQuantityLabel(selectedHistory.stock_after, selectedBalance)}</strong></div>
                <div><span>Kho</span><strong>{selectedHistory.warehouse_code} · {selectedHistory.warehouse_name}</strong></div>
                <div><span>Vị trí</span><strong>{selectedHistory.location_summary || 'Không vị trí'}</strong></div>
                <div><span>Lô</span><strong>{selectedHistory.lot_summary || 'Không lô'}</strong></div>
              </div>
              {selectedHistory.reason_note ? <div className={styles.documentNote}><span>Ghi chú</span><p>{selectedHistory.reason_note}</p></div> : null}
            </section>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
