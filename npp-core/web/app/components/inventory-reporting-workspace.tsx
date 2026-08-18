'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
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

type InventoryProductLabel = Readonly<{
  base_variant_id: string;
  base_sku: string;
  product_name: string;
  base_unit_code: string | null;
  base_unit_name: string | null;
  base_unit_symbol: string | null;
  package_unit_code: string | null;
  package_unit_name: string | null;
  package_unit_symbol: string | null;
  package_conversion_to_base: string | null;
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
  { id: 'exceptions', label: 'Cần kiểm tra' },
]);

const INVENTORY_TAB_PREFIX = 'inventory-reporting';
const QUANTITY_SCALE = 1_000_000_000_000n;
const QUANTITY_SCALE_DIGITS = 12;
const QUANTITY_PATTERN = /^(-?)(\d+)(?:\.(\d{1,12}))?$/;

const MOVEMENT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  OPENING_BALANCE: 'Tồn đầu kỳ',
  GOODS_RECEIPT: 'Nhập hàng',
  SUPPLIER_RETURN: 'Trả nhà cung cấp',
  INVENTORY_TRANSFER_OUT: 'Chuyển kho đi',
  INVENTORY_TRANSFER_IN: 'Nhận chuyển kho',
  INVENTORY_ADJUSTMENT: 'Điều chỉnh kho',
  STOCKTAKE_ADJUSTMENT: 'Điều chỉnh sau kiểm kho',
  FULFILLMENT_PICK: 'Soạn hàng',
  FULFILLMENT_REVERSE_PICK: 'Hoàn soạn hàng',
  DELIVERY_ISSUE: 'Xuất giao hàng',
  DELIVERY_RETURN: 'Nhập hàng giao trả về',
  CUSTOMER_RETURN: 'Khách trả hàng',
  PICKUP_ISSUE: 'Khách nhận tại kho',
  MANUAL_ISSUE: 'Xuất kho thủ công',
  MANUAL_RECEIPT: 'Nhập kho thủ công',
});

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
    EXPIRING_30_DAYS: 'Hết hạn trong 30 ngày',
    EXPIRING_90_DAYS: 'Hết hạn trong 90 ngày',
    ACTIVE: 'Còn hạn',
    NO_EXPIRY: 'Không có hạn',
  }[value] ?? 'Cần kiểm tra';
}

function expiryClass(value: string) {
  if (value === 'EXPIRED') return styles.statusBad;
  if (value === 'EXPIRING_30_DAYS' || value === 'EXPIRING_90_DAYS') return styles.statusWarn;
  if (value === 'ACTIVE') return styles.statusGood;
  return styles.statusNeutral;
}

function movementTypeLabel(value: string) {
  return MOVEMENT_LABELS[value] ?? 'Nghiệp vụ kho khác';
}

function costingStatusLabel(value: string) {
  if (value === 'COSTED') return 'Đã tính giá vốn';
  if (value === 'PENDING') return 'Chờ tính giá vốn';
  return 'Cần kiểm tra giá vốn';
}

function reconciliationStatusLabel(value: string) {
  const labels: Readonly<Record<string, string>> = {
    OK: 'Khớp',
    QUANTITY_MISMATCH: 'Lệch số lượng',
    COSTING_NOT_READY: 'Chưa đủ dữ liệu giá vốn',
    MISSING_COST: 'Thiếu giá vốn',
    ANOMALY: 'Cần kiểm tra',
  };
  return labels[value] ?? 'Cần kiểm tra';
}

function firstText(...values: Array<string | null | undefined>) {
  return values.map((value) => String(value ?? '').trim()).find(Boolean) ?? '';
}

function productUnitLabel(label: InventoryProductLabel | undefined) {
  if (!label) return '';
  const baseUnit = firstText(label.base_unit_name, label.base_unit_symbol, label.base_unit_code);
  const packageUnit = firstText(label.package_unit_name, label.package_unit_symbol, label.package_unit_code);
  if (!baseUnit) return '';
  if (packageUnit && label.package_conversion_to_base) {
    return `ĐVT: ${baseUnit} · 1 ${packageUnit} = ${formatDecimal(label.package_conversion_to_base)} ${baseUnit}`;
  }
  return `ĐVT: ${baseUnit}`;
}

function quantityToScaled(value: string | null | undefined) {
  const match = QUANTITY_PATTERN.exec(String(value ?? '').trim());
  if (!match) return null;
  const sign = match[1] === '-' ? -1n : 1n;
  const whole = BigInt(match[2]);
  const fraction = BigInt((match[3] ?? '').padEnd(QUANTITY_SCALE_DIGITS, '0'));
  return sign * (whole * QUANTITY_SCALE + fraction);
}

function scaledToQuantity(value: bigint) {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const whole = absolute / QUANTITY_SCALE;
  const fraction = (absolute % QUANTITY_SCALE).toString().padStart(QUANTITY_SCALE_DIGITS, '0').replace(/0+$/, '');
  return `${sign}${whole}${fraction ? `.${fraction}` : ''}`;
}

function packageBreakdown(label: InventoryProductLabel | undefined, quantity: string | null | undefined) {
  const packageUnit = firstText(label?.package_unit_name, label?.package_unit_symbol, label?.package_unit_code);
  const baseUnit = firstText(label?.base_unit_name, label?.base_unit_symbol, label?.base_unit_code);
  const scaledQuantity = quantityToScaled(quantity);
  const scaledConversion = quantityToScaled(label?.package_conversion_to_base);
  if (!packageUnit || !baseUnit || scaledQuantity === null || scaledConversion === null || scaledConversion <= QUANTITY_SCALE || scaledQuantity < scaledConversion) return '—';
  const packageCount = scaledQuantity / scaledConversion;
  const remainder = scaledQuantity % scaledConversion;
  if (remainder === 0n) return `${packageCount} ${packageUnit}`;
  return `${packageCount} ${packageUnit} + ${formatDecimal(scaledToQuantity(remainder))} ${baseUnit}`;
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

async function requestProductLabels(): Promise<InventoryProductLabel[]> {
  const response = await fetch('/api/inventory/balances?limit=1000', { method: 'GET', cache: 'no-store' });
  const envelope = await response.json().catch(() => ({})) as ApiEnvelope<InventoryProductLabel[]>;
  if (!response.ok || !envelope.data) {
    throw new Error(envelope.error?.message || 'Không tải được tên sản phẩm trong tồn kho.');
  }
  return envelope.data;
}

export function InventoryReportingWorkspace() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [report, setReport] = useState<InventoryReportingDashboard | null>(null);
  const [productLabels, setProductLabels] = useState<InventoryProductLabel[]>([]);
  const [warehouseOptions, setWarehouseOptions] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<InventoryReportTab>('overview');

  const productByVariant = useMemo(() => {
    const labels = new Map<string, InventoryProductLabel>();
    for (const label of productLabels) {
      if (!labels.has(label.base_variant_id)) labels.set(label.base_variant_id, label);
    }
    return labels;
  }, [productLabels]);

  const load = useCallback(async (filters: Filters, initialize = false) => {
    setBusy(true);
    setError('');
    try {
      const [next, labels] = await Promise.all([requestReport(filters), requestProductLabels()]);
      setReport(next);
      setProductLabels(labels);
      setWarehouseOptions((current) => (
        current.length > 0 && !initialize
          ? current
          : next.warehouseSummary.map((row) => ({
              id: row.warehouseId,
              code: row.warehouseCode,
              name: row.warehouseName,
            }))
      ));
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
  }, []);

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

  function renderProduct(variantId: string, sku: string) {
    const label = productByVariant.get(variantId);
    const name = firstText(label?.product_name, sku);
    const unit = productUnitLabel(label);
    return (
      <>
        <strong>{name}</strong>
        <br />
        <span>Mã hàng: {label?.base_sku || sku}{unit ? ` · ${unit}` : ''}</span>
      </>
    );
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
      subtitle="Theo dõi nhập – xuất – tồn, số hàng có thể xuất, giá trị tồn kho, hàng chậm luân chuyển, lô sắp hết hạn và các khoản cần kiểm tra giá vốn trong đúng phạm vi kho được cấp."
      kicker="Tồn kho & lô hàng"
      actions={actions}
    >
      <div className={styles.workspace} data-testid="inventory-reporting-workspace">
        <form className={styles.filters} onSubmit={applyFilters}>
          <label className={styles.field}>
            <span>Từ ngày</span>
            <input type="date" value={draft.from} disabled={busy} onChange={(event) => setDraft({ ...draft, from: event.target.value })} />
          </label>
          <label className={styles.field}>
            <span>Đến ngày</span>
            <input type="date" value={draft.to} disabled={busy} onChange={(event) => setDraft({ ...draft, to: event.target.value })} />
          </label>
          <label className={styles.field}>
            <span>Kho</span>
            <select value={draft.warehouseId} disabled={busy} onChange={(event) => setDraft({ ...draft, warehouseId: event.target.value })}>
              <option value="">Tất cả kho được cấp quyền</option>
              {warehouseOptions.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.name}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Chậm luân chuyển</span>
            <select value={draft.slowDays} disabled={busy} onChange={(event) => setDraft({ ...draft, slowDays: event.target.value })}>
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
                <p className={styles.cardLabel}>Mã hàng đang có tồn</p>
                <p className={styles.cardValue}>{formatDecimal(report.summary.stockedSkuCount, 0)}</p>
                <p className={styles.cardHint}>Đếm mã hàng có số tồn thực tế lớn hơn 0.</p>
              </article>
              <article className={styles.card}>
                <p className={styles.cardLabel}>Vị thế tồn hiện tại</p>
                <p className={styles.cardValue}>{formatDecimal(report.summary.stockPositionCount, 0)}</p>
                <p className={styles.cardHint}>Theo kho và mã hàng sau khi gộp vị trí, lô.</p>
              </article>
              <article className={styles.card}>
                <p className={styles.cardLabel}>Có giữ hàng</p>
                <p className={styles.cardValue}>{formatDecimal(report.summary.reservedPositionCount, 0)}</p>
                <p className={styles.cardHint}>Số vị thế đang có hàng được giữ cho đơn.</p>
              </article>
              <article className={styles.card}>
                <p className={styles.cardLabel}>Lô đang còn hàng</p>
                <p className={styles.cardValue}>{formatDecimal(report.summary.lotScopeCount, 0)}</p>
                <p className={styles.cardHint}>Chỉ tính các lô còn số lượng thực tế.</p>
              </article>
              <article className={styles.card}>
                <p className={styles.cardLabel}>Giá trị tồn hiện tại</p>
                <p className={styles.cardValue}>{formatMoney(report.summary.inventoryValueVnd)}</p>
                <p className={styles.cardHint}>Chỉ cộng các vị thế đã tính được giá vốn.</p>
              </article>
              <article className={styles.card}>
                <p className={styles.cardLabel}>Cần kiểm tra giá vốn</p>
                <p className={styles.cardValue}>{formatDecimal(report.summary.costingExceptionCount, 0)}</p>
                <p className={styles.cardHint}>Số vị thế có chênh lệch số lượng hoặc chưa tính đủ giá vốn.</p>
              </article>
            </div>

            <div className={styles.statusStrip}>
              <strong>Cập nhật dữ liệu:</strong>{' '}
              sổ kho {formatDateTime(report.projectionState.ledgerThrough)} · tồn kho {formatDateTime(report.projectionState.quantityProjectedThrough)} · giá vốn {formatDateTime(report.projectionState.costingProjectedThrough)}
              {report.projectionState.quantityProjectionStale ? ' · Tồn kho đang chậm cập nhật so với sổ kho.' : ' · Tồn kho đã cập nhật theo sổ kho.'}
            </div>

            <WorkspaceTabs tabs={INVENTORY_TABS} activeTab={activeTab} onChange={setActiveTab} idPrefix={INVENTORY_TAB_PREFIX} label="Chi tiết báo cáo tồn kho" />

            <WorkspaceTabPanel tabId="overview" activeTab={activeTab} idPrefix={INVENTORY_TAB_PREFIX}>
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div><h2>Tổng quan theo kho</h2><p>Đếm mã hàng và giá trị tiền theo từng kho; không cộng lẫn số lượng giữa các mã hàng khác đơn vị.</p></div>
                  <Link className={styles.linkButton} href="/inventory/balances">Mở tra cứu tồn</Link>
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th>Kho</th><th className={styles.numeric}>Mã hàng có tồn</th><th className={styles.numeric}>Mã hàng có giữ</th><th className={styles.numeric}>Giá trị (đ)</th><th className={styles.numeric}>Cần kiểm tra</th><th>Cập nhật tồn</th></tr></thead>
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

            <WorkspaceTabPanel tabId="positions" activeTab={activeTab} idPrefix={INVENTORY_TAB_PREFIX}>
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div><h2>Tồn khả dụng & giá trị hiện tại</h2><p>Số tồn, số đã giữ cho đơn và số có thể xuất lấy từ dữ liệu tồn kho chuẩn; giá trị và giá bình quân lấy từ dữ liệu giá vốn.</p></div>
                  <Link className={styles.linkButton} href="/inventory/costing">Mở giá vốn</Link>
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th>Kho</th><th>Sản phẩm / mã hàng</th><th className={styles.numeric}>Tồn kho</th><th>Quy đổi</th><th className={styles.numeric}>Đã giữ</th><th className={styles.numeric}>Có thể xuất</th><th className={styles.numeric}>Giá trị</th><th className={styles.numeric}>Giá bình quân</th><th>Tình trạng giá vốn</th></tr></thead>
                    <tbody>
                      {report.currentPositions.map((row) => (
                        <tr key={`${row.warehouseId}:${row.variantId}`}>
                          <td>{row.warehouseCode}</td><td>{renderProduct(row.variantId, row.sku)}</td>
                          <td className={styles.numeric}>{formatDecimal(row.onHandQuantity)}</td>
                          <td>{packageBreakdown(productByVariant.get(row.variantId), row.onHandQuantity)}</td>
                          <td className={styles.numeric}>{formatDecimal(row.reservedQuantity)}</td>
                          <td className={styles.numeric}>{formatDecimal(row.availableQuantity)}</td>
                          <td className={styles.numeric}>{row.inventoryValue === null ? '—' : formatMoney(row.inventoryValue)}</td>
                          <td className={styles.numeric}>{row.averageUnitCost === null ? '—' : formatMoney(row.averageUnitCost)}</td>
                          <td><span className={row.costingStatus === 'COSTED' ? styles.statusGood : styles.statusBad}>{costingStatusLabel(row.costingStatus)}</span></td>
                        </tr>
                      ))}
                      {!report.currentPositions.length ? <tr><td className={styles.empty} colSpan={9}>Không có vị thế tồn hiện tại.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </section>
            </WorkspaceTabPanel>

            <WorkspaceTabPanel tabId="movement" activeTab={activeTab} idPrefix={INVENTORY_TAB_PREFIX}>
              <section className={styles.section}>
                <div className={styles.sectionHeader}><div><h2>Nhập – xuất – tồn theo kỳ</h2><p>{report.filters.from} → {report.filters.to}. Số lượng chỉ so sánh trong cùng mã hàng; nguồn là sổ nhập xuất kho không sửa ngược.</p></div></div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th>Kho</th><th>Sản phẩm / mã hàng</th><th className={styles.numeric}>Đầu kỳ</th><th className={styles.numeric}>Nhập</th><th className={styles.numeric}>Xuất</th><th className={styles.numeric}>Cuối kỳ</th><th className={styles.numeric}>Dòng nghiệp vụ</th></tr></thead>
                    <tbody>
                      {report.periodFlow.map((row) => (
                        <tr key={`${row.warehouseId}:${row.variantId}`}>
                          <td>{row.warehouseCode}</td><td>{renderProduct(row.variantId, row.sku)}</td>
                          <td className={styles.numeric}>{formatDecimal(row.openingQuantity)}</td>
                          <td className={styles.numeric}>{formatDecimal(row.inboundQuantity)}</td>
                          <td className={styles.numeric}>{formatDecimal(row.outboundQuantity)}</td>
                          <td className={styles.numeric}>{formatDecimal(row.closingQuantity)}</td>
                          <td className={styles.numeric}>{formatDecimal(row.movementLineCount, 0)}</td>
                        </tr>
                      ))}
                      {!report.periodFlow.length ? <tr><td className={styles.empty} colSpan={7}>Không có phát sinh trong kỳ và không có số dư cuối kỳ.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHeader}><div><h2>Loại nghiệp vụ trong kỳ</h2><p>Đếm chứng từ, dòng và mã hàng theo từng loại nghiệp vụ kho.</p></div></div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th>Loại nghiệp vụ</th><th className={styles.numeric}>Chứng từ</th><th className={styles.numeric}>Dòng</th><th className={styles.numeric}>Mã hàng</th></tr></thead>
                    <tbody>
                      {report.movementTypes.map((row) => (
                        <tr key={row.movementType}><td>{movementTypeLabel(row.movementType)}</td><td className={styles.numeric}>{row.movementCount}</td><td className={styles.numeric}>{row.movementLineCount}</td><td className={styles.numeric}>{row.skuCount}</td></tr>
                      ))}
                      {!report.movementTypes.length ? <tr><td className={styles.empty} colSpan={4}>Không có nghiệp vụ kho trong kỳ.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </section>
            </WorkspaceTabPanel>

            <WorkspaceTabPanel tabId="slow-moving" activeTab={activeTab} idPrefix={INVENTORY_TAB_PREFIX}>
              <section className={styles.section}>
                <div className={styles.sectionHeader}><div><h2>Hàng chậm luân chuyển</h2><p>Hàng còn tồn và không phát sinh xuất kho trong {report.filters.slowDays} ngày gần nhất; mặt hàng chưa từng xuất được ghi riêng.</p></div></div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th>Kho</th><th>Sản phẩm / mã hàng</th><th className={styles.numeric}>Tồn kho</th><th className={styles.numeric}>Có thể xuất</th><th>Lần xuất cuối</th><th className={styles.numeric}>Số ngày</th><th className={styles.numeric}>Giá trị (đ)</th></tr></thead>
                    <tbody>
                      {report.slowMoving.map((row) => (
                        <tr key={`${row.warehouseId}:${row.variantId}`}>
                          <td>{row.warehouseCode}</td><td>{renderProduct(row.variantId, row.sku)}</td>
                          <td className={styles.numeric}>{formatDecimal(row.onHandQuantity)}</td>
                          <td className={styles.numeric}>{formatDecimal(row.availableQuantity)}</td>
                          <td>{row.neverOutbound ? 'Chưa từng xuất' : row.lastOutDate ?? '—'}</td>
                          <td className={styles.numeric}>{row.daysSinceOutbound ?? '—'}</td>
                          <td className={styles.numeric}>{row.inventoryValueVnd === null ? '—' : formatMoney(row.inventoryValueVnd)}</td>
                        </tr>
                      ))}
                      {!report.slowMoving.length ? <tr><td className={styles.empty} colSpan={7}>Không có mã hàng chậm luân chuyển theo ngưỡng đã chọn.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </section>
            </WorkspaceTabPanel>

            <WorkspaceTabPanel tabId="lots" activeTab={activeTab} idPrefix={INVENTORY_TAB_PREFIX}>
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div><h2>Lô, tuổi hàng & hạn dùng</h2><p>Tuổi lô chỉ tính khi có ngày sản xuất. Không tự suy diễn tuổi hàng cho mặt hàng không quản lý lô.</p></div>
                  <Link className={styles.linkButton} href="/inventory/lots">Mở danh mục lô</Link>
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th>Kho</th><th>Sản phẩm / mã hàng</th><th>Lô</th><th>Ngày sản xuất</th><th>Hạn dùng</th><th className={styles.numeric}>Tồn kho</th><th className={styles.numeric}>Có thể xuất</th><th>Trạng thái</th></tr></thead>
                    <tbody>
                      {report.expiryLots.map((row) => (
                        <tr key={`${row.warehouseId}:${row.lotId}`}>
                          <td>{row.warehouseCode}</td><td>{renderProduct(row.variantId, row.sku)}</td><td>{row.lotCode}</td>
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

            <WorkspaceTabPanel tabId="exceptions" activeTab={activeTab} idPrefix={INVENTORY_TAB_PREFIX}>
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div><h2>Cần kiểm tra số lượng & giá vốn</h2><p>Đối chiếu số lượng trong sổ kho với số lượng đang dùng để tính giá vốn. Chỉ hiện các dòng cần kiểm tra.</p></div>
                  <Link className={styles.linkButton} href="/inventory/costing">Mở đối soát giá vốn</Link>
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th>Kho</th><th>Sản phẩm / mã hàng</th><th className={styles.numeric}>Số lượng sổ kho</th><th className={styles.numeric}>Số lượng tính giá</th><th className={styles.numeric}>Chênh lệch</th><th>Trạng thái</th><th className={styles.numeric}>Số cảnh báo</th></tr></thead>
                    <tbody>
                      {report.exceptions.map((row) => (
                        <tr key={`${row.warehouseId}:${row.variantId}`}>
                          <td>{row.warehouseCode}</td><td>{renderProduct(row.variantId, row.sku)}</td>
                          <td className={styles.numeric}>{formatDecimal(row.ledgerQuantity)}</td>
                          <td className={styles.numeric}>{formatDecimal(row.costingQuantity)}</td>
                          <td className={styles.numeric}>{formatDecimal(row.quantityDifference)}</td>
                          <td><span className={styles.statusBad}>{reconciliationStatusLabel(row.reconciliationStatus)}</span></td>
                          <td className={styles.numeric}>{formatDecimal(row.anomalyCount, 0)}</td>
                        </tr>
                      ))}
                      {!report.exceptions.length ? <tr><td className={styles.empty} colSpan={7}>Không có chênh lệch giá vốn hiện tại.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </section>
            </WorkspaceTabPanel>

            <div className={styles.sourceNote}>
              <span><strong>Nguyên tắc số liệu:</strong> số lượng lấy từ sổ kho và dữ liệu tồn kho chuẩn; giá trị lấy từ dữ liệu giá vốn. Báo cáo không tạo nguồn tồn kho riêng.</span>
            </div>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
