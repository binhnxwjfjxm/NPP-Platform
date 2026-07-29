import { readFile, writeFile, rm } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const pathFromRoot = (path) => new URL(path, root);

async function read(path) {
  return readFile(pathFromRoot(path), 'utf8');
}

async function write(path, content) {
  await writeFile(pathFromRoot(path), content, 'utf8');
}

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`Missing fragment: ${label}`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`Fragment is not unique: ${label}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

const page = `import ProductWorkspace from './product-workspace';
import type { Product, ProductBrand, ProductCategory, UnitOfMeasure } from '../../lib/product-types';
import {
  listProductCategories,
  listProductBrands,
  listProducts,
  listUnits,
  normalizeProductGatewayError,
  resolveProductRequestId,
} from '../../lib/product-gateway';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  const requestId = resolveProductRequestId(null);
  let initialProducts: Product[] = [];
  let initialCategories: ProductCategory[] = [];
  let initialBrands: ProductBrand[] = [];
  let initialUnits: UnitOfMeasure[] = [];
  let initialError: string | null = null;

  try {
    [initialProducts, initialCategories, initialBrands, initialUnits] = await Promise.all([
      listProducts<Product>(requestId, new URLSearchParams({ limit: '1000' })),
      listProductCategories<ProductCategory>(requestId, new URLSearchParams({ limit: '1000' })),
      listProductBrands<ProductBrand>(requestId, new URLSearchParams({ limit: '1000' })),
      listUnits<UnitOfMeasure>(requestId, new URLSearchParams({ limit: '1000' })),
    ]);
  } catch (error) {
    initialError = normalizeProductGatewayError(error).publicMessage;
  }

  return (
    <ProductWorkspace
      initialProducts={initialProducts}
      initialCategories={initialCategories}
      initialBrands={initialBrands}
      initialUnits={initialUnits}
      initialError={initialError}
    />
  );
}
`;

const unitWorkspace = `'use client';

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
`;

await write('npp-core/web/app/products/page.tsx', page);
await write('npp-core/web/app/products/product-unit-workspace.tsx', unitWorkspace);

let productWorkspace = await read('npp-core/web/app/products/product-workspace.tsx');
productWorkspace = replaceOnce(
  productWorkspace,
  "import Modal from '../components/modal';\n",
  "import Modal from '../components/modal';\nimport ProductUnitWorkspace from './product-unit-workspace';\n",
  'product workspace unit import',
);
productWorkspace = replaceOnce(
  productWorkspace,
  "  ProductVariant,\n  VariantForm,\n",
  "  ProductVariant,\n  UnitOfMeasure,\n  VariantForm,\n",
  'unit type import',
);
productWorkspace = replaceOnce(
  productWorkspace,
  "  initialBrands: ProductBrand[];\n  initialError?: string | null;\n",
  "  initialBrands: ProductBrand[];\n  initialUnits: UnitOfMeasure[];\n  initialError?: string | null;\n",
  'initial units prop',
);
productWorkspace = replaceOnce(
  productWorkspace,
  "type Tab = 'products' | 'categories' | 'brands';",
  "type Tab = 'products' | 'categories' | 'brands' | 'units';",
  'units tab type',
);
productWorkspace = replaceOnce(
  productWorkspace,
  "  initialBrands,\n  initialError = null,\n",
  "  initialBrands,\n  initialUnits,\n  initialError = null,\n",
  'initial units parameter',
);
productWorkspace = replaceOnce(
  productWorkspace,
  "  const [notice, setNotice] = useState<string | null>(null);\n",
  "  const [notice, setNotice] = useState<string | null>(null);\n  const [unitSelection, setUnitSelection] = useState<{ productId: string; variantId: string; requestKey: number } | null>(null);\n",
  'unit selection state',
);
productWorkspace = replaceOnce(
  productWorkspace,
  "  function openVariantEdit(variant: ProductVariant) {\n    if (busy) return;\n    closeEditors();\n    setEditingVariant(variant);\n    setVariantForm(variantToForm(variant));\n    setError(null);\n    setNotice(null);\n    setShowVariantForm(true);\n  }\n\n  async function saveVariant()",
  "  function openVariantEdit(variant: ProductVariant) {\n    if (busy) return;\n    closeEditors();\n    setEditingVariant(variant);\n    setVariantForm(variantToForm(variant));\n    setError(null);\n    setNotice(null);\n    setShowVariantForm(true);\n  }\n\n  function openUnitSetup(product: Product, variant: ProductVariant) {\n    if (busy) return;\n    closeEditors();\n    setUnitSelection((current) => ({\n      productId: product.id,\n      variantId: variant.id,\n      requestKey: (current?.requestKey ?? 0) + 1,\n    }));\n    setTab('units');\n  }\n\n  async function saveVariant()",
  'direct SKU to unit setup action',
);
productWorkspace = replaceOnce(
  productWorkspace,
  "<AppShell title=\"Danh mục sản phẩm\" subtitle=\"Quản lý sản phẩm, loại sản phẩm, nhãn hàng, SKU và thông tin bán hàng\" kicker=\"Quản lý hàng hóa\">",
  "<AppShell title=\"Danh mục sản phẩm\" subtitle=\"Quản lý sản phẩm, loại sản phẩm, nhãn hàng, SKU, đơn vị tính và mã vạch\" kicker=\"Quản lý hàng hóa\">",
  'module subtitle',
);
productWorkspace = replaceOnce(
  productWorkspace,
  "            <button type=\"button\" className={tab === 'brands' ? styles.tabActive : styles.tab} onClick={() => selectTab('brands')} data-testid=\"brands-tab\">Nhãn hàng</button>\n",
  "            <button type=\"button\" className={tab === 'brands' ? styles.tabActive : styles.tab} onClick={() => selectTab('brands')} data-testid=\"brands-tab\">Nhãn hàng</button>\n            <button type=\"button\" className={tab === 'units' ? styles.tabActive : styles.tab} onClick={() => { setUnitSelection(null); selectTab('units'); }} data-testid=\"units-tab\">Đơn vị &amp; quy đổi</button>\n",
  'fourth primary tab',
);
productWorkspace = replaceOnce(
  productWorkspace,
  "          <button type=\"button\" className={styles.secondaryButton} onClick={() => void reloadAll()} disabled={busy}>Làm mới</button>\n",
  "          {tab !== 'units' ? <button type=\"button\" className={styles.secondaryButton} onClick={() => void reloadAll()} disabled={busy}>Làm mới</button> : null}\n",
  'contextual refresh action',
);
productWorkspace = replaceOnce(
  productWorkspace,
  "<td><button type=\"button\" onClick={() => openVariantEdit(variant)}>Sửa</button></td>",
  "<td className={styles.rowActions}><button type=\"button\" onClick={() => openVariantEdit(variant)}>Sửa</button><button type=\"button\" onClick={() => openUnitSetup(selectedProduct, variant)} data-testid={\`manage-units-${variant.sku}\`}>Đơn vị &amp; mã vạch</button></td>",
  'SKU unit action',
);
productWorkspace = replaceOnce(
  productWorkspace,
  "        <Modal open={showProductForm}",
  "        {tab === 'units' ? <ProductUnitWorkspace initialProducts={products} initialUnits={initialUnits} selection={unitSelection} /> : null}\n\n        <Modal open={showProductForm}",
  'unit workspace tab content',
);
await write('npp-core/web/app/products/product-workspace.tsx', productWorkspace);

let css = await read('npp-core/web/app/products/products.module.css');
css = replaceOnce(
  css,
  `.detachedUnitWorkspace {
  width: calc(100% - 280px);
  margin-left: 280px;
  padding: 0 28px 32px;
  transition: width 180ms ease, margin-left 180ms ease;
}

:global([data-collapsed='true']) + .detachedUnitWorkspace {
  width: calc(100% - 84px);
  margin-left: 84px;
}

`,
  `.unitWorkspace {
  display: grid;
  gap: 1rem;
}

.unitIntro {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.1rem 1.2rem;
  border: 1px solid #dbe4ef;
  border-radius: 1rem;
  background: linear-gradient(135deg, #f8fafc, #fff);
}

.unitIntro h2,
.unitIntro p {
  margin: 0;
}

.unitIntro h2 {
  margin-top: .25rem;
}

.unitIntro p {
  margin-top: .35rem;
  color: #64748b;
}

.subTabs {
  display: inline-flex;
  width: fit-content;
  padding: .3rem;
  border: 1px solid #dbe4ef;
  border-radius: .8rem;
  background: #f8fafc;
}

.subTab,
.subTabActive {
  border: 0;
  border-radius: .58rem;
  background: transparent;
  color: #475569;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  padding: .62rem .85rem;
}

.subTabActive {
  background: #fff;
  color: #172033;
  box-shadow: 0 4px 14px rgba(15, 23, 42, .09);
}

.unitPanel {
  display: grid;
  gap: 1rem;
  padding: 1.1rem;
  border: 1px solid #dbe4ef;
  border-radius: 1rem;
  background: #fff;
}

.unitSelectorBar {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  gap: .8rem;
  padding: 1rem;
  border: 1px solid #e2e8f0;
  border-radius: .85rem;
  background: #f8fafc;
}

.unitSelectorBar label {
  display: grid;
  gap: .35rem;
  color: #334155;
  font-size: .9rem;
  font-weight: 600;
}

.unitSelectorBar select {
  width: 100%;
  border: 1px solid #cbd5e1;
  border-radius: .62rem;
  background: #fff;
  color: #0f172a;
  font: inherit;
  padding: .68rem .72rem;
}

.skuWorkspaceGrid {
  display: grid;
  grid-template-columns: minmax(220px, .72fr) minmax(0, 2fr);
  align-items: start;
  gap: 1rem;
}

.skuSummaryCard {
  position: sticky;
  top: 1rem;
  padding: 1rem;
  border: 1px solid #dbe4ef;
  border-radius: .9rem;
  background: #f8fafc;
}

.skuSummaryCard h3,
.skuSummaryCard p {
  margin: 0;
}

.skuSummaryCard h3 {
  margin-top: .35rem;
  color: #172033;
  font-size: 1.25rem;
}

.skuSummaryCard p {
  margin-top: .25rem;
  color: #64748b;
}

.skuSummaryCard dl {
  display: grid;
  gap: .72rem;
  margin: 1rem 0 0;
}

.skuSummaryCard dl div {
  display: grid;
  gap: .18rem;
  padding-top: .72rem;
  border-top: 1px solid #e2e8f0;
}

.skuSummaryCard dt {
  color: #64748b;
  font-size: .78rem;
  font-weight: 700;
  text-transform: uppercase;
}

.skuSummaryCard dd {
  margin: 0;
  color: #172033;
  font-weight: 600;
}

`,
  'replace detached workspace with integrated layout styles',
);
css = replaceOnce(
  css,
  `@media (max-width: 1080px) {
  .detachedUnitWorkspace,
  :global([data-collapsed='true']) + .detachedUnitWorkspace {
    width: 100%;
    margin-left: 0;
    padding: 0 18px 26px;
  }
}

`,
  '',
  'remove detached workspace responsive compensation',
);
css = replaceOnce(
  css,
  `@media (max-width: 980px) {
  .filters,
  .formGrid {
    grid-template-columns: 1fr;
  }
`,
  `@media (max-width: 980px) {
  .filters,
  .formGrid,
  .unitSelectorBar,
  .skuWorkspaceGrid {
    grid-template-columns: 1fr;
  }

  .skuSummaryCard {
    position: static;
  }
`,
  'responsive integrated product layout',
);
css = replaceOnce(
  css,
  `  .detachedUnitWorkspace,
  :global([data-collapsed='true']) + .detachedUnitWorkspace {
    padding-inline: 12px;
  }

`,
  `  .subTabs {
    display: grid;
    width: 100%;
  }

`,
  'mobile subtab layout',
);
await write('npp-core/web/app/products/products.module.css', css);

await rm(pathFromRoot('scripts/apply-product-catalog-layout.mjs'));
await rm(pathFromRoot('.github/workflows/apply-product-catalog-layout.yml'));
