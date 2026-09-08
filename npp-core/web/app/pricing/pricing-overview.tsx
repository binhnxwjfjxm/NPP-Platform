'use client';

import { createIdempotencyKey } from '@npp/contracts';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../components/app-shell';
import type { PriceList, PriceListItem, PriceListType, PricingProduct, PricingVariant } from '../../lib/pricing-types';
import styles from './pricing-overview.module.css';

type Unit = { id: string; code: string; name: string; symbol?: string | null; is_active: boolean };
type OfficialRows = { rows: Record<string, unknown>[] };
type RuleView = {
  priceListCode: string;
  priceListName: string;
  listType: PriceListType;
  sku: string;
  adjustmentType: string;
  amountMinor: string;
  rateBps: string;
  minQuantity: string;
  maxQuantity: string;
  effectiveFrom: string;
  effectiveTo: string;
  externalRuleCode: string;
  note: string;
  isActive: boolean;
};
type SkuView = {
  productCode: string;
  productName: string;
  sku: string;
  variantName: string;
  unitName: string;
};
type ExportIntent = { intent: string; key: string };
type ApiEnvelope<T> = { data?: T; error?: { message?: string; code?: string } };

const PRODUCT_PAGE_SIZE = 1000;
const PRICE_ITEM_PAGE_SIZE = 2000;
const MAX_OFFSET = 10000;
const ADJUSTMENT_LABELS: Record<string, string> = {
  FIXED_PRICE: 'Đặt giá trực tiếp',
  PERCENT_DISCOUNT: 'Giảm phần trăm',
  AMOUNT_DISCOUNT: 'Giảm số tiền',
  PERCENT_MARKUP: 'Tăng phần trăm',
  AMOUNT_MARKUP: 'Tăng số tiền',
};
const LIST_TYPE_LABELS: Record<PriceListType, string> = {
  BASE: 'Giá nền', CHANNEL: 'Theo kênh', CUSTOMER_GROUP: 'Theo nhóm khách', CUSTOMER: 'Theo khách hàng',
  PROMOTION: 'Khuyến mãi', CUSTOM: 'Quy tắc khác',
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => null) as ApiEnvelope<T> | null;
  if (!response.ok || !payload || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    throw new Error(payload?.error?.message || payload?.error?.code || 'Yêu cầu không thành công');
  }
  return payload.data as T;
}

function money(value: string | null | undefined) {
  const normalized = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d{0,18})$/.test(normalized)) return normalized || '—';
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(BigInt(normalized))} ₫`;
}

function decimalKey(value: string | null | undefined) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  return normalized.includes('.') ? normalized.replace(/0+$/, '').replace(/\.$/, '') || '0' : normalized;
}

function dateText(value: string | null | undefined) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return normalized;
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(parsed);
}

function rateText(value: string | number | null | undefined) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return '';
  const percent = numeric / 100;
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(percent)}%`;
}

function ruleValue(rule: RuleView) {
  return ['PERCENT_DISCOUNT', 'PERCENT_MARKUP'].includes(rule.adjustmentType) ? rateText(rule.rateBps) : money(rule.amountMinor);
}

function summarizeRules(rules: RuleView[]) {
  const active = rules.filter((rule) => rule.isActive);
  if (!active.length) return '—';
  if (active.length !== 1) return 'Nhiều mức';
  const rule = active[0];
  if (rule.adjustmentType !== 'FIXED_PRICE'
    || decimalKey(rule.minQuantity || '0') !== '0'
    || decimalKey(rule.maxQuantity)
    || rule.effectiveFrom
    || rule.effectiveTo) return 'Nhiều mức';
  return money(rule.amountMinor);
}

function activeValue(value: unknown) {
  return value === true || String(value ?? '').toLowerCase() === 'true';
}

function fromItem(item: PriceListItem, list: PriceList): RuleView {
  return {
    priceListCode: list.code,
    priceListName: list.name,
    listType: list.list_type,
    sku: item.sku,
    adjustmentType: item.adjustment_type,
    amountMinor: item.amount_minor ?? '',
    rateBps: item.rate_bps == null ? '' : String(item.rate_bps),
    minQuantity: item.min_quantity ?? '0',
    maxQuantity: item.max_quantity ?? '',
    effectiveFrom: item.effective_from ?? '',
    effectiveTo: item.effective_to ?? '',
    externalRuleCode: item.external_rule_code ?? '',
    note: item.note ?? '',
    isActive: item.is_active,
  };
}

function fromOfficial(row: Record<string, unknown>, listByCode: Map<string, PriceList>): RuleView {
  const code = String(row.priceListCode ?? '').trim();
  const list = listByCode.get(code.toUpperCase());
  return {
    priceListCode: code,
    priceListName: String(row.priceListName ?? list?.name ?? ''),
    listType: String(row.listType ?? list?.list_type ?? 'CUSTOM') as PriceListType,
    sku: String(row.sku ?? '').trim(),
    adjustmentType: String(row.adjustmentType ?? '').trim(),
    amountMinor: String(row.amountMinor ?? '').trim(),
    rateBps: String(row.rateBps ?? '').trim(),
    minQuantity: String(row.minQuantity ?? '0').trim(),
    maxQuantity: String(row.maxQuantity ?? '').trim(),
    effectiveFrom: String(row.effectiveFrom ?? '').trim(),
    effectiveTo: String(row.effectiveTo ?? '').trim(),
    externalRuleCode: String(row.externalRuleCode ?? '').trim(),
    note: String(row.note ?? '').trim(),
    isActive: activeValue(row.isActive),
  };
}

async function listAllProducts(): Promise<PricingProduct[]> {
  const rows: PricingProduct[] = [];
  for (let offset = 0; offset <= MAX_OFFSET; offset += PRODUCT_PAGE_SIZE) {
    const page = await requestJson<PricingProduct[]>(`/api/products?limit=${PRODUCT_PAGE_SIZE}&offset=${offset}`);
    rows.push(...page);
    if (page.length < PRODUCT_PAGE_SIZE) return rows;
  }
  throw new Error('Danh mục sản phẩm vượt giới hạn đọc 11.000 dòng. Hãy xử lý giới hạn dữ liệu trước khi xem toàn bộ bảng giá.');
}

async function listAllPriceItems(priceListId: string): Promise<PriceListItem[]> {
  const rows: PriceListItem[] = [];
  for (let offset = 0; offset <= MAX_OFFSET; offset += PRICE_ITEM_PAGE_SIZE) {
    const page = await requestJson<PriceListItem[]>(`/api/price-lists/${priceListId}/items?limit=${PRICE_ITEM_PAGE_SIZE}&offset=${offset}`);
    rows.push(...page);
    if (page.length < PRICE_ITEM_PAGE_SIZE) return rows;
  }
  throw new Error('Một bảng giá vượt giới hạn đọc 12.000 dòng; chưa thể tổng hợp an toàn.');
}

async function listVariants(products: PricingProduct[]): Promise<PricingVariant[]> {
  const rows: PricingVariant[] = [];
  for (let index = 0; index < products.length; index += 16) {
    const chunk = products.slice(index, index + 16);
    const pages = await Promise.all(chunk.map((product) => requestJson<PricingVariant[]>(`/api/products/${product.id}/variants`)));
    for (const page of pages) rows.push(...page);
  }
  return rows;
}

async function listRules(lists: PriceList[]): Promise<RuleView[]> {
  const result: RuleView[] = [];
  for (let index = 0; index < lists.length; index += 8) {
    const chunk = lists.slice(index, index + 8);
    const pages = await Promise.all(chunk.map(async (list) => ({ list, items: await listAllPriceItems(list.id) })));
    for (const page of pages) result.push(...page.items.map((item) => fromItem(item, page.list)));
  }
  return result;
}

function ruleKey(priceListCode: string, sku: string) {
  return `${priceListCode.trim().toUpperCase()}\u0000${sku.trim().toUpperCase()}`;
}

function indexRules(rules: RuleView[]) {
  const byListSku = new Map<string, RuleView[]>();
  const baseBySku = new Map<string, RuleView[]>();
  for (const rule of rules) {
    const key = ruleKey(rule.priceListCode, rule.sku);
    const listRows = byListSku.get(key);
    if (listRows) listRows.push(rule); else byListSku.set(key, [rule]);
    if (rule.listType === 'BASE') {
      const sku = rule.sku.trim().toUpperCase();
      const baseRows = baseBySku.get(sku);
      if (baseRows) baseRows.push(rule); else baseBySku.set(sku, [rule]);
    }
  }
  return { byListSku, baseBySku };
}

function downloadBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

async function downloadWorkbook(filename: string, sheets: Array<{ sheetName: string; headers: string[]; rows: string[][] }>) {
  const response = await fetch('/api/data-exchange/workbook-xlsx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sheets }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message || 'Không tạo được tệp Excel.');
  }
  downloadBlob(await response.blob(), filename);
}

function detailHeaders() {
  return ['Mã bảng giá', 'Tên bảng giá', 'Loại', 'Kênh bán', 'Nhóm khách', 'Khách hàng', 'Ưu tiên', 'Cách kết hợp', 'Dừng xét tiếp', 'Mã SP', 'Tên SP', 'SKU', 'Quy cách', 'ĐVT', 'Cách áp dụng', 'Giá trị', 'SL từ', 'SL đến', 'Hiệu lực từ', 'Hiệu lực đến', 'Mã quy tắc', 'Ghi chú', 'Trạng thái'];
}

function detailRows(rules: RuleView[], listByCode: Map<string, PriceList>, skuByCode: Map<string, SkuView>) {
  return rules
    .slice()
    .sort((a, b) => a.priceListCode.localeCompare(b.priceListCode) || a.sku.localeCompare(b.sku) || Number(a.minQuantity || 0) - Number(b.minQuantity || 0))
    .map((rule) => {
      const list = listByCode.get(rule.priceListCode.toUpperCase());
      const sku = skuByCode.get(rule.sku.toUpperCase());
      return [
        rule.priceListCode,
        rule.priceListName,
        LIST_TYPE_LABELS[rule.listType] ?? rule.listType,
        list?.channel_name ?? '',
        list?.customer_group_name ?? '',
        list?.customer_name ?? '',
        list ? String(list.priority) : '',
        list?.stacking_mode === 'STACKABLE' ? 'Có thể kết hợp' : 'Chỉ áp dụng một mức',
        list?.stop_processing ? 'Có' : 'Không',
        sku?.productCode ?? '',
        sku?.productName ?? '',
        rule.sku,
        sku?.variantName ?? '',
        sku?.unitName ?? '',
        ADJUSTMENT_LABELS[rule.adjustmentType] ?? rule.adjustmentType,
        ruleValue(rule),
        decimalKey(rule.minQuantity || '0'),
        decimalKey(rule.maxQuantity),
        dateText(rule.effectiveFrom),
        dateText(rule.effectiveTo),
        rule.externalRuleCode,
        rule.note,
        rule.isActive ? 'Hoạt động' : 'Ngừng',
      ];
    });
}

export default function PricingOverview() {
  const [products, setProducts] = useState<PricingProduct[]>([]);
  const [variants, setVariants] = useState<PricingVariant[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [lists, setLists] = useState<PriceList[]>([]);
  const [rules, setRules] = useState<RuleView[]>([]);
  const [selectedListCode, setSelectedListCode] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const exportKeyRef = useRef<ExportIntent | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setError('');
      try {
        const [nextProducts, nextUnits, nextLists] = await Promise.all([
          listAllProducts(),
          requestJson<Unit[]>('/api/units?limit=1000'),
          requestJson<PriceList[]>('/api/price-lists?limit=1000'),
        ]);
        const activeProducts = nextProducts.filter((product) => product.is_active);
        const [nextVariants, nextRules] = await Promise.all([listVariants(activeProducts), listRules(nextLists)]);
        if (cancelled) return;
        setProducts(nextProducts); setUnits(nextUnits); setLists(nextLists); setVariants(nextVariants); setRules(nextRules);
        setSelectedListCode((current) => current || nextLists.find((list) => list.is_active && list.list_type !== 'BASE')?.code || nextLists[0]?.code || '');
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Không tải được toàn bộ bảng giá.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const unitById = useMemo(() => new Map(units.map((unit) => [unit.id, unit])), [units]);
  const skuRows = useMemo<SkuView[]>(() => variants
    .filter((variant) => variant.is_active && variant.is_sellable)
    .map((variant) => {
      const product = productById.get(variant.product_id);
      const unit = variant.unit_id ? unitById.get(variant.unit_id) : null;
      return {
        productCode: product?.code ?? '',
        productName: product?.name ?? '',
        sku: variant.sku,
        variantName: variant.name,
        unitName: unit?.name || unit?.symbol || unit?.code || '',
      };
    })
    .sort((a, b) => a.productCode.localeCompare(b.productCode) || a.sku.localeCompare(b.sku)), [productById, unitById, variants]);
  const skuByCode = useMemo(() => new Map(skuRows.map((row) => [row.sku.toUpperCase(), row])), [skuRows]);
  const listByCode = useMemo(() => new Map(lists.map((list) => [list.code.toUpperCase(), list])), [lists]);
  const listColumns = useMemo(() => lists
    .filter((list) => list.list_type !== 'BASE')
    .slice()
    .sort((a, b) => Number(b.is_active) - Number(a.is_active) || b.priority - a.priority || a.code.localeCompare(b.code)), [lists]);
  const ruleIndexes = useMemo(() => indexRules(rules), [rules]);
  const visibleRows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('vi');
    if (!term) return skuRows;
    return skuRows.filter((row) => `${row.productCode} ${row.productName} ${row.sku} ${row.variantName} ${row.unitName}`.toLocaleLowerCase('vi').includes(term));
  }, [search, skuRows]);

  function currentExportKey(intent: string) {
    if (exportKeyRef.current?.intent === intent) return exportKeyRef.current.key;
    const key = createIdempotencyKey('pricing_overview_export');
    exportKeyRef.current = { intent, key };
    return key;
  }

  async function officialRules(intent: string) {
    const key = currentExportKey(intent);
    const result = await requestJson<OfficialRows>('/api/file-operations/pricing/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ format: 'xlsx' }),
    });
    return result.rows.map((row) => fromOfficial(row, listByCode));
  }

  function summarySheet(sourceRules: RuleView[]) {
    const indexes = indexRules(sourceRules);
    const headers = ['Mã SP', 'Tên SP', 'SKU', 'Quy cách', 'ĐVT', 'Giá nền', ...listColumns.map((list) => `${list.code} · ${list.name}${list.is_active ? '' : ' (Ngừng)'}`)];
    const rows = skuRows.map((sku) => [
      sku.productCode,
      sku.productName,
      sku.sku,
      sku.variantName,
      sku.unitName,
      summarizeRules(indexes.baseBySku.get(sku.sku.toUpperCase()) ?? []),
      ...listColumns.map((list) => summarizeRules(indexes.byListSku.get(ruleKey(list.code, sku.sku)) ?? [])),
    ]);
    return { sheetName: 'Bảng giá tổng hợp', headers, rows };
  }

  function selectedListSummarySheet(list: PriceList, sourceRules: RuleView[]) {
    const indexes = indexRules(sourceRules);
    const headers = ['Mã SP', 'Tên SP', 'SKU', 'Quy cách', 'ĐVT', 'Giá nền', `${list.code} · ${list.name}${list.is_active ? '' : ' (Ngừng)'}`];
    const rows = skuRows.map((sku) => [
      sku.productCode,
      sku.productName,
      sku.sku,
      sku.variantName,
      sku.unitName,
      summarizeRules(indexes.baseBySku.get(sku.sku.toUpperCase()) ?? []),
      summarizeRules(indexes.byListSku.get(ruleKey(list.code, sku.sku)) ?? []),
    ]);
    return { sheetName: `Tổng hợp ${list.code}`, headers, rows };
  }

  async function exportSelectedList() {
    const list = listByCode.get(selectedListCode.toUpperCase());
    if (!list) { setError('Chọn bảng giá cần xuất.'); return; }
    setBusy(true); setError(''); setMessage('');
    const intent = `list:${list.code}`;
    try {
      const snapshot = await officialRules(intent);
      const selectedRules = snapshot.filter((rule) => rule.priceListCode.toUpperCase() === list.code.toUpperCase());
      await downloadWorkbook(`bang-gia-${list.code}.xlsx`, [
        selectedListSummarySheet(list, snapshot),
        { sheetName: 'Chi tiết chính sách giá', headers: detailHeaders(), rows: detailRows(selectedRules, listByCode, skuByCode) },
      ]);
      exportKeyRef.current = null;
      setMessage(`Đã xuất ${skuRows.length} SKU để đối chiếu và ${selectedRules.length} dòng chính sách của ${list.code} · ${list.name}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không xuất được bảng giá.');
    } finally { setBusy(false); }
  }

  async function exportAll() {
    setBusy(true); setError(''); setMessage('');
    const intent = 'all';
    try {
      const snapshot = await officialRules(intent);
      await downloadWorkbook('toan-bo-bang-gia.xlsx', [
        summarySheet(snapshot),
        { sheetName: 'Chi tiết chính sách giá', headers: detailHeaders(), rows: detailRows(snapshot, listByCode, skuByCode) },
      ]);
      exportKeyRef.current = null;
      setMessage(`Đã xuất ${skuRows.length} SKU và ${snapshot.length} dòng chính sách giá.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không xuất được toàn bộ bảng giá.');
    } finally { setBusy(false); }
  }

  return (
    <AppShell title="Toàn bộ bảng giá" subtitle="Đối chiếu giá theo từng SKU trên một màn; các chính sách nhiều điều kiện vẫn được giữ nguyên ở phần chi tiết.">
      <div className={styles.page} data-testid="pricing-overview-page">
        <div className={styles.toolbar}>
          <div className={styles.actions}>
            <Link className={styles.secondaryButton} href="/operations/data-exchange?tab=pricing">Nhập/cập nhật giá</Link>
            <Link className={styles.secondaryButton} href="/operations/import-export-history?definitionKey=pricing-items">Lịch sử nhập/xuất</Link>
          </div>
          <div className={styles.exportGroup}>
            <label>Bảng giá cần xuất
              <select value={selectedListCode} onChange={(event) => setSelectedListCode(event.target.value)} disabled={busy || loading}>
                <option value="">Chọn bảng giá</option>
                {lists.map((list) => <option key={list.id} value={list.code}>{list.code} · {list.name}{list.is_active ? '' : ' · Ngừng'}</option>)}
              </select>
            </label>
            <button type="button" className={styles.secondaryButton} onClick={() => void exportSelectedList()} disabled={busy || loading || !selectedListCode}>Xuất bảng đang chọn</button>
            <button type="button" className={styles.primaryButton} onClick={() => void exportAll()} disabled={busy || loading || !skuRows.length}>Xuất toàn bộ Excel</button>
          </div>
        </div>

        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        {message ? <div className={styles.notice} role="status">{message}</div> : null}
        <div className={styles.summaryBar}>
          <span>SKU đang bán <strong>{skuRows.length}</strong></span>
          <span>Bảng giá/chương trình <strong>{lists.length}</strong></span>
          <span>Dòng chính sách <strong>{rules.length}</strong></span>
        </div>
        <label className={styles.search}>Tìm sản phẩm hoặc SKU
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nhập mã SP, tên SP, SKU hoặc quy cách" />
        </label>

        {loading ? <div className={styles.empty}>Đang tải toàn bộ bảng giá…</div> : null}
        {!loading && !visibleRows.length ? <div className={styles.empty}>Không có SKU phù hợp.</div> : null}
        {!loading && visibleRows.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Mã SP</th><th>Tên SP</th><th>SKU</th><th>Quy cách</th><th>ĐVT</th><th>Giá nền</th>{listColumns.map((list) => <th key={list.id}>{list.code}<small>{list.name}{list.is_active ? '' : ' · Ngừng'}</small></th>)}</tr></thead>
              <tbody>{visibleRows.map((row) => (
                <tr key={row.sku}>
                  <td><strong>{row.productCode}</strong></td>
                  <td>{row.productName}</td>
                  <td><strong>{row.sku}</strong></td>
                  <td>{row.variantName}</td>
                  <td>{row.unitName || '—'}</td>
                  <td>{summarizeRules(ruleIndexes.baseBySku.get(row.sku.toUpperCase()) ?? [])}</td>
                  {listColumns.map((list) => <td key={`${row.sku}:${list.id}`}>{summarizeRules(ruleIndexes.byListSku.get(ruleKey(list.code, row.sku)) ?? [])}</td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : null}
        <p className={styles.note}><strong>Nhiều mức</strong> nghĩa là SKU có nhiều quy tắc hoặc có điều kiện số lượng/thời gian. File “Xuất toàn bộ Excel” luôn kèm sheet <strong>Chi tiết chính sách giá</strong> để không làm mất rule.</p>
      </div>
    </AppShell>
  );
}
