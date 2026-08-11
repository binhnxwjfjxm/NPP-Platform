'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell-core';
import styles from './data-exchange.module.css';

type Tab = 'products' | 'pricing' | 'stocktake' | 'quotation' | 'movements';
type Product = {
  id: string; code: string; name: string; catalog_name: string | null; category_id: string | null; brand_id: string | null;
  category_code: string | null; category_name: string | null; brand_code: string | null; brand_name: string | null;
  description: string | null; notes: string | null; is_catalog_visible: boolean; is_orderable: boolean; is_active: boolean;
};
type Variant = {
  id: string; product_id: string; sku: string; name: string; variant_kind: 'BASE' | 'CARTON' | 'OTHER';
  is_inventory_base: boolean; is_sellable: boolean; is_catalog_visible: boolean; is_active: boolean;
};
type Category = { id: string; code: string; name: string; is_active: boolean };
type Brand = { id: string; code: string; name: string; is_active: boolean };
type PriceList = {
  id: string; code: string; name: string; list_type: string; currency_code: string; channel_id: string | null;
  customer_group_id: string | null; customer_id: string | null; is_active: boolean;
};
type PriceItem = {
  id: string; price_list_id: string; sku: string; adjustment_type: string; amount_minor: string | null; rate_bps: number | null;
  min_quantity: string; max_quantity: string | null; effective_from: string | null; effective_to: string | null;
  source_key: string | null; external_rule_code: string | null; note: string | null; is_active: boolean; updated_at: string;
};
type Channel = { id: string; code: string; name: string; is_active: boolean };
type CustomerGroup = { id: string; code: string; name: string; is_active: boolean };
type Customer = { id: string; code: string; name: string; group_id: string | null; is_active: boolean };
type Balance = {
  warehouse_id: string; warehouse_code: string; warehouse_name: string; location_id: string | null; location_code: string | null;
  location_name: string | null; base_variant_id: string; base_sku: string; base_variant_name: string | null; lot_id: string | null;
  lot_code: string | null; on_hand_quantity: string; reserved_quantity: string; available_quantity: string;
};
type Stocktake = { id: string; stocktakeNumber: string; revision: string; status: string };
type Movement = {
  movement_id: string; movement_type: string; source_document_type: string | null; source_document_number: string | null;
  document_number: string | null; document_date: string; posted_at: string; posted_by: string; direction: 'IN' | 'OUT';
  base_quantity_delta: string; base_sku: string; lot_code: string | null; source_line_reference: string | null;
};
type ApiEnvelope<T> = { data?: T; error?: { code?: string; message?: string; retryable?: boolean } };
type RowMap = Record<string, string>;
type OfficialRows = { jobId?: string | null; columns: string[]; rows: Array<Record<string, unknown>> };
type QuotationRow = { sku: string; name: string; product: string; quantity: string; finalPrice: string; lineTotal: string; priceListCode: string; currency: string; error: string };
type MovementView = Movement & { stockAfter: string };

const PRODUCT_COLUMNS = [
  'productCode', 'productName', 'catalogName', 'categoryCode', 'brandCode', 'description', 'notes',
  'productIsCatalogVisible', 'productIsOrderable', 'productIsActive', 'sku', 'skuName', 'variantKind',
  'isInventoryBase', 'isSellable', 'isCatalogVisible', 'isActive',
  'unitCode', 'conversionToBase', 'lotTrackingMode', 'expiryTrackingMode', 'locationRequired',
] as const;
const PRODUCT_REQUIRED_COLUMNS = [
  'productCode', 'productName', 'productIsCatalogVisible', 'productIsOrderable', 'productIsActive',
  'sku', 'skuName', 'variantKind', 'isInventoryBase', 'isSellable', 'isCatalogVisible', 'isActive',
  'unitCode', 'conversionToBase', 'lotTrackingMode', 'expiryTrackingMode', 'locationRequired',
] as const;
const PRICING_COLUMNS = [
  'priceListCode', 'priceListName', 'listType', 'currencyCode', 'sku', 'sourceKey', 'adjustmentType',
  'amountMinor', 'rateBps', 'minQuantity', 'maxQuantity', 'effectiveFrom', 'effectiveTo', 'externalRuleCode', 'note', 'isActive',
] as const;
const STOCKTAKE_COLUMNS = ['warehouseCode', 'locationCode', 'sku', 'lotCode', 'actualCount'] as const;
const QUOTATION_COLUMNS = ['sku', 'productName', 'skuName', 'quantity', 'currencyCode', 'unitPriceMinor', 'lineTotalMinor', 'priceListCode'] as const;

function normalizeHeader(value: string) { return value.trim(); }
function bool(value: string, field: string) {
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'co', 'có'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'khong', 'không'].includes(normalized)) return false;
  throw new Error(`${field} phải là TRUE/FALSE.`);
}
function optional(value: string | undefined) { const text = String(value ?? '').trim(); return text || null; }
function exactQuantity(value: string, field: string, scale = 12) {
  const normalized = value.trim();
  const pattern = new RegExp(`^(0|[1-9]\\d{0,13})(?:\\.\\d{1,${scale}})?$`);
  if (!pattern.test(normalized)) throw new Error(`${field} phải là số không âm, tối đa ${scale} số lẻ.`);
  return normalized;
}
function csvEscape(value: unknown) { const text = String(value ?? ''); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
function toCsv(headers: string[], rows: string[][]) { return `\uFEFF${[headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n')}`; }
function parseCsv(text: string) {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); if (row.some((value) => value.trim())) rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  row.push(cell.replace(/\r$/, '')); if (row.some((value) => value.trim())) rows.push(row); return rows;
}
function mapRows(rows: string[][]): RowMap[] {
  if (rows.length < 2) throw new Error('Tệp không có dòng dữ liệu.');
  const headers = rows[0].map(normalizeHeader);
  if (headers.some((value) => !value) || new Set(headers.map((value) => value.toLowerCase())).size !== headers.length) throw new Error('Tên cột trống hoặc trùng.');
  return rows.slice(1).filter((row) => row.some((value) => value.trim())).map((row) => Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? '').trim()])));
}
function requireColumns(rows: RowMap[], required: readonly string[]) {
  if (!rows.length) throw new Error('Tệp không có dữ liệu.');
  const keys = new Set(Object.keys(rows[0])); const missing = required.filter((key) => !keys.has(key));
  if (missing.length) throw new Error(`Thiếu cột bắt buộc: ${missing.join(', ')}.`);
}
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => null) as ApiEnvelope<T> | null;
  if (!response.ok || !payload || !Object.prototype.hasOwnProperty.call(payload, 'data')) throw new Error(payload?.error?.message || payload?.error?.code || 'Yêu cầu không thành công');
  return payload.data as T;
}
function idempotency(prefix: string) { return `${prefix}_${crypto.randomUUID()}`; }
function downloadBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = href; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(href);
}
async function exportTable(filename: string, sheetName: string, headers: string[], rows: string[][], format: 'xlsx' | 'csv') {
  if (format === 'csv') { downloadBlob(new Blob([toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' }), filename.replace(/\.xlsx$/i, '.csv')); return; }
  const response = await fetch('/api/data-exchange/xlsx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sheetName, headers, rows }) });
  if (!response.ok) { const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null; throw new Error(payload?.error?.message || 'Không tạo được XLSX.'); }
  downloadBlob(await response.blob(), filename);
}
async function readTable(file: File) {
  if (file.name.toLowerCase().endsWith('.xlsx')) {
    const response = await fetch('/api/data-exchange/xlsx', { method: 'PUT', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, body: await file.arrayBuffer() });
    const payload = await response.json().catch(() => null) as { data?: { rows?: string[][] }; error?: { message?: string } } | null;
    if (!response.ok || !payload?.data?.rows) throw new Error(payload?.error?.message || 'Không đọc được XLSX.');
    return mapRows(payload.data.rows);
  }
  return mapRows(parseCsv(await file.text()));
}
function trimDecimal(value: string) {
  const normalized = String(value ?? '0').trim(); if (!normalized.includes('.')) return normalized;
  const next = normalized.replace(/0+$/, '').replace(/\.$/, ''); return next === '-0' ? '0' : next;
}
function scaled12(value: string) {
  const match = /^(-?)(\d+)(?:\.(\d{1,12}))?$/.exec(String(value ?? '').trim());
  if (!match) throw new Error(`Số lượng ledger không hợp lệ: ${value}`);
  const absolute = BigInt(match[2]) * 1_000_000_000_000n + BigInt((match[3] ?? '').padEnd(12, '0')); return match[1] ? -absolute : absolute;
}
function formatScaled12(value: bigint) {
  const negative = value < 0n; const absolute = negative ? -value : value; const whole = absolute / 1_000_000_000_000n;
  const fraction = String(absolute % 1_000_000_000_000n).padStart(12, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}
function scopeKey(warehouse: string, location: string | null, sku: string, lot: string | null) {
  return [warehouse.trim().toUpperCase(), (location ?? '').trim().toUpperCase(), sku.trim().toUpperCase(), (lot ?? '').trim().toUpperCase()].join('|');
}

export default function DataExchangeWorkspace() {
  const [tab, setTab] = useState<Tab>('products');
  const [products, setProducts] = useState<Product[]>([]); const [categories, setCategories] = useState<Category[]>([]); const [brands, setBrands] = useState<Brand[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]); const [channels, setChannels] = useState<Channel[]>([]); const [groups, setGroups] = useState<CustomerGroup[]>([]); const [customers, setCustomers] = useState<Customer[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [productColumns, setProductColumns] = useState<Set<string>>(new Set(PRODUCT_COLUMNS)); const [pricingColumns, setPricingColumns] = useState<Set<string>>(new Set(PRICING_COLUMNS));
  const [stocktakeWarehouse, setStocktakeWarehouse] = useState(''); const [quotationScope, setQuotationScope] = useState<'all' | 'category' | 'sku'>('all'); const [quotationCategory, setQuotationCategory] = useState('');
  const [quotationSkus, setQuotationSkus] = useState(''); const [quotationContext, setQuotationContext] = useState({ channelId: '', customerGroupId: '', customerId: '', quantity: '1' });
  const [quotationRows, setQuotationRows] = useState<QuotationRow[]>([]); const [selectedBalanceKey, setSelectedBalanceKey] = useState(''); const [movementRows, setMovementRows] = useState<MovementView[]>([]);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const warehouses = useMemo(() => {
    const map = new Map<string, { id: string; code: string; name: string }>();
    for (const item of balances) map.set(item.warehouse_id, { id: item.warehouse_id, code: item.warehouse_code, name: item.warehouse_name });
    return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [balances]);
  const selectedBalance = useMemo(() => balances.find((item) => scopeKey(item.warehouse_code, item.location_code, item.base_sku, item.lot_code) === selectedBalanceKey) ?? null, [balances, selectedBalanceKey]);

  async function refreshReferenceData() {
    const [nextProducts, nextCategories, nextBrands, nextLists, nextChannels, nextGroups, nextCustomers, nextBalances] = await Promise.all([
      requestJson<Product[]>('/api/products?limit=1000'), requestJson<Category[]>('/api/product-categories?limit=1000'), requestJson<Brand[]>('/api/product-brands?limit=1000'),
      requestJson<PriceList[]>('/api/price-lists?limit=1000'), requestJson<Channel[]>('/api/sales-channels?limit=1000'), requestJson<CustomerGroup[]>('/api/customer-groups?limit=1000'),
      requestJson<Customer[]>('/api/customers?limit=1000'), requestJson<Balance[]>('/api/inventory/balances?limit=2000'),
    ]);
    setProducts(nextProducts); setCategories(nextCategories); setBrands(nextBrands); setPriceLists(nextLists); setChannels(nextChannels); setGroups(nextGroups); setCustomers(nextCustomers); setBalances(nextBalances);
    if (!stocktakeWarehouse && nextBalances.length) setStocktakeWarehouse(nextBalances[0].warehouse_id);
  }
  useEffect(() => { refreshReferenceData().catch((cause) => setError(cause instanceof Error ? cause.message : 'Không tải được dữ liệu nền.')); }, []);
  function begin() { setBusy(true); setError(''); setMessage(''); }
  function fail(cause: unknown) { setError(cause instanceof Error ? cause.message : 'Thao tác không thành công.'); }
  function toggleColumn(setter: (value: Set<string>) => void, current: Set<string>, column: string) { const next = new Set(current); if (next.has(column)) next.delete(column); else next.add(column); setter(next); }

  async function productTemplate(format: 'xlsx' | 'csv') {
    begin();
    try { await exportTable('mau-san-pham-sku.xlsx', 'Sản phẩm SKU', [...PRODUCT_COLUMNS], [], format); setMessage(`Đã tải mẫu ${format.toUpperCase()} cho sản phẩm/SKU.`); }
    catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  async function productExport(format: 'xlsx' | 'csv') {
    begin();
    try {
      const result = await requestJson<OfficialRows>('/api/file-operations/products/export', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotency('p10_product_export') }, body: JSON.stringify({ format }) });
      const selected = PRODUCT_COLUMNS.filter((column) => productColumns.has(column) && result.columns.includes(column)); if (!selected.length) throw new Error('Chọn ít nhất một cột để xuất.');
      const rows = result.rows.map((row) => selected.map((column) => String(row[column] ?? ''))); await exportTable('san-pham-sku.xlsx', 'Sản phẩm SKU', selected, rows, format);
      setMessage(`Đã xuất ${rows.length} dòng SKU${result.jobId ? ` · job ${result.jobId}` : ''}.`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  async function productImport(file: File) {
    begin();
    try {
      const rows = await readTable(file); requireColumns(rows, PRODUCT_REQUIRED_COLUMNS);
      const result = await requestJson<{ jobId?: string; import?: { imported?: number; created?: number; updated?: number }; onboarding?: { variantsConfigured?: number; policiesConfigured?: number } }>('/api/file-operations/products/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotency('p10_product_import') },
        body: JSON.stringify({ format: file.name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv', rows }),
      });
      await refreshReferenceData(); const info = result.import ?? {}; const onboarding = result.onboarding ?? {};
      setMessage(`Đã import sản phẩm/SKU${info.imported == null ? '' : `: ${info.imported} sản phẩm`} · cấu hình đơn vị ${onboarding.variantsConfigured ?? 0} SKU · chính sách kho ${onboarding.policiesConfigured ?? 0} SKU${result.jobId ? ` · job ${result.jobId}` : ''}.`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function loadPricingItems() {
    const rows: Array<{ list: PriceList; item: PriceItem }> = [];
    await Promise.all(priceLists.map(async (list) => { const items = await requestJson<PriceItem[]>(`/api/price-lists/${list.id}/items?limit=2000`); for (const item of items) rows.push({ list, item }); })); return rows;
  }
  async function pricingExport(format: 'xlsx' | 'csv') {
    begin();
    try {
      const result = await requestJson<OfficialRows>('/api/file-operations/pricing/export', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotency('p10_pricing_export') }, body: JSON.stringify({ format }) });
      const selected = PRICING_COLUMNS.filter((column) => pricingColumns.has(column) && result.columns.includes(column)); if (!selected.length) throw new Error('Chọn ít nhất một cột để xuất.');
      const rows = result.rows.map((row) => selected.map((column) => String(row[column] ?? ''))); await exportTable('bang-gia-sku.xlsx', 'Giá bán SKU', selected, rows, format); setMessage(`Đã xuất ${rows.length} dòng giá${result.jobId ? ` · job ${result.jobId}` : ''}.`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  async function pricingImport(file: File) {
    begin();
    try {
      const rows = await readTable(file); requireColumns(rows, ['priceListCode', 'sku', 'adjustmentType', 'sourceKey', 'isActive']); if (rows.length > 2000) throw new Error('Import giá tối đa 2.000 dòng.');
      const blankSource = rows.filter((row) => !String(row.sourceKey ?? '').trim()); const officialRows = rows.filter((row) => String(row.sourceKey ?? '').trim()); let officialJob = '';
      if (officialRows.length) {
        const result = await requestJson<{ jobId?: string }>('/api/file-operations/pricing/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotency('p10_pricing_import') }, body: JSON.stringify({ format: file.name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv', rows: officialRows }) }); officialJob = result.jobId ?? '';
      }
      if (blankSource.length) {
        const listByCode = new Map<string, PriceList>(priceLists.map((item) => [item.code.toUpperCase(), item] as const)); const existingRows = await loadPricingItems();
        for (const [index, row] of blankSource.entries()) {
          const listCode = String(row.priceListCode ?? '').trim().toUpperCase(); const sku = String(row.sku ?? '').trim().toUpperCase(); const adjustmentType = String(row.adjustmentType ?? '').trim().toUpperCase();
          const list = listByCode.get(listCode); if (!list) throw new Error(`Dòng giá ${index + 1}: priceListCode ${listCode || 'trống'} không tồn tại.`);
          const minQuantity = exactQuantity(String(row.minQuantity ?? '0'), 'minQuantity', 6); const maxQuantity = String(row.maxQuantity ?? '').trim() ? exactQuantity(String(row.maxQuantity), 'maxQuantity', 6) : null;
          const effectiveFrom = optional(row.effectiveFrom); const effectiveTo = optional(row.effectiveTo);
          const matches = existingRows.filter(({ list: currentList, item }) => currentList.id === list.id && item.sku.toUpperCase() === sku && item.adjustment_type === adjustmentType
            && trimDecimal(item.min_quantity) === trimDecimal(minQuantity) && trimDecimal(item.max_quantity ?? '') === trimDecimal(maxQuantity ?? '')
            && String(item.effective_from ?? '') === String(effectiveFrom ?? '') && String(item.effective_to ?? '') === String(effectiveTo ?? ''));
          if (matches.length !== 1) throw new Error(`Không thể cập nhật ${listCode}/${sku}: cần đúng 1 dòng legacy khớp identity + khoảng hiệu lực, hiện có ${matches.length}.`);
          const match = matches[0]; const amountMinor = optional(row.amountMinor); const rateBps = optional(row.rateBps);
          await requestJson(`/api/price-lists/${list.id}/items/${match.item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            adjustmentType, amountMinor, rateBps: rateBps ? Number(rateBps) : null, minQuantity, maxQuantity, effectiveFrom, effectiveTo,
            externalRuleCode: optional(row.externalRuleCode), note: optional(row.note), isActive: bool(String(row.isActive ?? ''), 'isActive'), expectedUpdatedAt: match.item.updated_at,
          }) });
        }
      }
      setMessage(`Đã xử lý ${rows.length} dòng giá${officialJob ? ` · job ${officialJob}` : ''}. ${blankSource.length ? `${blankSource.length} dòng legacy sourceKey trống được cập nhật bằng optimistic PATCH canonical.` : ''}`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function stocktakeExport(format: 'xlsx' | 'csv') {
    begin();
    try {
      const warehouse = warehouses.find((item) => item.id === stocktakeWarehouse); if (!warehouse) throw new Error('Chọn kho trước khi xuất file kiểm kê.');
      const result = await requestJson<OfficialRows>('/api/file-operations/stocktake/export', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotency('p10_stocktake_export') }, body: JSON.stringify({ warehouseId: warehouse.id, format }) });
      const selected = STOCKTAKE_COLUMNS.filter((column) => result.columns.includes(column)); const rows = result.rows.map((row) => selected.map((column) => String(row[column] ?? '')));
      await exportTable(`kiem-ke-${warehouse.code}.xlsx`, 'Kiểm kê thực tế', selected, rows, format); setMessage(`Đã xuất ${rows.length} phạm vi kiểm kê; file không chứa số tồn hệ thống${result.jobId ? ` · job ${result.jobId}` : ''}.`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  async function stocktakeImport(file: File) {
    begin();
    try {
      const rows = await readTable(file); requireColumns(rows, STOCKTAKE_COLUMNS); if (rows.length > 500) throw new Error('Mỗi đợt kiểm kê tối đa 500 phạm vi.');
      for (const [index, row] of rows.entries()) exactQuantity(String(row.actualCount ?? ''), `Dòng ${index + 2} actualCount`, 12);
      const result = await requestJson<{ jobId?: string; stocktake: Stocktake }>('/api/file-operations/stocktake/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotency('p10_stocktake_import') }, body: JSON.stringify({ format: file.name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv', rows }) });
      setMessage(`Đã tạo và nhập số đếm vào ${result.stocktake.stocktakeNumber}. Trạng thái: ${result.stocktake.status}. Chưa gửi duyệt, chưa ghi sổ tồn${result.jobId ? ` · job ${result.jobId}` : ''}.`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function buildQuotation() {
    begin();
    try {
      const quantity = exactQuantity(quotationContext.quantity, 'Số lượng báo giá', 6); const manualSkus = new Set<string>(quotationSkus.split(/[\s,;]+/).map((value) => value.trim().toUpperCase()).filter(Boolean));
      let selectedProducts = products.filter((product) => product.is_active); if (quotationScope === 'category') { if (!quotationCategory) throw new Error('Chọn ngành/nhóm sản phẩm.'); selectedProducts = selectedProducts.filter((product) => product.category_id === quotationCategory); }
      const skus: string[] = [];
      await Promise.all(selectedProducts.map(async (product) => { const variants = await requestJson<Variant[]>(`/api/products/${product.id}/variants`); variants.filter((variant) => variant.is_active && variant.is_sellable && (quotationScope !== 'sku' || manualSkus.has(variant.sku.toUpperCase()))).forEach((variant) => skus.push(variant.sku)); }));
      const unique = [...new Set(skus)].sort(); if (quotationScope === 'sku') { const found = new Set(unique.map((sku) => sku.toUpperCase())); const missing = [...manualSkus].filter((sku) => !found.has(sku)); if (missing.length) throw new Error(`Không tìm thấy SKU bán được: ${missing.join(', ')}.`); }
      if (!unique.length) throw new Error('Không có SKU phù hợp để lập báo giá.');
      const result = await requestJson<OfficialRows>('/api/file-operations/quotation', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotency('p10_quotation') }, body: JSON.stringify({ skus: unique, quantity, currencyCode: 'VND', channelId: quotationContext.channelId || null, customerGroupId: quotationContext.customerGroupId || null, customerId: quotationContext.customerId || null, format: 'tabular' }) });
      const rows = result.rows.map((row) => ({ sku: String(row.sku ?? ''), name: String(row.skuName ?? ''), product: String(row.productName ?? ''), quantity: String(row.quantity ?? quantity), finalPrice: String(row.unitPriceMinor ?? ''), lineTotal: String(row.lineTotalMinor ?? ''), priceListCode: String(row.priceListCode ?? ''), currency: String(row.currencyCode ?? 'VND'), error: '' }));
      setQuotationRows(rows); setMessage(`Đã tính giá canonical cho ${rows.length} SKU${result.jobId ? ` · job ${result.jobId}` : ''}.`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  async function quotationExport(format: 'xlsx' | 'csv') {
    begin();
    try { if (!quotationRows.length) throw new Error('Hãy tính báo giá trước khi xuất file.'); const rows = quotationRows.map((row) => [row.sku, row.product, row.name, row.quantity, row.currency, row.finalPrice, row.lineTotal, row.priceListCode]); await exportTable('bao-gia.xlsx', 'Báo giá', [...QUOTATION_COLUMNS], rows, format); setMessage(`Đã xuất ${rows.length} dòng báo giá.`); }
    catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  async function loadMovements() {
    begin();
    try {
      if (!selectedBalance) throw new Error('Chọn một dòng tồn kho để xem biến động.'); const params = new URLSearchParams({ warehouseId: selectedBalance.warehouse_id, baseVariantId: selectedBalance.base_variant_id, limit: '500' });
      if (selectedBalance.location_id) params.set('locationId', selectedBalance.location_id); if (selectedBalance.lot_id) params.set('lotId', selectedBalance.lot_id);
      const rows = await requestJson<Movement[]>(`/api/inventory/balances/drill-down?${params}`); let running = scaled12(selectedBalance.on_hand_quantity);
      const views = rows.map((row) => { const stockAfter = formatScaled12(running); running -= scaled12(row.base_quantity_delta); return { ...row, stockAfter }; }); setMovementRows(views); setMessage(`Đã tải ${views.length} biến động của ${selectedBalance.base_sku}.`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  function fileInput(key: string, accept: string, handler: (file: File) => Promise<void>) {
    return <input ref={(node) => { fileRefs.current[key] = node; }} className={styles.hiddenInput} type="file" accept={accept} onChange={(event) => { const file = event.target.files?.[0]; if (file) void handler(file); event.currentTarget.value = ''; }} />;
  }
  function columnChooser(columns: readonly string[], selected: Set<string>, setter: (value: Set<string>) => void) {
    return <details className={styles.columns}><summary>Cột xuất file ({selected.size}/{columns.length})</summary><div className={styles.columnGrid}>{columns.map((column) => <label key={column}><input type="checkbox" checked={selected.has(column)} onChange={() => toggleColumn(setter, selected, column)} />{column}</label>)}</div></details>;
  }

  const actions = <div className={styles.headerActions}><a className={styles.secondaryButton} href="/operations/import-export-history">Lịch sử import/export</a><button className={styles.secondaryButton} type="button" onClick={() => { begin(); refreshReferenceData().then(() => setMessage('Đã cập nhật dữ liệu nền.')).catch(fail).finally(() => setBusy(false)); }} disabled={busy}>Làm mới</button></div>;
  return <AppShell kicker="Phase 10.4 · Dữ liệu & báo giá" title="Import / Export & Báo giá" subtitle="Tệp đi qua API nghiệp vụ canonical; sản phẩm/SKU được onboarding đủ đơn vị và chính sách tồn kho trước khi nhập tồn." actions={actions}>
    <div className={styles.page} data-testid="phase-10-4-data-exchange">
      <nav className={styles.tabs} aria-label="Nhóm dữ liệu Phase 10.4">{([['products', 'Sản phẩm / SKU'], ['pricing', 'Giá bán'], ['stocktake', 'Kiểm kê'], ['quotation', 'Báo giá'], ['movements', 'Biến động kho']] as Array<[Tab, string]>).map(([key, label]) => <button key={key} type="button" className={tab === key ? styles.activeTab : ''} onClick={() => { setTab(key); setError(''); setMessage(''); }}>{label}</button>)}</nav>
      {error ? <div className={styles.error} role="alert">{error}</div> : null}{message ? <div className={styles.success} role="status">{message}</div> : null}

      {tab === 'products' ? <section className={styles.panel}><div className={styles.panelTitle}><div><h2>Sản phẩm / SKU</h2><p>Một file tạo/cập nhật sản phẩm, SKU, đơn vị quy đổi và chính sách quản lý tồn kho. Không cần tạo SKU xong rồi sang màn khác cấu hình lại.</p></div><div className={styles.buttonRow}>
        {fileInput('products', '.xlsx,.csv', productImport)}<button type="button" className={styles.primaryButton} onClick={() => fileRefs.current.products?.click()} disabled={busy}>Nhập file</button>
        <button type="button" className={styles.secondaryButton} onClick={() => void productTemplate('xlsx')} disabled={busy}>Mẫu XLSX</button><button type="button" className={styles.secondaryButton} onClick={() => void productTemplate('csv')} disabled={busy}>Mẫu CSV</button>
        <button type="button" className={styles.secondaryButton} onClick={() => void productExport('xlsx')} disabled={busy}>Xuất XLSX</button><button type="button" className={styles.secondaryButton} onClick={() => void productExport('csv')} disabled={busy}>Xuất CSV</button>
      </div></div>{columnChooser(PRODUCT_COLUMNS, productColumns, setProductColumns)}<div className={styles.guardrail}><strong>Logic onboarding SKU</strong><span>Mỗi SKU cần unitCode + conversionToBase. SKU tồn chuẩn dùng conversionToBase = 1 và khai báo lotTrackingMode, expiryTrackingMode, locationRequired. Chính sách lô/hạn dùng chỉ đặt trên SKU tồn chuẩn; có thể dùng CÓ/KHÔNG, BẮT BUỘC/TÙY CHỌN trong file.</span></div><p className={styles.note}>Cập nhật sản phẩm hiện hữu phải chứa đầy đủ SKU đang hoạt động; Core từ chối snapshot thiếu thay vì tự xóa/ngưng SKU.</p></section> : null}

      {tab === 'pricing' ? <section className={styles.panel}><div className={styles.panelTitle}><div><h2>Giá bán theo SKU</h2><p>Định danh file: priceListCode + SKU + sourceKey. Dòng legacy sourceKey trống dùng optimistic PATCH canonical.</p></div><div className={styles.buttonRow}>{fileInput('pricing', '.xlsx,.csv', pricingImport)}<button type="button" className={styles.primaryButton} onClick={() => fileRefs.current.pricing?.click()} disabled={busy}>Nhập file</button><button type="button" className={styles.secondaryButton} onClick={() => void pricingExport('xlsx')} disabled={busy}>Xuất XLSX</button><button type="button" className={styles.secondaryButton} onClick={() => void pricingExport('csv')} disabled={busy}>Xuất CSV</button></div></div>{columnChooser(PRICING_COLUMNS, pricingColumns, setPricingColumns)}</section> : null}

      {tab === 'stocktake' ? <section className={styles.panel}><div className={styles.panelTitle}><div><h2>Nhập số kiểm kê thực tế</h2><p>File tạo đợt kiểm kê và ghi số đếm; không sửa balance trực tiếp.</p></div><div className={styles.buttonRow}>{fileInput('stocktake', '.xlsx,.csv', stocktakeImport)}<button type="button" className={styles.primaryButton} onClick={() => fileRefs.current.stocktake?.click()} disabled={busy}>Nhập số đếm</button><button type="button" className={styles.secondaryButton} onClick={() => void stocktakeExport('xlsx')} disabled={busy}>Mẫu XLSX</button><button type="button" className={styles.secondaryButton} onClick={() => void stocktakeExport('csv')} disabled={busy}>Mẫu CSV</button></div></div><label className={styles.field}>Kho kiểm kê<select value={stocktakeWarehouse} onChange={(event) => setStocktakeWarehouse(event.target.value)}><option value="">Chọn kho</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label><div className={styles.guardrail}><strong>Không cập nhật tồn trực tiếp.</strong><span>actual_quantity → Stocktake draft/count → gửi duyệt → duyệt → ghi sổ chênh lệch. Chưa gửi duyệt, chưa ghi sổ tồn.</span><a href="/inventory/stocktakes">Mở Kiểm kê kho</a></div></section> : null}

      {tab === 'quotation' ? <section className={styles.panel}><div className={styles.panelTitle}><div><h2>Báo giá</h2><p>Backend dùng pricing resolver canonical cho từng SKU.</p></div><div className={styles.buttonRow}><button type="button" className={styles.primaryButton} onClick={() => void buildQuotation()} disabled={busy}>Tính báo giá</button><button type="button" className={styles.secondaryButton} onClick={() => void quotationExport('xlsx')} disabled={busy || !quotationRows.length}>Xuất XLSX</button><button type="button" className={styles.secondaryButton} onClick={() => void quotationExport('csv')} disabled={busy || !quotationRows.length}>Xuất CSV</button></div></div><div className={styles.formGrid}>
        <label className={styles.field}>Phạm vi<select value={quotationScope} onChange={(event) => setQuotationScope(event.target.value as 'all' | 'category' | 'sku')}><option value="all">Tất cả SKU bán được</option><option value="category">Theo ngành / nhóm</option><option value="sku">Danh sách SKU</option></select></label>
        {quotationScope === 'category' ? <label className={styles.field}>Ngành / nhóm<select value={quotationCategory} onChange={(event) => setQuotationCategory(event.target.value)}><option value="">Chọn nhóm</option>{categories.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label> : null}
        {quotationScope === 'sku' ? <label className={`${styles.field} ${styles.span2}`}>SKU<input value={quotationSkus} onChange={(event) => setQuotationSkus(event.target.value)} placeholder="SKU001, SKU002..." /></label> : null}
        <label className={styles.field}>Kênh<select value={quotationContext.channelId} onChange={(event) => setQuotationContext({ ...quotationContext, channelId: event.target.value })}><option value="">Không chọn</option>{channels.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
        <label className={styles.field}>Nhóm khách<select value={quotationContext.customerGroupId} onChange={(event) => setQuotationContext({ ...quotationContext, customerGroupId: event.target.value })}><option value="">Không chọn</option>{groups.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
        <label className={styles.field}>Khách hàng<select value={quotationContext.customerId} onChange={(event) => setQuotationContext({ ...quotationContext, customerId: event.target.value })}><option value="">Không chọn</option>{customers.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
        <label className={styles.field}>Số lượng<input inputMode="decimal" value={quotationContext.quantity} onChange={(event) => setQuotationContext({ ...quotationContext, quantity: event.target.value })} /></label></div>
        {quotationRows.length ? <div className={styles.tableWrap}><table><thead><tr><th>SKU</th><th>Sản phẩm</th><th>SL</th><th>Giá áp dụng</th><th>Thành tiền</th><th>Bảng giá gốc</th></tr></thead><tbody>{quotationRows.map((row) => <tr key={row.sku}><td><strong>{row.sku}</strong><small>{row.name}</small></td><td>{row.product}</td><td>{row.quantity}</td><td>{row.finalPrice || '—'}</td><td>{row.lineTotal || '—'}</td><td>{row.priceListCode || '—'}</td></tr>)}</tbody></table></div> : null}</section> : null}

      {tab === 'movements' ? <section className={styles.panel}><div className={styles.panelTitle}><div><h2>Tra cứu biến động theo SKU</h2><p>Balance trả lời còn bao nhiêu; ledger drill-down trả lời từng lần +/−.</p></div><button type="button" className={styles.primaryButton} onClick={() => void loadMovements()} disabled={busy}>Truy vấn biến động</button></div><label className={styles.field}>Dòng tồn<select value={selectedBalanceKey} onChange={(event) => { setSelectedBalanceKey(event.target.value); setMovementRows([]); }}><option value="">Chọn kho / vị trí / SKU / lô</option>{balances.map((item) => { const key = scopeKey(item.warehouse_code, item.location_code, item.base_sku, item.lot_code); return <option key={key} value={key}>{item.warehouse_code} · {item.location_code || 'Không vị trí'} · {item.base_sku}{item.lot_code ? ` · ${item.lot_code}` : ''} · tồn {trimDecimal(item.on_hand_quantity)}</option>; })}</select></label>
        {selectedBalance ? <div className={styles.balanceSummary}><span>Tồn hiện tại <strong>{trimDecimal(selectedBalance.on_hand_quantity)}</strong></span><span>Đang giữ <strong>{trimDecimal(selectedBalance.reserved_quantity)}</strong></span><span>Khả dụng <strong>{trimDecimal(selectedBalance.available_quantity)}</strong></span></div> : null}
        {movementRows.length ? <div className={styles.tableWrap}><table><thead><tr><th>Thời gian</th><th>Chứng từ</th><th>Loại</th><th>Biến động</th><th>Tồn sau</th></tr></thead><tbody>{movementRows.map((row) => <tr key={`${row.movement_id}:${row.source_line_reference ?? row.base_quantity_delta}`}><td>{new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(row.posted_at))}</td><td>{row.source_document_number || row.document_number || row.source_document_type || '—'}</td><td>{row.movement_type}</td><td className={scaled12(row.base_quantity_delta) >= 0n ? styles.positive : styles.negative}>{scaled12(row.base_quantity_delta) >= 0n ? '+' : ''}{trimDecimal(row.base_quantity_delta)}</td><td>{trimDecimal(row.stockAfter)}</td></tr>)}</tbody></table></div> : null}</section> : null}
    </div>
  </AppShell>;
}
