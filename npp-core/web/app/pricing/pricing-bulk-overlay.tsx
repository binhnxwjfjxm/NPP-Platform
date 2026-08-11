'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal from '../components/modal';
import type {
  PriceAdjustmentType,
  PriceList,
  PriceListItem,
} from '../../lib/pricing-types';
import styles from './pricing-bulk-overlay.module.css';

type ConflictPolicy = 'SKIP_EXISTING' | 'UPSERT_SKU';
type PreviewStatus = 'CREATE' | 'UPDATE' | 'SKIP';
type PreviewRow = { sku: string; status: PreviewStatus; reason: string; item: PriceListItem | null };
type ImportResult = { channelsCreated: number; listsCreated: number; itemsCreated: number; itemsUpdated: number; totalItems: number };
type ApiEnvelope<T> = { data?: T; error?: { code?: string; message?: string; retryable?: boolean; details?: unknown } };

const ADJUSTMENT_LABELS: Record<PriceAdjustmentType, string> = {
  FIXED_PRICE: 'Đặt giá trực tiếp',
  PERCENT_DISCOUNT: 'Giảm phần trăm',
  AMOUNT_DISCOUNT: 'Giảm số tiền',
  PERCENT_MARKUP: 'Tăng phần trăm',
  AMOUNT_MARKUP: 'Tăng số tiền',
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    const error = new Error(payload.error?.message || payload.error?.code || 'Yêu cầu không thành công');
    Object.assign(error, { code: payload.error?.code, statusCode: response.status, retryable: payload.error?.retryable === true, details: payload.error?.details ?? {} });
    throw error;
  }
  return payload.data as T;
}

function apiDate(value: string): string | null { return value ? new Date(value).toISOString() : null; }
function upper(value: string | null | undefined): string { return String(value ?? '').trim().toUpperCase(); }
function decimalKey(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  if (!normalized.includes('.')) return normalized;
  return normalized.replace(/0+$/, '').replace(/\.$/, '') || '0';
}
function dateKey(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? normalized : parsed.toISOString();
}
function percentToBps(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  return Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
}
function validMoney(value: string): boolean { return /^(?:0|[1-9]\d{0,18})$/.test(value.trim()); }
function parseSkuInput(value: string): string[] {
  return [...new Set(value.split(/[\s,;]+/).map(upper).filter(Boolean))];
}

export default function PricingBulkOverlay() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lists, setLists] = useState<PriceList[]>([]);
  const [items, setItems] = useState<PriceListItem[]>([]);
  const [selectedListId, setSelectedListId] = useState('');
  const [skuInput, setSkuInput] = useState('');
  const [search, setSearch] = useState('');
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());
  const [adjustmentType, setAdjustmentType] = useState<PriceAdjustmentType>('FIXED_PRICE');
  const [sharedValue, setSharedValue] = useState('');
  const [fixedPrices, setFixedPrices] = useState<Record<string, string>>({});
  const [minQuantity, setMinQuantity] = useState('0');
  const [maxQuantity, setMaxQuantity] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [note, setNote] = useState('');
  const [conflictPolicy, setConflictPolicy] = useState<ConflictPolicy>('UPSERT_SKU');

  const selectedList = useMemo(() => lists.find((list) => list.id === selectedListId) ?? null, [lists, selectedListId]);
  const skuMeta = useMemo(() => {
    const map = new Map<string, PriceListItem>();
    for (const item of items) if (!map.has(upper(item.sku))) map.set(upper(item.sku), item);
    return map;
  }, [items]);
  const existingSkus = useMemo(() => [...skuMeta.keys()].sort((a, b) => a.localeCompare(b)), [skuMeta]);
  const visibleExistingSkus = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('vi');
    if (!term) return existingSkus.slice(0, 120);
    return existingSkus.filter((sku) => {
      const item = skuMeta.get(sku);
      return `${sku} ${item?.variant_name ?? ''} ${item?.product_code ?? ''} ${item?.product_name ?? ''}`.toLocaleLowerCase('vi').includes(term);
    }).slice(0, 120);
  }, [existingSkus, search, skuMeta]);
  const selectedSkuList = useMemo(() => [...selectedSkus].sort((a, b) => a.localeCompare(b)), [selectedSkus]);

  useEffect(() => {
    if (!open || lists.length) return;
    const controller = new AbortController();
    setLoading(true); setMessage(null);
    requestJson<PriceList[]>('/api/price-lists?active=true&limit=1000', { signal: controller.signal })
      .then((nextLists) => {
        setLists(nextLists);
        if (!selectedListId && nextLists.length) setSelectedListId(nextLists.find((list) => list.list_type === 'BASE')?.id ?? nextLists[0].id);
      })
      .catch((error) => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Không tải được bảng giá.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, lists.length, selectedListId]);

  useEffect(() => {
    setItems([]); setSelectedSkus(new Set()); setFixedPrices({});
    if (!open || !selectedListId) return;
    const controller = new AbortController();
    setLoading(true);
    requestJson<PriceListItem[]>(`/api/price-lists/${selectedListId}/items?limit=2000`, { signal: controller.signal })
      .then(setItems)
      .catch((error) => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Không tải được các dòng giá hiện có.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, selectedListId]);

  useEffect(() => {
    if (selectedList?.list_type === 'BASE' && adjustmentType !== 'FIXED_PRICE') setAdjustmentType('FIXED_PRICE');
  }, [selectedList, adjustmentType]);

  const preview = useMemo<PreviewRow[]>(() => {
    const targetFrom = dateKey(apiDate(effectiveFrom));
    const targetTo = dateKey(apiDate(effectiveTo));
    return selectedSkuList.map((sku) => {
      const activeRows = items.filter((item) => upper(item.sku) === sku && item.is_active);
      const matchingRows = activeRows.filter((item) => item.adjustment_type === adjustmentType
        && decimalKey(item.min_quantity) === decimalKey(minQuantity || '0')
        && decimalKey(item.max_quantity) === decimalKey(maxQuantity)
        && dateKey(item.effective_from) === targetFrom
        && dateKey(item.effective_to) === targetTo);
      if (conflictPolicy === 'SKIP_EXISTING' && activeRows.length) return { sku, status: 'SKIP', reason: 'SKU đã có quy tắc đang hoạt động trong bảng này.', item: null };
      if (matchingRows.length > 1) return { sku, status: 'SKIP', reason: 'Có nhiều dòng cùng điều kiện; cần xử lý trùng trước.', item: null };
      if (matchingRows.length === 1) return { sku, status: 'UPDATE', reason: 'Tìm đúng dòng hiện có bằng SKU + điều kiện; giữ nguyên định danh nội bộ.', item: matchingRows[0] };
      if (activeRows.length) return { sku, status: 'SKIP', reason: 'SKU có quy tắc khác điều kiện; không tạo dòng chồng lấn âm thầm.', item: null };
      return { sku, status: 'CREATE', reason: 'Chưa có dòng cùng điều kiện; hệ thống sẽ tra SKU chuẩn và tạo mới.', item: null };
    });
  }, [adjustmentType, conflictPolicy, effectiveFrom, effectiveTo, items, maxQuantity, minQuantity, selectedSkuList]);

  const actionableRows = preview.filter((row) => row.status !== 'SKIP');
  const usesAmount = ['FIXED_PRICE', 'AMOUNT_DISCOUNT', 'AMOUNT_MARKUP'].includes(adjustmentType);

  function addTypedSkus() {
    const nextSkus = parseSkuInput(skuInput);
    if (!nextSkus.length) return;
    setSelectedSkus((current) => new Set([...current, ...nextSkus]));
    setSkuInput('');
  }
  function toggleSku(sku: string, checked: boolean) {
    setSelectedSkus((current) => { const next = new Set(current); if (checked) next.add(sku); else next.delete(sku); return next; });
  }
  function close() { if (!busy) { setOpen(false); setMessage(null); } }

  function validate(): string | null {
    if (!selectedList) return 'Chọn bảng giá/chương trình.';
    if (!selectedSkus.size) return 'Nhập hoặc chọn ít nhất một SKU.';
    if (!actionableRows.length) return 'Không có SKU nào đủ điều kiện để áp dụng.';
    if (selectedList.list_type === 'BASE' && adjustmentType !== 'FIXED_PRICE') return 'Bảng giá nền chỉ nhận giá trực tiếp.';
    if (adjustmentType === 'FIXED_PRICE') {
      const missing = actionableRows.find((row) => !validMoney(fixedPrices[row.sku] ?? ''));
      if (missing) return `Nhập giá hợp lệ cho SKU ${missing.sku}.`;
    } else if (usesAmount) {
      if (!validMoney(sharedValue)) return 'Giá trị tiền phải là số nguyên không âm.';
    } else if (percentToBps(sharedValue) === null) return 'Phần trăm chỉ nhận tối đa 2 chữ số thập phân.';
    if (maxQuantity && Number(maxQuantity) <= Number(minQuantity || '0')) return 'Số lượng đến phải lớn hơn số lượng từ.';
    if (effectiveFrom && effectiveTo && new Date(effectiveTo) <= new Date(effectiveFrom)) return 'Hiệu lực đến phải sau hiệu lực từ.';
    return null;
  }

  async function applyBulk() {
    const validation = validate();
    if (validation) { setMessage(validation); return; }
    const list = selectedList as PriceList;
    setBusy(true); setMessage(null);
    try {
      const rateBps = usesAmount ? null : percentToBps(sharedValue);
      const result = await requestJson<ImportResult>('/api/pricing/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchBySku: true,
          sourceBatchId: `web-bulk-sku-${crypto.randomUUID()}`,
          items: actionableRows.map((row) => ({
            priceListCode: list.code,
            sku: row.sku,
            adjustmentType,
            amountMinor: usesAmount ? (adjustmentType === 'FIXED_PRICE' ? fixedPrices[row.sku] : sharedValue) : null,
            rateBps,
            minQuantity: minQuantity || '0', maxQuantity: maxQuantity || null,
            effectiveFrom: apiDate(effectiveFrom), effectiveTo: apiDate(effectiveTo),
            sourceKind: 'ADMIN', externalRuleCode: 'WEB_BULK_SKU', note: note.trim() || null, isActive: true,
          })),
        }),
      });
      setMessage(`Đã hoàn tất: tạo ${result.itemsCreated}, cập nhật ${result.itemsUpdated}, tổng ${result.totalItems} SKU.`);
      setItems(await requestJson<PriceListItem[]>(`/api/price-lists/${list.id}/items?limit=2000`));
      setSelectedSkus(new Set()); setFixedPrices({});
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không áp dụng được giá cho các SKU đã chọn.');
    } finally { setBusy(false); }
  }

  return <>
    <button type="button" className={styles.launchButton} onClick={() => setOpen(true)} data-testid="open-bulk-pricing">Thiết lập giá nhiều SKU</button>
    <Modal open={open} title="Thiết lập giá cho nhiều SKU" description="SKU là khóa tra cứu. Gõ hoặc dán SKU; hệ thống tự tìm đúng dòng giá và các định danh liên quan ở phía sau." onClose={close} testId="bulk-pricing-modal" size="large"
      footer={<><button type="button" className={styles.secondaryButton} onClick={close} disabled={busy}>Đóng</button><button type="button" className={styles.primaryButton} onClick={() => void applyBulk()} disabled={busy || loading || !actionableRows.length} data-testid="apply-bulk-pricing">{busy ? 'Đang áp dụng…' : `Áp dụng ${actionableRows.length || ''} SKU`}</button></>}>
      {message ? <div className={styles.notice} role="status">{message}</div> : null}
      <div className={styles.scopeGrid}>
        <label>Bảng giá / chương trình<select value={selectedListId} onChange={(event) => setSelectedListId(event.target.value)}><option value="">Chọn bảng giá</option>{lists.map((list) => <option key={list.id} value={list.id}>{list.code} — {list.name}</option>)}</select></label>
        <label>Loại điều chỉnh<select value={adjustmentType} disabled={selectedList?.list_type === 'BASE'} onChange={(event) => setAdjustmentType(event.target.value as PriceAdjustmentType)}>{Object.entries(ADJUSTMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Cách xử lý trùng<select value={conflictPolicy} onChange={(event) => setConflictPolicy(event.target.value as ConflictPolicy)}><option value="UPSERT_SKU">Cập nhật đúng dòng theo SKU</option><option value="SKIP_EXISTING">Bỏ qua SKU đã có quy tắc</option></select></label>
      </div>

      <div className={styles.skuEntry} data-testid="bulk-pricing-sku-entry"><label>Nhập / dán SKU<input value={skuInput} onChange={(event) => setSkuInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTypedSkus(); } }} placeholder="VD: SKU001, SKU002, SKU003" /></label><button type="button" className={styles.primaryButton} onClick={addTypedSkus} disabled={!parseSkuInput(skuInput).length}>Thêm SKU</button><span>{selectedSkus.size} SKU đã chọn</span></div>

      <div className={styles.selectionHeader}><label className={styles.searchLabel}>Tìm SKU đang có trong bảng giá<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="SKU, tên quy cách hoặc sản phẩm" /></label><button type="button" className={styles.secondaryButton} onClick={() => setSelectedSkus((current) => new Set([...current, ...visibleExistingSkus]))} disabled={!visibleExistingSkus.length}>Chọn kết quả</button><button type="button" className={styles.secondaryButton} onClick={() => setSelectedSkus(new Set())} disabled={!selectedSkus.size}>Bỏ chọn</button></div>
      <div className={styles.existingSkuList} aria-label="SKU đang có trong bảng giá">{loading ? <p>Đang tải dữ liệu…</p> : visibleExistingSkus.map((sku) => { const item = skuMeta.get(sku); return <label key={sku}><input type="checkbox" checked={selectedSkus.has(sku)} onChange={(event) => toggleSku(sku, event.target.checked)} /><span><strong>{sku}</strong><small>{item?.product_name ?? '—'} · {item?.variant_name ?? '—'}</small></span></label>; })}</div>

      {selectedSkuList.length ? <div className={styles.variantList} aria-label="Danh sách SKU thiết lập giá">{selectedSkuList.map((sku) => { const meta = skuMeta.get(sku); return <div key={sku} className={styles.variantRow}><button type="button" className={styles.removeSku} onClick={() => toggleSku(sku, false)} aria-label={`Bỏ SKU ${sku}`}>×</button><span><strong>{sku}</strong><small>{meta ? `${meta.product_name} · ${meta.variant_name}` : 'SKU sẽ được tra cứu trong danh mục khi áp dụng'}</small></span><span>{meta?.amount_minor ? `Giá hiện tại ${meta.amount_minor}` : 'Chưa có giá cùng bảng'}</span>{adjustmentType === 'FIXED_PRICE' ? <input aria-label={`Giá SKU ${sku}`} inputMode="numeric" placeholder="Giá VND" value={fixedPrices[sku] ?? ''} onChange={(event) => setFixedPrices((current) => ({ ...current, [sku]: event.target.value.replace(/\D/g, '') }))} /> : null}</div>; })}</div> : null}

      {adjustmentType !== 'FIXED_PRICE' ? <div className={styles.valuePanel}><label>{usesAmount ? 'Giá trị tiền (₫)' : 'Phần trăm (%)'}<input value={sharedValue} inputMode={usesAmount ? 'numeric' : 'decimal'} onChange={(event) => setSharedValue(usesAmount ? event.target.value.replace(/\D/g, '') : event.target.value)} /></label></div> : null}
      <details className={styles.advanced}><summary>Điều kiện và thời gian áp dụng</summary><div className={styles.scopeGrid}><label>Số lượng từ<input value={minQuantity} inputMode="decimal" onChange={(event) => setMinQuantity(event.target.value)} /></label><label>Số lượng đến<input value={maxQuantity} inputMode="decimal" placeholder="Không giới hạn" onChange={(event) => setMaxQuantity(event.target.value)} /></label><label>Hiệu lực từ<input type="datetime-local" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></label><label>Hiệu lực đến<input type="datetime-local" value={effectiveTo} onChange={(event) => setEffectiveTo(event.target.value)} /></label><label className={styles.wide}>Ghi chú<input value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} /></label></div></details>
      <section className={styles.preview} aria-label="Xem trước thiết lập giá nhiều SKU"><div className={styles.previewHeader}><h3>Xem trước</h3><span>{actionableRows.length} áp dụng · {preview.filter((row) => row.status === 'SKIP').length} bỏ qua</span></div>{preview.length === 0 ? <p>Nhập hoặc chọn SKU để xem trước.</p> : preview.map((row) => <div key={row.sku} className={styles.previewRow}><strong>{row.sku}</strong><span className={row.status === 'SKIP' ? styles.skip : row.status === 'UPDATE' ? styles.update : styles.create}>{row.status === 'SKIP' ? 'Bỏ qua' : row.status === 'UPDATE' ? 'Cập nhật' : 'Tạo mới'}</span><span>{row.reason}</span></div>)}</section>
    </Modal>
  </>;
}
