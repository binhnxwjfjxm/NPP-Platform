'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../components/modal';
import type { PriceAdjustmentType, PriceList, PriceListItem } from '../../lib/pricing-types';
import styles from './pricing-bulk-overlay.module.css';

type ApplyMode = 'NOW' | 'SCHEDULED';
type PreviewRow = { sku: string; status: 'CREATE' | 'UPDATE'; reason: string };
type ImportResult = { itemsCreated: number; itemsUpdated: number; itemsReplaced?: number; totalItems: number };
type ApiEnvelope<T> = { data?: T; error?: { code?: string; message?: string; retryable?: boolean; details?: unknown } };
type Props = {
  priceLists: PriceList[];
  defaultPriceListId?: string;
  onApplied?: (priceListId: string) => void | Promise<void>;
};

const PRICE_ITEM_PAGE_SIZE = 2000;
const MAX_PRICE_ITEM_OFFSET = 10000;
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
async function listAllPriceListItems(priceListId: string, signal?: AbortSignal): Promise<PriceListItem[]> {
  const rows: PriceListItem[] = [];
  for (let offset = 0; offset <= MAX_PRICE_ITEM_OFFSET; offset += PRICE_ITEM_PAGE_SIZE) {
    const page = await requestJson<PriceListItem[]>(`/api/price-lists/${priceListId}/items?limit=${PRICE_ITEM_PAGE_SIZE}&offset=${offset}`, { signal });
    rows.push(...page);
    if (page.length < PRICE_ITEM_PAGE_SIZE) return rows;
  }
  throw new Error('Bảng giá vượt giới hạn đọc 12.000 dòng; chưa thể điều chỉnh an toàn.');
}
function apiDate(value: string): string | null { return value ? new Date(value).toISOString() : null; }
function upper(value: string | null | undefined): string { return String(value ?? '').trim().toUpperCase(); }
function decimalKey(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  return normalized.includes('.') ? normalized.replace(/0+$/, '').replace(/\.$/, '') || '0' : normalized;
}
function percentToBps(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  return Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
}
function validMoney(value: string): boolean { return /^(?:0|[1-9]\d{0,18})$/.test(value.trim()); }
function parseSkuInput(value: string): string[] { return [...new Set(value.split(/[\s,;]+/).map(upper).filter(Boolean))]; }
function currentItem(rows: PriceListItem[]) {
  const now = Date.now();
  return rows
    .filter((item) => item.is_active)
    .filter((item) => (!item.effective_from || new Date(item.effective_from).getTime() <= now)
      && (!item.effective_to || new Date(item.effective_to).getTime() > now))
    .sort((a, b) => new Date(b.effective_from ?? 0).getTime() - new Date(a.effective_from ?? 0).getTime())[0] ?? null;
}

export default function PricingBulkOverlay({ priceLists, defaultPriceListId = '', onApplied }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  const [note, setNote] = useState('');
  const [applyMode, setApplyMode] = useState<ApplyMode>('NOW');
  const [applyAt, setApplyAt] = useState('');
  const operationKeyRef = useRef<string | null>(null);

  const lists = useMemo(() => priceLists.filter((list) => list.is_active), [priceLists]);
  const selectedList = useMemo(() => lists.find((list) => list.id === selectedListId) ?? null, [lists, selectedListId]);
  const itemsBySku = useMemo(() => {
    const map = new Map<string, PriceListItem[]>();
    for (const item of items) {
      const sku = upper(item.sku);
      const rows = map.get(sku);
      if (rows) rows.push(item); else map.set(sku, [item]);
    }
    return map;
  }, [items]);
  const existingSkus = useMemo(() => [...itemsBySku.keys()].sort((a, b) => a.localeCompare(b)), [itemsBySku]);
  const visibleExistingSkus = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('vi');
    return existingSkus.filter((sku) => {
      const item = currentItem(itemsBySku.get(sku) ?? []) ?? itemsBySku.get(sku)?.[0];
      return !term || `${sku} ${item?.variant_name ?? ''} ${item?.product_code ?? ''} ${item?.product_name ?? ''}`.toLocaleLowerCase('vi').includes(term);
    }).slice(0, 150);
  }, [existingSkus, itemsBySku, search]);
  const selectedSkuList = useMemo(() => [...selectedSkus].sort((a, b) => a.localeCompare(b)), [selectedSkus]);
  const usesAmount = ['FIXED_PRICE', 'AMOUNT_DISCOUNT', 'AMOUNT_MARKUP'].includes(adjustmentType);

  useEffect(() => {
    setItems([]); setSelectedSkus(new Set()); setFixedPrices({}); setMessage(null); setError(null);
    if (!open || !selectedListId) return;
    const controller = new AbortController();
    setLoading(true);
    listAllPriceListItems(selectedListId, controller.signal)
      .then(setItems)
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Không tải được giá hiện tại.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, selectedListId]);

  useEffect(() => {
    if (selectedList?.list_type === 'BASE' && adjustmentType !== 'FIXED_PRICE') setAdjustmentType('FIXED_PRICE');
  }, [selectedList, adjustmentType]);

  useEffect(() => { operationKeyRef.current = null; }, [selectedListId, selectedSkuList, adjustmentType, sharedValue, fixedPrices, minQuantity, maxQuantity, note, applyMode, applyAt]);

  const preview = useMemo<PreviewRow[]>(() => selectedSkuList.map((sku) => {
    const scoped = (itemsBySku.get(sku) ?? []).filter((item) => item.is_active
      && item.adjustment_type === adjustmentType
      && decimalKey(item.min_quantity) === decimalKey(minQuantity || '0')
      && decimalKey(item.max_quantity) === decimalKey(maxQuantity));
    return scoped.length
      ? { sku, status: 'UPDATE', reason: applyMode === 'NOW' ? 'Kết thúc mức giá hiện tại và áp dụng giá mới ngay.' : 'Giữ giá hiện tại đến ngày áp dụng rồi tự chuyển giá mới.' }
      : { sku, status: 'CREATE', reason: 'Chưa có mức giá cùng phạm vi; sẽ tạo mức giá mới.' };
  }), [adjustmentType, applyMode, itemsBySku, maxQuantity, minQuantity, selectedSkuList]);

  function openDialog() {
    const preferred = lists.some((list) => list.id === defaultPriceListId) ? defaultPriceListId : lists.find((list) => list.list_type === 'BASE')?.id ?? lists[0]?.id ?? '';
    setSelectedListId(preferred);
    setApplyMode('NOW'); setApplyAt(''); setError(null); setMessage(null); setOpen(true);
  }
  function addTypedSkus() {
    const nextSkus = parseSkuInput(skuInput);
    if (!nextSkus.length) return;
    setSelectedSkus((current) => new Set([...current, ...nextSkus]));
    setSkuInput('');
  }
  function toggleSku(sku: string, checked: boolean) {
    setSelectedSkus((current) => { const next = new Set(current); if (checked) next.add(sku); else next.delete(sku); return next; });
  }
  function close() { if (!busy) setOpen(false); }
  function validate(): string | null {
    if (!selectedList) return 'Chọn bảng giá cần điều chỉnh.';
    if (!selectedSkus.size) return 'Chọn ít nhất một SKU.';
    if (selectedList.list_type === 'BASE' && adjustmentType !== 'FIXED_PRICE') return 'Bảng giá nền chỉ nhận giá trực tiếp.';
    if (applyMode === 'SCHEDULED' && !applyAt) return 'Chọn ngày áp dụng giá mới.';
    if (applyMode === 'SCHEDULED' && Number.isNaN(new Date(applyAt).getTime())) return 'Ngày áp dụng không hợp lệ.';
    if (adjustmentType === 'FIXED_PRICE') {
      const missing = selectedSkuList.find((sku) => !validMoney(fixedPrices[sku] ?? ''));
      if (missing) return `Nhập giá hợp lệ cho SKU ${missing}.`;
    } else if (usesAmount) {
      if (!validMoney(sharedValue)) return 'Giá trị tiền phải là số nguyên không âm.';
    } else if (percentToBps(sharedValue) === null) return 'Phần trăm chỉ nhận tối đa 2 chữ số thập phân.';
    if (maxQuantity && Number(maxQuantity) <= Number(minQuantity || '0')) return 'Số lượng đến phải lớn hơn số lượng từ.';
    return null;
  }

  async function applyBulk() {
    const validation = validate();
    if (validation) { setError(validation); setMessage(null); return; }
    const list = selectedList as PriceList;
    setBusy(true); setMessage(null); setError(null);
    try {
      const operationKey = operationKeyRef.current ?? createIdempotencyKey('pricing_adjust');
      operationKeyRef.current = operationKey;
      const rateBps = usesAmount ? null : percentToBps(sharedValue);
      const result = await requestJson<ImportResult>('/api/pricing/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operationKey },
        body: JSON.stringify({
          matchBySku: true,
          replaceFrom: true,
          applyAt: applyMode === 'SCHEDULED' ? apiDate(applyAt) : null,
          sourceBatchId: operationKey,
          items: selectedSkuList.map((sku) => ({
            priceListCode: list.code, sku, adjustmentType,
            amountMinor: usesAmount ? (adjustmentType === 'FIXED_PRICE' ? fixedPrices[sku] : sharedValue) : null,
            rateBps, minQuantity: minQuantity || '0', maxQuantity: maxQuantity || null,
            sourceKind: 'ADMIN', externalRuleCode: 'PRICE_ADJUSTMENT', note: note.trim() || null, isActive: true,
          })),
        }),
      });
      operationKeyRef.current = null;
      setItems(await listAllPriceListItems(list.id));
      setSelectedSkus(new Set()); setFixedPrices({});
      setMessage(`Đã điều chỉnh ${result.totalItems} SKU${applyMode === 'NOW' ? ' và áp dụng ngay.' : ' theo ngày đã chọn.'}`);
      await onApplied?.(list.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không điều chỉnh được giá.');
    } finally { setBusy(false); }
  }

  return <>
    <button type="button" className={styles.launchButton} onClick={openDialog} data-testid="open-bulk-pricing">Điều chỉnh trực tiếp</button>
    <Modal open={open} title="Điều chỉnh giá trực tiếp" description="Chỉ SKU được chọn mới thay đổi. Giá cũ được giữ trong lịch sử và tự kết thúc tại thời điểm áp dụng giá mới." onClose={close} testId="bulk-pricing-modal" size="workspace"
      footer={<><button type="button" className={styles.secondaryButton} onClick={close} disabled={busy}>Đóng</button><button type="button" className={styles.primaryButton} onClick={() => void applyBulk()} disabled={busy || loading || !selectedSkus.size} data-testid="apply-bulk-pricing">{busy ? 'Đang áp dụng…' : `Xác nhận ${selectedSkus.size || ''} SKU`}</button></>}>
      {error ? <div className={styles.errorNotice} role="alert">{error}</div> : null}
      {message ? <div className={styles.notice} role="status">{message}</div> : null}
      <div className={styles.scopeGrid}>
        <label>Bảng giá<select value={selectedListId} onChange={(event) => setSelectedListId(event.target.value)}><option value="">Chọn bảng giá</option>{lists.map((list) => <option key={list.id} value={list.id}>{list.code} — {list.name}</option>)}</select></label>
        <label>Loại điều chỉnh<select value={adjustmentType} disabled={selectedList?.list_type === 'BASE'} onChange={(event) => setAdjustmentType(event.target.value as PriceAdjustmentType)}>{Object.entries(ADJUSTMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Thời điểm áp dụng<select value={applyMode} onChange={(event) => setApplyMode(event.target.value as ApplyMode)}><option value="NOW">Cập nhật ngay</option><option value="SCHEDULED">Áp dụng từ ngày</option></select></label>
        {applyMode === 'SCHEDULED' ? <label>Ngày áp dụng<input type="datetime-local" value={applyAt} onChange={(event) => setApplyAt(event.target.value)} /></label> : null}
      </div>
      <div className={styles.skuEntry}><label>Nhập / dán SKU<input value={skuInput} onChange={(event) => setSkuInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTypedSkus(); } }} placeholder="VD: SKU001, SKU002" /></label><button type="button" className={styles.primaryButton} onClick={addTypedSkus} disabled={!parseSkuInput(skuInput).length}>Thêm SKU</button><span>{selectedSkus.size} SKU đã chọn</span></div>
      <div className={styles.selectionHeader}><label className={styles.searchLabel}>Tìm trong bảng giá<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="SKU, tên sản phẩm hoặc quy cách" /></label><button type="button" className={styles.secondaryButton} onClick={() => setSelectedSkus((current) => new Set([...current, ...visibleExistingSkus]))} disabled={!visibleExistingSkus.length}>Chọn kết quả</button><button type="button" className={styles.secondaryButton} onClick={() => setSelectedSkus(new Set())} disabled={!selectedSkus.size}>Bỏ chọn</button></div>
      <div className={styles.existingSkuList}>{loading ? <p>Đang tải dữ liệu…</p> : visibleExistingSkus.map((sku) => { const item = currentItem(itemsBySku.get(sku) ?? []) ?? itemsBySku.get(sku)?.[0]; return <label key={sku}><input type="checkbox" checked={selectedSkus.has(sku)} onChange={(event) => toggleSku(sku, event.target.checked)} /><span><strong>{sku}</strong><small>{item?.product_name ?? '—'} · {item?.variant_name ?? '—'}</small></span></label>; })}</div>
      {selectedSkuList.length ? <div className={styles.variantList}>{selectedSkuList.map((sku) => { const current = currentItem(itemsBySku.get(sku) ?? []); return <div key={sku} className={styles.variantRow}><button type="button" className={styles.removeSku} onClick={() => toggleSku(sku, false)} aria-label={`Bỏ SKU ${sku}`}>×</button><span><strong>{sku}</strong><small>{current ? `${current.product_name} · ${current.variant_name}` : 'SKU sẽ được tra cứu khi áp dụng'}</small></span><span>{current?.amount_minor ? `Hiện tại ${new Intl.NumberFormat('vi-VN').format(BigInt(current.amount_minor))} ₫` : 'Chưa có giá hiện tại'}</span>{adjustmentType === 'FIXED_PRICE' ? <input aria-label={`Giá mới SKU ${sku}`} inputMode="numeric" placeholder="Giá mới" value={fixedPrices[sku] ?? ''} onChange={(event) => setFixedPrices((currentValues) => ({ ...currentValues, [sku]: event.target.value.replace(/\D/g, '') }))} /> : null}</div>; })}</div> : null}
      {adjustmentType !== 'FIXED_PRICE' ? <div className={styles.valuePanel}><label>{usesAmount ? 'Giá trị tiền (₫)' : 'Phần trăm (%)'}<input value={sharedValue} inputMode={usesAmount ? 'numeric' : 'decimal'} onChange={(event) => setSharedValue(usesAmount ? event.target.value.replace(/\D/g, '') : event.target.value)} /></label></div> : null}
      <details className={styles.advanced}><summary>Điều kiện nâng cao</summary><div className={styles.scopeGrid}><label>Số lượng từ<input value={minQuantity} inputMode="decimal" onChange={(event) => setMinQuantity(event.target.value)} /></label><label>Số lượng đến<input value={maxQuantity} inputMode="decimal" placeholder="Không giới hạn" onChange={(event) => setMaxQuantity(event.target.value)} /></label><label className={styles.wide}>Ghi chú<input value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} /></label></div></details>
      <section className={styles.preview}><div className={styles.previewHeader}><h3>Xem trước</h3><span>{preview.length} SKU</span></div>{preview.length === 0 ? <p>Chọn SKU để xem trước.</p> : preview.map((row) => <div key={row.sku} className={styles.previewRow}><strong>{row.sku}</strong><span className={row.status === 'UPDATE' ? styles.update : styles.create}>{row.status === 'UPDATE' ? 'Điều chỉnh' : 'Tạo mới'}</span><span>{row.reason}</span></div>)}</section>
    </Modal>
  </>;
}
