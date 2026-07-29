'use client';

import { useEffect, useState } from 'react';
import type { Product, ProductVariant, UnitOfMeasure } from '../../lib/product-types';
import { UnitCatalogPanel, VariantUnitPanel } from './product-unit-admin';
import styles from './products.module.css';

type UnitSelection = {
  productId: string;
  variantId: string;
  requestKey: number;
};

type WorkspaceTab = 'catalog' | 'sku';

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: { message?: string; code?: string } };
  if (!response.ok || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    throw new Error(payload.error?.message || payload.error?.code || 'Yêu cầu không thành công');
  }
  return payload.data as T;
}

export default function ProductUnitWorkspace({
  initialProducts,
  initialUnits,
  selection = null,
}: {
  initialProducts: Product[];
  initialUnits: UnitOfMeasure[];
  selection?: UnitSelection | null;
}) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(selection ? 'sku' : 'catalog');
  const [products, setProducts] = useState(initialProducts);
  const [units, setUnits] = useState(initialUnits);
  const [productId, setProductId] = useState('');
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [variantId, setVariantId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedProduct = products.find((item) => item.id === productId) ?? null;
  const selectedVariant = variants.find((item) => item.id === variantId) ?? null;

  async function loadVariants(nextProductId: string, preferredVariantId = '') {
    setProductId(nextProductId);
    setVariantId('');
    setVariants([]);
    setMessage(null);
    if (!nextProductId) return;

    setBusy(true);
    try {
      const next = await requestJson<ProductVariant[]>(`/api/products/${nextProductId}/variants`);
      setVariants(next);
      const preferred = next.find((item) => item.id === preferredVariantId);
      setVariantId(preferred?.id ?? next[0]?.id ?? '');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể tải SKU');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!selection) return;
    setActiveTab('sku');
    void loadVariants(selection.productId, selection.variantId);
  }, [selection?.requestKey]);

  async function refreshProducts() {
    setBusy(true);
    setMessage(null);
    try {
      const next = await requestJson<Product[]>('/api/products?limit=1000');
      setProducts(next);
      if (productId && !next.some((item) => item.id === productId)) {
        setProductId('');
        setVariantId('');
        setVariants([]);
      }
      setMessage('Đã làm mới danh sách sản phẩm');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể làm mới sản phẩm');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.unitWorkspace} data-testid="product-unit-workspace">
      <div className={styles.unitIntro}>
        <div>
          <span className={styles.eyebrow}>Thiết lập hàng hóa</span>
          <h2>Đơn vị tính, quy đổi &amp; mã vạch</h2>
          <p>Quản lý danh mục đơn vị dùng chung và thiết lập quy đổi, mã vạch theo từng SKU.</p>
        </div>
      </div>

      <div className={styles.subTabs} role="tablist" aria-label="Khu vực đơn vị và quy đổi">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'catalog'}
          className={activeTab === 'catalog' ? styles.subTabActive : styles.subTab}
          onClick={() => setActiveTab('catalog')}
          data-testid="unit-catalog-tab"
        >
          Danh mục đơn vị
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'sku'}
          className={activeTab === 'sku' ? styles.subTabActive : styles.subTab}
          onClick={() => setActiveTab('sku')}
          data-testid="sku-conversion-tab"
        >
          Thiết lập theo SKU
        </button>
      </div>

      {activeTab === 'catalog' ? (
        <div className={styles.unitPanel} data-testid="unit-catalog-view">
          <UnitCatalogPanel units={units} onUnitsChanged={setUnits} />
        </div>
      ) : null}

      {activeTab === 'sku' ? (
        <div className={styles.unitPanel} data-testid="sku-conversion-view">
          <div className={styles.sectionHeader}>
            <div>
              <h2>Thiết lập theo SKU</h2>
              <p>Chọn sản phẩm và SKU để quản lý đơn vị, hệ số quy đổi và mã vạch.</p>
            </div>
            <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void refreshProducts()} data-testid="refresh-unit-products-button">
              Làm mới sản phẩm
            </button>
          </div>

          {message ? <div className={styles.notice}>{message}</div> : null}

          <div className={styles.unitSelectorBar}>
            <label>
              Sản phẩm
              <select value={productId} disabled={busy} onChange={(event) => void loadVariants(event.target.value)} data-testid="unit-product-select">
                <option value="">Chọn sản phẩm</option>
                {products.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
              </select>
            </label>
            <label>
              SKU
              <select value={variantId} disabled={!productId || busy} onChange={(event) => setVariantId(event.target.value)} data-testid="unit-variant-select">
                <option value="">Chọn SKU</option>
                {variants.map((item) => <option key={item.id} value={item.id}>{item.sku} — {item.name}</option>)}
              </select>
            </label>
          </div>

          {!productId ? <p className={styles.empty}>Chọn sản phẩm để quản lý quy đổi.</p> : null}
          {productId && variants.length === 0 && !busy ? <p className={styles.empty}>Sản phẩm chưa có SKU.</p> : null}

          {selectedVariant ? (
            <div className={styles.skuWorkspaceGrid}>
              <aside className={styles.skuSummaryCard} data-testid="selected-sku-summary">
                <span className={styles.eyebrow}>SKU đang thiết lập</span>
                <h3>{selectedVariant.sku}</h3>
                <p>{selectedVariant.name}</p>
                <dl>
                  <div><dt>Sản phẩm</dt><dd>{selectedProduct ? `${selectedProduct.code} — ${selectedProduct.name}` : '—'}</dd></div>
                  <div><dt>Đơn vị tồn chuẩn</dt><dd>{selectedVariant.is_inventory_base ? 'Có' : 'Không'}</dd></div>
                  <div><dt>Được phép bán</dt><dd>{selectedVariant.is_sellable ? 'Có' : 'Không'}</dd></div>
                  <div><dt>Trạng thái</dt><dd>{selectedVariant.is_active ? 'Đang sử dụng' : 'Đã ngừng'}</dd></div>
                </dl>
              </aside>

              <VariantUnitPanel
                productId={productId}
                variant={selectedVariant}
                units={units}
                onVariantUpdated={(saved) => setVariants((current) => current.map((item) => item.id === saved.id ? saved : item))}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
