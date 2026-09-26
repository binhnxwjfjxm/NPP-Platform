'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import styles from './data-exchange.module.css';
import { DataExchangeView } from './data-exchange-view';
import { DataExchangeImportPreview } from './data-exchange-preview';
import { buildDataExchangeImportActions } from './data-exchange-import-actions';
import {
  type Tab, type ImportKind, type Unit, type PriceList, type Balance, type Movement, type PendingImport,
  type MovementView, PRODUCT_COLUMNS, TABS, labelFor, humanizeMessage,
} from './data-exchange-model';
import { scaled12, formatScaled12, scopeKey, requestJson } from './data-exchange-file-utils';

const MOVEMENT_PAGE_SIZE = 500;

function filenameFromDisposition(value: string | null, fallback: string) {
  const match = /filename="([^"\r\n]+)"/i.exec(value ?? '');
  return match?.[1] || fallback;
}

export default function DataExchangeWorkspace() {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const [tab, setTab] = useState<Tab>(TABS.includes(requestedTab as Tab) ? requestedTab as Tab : 'products');
  const [units, setUnits] = useState<Unit[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [productColumns, setProductColumns] = useState<Set<string>>(new Set(PRODUCT_COLUMNS));
  const [pricingPriceListId, setPricingPriceListId] = useState('');
  const [stocktakeWarehouse, setStocktakeWarehouse] = useState('');
  const [selectedBalanceKey, setSelectedBalanceKey] = useState(''); const [movementRows, setMovementRows] = useState<MovementView[]>([]);
  const [movementHasMore, setMovementHasMore] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const importOperationKeyRef = useRef<string | null>(null);
  const referenceLoadedRef = useRef(false);

  useEffect(() => { if (TABS.includes(requestedTab as Tab)) setTab(requestedTab as Tab); }, [requestedTab]);

  const warehouses = useMemo(() => {
    const map = new Map<string, { id: string; code: string; name: string }>();
    for (const item of balances) map.set(item.warehouse_id, { id: item.warehouse_id, code: item.warehouse_code, name: item.warehouse_name });
    return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [balances]);
  const selectedBalance = useMemo(() => balances.find((item) => scopeKey(item.warehouse_code, item.location_code, item.base_sku, item.lot_code) === selectedBalanceKey) ?? null, [balances, selectedBalanceKey]);

  async function loadAllBalances() {
    const rows: Balance[] = [];
    let offset = 0;
    while (true) {
      const batch = await requestJson<Balance[]>(`/api/inventory/balances?limit=1000&offset=${offset}`);
      rows.push(...batch);
      if (batch.length < 1000) return rows;
      offset += 1000;
      if (offset > 100_000) throw new Error('Dữ liệu tồn kho quá lớn. Hãy dùng Tra cứu tồn kho để thu hẹp phạm vi.');
    }
  }

  async function refreshReferenceData() {
    const [nextUnits, nextLists, nextBalances] = await Promise.all([
      requestJson<Unit[]>('/api/units?limit=1000'),
      requestJson<PriceList[]>('/api/price-lists?limit=1000'),
      loadAllBalances(),
    ]);
    setUnits(nextUnits); setPriceLists(nextLists); setBalances(nextBalances);
    if (!pricingPriceListId) setPricingPriceListId(nextLists.find((item) => item.is_active && item.list_type === 'BASE')?.id ?? '');
    if (!stocktakeWarehouse && nextBalances.length) setStocktakeWarehouse(nextBalances[0].warehouse_id);
  }
  useEffect(() => {
    if (tab === 'office-forms' || referenceLoadedRef.current) return;
    referenceLoadedRef.current = true;
    refreshReferenceData().catch((cause) => {
      referenceLoadedRef.current = false;
      setError(cause instanceof Error ? cause.message : 'Không tải được dữ liệu nền.');
    });
  }, [tab]);
  function begin() { setBusy(true); setError(''); setMessage(''); }
  function fail(cause: unknown) { setError(cause instanceof Error ? humanizeMessage(cause.message) : 'Thao tác không thành công.'); }
  function toggleColumn(setter: (value: Set<string>) => void, current: Set<string>, column: string) { const next = new Set(current); if (next.has(column)) next.delete(column); else next.add(column); setter(next); }

  const { productTemplate, productExport, pricingTemplate, pricingExport, stocktakeExport, prepareImport, confirmPendingImport, updatePendingRow } = buildDataExchangeImportActions({
    units, productColumns, pendingImport, importOperationKeyRef, setPendingImport, refreshReferenceData, setMessage, setBusy, fail, begin, priceLists, pricingPriceListId, warehouses, stocktakeWarehouse,
  });

  function movementQuery(offset: number) {
    if (!selectedBalance) throw new Error('Chọn một dòng tồn kho để xem biến động.');
    const params = new URLSearchParams({
      warehouseId: selectedBalance.warehouse_id,
      baseVariantId: selectedBalance.base_variant_id,
      limit: String(MOVEMENT_PAGE_SIZE),
      offset: String(offset),
    });
    if (selectedBalance.location_id) params.set('locationId', selectedBalance.location_id);
    if (selectedBalance.lot_id) params.set('lotId', selectedBalance.lot_id);
    return params;
  }

  function movementViews(rows: Movement[], startingQuantity: bigint) {
    let running = startingQuantity;
    return rows.map((row) => {
      const stockAfter = formatScaled12(running);
      running -= scaled12(row.base_quantity_delta);
      return { ...row, stockAfter };
    });
  }

  async function loadMovements() {
    begin();
    try {
      if (!selectedBalance) throw new Error('Chọn một dòng tồn kho để xem biến động.');
      const rows = await requestJson<Movement[]>(`/api/inventory/balances/drill-down?${movementQuery(0)}`);
      const views = movementViews(rows, scaled12(selectedBalance.on_hand_quantity));
      setMovementRows(views);
      setMovementHasMore(rows.length === MOVEMENT_PAGE_SIZE);
      setMessage(`Đã tải ${views.length} lần biến động của ${selectedBalance.base_sku}.`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function loadMoreMovements() {
    if (!selectedBalance || !movementHasMore || busy) return;
    begin();
    try {
      const rows = await requestJson<Movement[]>(`/api/inventory/balances/drill-down?${movementQuery(movementRows.length)}`);
      let running = scaled12(selectedBalance.on_hand_quantity);
      for (const row of movementRows) running -= scaled12(row.base_quantity_delta);
      const views = movementViews(rows, running);
      setMovementRows((current) => [...current, ...views]);
      setMovementHasMore(rows.length === MOVEMENT_PAGE_SIZE);
      setMessage(`Đã tải ${movementRows.length + views.length} lần biến động của ${selectedBalance.base_sku}.`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function exportMovements(format: 'xlsx' | 'csv') {
    begin();
    try {
      if (!selectedBalance) throw new Error('Chọn một dòng tồn kho trước khi xuất file.');
      const query = new URLSearchParams({
        warehouseId: selectedBalance.warehouse_id,
        baseVariantId: selectedBalance.base_variant_id,
        format,
      });
      if (selectedBalance.location_id) query.set('locationId', selectedBalance.location_id);
      if (selectedBalance.lot_id) query.set('lotId', selectedBalance.lot_id);
      const response = await fetch(`/api/inventory/balances/drill-down/export?${query.toString()}`, { method: 'GET', cache: 'no-store' });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message || 'Không xuất được biến động kho.');
      }
      const blob = await response.blob();
      const filename = filenameFromDisposition(response.headers.get('content-disposition'), `Bien-dong-kho.${format}`);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      setMessage(`Đã xuất biến động kho của ${selectedBalance.base_sku}.`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  function selectMovementBalance(value: string) {
    setSelectedBalanceKey(value);
    setMovementRows([]);
    setMovementHasMore(false);
  }

  function fileInput(key: string, accept: string, kind: ImportKind) {
    return <input ref={(node) => { fileRefs.current[key] = node; }} className={styles.hiddenInput} type="file" accept={accept} onChange={(event) => { const file = event.target.files?.[0]; if (file) void prepareImport(kind, file); event.currentTarget.value = ''; }} />;
  }
  function columnChooser(columns: readonly string[], selected: Set<string>, setter: (value: Set<string>) => void) {
    return <details className={styles.columns}><summary>Chọn thông tin muốn xuất ({selected.size}/{columns.length})</summary><div className={styles.columnGrid}>{columns.map((column) => <label key={column}><input type="checkbox" checked={selected.has(column)} onChange={() => toggleColumn(setter, selected, column)} />{labelFor(column)}</label>)}</div></details>;
  }
  function previewTable() { return <DataExchangeImportPreview ctx={{ pendingImport, tab, setPendingImport, busy, confirmPendingImport, units, updatePendingRow }} />; }

  return <DataExchangeView ctx={{ tab, setTab, setError, setMessage, setPendingImport, busy, setBusy, error, message, fileRefs, fileInput, productTemplate, productExport, columnChooser, productColumns, setProductColumns, previewTable, pricingTemplate, pricingExport, priceLists, pricingPriceListId, setPricingPriceListId, stocktakeExport, stocktakeWarehouse, setStocktakeWarehouse, warehouses, loadMovements, loadMoreMovements, movementHasMore, exportMovements, selectedBalanceKey, selectMovementBalance, balances, selectedBalance, movementRows, refreshReferenceData, begin, fail }} />;
}
