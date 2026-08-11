'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import styles from './data-exchange.module.css';
import { DataExchangeView } from './data-exchange-view';
import { DataExchangeImportPreview } from './data-exchange-preview';
import { buildDataExchangeImportActions } from './data-exchange-import-actions';
import {
  type Tab, type ImportKind, type Product, type Variant, type Category, type Brand, type Unit, type PriceList,
  type Channel, type CustomerGroup, type Customer, type Balance, type Movement, type PendingImport,
  type OfficialRows, type QuotationRow, type MovementView, PRODUCT_COLUMNS, QUOTATION_COLUMNS, TABS, labelFor, humanizeMessage,
} from './data-exchange-model';
import { exactQuantity, exportTable, scaled12, formatScaled12, scopeKey, requestJson, idempotency } from './data-exchange-file-utils';

export default function DataExchangeWorkspace() {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const [tab, setTab] = useState<Tab>(TABS.includes(requestedTab as Tab) ? requestedTab as Tab : 'products');
  const [products, setProducts] = useState<Product[]>([]); const [categories, setCategories] = useState<Category[]>([]); const [brands, setBrands] = useState<Brand[]>([]); const [units, setUnits] = useState<Unit[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]); const [channels, setChannels] = useState<Channel[]>([]); const [groups, setGroups] = useState<CustomerGroup[]>([]); const [customers, setCustomers] = useState<Customer[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [productColumns, setProductColumns] = useState<Set<string>>(new Set(PRODUCT_COLUMNS));
  const [pricingPriceListId, setPricingPriceListId] = useState('');
  const [stocktakeWarehouse, setStocktakeWarehouse] = useState(''); const [quotationScope, setQuotationScope] = useState<'all' | 'category' | 'sku'>('all'); const [quotationCategory, setQuotationCategory] = useState('');
  const [quotationSkus, setQuotationSkus] = useState(''); const [quotationContext, setQuotationContext] = useState({ channelId: '', customerGroupId: '', customerId: '', quantity: '1' });
  const [quotationRows, setQuotationRows] = useState<QuotationRow[]>([]); const [selectedBalanceKey, setSelectedBalanceKey] = useState(''); const [movementRows, setMovementRows] = useState<MovementView[]>([]);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => { if (TABS.includes(requestedTab as Tab)) setTab(requestedTab as Tab); }, [requestedTab]);

  const warehouses = useMemo(() => {
    const map = new Map<string, { id: string; code: string; name: string }>();
    for (const item of balances) map.set(item.warehouse_id, { id: item.warehouse_id, code: item.warehouse_code, name: item.warehouse_name });
    return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [balances]);
  const selectedBalance = useMemo(() => balances.find((item) => scopeKey(item.warehouse_code, item.location_code, item.base_sku, item.lot_code) === selectedBalanceKey) ?? null, [balances, selectedBalanceKey]);

  async function refreshReferenceData() {
    const [nextProducts, nextCategories, nextBrands, nextUnits, nextLists, nextChannels, nextGroups, nextCustomers, nextBalances] = await Promise.all([
      requestJson<Product[]>('/api/products?limit=1000'), requestJson<Category[]>('/api/product-categories?limit=1000'), requestJson<Brand[]>('/api/product-brands?limit=1000'), requestJson<Unit[]>('/api/units?limit=1000'),
      requestJson<PriceList[]>('/api/price-lists?limit=1000'), requestJson<Channel[]>('/api/sales-channels?limit=1000'), requestJson<CustomerGroup[]>('/api/customer-groups?limit=1000'),
      requestJson<Customer[]>('/api/customers?limit=1000'), requestJson<Balance[]>('/api/inventory/balances?limit=1000'),
    ]);
    setProducts(nextProducts); setCategories(nextCategories); setBrands(nextBrands); setUnits(nextUnits); setPriceLists(nextLists); setChannels(nextChannels); setGroups(nextGroups); setCustomers(nextCustomers); setBalances(nextBalances);
    if (!pricingPriceListId) setPricingPriceListId(nextLists.find((item) => item.is_active && item.list_type === 'BASE')?.id ?? '');
    if (!stocktakeWarehouse && nextBalances.length) setStocktakeWarehouse(nextBalances[0].warehouse_id);
  }
  useEffect(() => { refreshReferenceData().catch((cause) => setError(cause instanceof Error ? cause.message : 'Không tải được dữ liệu nền.')); }, []);
  function begin() { setBusy(true); setError(''); setMessage(''); }
  function fail(cause: unknown) { setError(cause instanceof Error ? humanizeMessage(cause.message) : 'Thao tác không thành công.'); }
  function toggleColumn(setter: (value: Set<string>) => void, current: Set<string>, column: string) { const next = new Set(current); if (next.has(column)) next.delete(column); else next.add(column); setter(next); }

  const { productTemplate, productExport, pricingExport, stocktakeExport, prepareImport, confirmPendingImport, updatePendingRow } = buildDataExchangeImportActions({
    units, productColumns, pendingImport, setPendingImport, refreshReferenceData, setMessage, setBusy, fail, begin, priceLists, pricingPriceListId, warehouses, stocktakeWarehouse,
  });

  async function buildQuotation() {
    begin();
    try {
      const quantity = exactQuantity(quotationContext.quantity, 'quantity', 6); const manualSkus = new Set<string>(quotationSkus.split(/[\s,;]+/).map((value) => value.trim().toUpperCase()).filter(Boolean));
      let selectedProducts = products.filter((product) => product.is_active); if (quotationScope === 'category') { if (!quotationCategory) throw new Error('Chọn ngành/nhóm sản phẩm.'); selectedProducts = selectedProducts.filter((product) => product.category_id === quotationCategory); }
      const skus: string[] = [];
      await Promise.all(selectedProducts.map(async (product) => { const variants = await requestJson<Variant[]>(`/api/products/${product.id}/variants`); variants.filter((variant) => variant.is_active && variant.is_sellable && (quotationScope !== 'sku' || manualSkus.has(variant.sku.toUpperCase()))).forEach((variant) => skus.push(variant.sku)); }));
      const unique = [...new Set(skus)].sort(); if (quotationScope === 'sku') { const found = new Set(unique.map((sku) => sku.toUpperCase())); const missing = [...manualSkus].filter((sku) => !found.has(sku)); if (missing.length) throw new Error(`Không tìm thấy SKU đang bán: ${missing.join(', ')}.`); }
      if (!unique.length) throw new Error('Không có SKU phù hợp để lập báo giá.');
      const result = await requestJson<OfficialRows>('/api/file-operations/quotation', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotency('p10_quotation') }, body: JSON.stringify({ skus: unique, quantity, currencyCode: 'VND', channelId: quotationContext.channelId || null, customerGroupId: quotationContext.customerGroupId || null, customerId: quotationContext.customerId || null, format: 'tabular' }) });
      const rows = result.rows.map((row) => ({ sku: String(row.sku ?? ''), name: String(row.skuName ?? ''), product: String(row.productName ?? ''), quantity: String(row.quantity ?? quantity), finalPrice: String(row.unitPriceMinor ?? ''), lineTotal: String(row.lineTotalMinor ?? ''), priceListCode: String(row.priceListCode ?? ''), currency: String(row.currencyCode ?? 'VND'), error: '' }));
      setQuotationRows(rows); setMessage(`Đã tính giá cho ${rows.length} SKU.`);
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
      const views = rows.map((row) => { const stockAfter = formatScaled12(running); running -= scaled12(row.base_quantity_delta); return { ...row, stockAfter }; }); setMovementRows(views); setMessage(`Đã tải ${views.length} lần biến động của ${selectedBalance.base_sku}.`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  function fileInput(key: string, accept: string, kind: ImportKind) {
    return <input ref={(node) => { fileRefs.current[key] = node; }} className={styles.hiddenInput} type="file" accept={accept} onChange={(event) => { const file = event.target.files?.[0]; if (file) void prepareImport(kind, file); event.currentTarget.value = ''; }} />;
  }
  function columnChooser(columns: readonly string[], selected: Set<string>, setter: (value: Set<string>) => void) {
    return <details className={styles.columns}><summary>Chọn thông tin muốn xuất ({selected.size}/{columns.length})</summary><div className={styles.columnGrid}>{columns.map((column) => <label key={column}><input type="checkbox" checked={selected.has(column)} onChange={() => toggleColumn(setter, selected, column)} />{labelFor(column)}</label>)}</div></details>;
  }
  function previewTable() { return <DataExchangeImportPreview ctx={{ pendingImport, tab, setPendingImport, busy, confirmPendingImport, units, updatePendingRow }} />; }

  return <DataExchangeView ctx={{ tab, setTab, setError, setMessage, setPendingImport, busy, setBusy, error, message, fileRefs, fileInput, productTemplate, productExport, columnChooser, productColumns, setProductColumns, previewTable, pricingExport, priceLists, pricingPriceListId, setPricingPriceListId, stocktakeExport, stocktakeWarehouse, setStocktakeWarehouse, warehouses, buildQuotation, quotationExport, quotationRows, quotationScope, setQuotationScope, quotationCategory, setQuotationCategory, categories, quotationSkus, setQuotationSkus, quotationContext, setQuotationContext, channels, groups, customers, loadMovements, selectedBalanceKey, setSelectedBalanceKey, setMovementRows, balances, selectedBalance, movementRows, refreshReferenceData, begin, fail }} />;
}
