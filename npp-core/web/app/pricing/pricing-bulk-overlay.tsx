'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal from '../components/modal';
import type {
  PriceAdjustmentType,
  PriceList,
  PriceListItem,
  PricingProduct,
  PricingVariant,
} from '../../lib/pricing-types';
import styles from './pricing-bulk-overlay.module.css';

type ConflictPolicy = 'SKIP_EXISTING' | 'UPSERT_BULK';
type PreviewStatus = 'CREATE' | 'UPDATE' | 'SKIP';

type PreviewRow = {
  variant: PricingVariant;
  sourceKey: string;
  status: PreviewStatus;
  reason: string;
};

type ImportResult = {
  channelsCreated: number;
  listsCreated: number;
  itemsCreated: number;
  itemsUpdated: number;
  totalItems: number;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
};

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
    Object.assign(error, {
      code: payload.error?.code,
      statusCode: response.status,
      retryable: payload.error?.retryable === true,
      details: payload.error?.details ?? {},
    });
    throw error;
  }
  return payload.data as T;
}

function apiDate(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

function normalizedIdentifier(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function bulkSourceKey(list: PriceList, variant: PricingVariant, adjustmentType: PriceAdjustmentType): string {
  return `bulk-admin:${normalizedIdentifier(list.code)}:${normalizedIdentifier(variant.sku)}:${adjustmentType}`;
}

function percentToBps(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  return Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
}

function validMoney(value: string): boolean {
  return /^(?:0|[1-9]\d{0,18})$/.test(value.trim());
}

export default function PricingBulkOverlay() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lists, setLists] = useState<PriceList[]>([]);
  const [products, setProducts] = useState<PricingProduct[]>([]);
  const [variants, setVariants] = useState<PricingVariant[]>([]);
  const [items, setItems] = useState<PriceListItem[]>([]);
  const [selectedListId, setSelectedListId] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [adjustmentType, setAdjustmentType] = useState<PriceAdjustmentType>('FIXED_PRICE');
  const [sharedValue, setSharedValue] = useState('');
  const [fixedPrices, setFixedPrices] = useState<Record<string, string>>({});
  const [minQuantity, setMinQuantity] = useState('0');
  const [maxQuantity, setMaxQuantity] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [note, setNote] = useState('');
  const [conflictPolicy, setConflictPolicy] = useState<ConflictPolicy>('SKIP_EXISTING');

  const selectedList = useMemo(
    () => lists.find((list) => list.id === selectedListId) ?? null,
    [lists, selectedListId],
  );

  const priceableVariants = useMemo(
    () => variants.filter((variant) => variant.is_active && variant.is_sellable && variant.unit_id && variant.conversion_to_base),
    [variants],
  );

  const visibleVariants = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('vi');
    if (!term) return priceableVariants;
    return priceableVariants.filter((variant) => `${variant.sku} ${variant.name}`.toLocaleLowerCase('vi').includes(term));
  }, [priceableVariants, search]);

  useEffect(() => {
    if (!open || lists.length || products.length) return;
    const controller = new AbortController();
    setLoading(true);
    setMessage(null);
    Promise.all([
      requestJson<PriceList[]>('/api/price-lists?active=true&limit=1000', { signal: controller.signal }),
      requestJson<PricingProduct[]>('/api/products?active=true&limit=1000', { signal: controller.signal }),
    ])
      .then(([nextLists, nextProducts]) => {
        setLists(nextLists);
        setProducts(nextProducts);
        if (!selectedListId && nextLists.length) setSelectedListId(nextLists[0].id);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setMessage(error instanceof Error ? error.message : 'Không tải được dữ liệu thiết lập giá.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, lists.length, products.length, selectedListId]);

  useEffect(() => {
    setSelectedIds(new Set());
    setVariants([]);
    setFixedPrices({});
    if (!open || !selectedProductId) return;
    const controller = new AbortController();
    setLoading(true);
    requestJson<PricingVariant[]>(`/api/products/${selectedProductId}/variants`, { signal: controller.signal })
      .then((next) => setVariants(next))
      .catch((error) => {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Không tải được SKU của sản phẩm.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, selectedProductId]);

  useEffect(() => {
    setItems([]);
    setSelectedIds(new Set());
    if (!open || !selectedListId) return;
    const controller = new AbortController();
    requestJson<PriceListItem[]>(`/api/price-lists/${selectedListId}/items?limit=2000`, { signal: controller.signal })
      .then(setItems)
      .catch((error) => {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Không tải được các mức giá hiện có.');
      });
    return () => controller.abort();
  }, [open, selectedListId]);

  useEffect(() => {
    if (selectedList?.list_type === 'BASE' && adjustmentType !== 'FIXED_PRICE') {
      setAdjustmentType('FIXED_PRICE');
    }
  }, [selectedList, adjustmentType]);

  const preview = useMemo<PreviewRow[]>(() => {
    if (!selectedList) return [];
    return priceableVariants
      .filter((variant) => selectedIds.has(variant.id))
      .map((variant) => {
        const sourceKey = bulkSourceKey(selectedList, variant, adjustmentType);
        const activeRows = items.filter((item) => item.variant_id === variant.id && item.is_active);
        const own = activeRows.find((item) => item.source_key === sourceKey);
        const unrelated = activeRows.some((item) => item.source_key !== sourceKey);

        if (conflictPolicy === 'SKIP_EXISTING' && activeRows.length) {
          return { variant, sourceKey, status: 'SKIP', reason: 'SKU đã có mức giá/quy tắc đang hoạt động trong bảng này.' };
        }
        if (unrelated) {
          return { variant, sourceKey, status: 'SKIP', reason: 'Có quy tắc khác đang hoạt động; không ghi đè âm thầm.' };
        }
        if (own) {
          return { variant, sourceKey, status: 'UPDATE', reason: 'Cập nhật thiết lập hàng loạt đã tạo trước đó.' };
        }
        return { variant, sourceKey, status: 'CREATE', reason: 'Tạo dòng giá mới cho đúng SKU.' };
      });
  }, [adjustmentType, conflictPolicy, items, priceableVariants, selectedIds, selectedList]);

  const actionableRows = preview.filter((row) => row.status !== 'SKIP');
  const usesAmount = ['FIXED_PRICE', 'AMOUNT_DISCOUNT', 'AMOUNT_MARKUP'].includes(adjustmentType);

  function toggleVisibleSelection(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const variant of visibleVariants) {
        if (checked) next.add(variant.id);
        else next.delete(variant.id);
      }
      return next;
    });
  }

  function close() {
    if (busy) return;
    setOpen(false);
    setMessage(null);
  }

  function validate(): string | null {
    if (!selectedList) return 'Chọn bảng giá/chương trình.';
    if (!selectedProductId) return 'Chọn sản phẩm.';
    if (!selectedIds.size) return 'Chọn ít nhất một SKU.';
    if (!actionableRows.length) return 'Không có SKU nào đủ điều kiện để áp dụng.';
    if (selectedList.list_type === 'BASE' && adjustmentType !== 'FIXED_PRICE') return 'Bảng giá nền chỉ nhận giá trực tiếp.';
    if (adjustmentType === 'FIXED_PRICE') {
      const missing = actionableRows.find((row) => !validMoney(fixedPrices[row.variant.id] ?? ''));
      if (missing) return `Nhập giá hợp lệ cho SKU ${missing.variant.sku}.`;
    } else if (usesAmount) {
      if (!validMoney(sharedValue)) return 'Giá trị tiền phải là số nguyên không âm.';
    } else if (percentToBps(sharedValue) === null) {
      return 'Phần trăm chỉ nhận tối đa 2 chữ số thập phân.';
    }
    if (maxQuantity && Number(maxQuantity) <= Number(minQuantity || '0')) return 'Số lượng đến phải lớn hơn số lượng từ.';
    if (effectiveFrom && effectiveTo && new Date(effectiveTo) <= new Date(effectiveFrom)) return 'Hiệu lực đến phải sau hiệu lực từ.';
    return null;
  }

  async function applyBulk() {
    const validation = validate();
    if (validation) {
      setMessage(validation);
      return;
    }
    const list = selectedList as PriceList;
    setBusy(true);
    setMessage(null);
    try {
      const rateBps = usesAmount ? null : percentToBps(sharedValue);
      const result = await requestJson<ImportResult>('/api/pricing/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceBatchId: `web-bulk-${crypto.randomUUID()}`,
          items: actionableRows.map((row) => ({
            priceListCode: list.code,
            sku: row.variant.sku,
            adjustmentType,
            amountMinor: usesAmount ? (adjustmentType === 'FIXED_PRICE' ? fixedPrices[row.variant.id] : sharedValue) : null,
            rateBps,
            minQuantity: minQuantity || '0',
            maxQuantity: maxQuantity || null,
            effectiveFrom: apiDate(effectiveFrom),
            effectiveTo: apiDate(effectiveTo),
            sourceKind: 'ADMIN',
            sourceKey: row.sourceKey,
            externalRuleCode: 'WEB_BULK_ADMIN',
            note: note.trim() || null,
            isActive: true,
          })),
        }),
      });
      setMessage(`Đã hoàn tất: tạo ${result.itemsCreated}, cập nhật ${result.itemsUpdated}, tổng ${result.totalItems} SKU.`);
      setItems(await requestJson<PriceListItem[]>(`/api/price-lists/${list.id}/items?limit=2000`));
      setSelectedIds(new Set());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không áp dụng được giá cho các SKU đã chọn.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={styles.launchButton} onClick={() => setOpen(true)} data-testid="open-bulk-pricing">
        Thiết lập giá nhiều SKU
      </button>
      <Modal
        open={open}
        title="Thiết lập giá cho nhiều SKU"
        description="Chọn nhiều SKU, xem trước xung đột và ghi toàn bộ lô trong một giao dịch. Mỗi SKU vẫn là một dòng giá độc lập."
        onClose={close}
        testId="bulk-pricing-modal"
        size="large"
        footer={(
          <>
            <button type="button" className={styles.secondaryButton} onClick={close} disabled={busy}>Đóng</button>
            <button type="button" className={styles.primaryButton} onClick={() => void applyBulk()} disabled={busy || loading || !actionableRows.length} data-testid="apply-bulk-pricing">
              {busy ? 'Đang áp dụng…' : `Áp dụng ${actionableRows.length || ''} SKU`}
            </button>
          </>
        )}
      >
        {message ? <div className={styles.notice} role="status">{message}</div> : null}
        <div className={styles.scopeGrid}>
          <label>Bảng giá / chương trình<select value={selectedListId} onChange={(event) => setSelectedListId(event.target.value)}><option value="">Chọn bảng giá</option>{lists.map((list) => <option key={list.id} value={list.id}>{list.code} — {list.name}</option>)}</select></label>
          <label>Sản phẩm<select value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)}><option value="">Chọn sản phẩm</option>{products.filter((product) => product.is_active).map((product) => <option key={product.id} value={product.id}>{product.code} — {product.name}</option>)}</select></label>
          <label>Loại điều chỉnh<select value={adjustmentType} disabled={selectedList?.list_type === 'BASE'} onChange={(event) => setAdjustmentType(event.target.value as PriceAdjustmentType)}>{Object.entries(ADJUSTMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Cách xử lý trùng<select value={conflictPolicy} onChange={(event) => setConflictPolicy(event.target.value as ConflictPolicy)}><option value="SKIP_EXISTING">Bỏ qua SKU đã có quy tắc</option><option value="UPSERT_BULK">Cập nhật dòng do công cụ này tạo</option></select></label>
        </div>

        <div className={styles.selectionHeader}>
          <label className={styles.searchLabel}>Tìm trong SKU của sản phẩm<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Mã SKU hoặc tên SKU" /></label>
          <div><strong>{selectedIds.size} SKU đã chọn</strong><span>{visibleVariants.length} SKU phù hợp bộ lọc</span></div>
          <button type="button" className={styles.secondaryButton} onClick={() => toggleVisibleSelection(true)} disabled={!visibleVariants.length}>Chọn tất cả đang hiển thị</button>
          <button type="button" className={styles.secondaryButton} onClick={() => toggleVisibleSelection(false)} disabled={!selectedIds.size}>Bỏ chọn đang hiển thị</button>
        </div>

        <div className={styles.variantList} aria-label="Danh sách SKU thiết lập giá">
          {loading ? <p>Đang tải dữ liệu…</p> : null}
          {!loading && selectedProductId && !priceableVariants.length ? <p>Sản phẩm chưa có SKU bán hàng với đơn vị/quy đổi hợp lệ.</p> : null}
          {visibleVariants.map((variant) => (
            <label key={variant.id} className={styles.variantRow}>
              <input type="checkbox" checked={selectedIds.has(variant.id)} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); if (event.target.checked) next.add(variant.id); else next.delete(variant.id); return next; })} />
              <span><strong>{variant.sku}</strong><small>{variant.name}</small></span>
              <span>Quy đổi {variant.conversion_to_base}</span>
              {adjustmentType === 'FIXED_PRICE' ? <input aria-label={`Giá SKU ${variant.sku}`} inputMode="numeric" placeholder="Giá VND" value={fixedPrices[variant.id] ?? ''} onChange={(event) => setFixedPrices((current) => ({ ...current, [variant.id]: event.target.value.replace(/\D/g, '') }))} /> : null}
            </label>
          ))}
        </div>

        {adjustmentType !== 'FIXED_PRICE' ? <div className={styles.valuePanel}><label>{usesAmount ? 'Giá trị tiền (₫)' : 'Phần trăm (%)'}<input value={sharedValue} inputMode={usesAmount ? 'numeric' : 'decimal'} onChange={(event) => setSharedValue(usesAmount ? event.target.value.replace(/\D/g, '') : event.target.value)} /></label></div> : null}

        <details className={styles.advanced}>
          <summary>Điều kiện và thời gian áp dụng</summary>
          <div className={styles.scopeGrid}>
            <label>Số lượng từ<input value={minQuantity} inputMode="decimal" onChange={(event) => setMinQuantity(event.target.value)} /></label>
            <label>Số lượng đến<input value={maxQuantity} inputMode="decimal" placeholder="Không giới hạn" onChange={(event) => setMaxQuantity(event.target.value)} /></label>
            <label>Hiệu lực từ<input type="datetime-local" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></label>
            <label>Hiệu lực đến<input type="datetime-local" value={effectiveTo} onChange={(event) => setEffectiveTo(event.target.value)} /></label>
            <label className={styles.wide}>Ghi chú<input value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} /></label>
          </div>
        </details>

        <section className={styles.preview} aria-label="Xem trước thiết lập giá nhiều SKU">
          <div className={styles.previewHeader}><h3>Xem trước</h3><span>{actionableRows.length} áp dụng · {preview.filter((row) => row.status === 'SKIP').length} bỏ qua</span></div>
          {preview.length === 0 ? <p>Chọn SKU để xem trước.</p> : preview.map((row) => <div key={row.variant.id} className={styles.previewRow}><strong>{row.variant.sku}</strong><span className={row.status === 'SKIP' ? styles.skip : row.status === 'UPDATE' ? styles.update : styles.create}>{row.status === 'SKIP' ? 'Bỏ qua' : row.status === 'UPDATE' ? 'Cập nhật' : 'Tạo mới'}</span><span>{row.reason}</span></div>)}
        </section>
      </Modal>
    </>
  );
}
