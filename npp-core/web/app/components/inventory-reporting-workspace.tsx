'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AppShell } from './app-shell';
import type { InventoryReportingDashboard } from '../../lib/inventory-reporting-types';
import {
  WorkspaceTabPanel,
  WorkspaceTabs,
  type WorkspaceTabOption,
} from './workspace-tabs';
import styles from './inventory-reporting-workspace.module.css';

type ApiEnvelope<T> = Readonly<{
  data?: T;
  error?: { message?: string };
}>;

type Filters = Readonly<{
  from: string;
  to: string;
  warehouseId: string;
  slowDays: string;
}>;

type InventoryReportTab =
  | 'overview'
  | 'positions'
  | 'movement'
  | 'slow-moving'
  | 'lots'
  | 'exceptions';

const EMPTY_FILTERS: Filters = Object.freeze({
  from: '',
  to: '',
  warehouseId: '',
  slowDays: '90',
});

const INVENTORY_TABS: readonly WorkspaceTabOption<InventoryReportTab>[] = Object.freeze([
  { id: 'overview', label: 'Tổng quan' },
  { id: 'positions', label: 'Tồn hiện tại' },
  { id: 'movement', label: 'Luân chuyển' },
  { id: 'slow-moving', label: 'Chậm luân chuyển' },
  { id: 'lots', label: 'Lô & hạn dùng' },
  { id: 'exceptions', label: 'Ngoại lệ' },
]);

const INVENTORY_TAB_PREFIX = 'inventory-reporting';

function incrementDigits(value: string) {
  const digits = value.split('');
  let carry = 1;
  for (let index = digits.length - 1; index >= 0 && carry; index -= 1) {
    const next = digits[index].charCodeAt(0) - 48 + carry;
    digits[index] = String(next % 10);
    carry = next >= 10 ? 1 : 0;
  }
  if (carry) digits.unshift('1');
  return digits.join('');
}

function formatDecimal(value: string | null | undefined, maxFraction = 6) {
  const normalized = String(value ?? '0').trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return normalized || '0';

  const [, sign, rawInteger, fraction = ''] = match;
  const fractionLimit = Math.max(0, Math.trunc(maxFraction));
  let integer = rawInteger;
  let roundedFraction = fraction;

  if (fraction.length > fractionLimit) {
    roundedFraction = fraction.slice(0, fractionLimit);
    if (fraction[fractionLimit] >= '5') {
      const incremented = incrementDigits(`${integer}${roundedFraction}`);
      if (fractionLimit === 0) {
        integer = incremented;
        roundedFraction = '';
      } else {
        integer = incremented.slice(0, -fractionLimit) || '0';
        roundedFraction = incremented.slice(-fractionLimit).padStart(fractionLimit, '0');
      }
    }
  }

  const trimmedFraction = roundedFraction.replace(/0+$/, '');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const isZero = /^0+$/.test(integer) && !trimmedFraction;
  const displaySign = sign === '-' && !isZero ? '-' : '';
  return `${displaySign}${grouped}${trimmedFraction ? `,${trimmedFraction}` : ''}`;
}

function formatMoney(value: string | null | undefined) {
  return `${formatDecimal(value, 0)} ₫`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('vi-VN', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Asia/Ho_Chi_Minh',
      }).format(parsed);
}

function expiryLabel(value: string) {
  return {
    EXPIRED: 'Đã hết hạn',
    EXPIRING_30_DAYS: 'Hết hạn ≤ 30 ngày',
    EXPIRING_90_DAYS: 'Hết hạn ≤ 90 ngày',
    ACTIVE: 'Còn hạn',
    NO_EXPIRY: 'Không có hạn',
  }[value] ?? value;
}

function expiryClass(value: string) {
  if (value === 'EXPIRED') return styles.statusBad;
  if (value === 'EXPIRING_30_DAYS' || value === 'EXPIRING_90_DAYS') return styles.statusWarn;
  if (value === 'ACTIVE') return styles.statusGood;
  return styles.statusNeutral;
}

async function requestReport(filters: Filters): Promise<InventoryReportingDashboard> {
  const query = new URLSearchParams();
  if (filters.from) query.set('from', filters.from);
  if (filters.to) query.set('to', filters.to);
  if (filters.warehouseId) query.set('warehouseId', filters.warehouseId);
  if (filters.slowDays) query.set('slowDays', filters.slowDays);
  const serialized = query.toString();
  const response = await fetch(
    `/api/reporting/inventory${serialized ? `?${serialized}` : ''}`,
    { method: 'GET', cache: 'no-store' },
  );
  const envelope = await response.json().catch(() => ({})) as ApiEnvelope<InventoryReportingDashboard>;
  if (!response.ok || !envelope.data) {
    throw new Error(envelope.error?.message || 'Không tải được báo cáo tồn kho.');
  }
  return envelope.data;
}

export function InventoryReportingWorkspace() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [report, setReport] = useState<InventoryReportingDashboard | null>(null);
  const [warehouseOptions, setWarehouseOptions] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<InventoryReportTab>('overview');

  const load = useCallback(async (filters: Filters, initialize = false) => {
    setBusy(true);
    setError('');
    try {
      const next = await requestReport(filters);
      setReport(next);
      if (next.warehouseSummary.length > 0 && (initialize || warehouseOptions.length === 0)) {
        setWarehouseOptions(next.warehouseSummary.map((row) => ({
          id: row.warehouseId,
          code: row.warehouseCode,
          name: row.warehouseName,
        })));
      }
      if (initialize) {
        setDraft(Object.freeze({
          from: next.filters.from,
          to: next.filters.to,
          warehouseId: '',
          slowDays: String(next.filters.slowDays),
        }));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được báo cáo tồn kho.');
    } finally {
      setBusy(false);
    }
  }, [warehouseOptions.length]);

  useEffect(() => {
    void load(EMPTY_FILTERS, true);
  }, [load]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(draft);
  }

  function resetFilters() {
    const next = Object.freeze({ ...EMPTY_FILTERS });
    setDraft(next);
    void load(next, true);
  }

  const actions = (
    <div className={styles.headerActions}>
      <Link className={styles.linkButton} href="/inventory/balances">Tra cứu tồn</Link>
      <Link className={styles.linkButton} href="/inventory/costing">Giá vốn</Link>
      <Link className={styles.linkButton} href="/inventory/lots">Danh mục lô</Link>
    </div>
  );

  return (
    <AppShell
      title="Báo cáo tồn kho"
      subtitle="Theo dõi luân chuyển theo kỳ, tồn khả dụng hiện tại, giá trị MWA, hàng chậm luân chuyển, lô sắp hết hạn và chênh lệch costing trong đúng phạm vi kho được cấp."
      kicker="Tồn kho & lô hàng"
      actions={actions}
    >
      <div className={styles.workspace} data-testid="inventory-reporting-workspace">
        <form className={styles.filters} onSubmit={applyFilters}>
          <label className={styles.field}>
            <span>Từ ngày</span>
            <input
              type="date"
              value={draft.from}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, from: event.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span>Đến ngày</span>
            <input
              type="date"
              value={draft.to}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span>Kho</span>
            <select
              value={draft.warehouseId}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, warehouseId: event.target.value })}
            >
              <option value="">Tất cả kho được cấp quyền</option>
              {warehouseOptions.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.code} — {warehouse.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Chậm luân chuyển</span>
            <select
              value={draft.slowDays}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, slowDays: event.target.value })}
            >
              <option value="30">30 ngày</option>
              <option value="60">60 ngày</option>
              <option value="90">90 ngày</option>
              <option value="120">120 ngày</option>
              <option value="180">180 ngày</option>
              <option value="365">365 ngày</option>
            </select>
          </label>
          <button className={styles.primaryButton} type="submit" disabled={busy}>Áp dụng</button>
          <button className={styles.secondaryButton} type="button" onClick={resetFilters} disabled={busy}>Đặt lại</button>
        </form>

        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        {busy && !report ? <div className={styles.loading}>Đang tải báo cáo tồn kho…</div> : null}

        {report ? (
          <>
            <div className={styles.cards}>
              <article className={styles.card}>
                <p className={styles.cardLabel}>SKU đang có tồn</p>
                <p className={styles.cardValue}>{formatDecimal(report.summary.stockedSkuCount, 0)}</p>
                <p className={styles.cardHint}>Đếm SKU có on-hand dương, không cộng lẫn đơn vị giữa SKU.</p>
              </article>
              <article className={styles.card}>
                <p className={styles.cardLabel}>Vị thế tồn hiện tại</p>
                <p className={styles.cardValue}>{formatDecimal(report.summary.stockPositionCount, 0)}</p>
                <p className={styles.cardHint}>Theo kho × SKU sau khi gom vị trí/lô.</p>
              </article>
              <article className={styles.card}>
                <p className={styles.cardLabel}>Có giữ hàng</p>
                <p className={styles.cardValue}>{formatDecimal(report.summary.reservedPositionCount, 0)}</p>
                <p className={styles.cardHint}>Vị thế có reserved quantity dương.</p>
              </article>
              <article className={styles.card}>
                <p className={styles.cardLabel}>Lô đang còn hàng</p>
                <p className={styles.cardValue}>{formatDecimal(report.summary.lotScopeCount, 0)}</p>
                <p className={styles.cardHint}>Chỉ lô canonical có on-hand dương.</p>
              </article>
              <article className={styles.card}>
                <p className={styles.cardLabel}>Giá trị tồn hiện tại</p>
                <p className={styles.cardValue}>{formatMoney(report.summary.inventoryValueVnd)}</p>
                <p className={styles.cardHint}>MWA_V1, chỉ cộng vị thế COSTED.</p>
              </article>
              <article className={styles.card}>
                <p className={styles.cardLabel}>Ngoại lệ costing</p>
                <p className={styles.cardValue}>{formatDecimal(report.summary.costingExceptionCount, 0)}</p>
                <p className={styles.cardHint}>Chênh quantity hoặc trạng thái cost không COSTED.</p>
              </article>
            </div>

            <div className={styles.statusStrip}>
              <strong>Watermark:</strong>{' '}
              ledger {formatDateTime(report.projectionState.ledgerThrough)} · tồn {formatDateTime(report.projectionState.quantityProjectedThrough)} · giá vốn {formatDateTime(report.projectionState.costingProjectedThrough)}
              {report.projectionState.quantityProjectionStale ? ' · Projection tồn đang chậm hơn ledger.' : ' · Projection tồn theo kịp ledger.'}
            </div>

            <WorkspaceTabs
              tabs={INVENTORY_TABS}
              activeTab={activeTab}
              onChange={setActiveTab}
              idPrefix={INVENTORY_TAB_PREFIX}
              label="Chi tiết báo cáo tồn kho"
            />

            <WorkspaceTabPanel
              tabId="overview"
              activeTab={activeTab}
              idPrefix={INVENTORY_TAB_PREFIX}
            >
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h2>Tổng quan theo kho</h2>
                    <p>Đếm SKU và giá trị tiền theo từng kho; không cộng số lượng của các SKU khác đơn vị với nhau.</p>
                  </div>
                  <Link className={styles.linkButton} href="/inventory/balances">Mở tra cứu tồn</Link>
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th>Kho</th><th className={styles.numeric}>SKU có tồn</th><th className={styles.numeric}>SKU có giữ</th><th className={styles.numeric}>Giá trị VND</th><th className={styles.numeric}>Ngoại lệ</th><th>Projection tồn</th></tr></thead>
                    <tbody>
                      {report.warehouseSummary.map((row) => (
                        <tr key={row.warehouseId}>
                          <td><strong>{row.warehouseCode}</strong><br />{row.warehouseName}</td>
                          <td className={styles.numeric}>{formatDecimal(row.stockedSkuCount, 0)}</td>
                          <td className={styles.numeric}>{formatDecimal(row.reservedSkuCount, 0)}</td>
                          <td className={styles.numeric}>{formatMoney(row.inventoryValueVnd)}</td>
                          <td className={styles.numeric}>{formatDecimal(row.costingExceptionCount, 0)}</td>
                          <td>{formatDateTime(row.quantityProjectedThrough)}</td>
                        </tr>
                      ))}
                      {!report.warehouseSummary.length ? <tr><td className={styles.empty} colSpan={6}>Chưa có dữ liệu tồn trong phạm vi.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </section>
            </WorkspaceTabPanel>

            <WorkspaceTabPanel
              tabId="positions"
              activeTab={activeTab}
              idPrefix={INVENTORY_TAB_PREFIX}
            >
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h2>Tồn khả dụng & giá trị hiện tại</h2>
                    <p>On-hand, reserved, available lấy từ projection tồn; giá trị và giá bình quân lấy từ MWA_V1.</p>
                  </div>
                  <Link className={styles.linkButton} href="/inventory/costing">Mở giá vốn</Link>
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th>Kho</th><th>SKU</th><th className={styles.numeric}>On-hand</th><th className={styles.numeric}>Reserved</th><th className={styles.numeric}>Available</th><th className={styles.numeric}>Giá trị</th><th className={styles.numeric}>Giá BQ</th><th>Cost</th></tr></thead>
                    <tbody>
                      {report.currentPositions.map((row) => (
                        <tr key={`${row.warehouseId}:${row.variantId}`}>
                          <td>{row.warehouseCode}</td><td><strong>{row.sku}</strong></td>
                          <td className={styles.numeric}>{formatDecimal(row.onHandQuantity)}</td>
                          <td className={styles.numeric}>{formatDecimal(row.reservedQuantity)}</td>
                          <td className={styles.numeric}>{formatDecimal(row.availableQuantity)}</td>
                          <td className={styles.numeric}>{row.inventoryValue === null ? '—' : formatMoney(row.inventoryValue)}</td>
                          <td className={styles.numeric}>{row.averageUnitCost === null ? '—' : formatMoney(row.averageUnitCost)}</td>
                          <td><span className={row.costingStatus === 'COSTED' ? styles.statusGood : styles.statusBad}>{row.costingStatus}</span></td>
                        </tr>
                      ))}
                      {!report.currentPositions.length ? <tr><td className={styles.empty} colSpan={8}>Không có vị thế tồn hiện tại.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </section>
            </WorkspaceTabPanel>

            <WorkspaceTabPanel
              tabId="movement"
              activeTab={activeTab}
              idPrefix={INVENTORY_TAB_PREFIX}
            >
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h2>Nhập – xuất – tồn theo kỳ</h2>
                    <p>{report.filters.from} → {report.filters.to}. Số lượng chỉ so sánh trong cùng SKU; nguồn là ledger append-only.</p>
                  </div>
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th>Kho</th><th>SKU</th><th className={styles.numeric}>Đầu kỳ</th><th className={styles.numeric}>Nhập</th><th className={styles.numeric}>Xuất</th><th className={styles.numeric}>Cuối kỳ</th><th className={styles.numeric}>Dòng movement</th></tr></thead>
                    <tbody>
                      {report.periodFlow.map((row) => (
                        <tr key={`${row.warehouseId}:${row.variantId}`}>
                          <td>{row.warehouseCode}</td><td><strong>{row.sku}</strong></td>
                          <td className={styles.numeric}>{formatDecimal(row.openingQuantity)}</td>
                          <td className={styles.numeric}>{formatDecimal(row.inboundQuantity)}</td>
                          <td className={styles.numeric}>{formatDecimal(row.outboundQuantity)}</td>
                          <td className={styles.numeric}>{formatDecimal(row.closingQuantity)}</td>
                          <td className={styles.numeric}>{formatDecimal(row.movementLineCount, 0)}</td>
                        </tr>
                      ))}
                      {!report.periodFlow.length ? <tr><td className={styles.empty} colSpan={7}>Không có movement trong kỳ và không có số dư cuối kỳ.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHeader}><div><h2>Loại movement trong kỳ</h2><p>Đếm chứng từ/dòng/SKU theo loại movement, không cộng quantity giữa các SKU khác nhau.</p></div></div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th>Loại movement</th><th className={styles.numeric}>Movement</th><th className={styles.numeric}>Dòng</th><th className={styles.numeric}>SKU</th></tr></thead>
                    <tbody>
                      {report.movementTypes.map((row) => (
                        <tr key={row.movementType}><td>{row.movementType}</td><td className={styles.numeric}>{row.movementCount}</td><td className={styles.numeric}>{row.movementLineCount}</td><td className={styles.numeric}>{row.skuCount}</td></tr>
                      ))}
                      {!report.movementTypes.length ? <tr><td className={styles.empty} colSpan={4}>Không có movement trong kỳ.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </section>
            </WorkspaceTabPanel>

            <WorkspaceTabPanel
              tabId="slow-moving"
              activeTab={activeTab}
              idPrefix={INVENTORY_TAB_PREFIX}
            >
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div><h2>Hàng chậm luân chuyển</h2><p>On-hand dương và không có OUT trong {report.filters.slowDays} ngày gần nhất; “chưa từng xuất” được tách rõ.</p></div>
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th>Kho</th><th>SKU</th><th className={styles.numeric}>On-hand</th><th className={styles.numeric}>Available</th><th>Lần xuất cuối</th><th className={styles.numeric}>Số ngày</th><th className={styles.numeric}>Giá trị VND</th></tr></thead>
                    <tbody>
                      {report.slowMoving.map((row) => (
                        <tr key={`${row.warehouseId}:${row.variantId}`}>
                          <td>{row.warehouseCode}</td><td><strong>{row.sku}</strong></td>
                          <td className={styles.numeric}>{formatDecimal(row.onHandQuantity)}</td>
                          <td className={styles.numeric}>{formatDecimal(row.availableQuantity)}</td>
                          <td>{row.neverOutbound ? 'Chưa từng xuất' : row.lastOutDate ?? '—'}</td>
                          <td className={styles.numeric}>{row.daysSinceOutbound ?? '—'}</td>
                          <td className={styles.numeric}>{row.inventoryValueVnd === null ? '—' : formatMoney(row.inventoryValueVnd)}</td>
                        </tr>
                      ))}
                      {!report.slowMoving.length ? <tr><td className={styles.empty} colSpan={7}>Không có SKU chậm luân chuyển theo ngưỡng đã chọn.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </section>
            </WorkspaceTabPanel>

            <WorkspaceTabPanel
              tabId="lots"
              activeTab={activeTab}
              idPrefix={INVENTORY_TAB_PREFIX}
            >
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div><h2>Lô, tuổi sản xuất & hạn dùng</h2><p>Tuổi chỉ tính khi lô có manufactured_date canonical. Không suy diễn FIFO age cho hàng không quản lý lô dưới MWA.</p></div>
                  <Link className={styles.linkButton} href="/inventory/lots">Mở danh mục lô</Link>
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th>Kho</th><th>SKU</th><th>Lô</th><th>Ngày SX</th><th>Hạn dùng</th><th className={styles.numeric}>On-hand</th><th className={styles.numeric}>Available</th><th>Trạng thái</th></tr></thead>
                    <tbody>
                      {report.expiryLots.map((row) => (
                        <tr key={`${row.warehouseId}:${row.lotId}`}>
                          <td>{row.warehouseCode}</td><td><strong>{row.sku}</strong></td><td>{row.lotCode}</td>
                          <td>{row.manufacturedDate ?? '—'}{row.manufacturedAgeDays ? ` (${row.manufacturedAgeDays} ngày)` : ''}</td>
                          <td>{row.expiryDate ?? '—'}</td>
                          <td className={styles.numeric}>{formatDecimal(row.onHandQuantity)}</td>
                          <td className={styles.numeric}>{formatDecimal(row.availableQuantity)}</td>
                          <td><span className={expiryClass(row.expiryBucket)}>{expiryLabel(row.expiryBucket)}</span></td>
                        </tr>
                      ))}
                      {!report.expiryLots.length ? <tr><td className={styles.empty} colSpan={8}>Không có lô còn hàng trong phạm vi.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </section>
            </WorkspaceTabPanel>

            <WorkspaceTabPanel
              tabId="exceptions"
              activeTab={activeTab}
              idPrefix={INVENTORY_TAB_PREFIX}
            >
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div><h2>Ngoại lệ quantity ↔ costing</h2><p>Đối chiếu quantity ledger bất biến với projection costing mới nhất. Chỉ hiển thị dòng khác OK.</p></div>
                  <Link className={styles.linkButton} href="/inventory/costing">Mở đối soát giá vốn</Link>
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th>Kho</th><th>SKU</th><th className={styles.numeric}>Ledger qty</th><th className={styles.numeric}>Costing qty</th><th className={styles.numeric}>Chênh lệch</th><th>Trạng thái</th><th className={styles.numeric}>Anomaly</th></tr></thead>
                    <tbody>
                      {report.exceptions.map((row) => (
                        <tr key={`${row.warehouseId}:${row.variantId}`}>
                          <td>{row.warehouseCode}</td><td><strong>{row.sku}</strong></td>
                          <td className={styles.numeric}>{formatDecimal(row.ledgerQuantity)}</td>
                          <td className={styles.numeric}>{formatDecimal(row.costingQuantity)}</td>
                          <td className={styles.numeric}>{formatDecimal(row.quantityDifference)}</td>
                          <td><span className={styles.statusBad}>{row.reconciliationStatus}</span></td>
                          <td className={styles.numeric}>{formatDecimal(row.anomalyCount, 0)}</td>
                        </tr>
                      ))}
                      {!report.exceptions.length ? <tr><td className={styles.empty} colSpan={7}>Không có chênh lệch costing hiện tại.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </section>
            </WorkspaceTabPanel>

            <div className={styles.sourceNote}>
              <span><strong>Nguồn quantity:</strong> <code>{report.basis.quantityTruth}</code></span>
              <span><strong>Tồn hiện tại:</strong> <code>{report.basis.currentAvailability}</code></span>
              <span><strong>Giá trị:</strong> <code>{report.basis.currentValue}</code></span>
              <span><strong>Aging:</strong> <code>{report.basis.lotAge}</code></span>
            </div>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
