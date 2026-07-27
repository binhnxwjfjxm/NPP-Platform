'use client';

import { useState } from 'react';
import type { Product, ProductVariant, UnitOfMeasure } from '../../lib/product-types';
import { UnitCatalogPanel, VariantUnitPanel } from './product-unit-admin';
import styles from './products.module.css';

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
}: {
  initialProducts: Product[];
  initialUnits: UnitOfMeasure[];
}) {
  const [units, setUnits] = useState(initialUnits);
  const [productId, setProductId] = useState('');
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [variantId, setVariantId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedVariant = variants.find((item) => item.id === variantId) ?? null;

  async function selectProduct(nextProductId: string) {
    setProductId(nextProductId);
    setVariantId('');
    setVariants([]);
    setMessage(null);
    if (!nextProductId) return;
    setBusy(true);
    try {
      const next = await requestJson<ProductVariant[]>(`/api/products/${nextProductId}/variants`);
      setVariants(next);
      if (next.length > 0) setVariantId(next[0].id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể tải SKU');
    } finally {
      setBusy(false);
    }
  }

  return <div className={styles.page} data-testid="product-unit-workspace">
    <div className={styles.header}>
      <div><span className={styles.eyebrow}>Phase 3.3D</span><h1>Đơn vị, quy đổi &amp; barcode</h1><p>Tồn kho luôn quy về SKU gốc; hệ số được cấu hình riêng cho từng SKU.</p></div>
    </div>

    <UnitCatalogPanel units={units} onUnitsChanged={setUnits} />

    <section className={styles.variantPanel}>
      <div className={styles.sectionHeader}><div><h2>Quy đổi theo SKU</h2><p>Chọn sản phẩm và SKU để gắn đơn vị, hệ số và barcode.</p></div></div>
      {message ? <div className={styles.notice}>{message}</div> : null}
      <div className={styles.formGrid}>
        <label>Sản phẩm<select value={productId} onChange={(event) => void selectProduct(event.target.value)} data-testid="unit-product-select"><option value="">Chọn sản phẩm</option>{initialProducts.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
        <label>SKU<select value={variantId} disabled={!productId || busy} onChange={(event) => setVariantId(event.target.value)} data-testid="unit-variant-select"><option value="">Chọn SKU</option>{variants.map((item) => <option key={item.id} value={item.id}>{item.sku} — {item.name}</option>)}</select></label>
      </div>
      {!productId ? <p className={styles.empty}>Chọn sản phẩm để quản lý quy đổi.</p> : null}
      {productId && variants.length === 0 && !busy ? <p className={styles.empty}>Sản phẩm chưa có SKU.</p> : null}
      {selectedVariant ? <VariantUnitPanel
        productId={productId}
        variant={selectedVariant}
        units={units}
        onVariantUpdated={(saved) => setVariants((current) => current.map((item) => item.id === saved.id ? saved : item))}
      /> : null}
    </section>
  </div>;
}
