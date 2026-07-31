'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import type { Supplier } from '../../../lib/supplier-types';
import type {
  PurchaseOrderSkuSearchOption,
  SupplierPurchasePrice,
} from '../../../lib/purchase-order-types';
import {
  formatDecimalString,
  formatPurchaseOrderAmount,
} from '../../../lib/purchase-order-types';
import { formatDecimalForInput } from '../../../lib/purchase-order-line-entry';
import styles from './purchase-prices.module.css';

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean };
};

type Draft = {
  supplierId: string;
  variantId: string;
  unitId: string;
  unitPrice: string;
  currencyCode: string;
  minQuantity: string;
  effectiveFrom: string;
  effectiveTo: string;
  supplierSku: string;
  sourceReference: string;
  note: string;
  isActive: boolean;
};

type EditorState = {
  mode: 'create' | 'edit';
  price: SupplierPurchasePrice | null;
};

function localToday() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function emptyDraft(supplierId = ''): Draft {
  return {
    supplierId,
    variantId: '',
    unitId: '',
    unitPrice: '',
    currencyCode: 'VND',
    minQuantity: '0',
    effectiveFrom: localToday(),
    effectiveTo: '',
    supplierSku: '',
    sourceReference: '',
    note: '',
    isActive: true,
  };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message || 'Không thực hiện được yêu cầu bảng giá mua.');
  }
  return payload.data;
}

function selectedOptionFromPrice(price: SupplierPurchasePrice): PurchaseOrderSkuSearchOption {
  return {
    id: price.variantId,
    productId: '',
    productCode: price.productCode,
    productName: price.productName,
    sku: price.sku,
    variantName: price.variantName,
    barcode: null,
    unitId: price.unitId,
    unitCode: price.unitCode,
    unitName: price.unitName,
    conversionToBase: null,
    allowsFractional: null,
    eligibility: { selectable: true, code: 'ELIGIBLE', message: 'Có thể mua hàng.' },
  };
}

export default function PurchasePriceWorkspace() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [prices, setPrices] = useState<SupplierPurchasePrice[]>([]);
  const [supplierFilter, setSupplierFilter] = useState('');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [selectedSku, setSelectedSku] = useState<PurchaseOrderSkuSearchOption | null>(null);
  const [skuTerm, setSkuTerm] = useState('');
  const [skuResults, setSkuResults] = useState<PurchaseOrderSkuSearchOption[]>([]);
  const [loadingSku, setLoadingSku] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const createKey = useRef<string | null>(null);

  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => supplier.is_active).sort((left, right) => left.code.localeCompare(right.code)),
    [suppliers],
  );
  const visiblePrices = useMemo(
    () => prices.filter((price) => !supplierFilter || price.supplierId === supplierFilter),
    [prices, supplierFilter],
  );
  const counts = useMemo(() => ({
    total: prices.length,
    active: prices.filter((price) => price.isActive).length,
    suppliers: new Set(prices.map((price) => price.supplierId)).size,
  }), [prices]);

  async function loadAll(message?: string) {
    setLoading(true);
    setError(null);
    try {
      const [nextSuppliers, nextPrices] = await Promise.all([
        requestJson<Supplier[]>('/api/suppliers?active=true&limit=1000'),
        requestJson<SupplierPurchasePrice[]>('/api/supplier-purchase-prices?limit=1000'),
      ]);
      setSuppliers(nextSuppliers);
      setPrices(nextPrices);
      if (message) setNotice(message);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Không tải được bảng giá mua.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    const term = skuTerm.trim();
    if (!editor || term.length < 2 || selectedSku?.sku === term) {
      setSkuResults([]);
      return undefined;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoadingSku(true);
      try {
        const query = new URLSearchParams({ search: term, limit: '30', offset: '0' });
        const results = await requestJson<PurchaseOrderSkuSearchOption[]>(`/api/purchase-orders/sku-search?${query.toString()}`, { signal: controller.signal });
        if (!controller.signal.aborted) {
          setSkuResults(results.filter((option) => option.eligibility.selectable && option.unitId));
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Không tìm được SKU.');
      } finally {
        if (!controller.signal.aborted) setLoadingSku(false);
      }
    }, 280);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [editor, selectedSku, skuTerm]);

  function openCreate() {
    const supplierId = supplierFilter || activeSuppliers[0]?.id || '';
    setEditor({ mode: 'create', price: null });
    setDraft(emptyDraft(supplierId));
    setSelectedSku(null);
    setSkuTerm('');
    setSkuResults([]);
    setError(null);
    setNotice(null);
    createKey.current = `purchase-price-${crypto.randomUUID()}`;
  }

  function openEdit(price: SupplierPurchasePrice) {
    setEditor({ mode: 'edit', price });
    setDraft({
      supplierId: price.supplierId,
      variantId: price.variantId,
      unitId: price.unitId,
      unitPrice: formatDecimalForInput(price.unitPrice),
      currencyCode: price.currencyCode,
      minQuantity: formatDecimalForInput(price.minQuantity),
      effectiveFrom: price.effectiveFrom,
      effectiveTo: price.effectiveTo ?? '',
      supplierSku: price.supplierSku ?? '',
      sourceReference: price.sourceReference ?? '',
      note: price.note ?? '',
      isActive: price.isActive,
    });
    const option = selectedOptionFromPrice(price);
    setSelectedSku(option);
    setSkuTerm(option.sku);
    setSkuResults([]);
    setError(null);
    setNotice(null);
  }

  function closeEditor() {
    if (busy) return;
    setEditor(null);
    setSelectedSku(null);
    setSkuTerm('');
    setSkuResults([]);
  }

  function selectSku(option: PurchaseOrderSkuSearchOption) {
    setSelectedSku(option);
    setSkuTerm(option.sku);
    setSkuResults([]);
    setDraft((current) => ({
      ...current,
      variantId: option.id,
      unitId: option.unitId ?? '',
    }));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.supplierId) return setError('Vui lòng chọn nhà cung cấp.');
    if (!draft.variantId || !draft.unitId) return setError('Vui lòng chọn một SKU mua hàng hợp lệ.');
    if (!draft.unitPrice.trim() || Number(draft.unitPrice.replace(',', '.')) <= 0) return setError('Giá mua phải lớn hơn 0.');
    if (!draft.effectiveFrom) return setError('Vui lòng chọn ngày bắt đầu hiệu lực.');
    if (draft.effectiveTo && draft.effectiveTo < draft.effectiveFrom) return setError('Ngày kết thúc không được trước ngày bắt đầu.');

    setBusy(true);
    setError(null);
    setNotice(null);
    const body = {
      supplierId: draft.supplierId,
      variantId: draft.variantId,
      unitId: draft.unitId,
      unitPrice: draft.unitPrice.trim().replace(',', '.'),
      currencyCode: draft.currencyCode.trim().toUpperCase(),
      minQuantity: (draft.minQuantity.trim() || '0').replace(',', '.'),
      effectiveFrom: draft.effectiveFrom,
      effectiveTo: draft.effectiveTo || null,
      supplierSku: draft.supplierSku.trim() || null,
      sourceReference: draft.sourceReference.trim() || null,
      note: draft.note.trim() || null,
      isActive: draft.isActive,
      ...(editor?.mode === 'edit' && editor.price ? { expectedRevision: editor.price.revision } : {}),
    };
    try {
      if (editor?.mode === 'edit' && editor.price) {
        await requestJson<SupplierPurchasePrice>(`/api/supplier-purchase-prices/${editor.price.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      } else {
        createKey.current ??= `purchase-price-${crypto.randomUUID()}`;
        await requestJson<SupplierPurchasePrice>('/api/supplier-purchase-prices', {
          method: 'POST',
          headers: { 'Idempotency-Key': createKey.current },
          body: JSON.stringify(body),
        });
      }
      closeEditor();
      await loadAll(editor?.mode === 'edit' ? 'Giá mua đã được cập nhật.' : 'Giá mua đã được thiết lập.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Không lưu được giá mua.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title="Bảng giá mua"
      subtitle="Thiết lập giá mua theo nhà cung cấp, SKU, đơn vị, số lượng và thời gian hiệu lực. Giá bán được quản lý riêng."
      kicker="Mua hàng"
      actions={(
        <button type="button" className={styles.primary} onClick={openCreate} disabled={loading || busy} data-testid="purchase-price-create">
          Thêm giá mua
        </button>
      )}
    >
      <main className={styles.page} data-testid="supplier-purchase-prices-page">
        {error ? <div className={`${styles.banner} ${styles.error}`} role="alert">{error}</div> : null}
        {notice ? <div className={`${styles.banner} ${styles.success}`} role="status">{notice}</div> : null}

        <section className={styles.summary} aria-label="Tổng quan bảng giá mua">
          <article><span>Tổng dòng giá</span><strong>{formatDecimalString(String(counts.total))}</strong></article>
          <article><span>Đang hiệu lực quản trị</span><strong>{formatDecimalString(String(counts.active))}</strong></article>
          <article><span>Nhà cung cấp có giá</span><strong>{formatDecimalString(String(counts.suppliers))}</strong></article>
        </section>

        <section className={styles.toolbar}>
          <label>
            Lọc theo nhà cung cấp
            <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)}>
              <option value="">Tất cả nhà cung cấp</option>
              {activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} — {supplier.name}</option>)}
            </select>
          </label>
          <button type="button" className={styles.secondary} onClick={() => void loadAll('Bảng giá mua đã được cập nhật.')} disabled={loading || busy}>
            {loading ? 'Đang tải…' : 'Cập nhật dữ liệu'}
          </button>
        </section>

        {editor ? (
          <section className={styles.editor} aria-labelledby="purchase-price-editor-title">
            <div className={styles.editorHeader}>
              <div>
                <p className={styles.meta}>{editor.mode === 'create' ? 'Thiết lập mới' : 'Chỉnh sửa giá mua'}</p>
                <h2 id="purchase-price-editor-title">{editor.mode === 'create' ? 'Giá mua theo nhà cung cấp' : `${editor.price?.sku} — ${editor.price?.supplierCode}`}</h2>
              </div>
              <button type="button" className={styles.secondary} onClick={closeEditor} disabled={busy}>Đóng</button>
            </div>

            <form className={styles.editorBody} onSubmit={save}>
              <aside className={styles.searchPanel}>
                <label>
                  Nhà cung cấp
                  <select value={draft.supplierId} onChange={(event) => setDraft((current) => ({ ...current, supplierId: event.target.value }))} disabled={busy}>
                    <option value="">Chọn nhà cung cấp</option>
                    {activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} — {supplier.name}</option>)}
                  </select>
                </label>
                <label>
                  Tìm SKU mua hàng
                  <input value={skuTerm} onChange={(event) => { setSkuTerm(event.target.value); setSelectedSku(null); setDraft((current) => ({ ...current, variantId: '', unitId: '' })); }} placeholder="Nhập SKU, mã hàng hoặc tên sản phẩm…" disabled={busy} />
                </label>
                <span className={styles.help}>{loadingSku ? 'Đang tìm…' : 'Chọn đúng SKU và đơn vị đang được bật cho mua hàng.'}</span>
                <div className={styles.searchResults}>
                  {skuResults.map((option) => (
                    <button key={option.id} type="button" className={`${styles.searchResult} ${selectedSku?.id === option.id ? styles.searchResultActive : ''}`} onClick={() => selectSku(option)}>
                      <strong>{option.sku} — {option.variantName}</strong>
                      <span>{option.productCode} · {option.productName}</span>
                      <span>Đơn vị: {option.unitCode} · Quy đổi: {option.conversionToBase}</span>
                    </button>
                  ))}
                </div>
              </aside>

              <div className={styles.formGrid}>
                <div className={styles.selectedSku}>
                  {selectedSku ? (
                    <div className={styles.priceIdentity}>
                      <div><strong>{selectedSku.sku} — {selectedSku.variantName}</strong><span>{selectedSku.productCode} · {selectedSku.productName}</span></div>
                      <span>{selectedSku.unitCode}</span>
                    </div>
                  ) : <span className={styles.help}>Chưa chọn SKU.</span>}
                </div>
                <label>Giá mua<input value={draft.unitPrice} inputMode="decimal" onChange={(event) => setDraft((current) => ({ ...current, unitPrice: event.target.value }))} placeholder="Ví dụ: 75000" disabled={busy} /></label>
                <label>Tiền tệ<input value={draft.currencyCode} maxLength={3} onChange={(event) => setDraft((current) => ({ ...current, currencyCode: event.target.value.toUpperCase() }))} disabled={busy} /></label>
                <label>Số lượng tối thiểu<input value={draft.minQuantity} inputMode="decimal" onChange={(event) => setDraft((current) => ({ ...current, minQuantity: event.target.value }))} disabled={busy} /></label>
                <label>Mã SKU của NCC<input value={draft.supplierSku} maxLength={128} onChange={(event) => setDraft((current) => ({ ...current, supplierSku: event.target.value }))} disabled={busy} /></label>
                <label>Hiệu lực từ<input type="date" value={draft.effectiveFrom} onChange={(event) => setDraft((current) => ({ ...current, effectiveFrom: event.target.value }))} disabled={busy} /></label>
                <label>Hiệu lực đến<input type="date" value={draft.effectiveTo} onChange={(event) => setDraft((current) => ({ ...current, effectiveTo: event.target.value }))} disabled={busy} /></label>
                <label className={styles.formWide}>Tham chiếu thỏa thuận<input value={draft.sourceReference} maxLength={256} onChange={(event) => setDraft((current) => ({ ...current, sourceReference: event.target.value }))} placeholder="Hợp đồng, báo giá hoặc thỏa thuận…" disabled={busy} /></label>
                <label className={styles.formWide}>Ghi chú<textarea value={draft.note} maxLength={2000} rows={3} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} disabled={busy} /></label>
                <label><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))} disabled={busy} /> Đang sử dụng</label>
                <div className={styles.actions}>
                  <button type="button" className={styles.secondary} onClick={closeEditor} disabled={busy}>Hủy thao tác</button>
                  <button type="submit" className={styles.primary} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu giá mua'}</button>
                </div>
              </div>
            </form>
          </section>
        ) : null}

        <section className={styles.listSection}>
          <div className={styles.listHeader}>
            <div><p className={styles.meta}>Danh mục mua hàng</p><h2>Giá theo nhà cung cấp và SKU</h2></div>
            <span className={styles.meta}>{visiblePrices.length} dòng</span>
          </div>
          {visiblePrices.length === 0 ? <div className={styles.empty}>{loading ? 'Đang tải bảng giá mua…' : 'Chưa có giá mua phù hợp bộ lọc.'}</div> : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Nhà cung cấp</th><th>SKU</th><th>Đơn vị</th><th>Giá mua</th><th>Từ SL</th><th>Hiệu lực</th><th>Mã NCC</th><th>Trạng thái</th><th></th></tr></thead>
                <tbody>
                  {visiblePrices.map((price) => (
                    <tr key={price.id}>
                      <td><div className={styles.priceIdentity}><div><strong>{price.supplierCode}</strong><span>{price.supplierName}</span></div></div></td>
                      <td><div className={styles.priceIdentity}><div><strong>{price.sku}</strong><span>{price.productCode} · {price.productName}</span></div></div></td>
                      <td>{price.unitCode}</td>
                      <td><strong>{formatPurchaseOrderAmount(price.unitPrice, price.currencyCode)}</strong></td>
                      <td>{formatDecimalString(price.minQuantity)}</td>
                      <td>{price.effectiveFrom}{price.effectiveTo ? ` → ${price.effectiveTo}` : ' → không giới hạn'}</td>
                      <td>{price.supplierSku || '—'}</td>
                      <td><span className={price.isActive ? styles.statusActive : styles.statusInactive}>{price.isActive ? 'Đang dùng' : 'Ngừng dùng'}</span></td>
                      <td><button type="button" className={styles.secondary} onClick={() => openEdit(price)} disabled={busy}>Chỉnh sửa</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </AppShell>
  );
}
