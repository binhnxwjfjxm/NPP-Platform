'use client';

import { useMemo, useState } from 'react';
import { AppShell } from '../components/app-shell';
import Modal from '../components/modal';
import type {
  BrandForm,
  CategoryForm,
  Product,
  ProductBrand,
  ProductCategory,
  ProductForm,
  ProductVariant,
  VariantForm,
} from '../../lib/product-types';
import styles from './products.module.css';

type Props = {
  initialProducts: Product[];
  initialCategories: ProductCategory[];
  initialBrands: ProductBrand[];
  initialError?: string | null;
};

type Tab = 'products' | 'categories' | 'brands';
type StatusFilter = 'all' | 'active' | 'inactive';

const EMPTY_PRODUCT: ProductForm = {
  code: '', name: '', catalogName: '', categoryId: '', brandId: '', description: '', notes: '',
  isCatalogVisible: false, isOrderable: false, isActive: true,
};
const EMPTY_CATEGORY: CategoryForm = {
  code: '', name: '', parentCategoryId: '', description: '', sortOrder: '0',
  isCatalogVisible: true, isActive: true,
};
const EMPTY_BRAND: BrandForm = {
  code: '', name: '', description: '', isCatalogVisible: true, isActive: true,
};
const EMPTY_VARIANT: VariantForm = {
  sku: '', name: '', variantKind: 'BASE', isInventoryBase: false,
  isSellable: true, isCatalogVisible: false, isActive: true,
};

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  let payload: { data?: T; error?: { message?: string; code?: string } } = {};
  try {
    payload = await response.json();
  } catch {
    throw new Error('Phản hồi máy chủ không hợp lệ');
  }
  if (!response.ok || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    throw new Error(payload.error?.message || payload.error?.code || 'Yêu cầu không thành công');
  }
  return payload.data as T;
}

function productToForm(product: Product): ProductForm {
  return {
    code: product.code,
    name: product.name,
    catalogName: product.catalog_name ?? '',
    categoryId: product.category_id ?? '',
    brandId: product.brand_id ?? '',
    description: product.description ?? '',
    notes: product.notes ?? '',
    isCatalogVisible: product.is_catalog_visible,
    isOrderable: product.is_orderable,
    isActive: product.is_active,
  };
}

function categoryToForm(category: ProductCategory): CategoryForm {
  return {
    code: category.code,
    name: category.name,
    parentCategoryId: category.parent_category_id ?? '',
    description: category.description ?? '',
    sortOrder: String(category.sort_order),
    isCatalogVisible: category.is_catalog_visible,
    isActive: category.is_active,
  };
}

function brandToForm(brand: ProductBrand): BrandForm {
  return {
    code: brand.code,
    name: brand.name,
    description: brand.description ?? '',
    isCatalogVisible: brand.is_catalog_visible,
    isActive: brand.is_active,
  };
}

function variantToForm(variant: ProductVariant): VariantForm {
  return {
    sku: variant.sku,
    name: variant.name,
    variantKind: variant.variant_kind,
    isInventoryBase: variant.is_inventory_base,
    isSellable: variant.is_sellable,
    isCatalogVisible: variant.is_catalog_visible,
    isActive: variant.is_active,
  };
}

export default function ProductWorkspace({
  initialProducts,
  initialCategories,
  initialBrands,
  initialError = null,
}: Props) {
  const [tab, setTab] = useState<Tab>('products');
  const [products, setProducts] = useState(initialProducts);
  const [categories, setCategories] = useState(initialCategories);
  const [brands, setBrands] = useState(initialBrands);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [catalogFilter, setCatalogFilter] = useState<'all' | 'visible' | 'hidden'>('all');
  const [orderableFilter, setOrderableFilter] = useState<'all' | 'yes' | 'no'>('all');
  const [productForm, setProductForm] = useState<ProductForm>(EMPTY_PRODUCT);
  const [categoryForm, setCategoryForm] = useState<CategoryForm>(EMPTY_CATEGORY);
  const [brandForm, setBrandForm] = useState<BrandForm>(EMPTY_BRAND);
  const [variantForm, setVariantForm] = useState<VariantForm>(EMPTY_VARIANT);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingCategory, setEditingCategory] = useState<ProductCategory | null>(null);
  const [editingBrand, setEditingBrand] = useState<ProductBrand | null>(null);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(null);
  const [showProductForm, setShowProductForm] = useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [showBrandForm, setShowBrandForm] = useState(false);
  const [showVariantForm, setShowVariantForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);

  const normalizedSearch = normalizeSearch(search);
  const visibleProducts = useMemo(() => products.filter((product) => {
    if (statusFilter === 'active' && !product.is_active) return false;
    if (statusFilter === 'inactive' && product.is_active) return false;
    if (catalogFilter === 'visible' && !product.is_catalog_visible) return false;
    if (catalogFilter === 'hidden' && product.is_catalog_visible) return false;
    if (orderableFilter === 'yes' && !product.is_orderable) return false;
    if (orderableFilter === 'no' && product.is_orderable) return false;
    if (!normalizedSearch) return true;
    return [product.code, product.name, product.catalog_name, product.category_name, product.brand_name]
      .some((value) => value?.toLowerCase().includes(normalizedSearch));
  }), [products, normalizedSearch, statusFilter, catalogFilter, orderableFilter]);

  const activeSellableVariantExists = variants.some((variant) => variant.is_active && variant.is_sellable);
  const editorOpen = showProductForm || showCategoryForm || showBrandForm || showVariantForm;

  function closeEditors() {
    if (busy) return;
    setShowProductForm(false);
    setShowCategoryForm(false);
    setShowBrandForm(false);
    setShowVariantForm(false);
    setError(null);
  }

  function selectTab(nextTab: Tab) {
    if (busy) return;
    closeEditors();
    setTab(nextTab);
  }

  function startWork() {
    setBusy(true);
    setError(null);
    setNotice(null);
  }

  function fail(errorValue: unknown) {
    setError(errorValue instanceof Error ? errorValue.message : 'Không thể hoàn tất thao tác');
  }

  async function reloadAll() {
    startWork();
    try {
      const [nextProducts, nextCategories, nextBrands] = await Promise.all([
        requestJson<Product[]>('/api/products?limit=1000'),
        requestJson<ProductCategory[]>('/api/product-categories?limit=1000'),
        requestJson<ProductBrand[]>('/api/product-brands?limit=1000'),
      ]);
      setProducts(nextProducts);
      setCategories(nextCategories);
      setBrands(nextBrands);
      setNotice('Đã làm mới danh mục');
    } catch (errorValue) {
      fail(errorValue);
    } finally {
      setBusy(false);
    }
  }

  async function loadVariants(product: Product) {
    startWork();
    try {
      const next = await requestJson<ProductVariant[]>(`/api/products/${product.id}/variants`);
      setSelectedProduct(product);
      setVariants(next);
      setEditingVariant(null);
      setVariantForm(EMPTY_VARIANT);
      setShowVariantForm(false);
    } catch (errorValue) {
      fail(errorValue);
    } finally {
      setBusy(false);
    }
  }

  function openProductCreate() {
    closeEditors();
    setEditingProduct(null);
    setProductForm(EMPTY_PRODUCT);
    setError(null);
    setNotice(null);
    setShowProductForm(true);
  }

  async function openProductEdit(product: Product) {
    closeEditors();
    await loadVariants(product);
    setEditingProduct(product);
    setProductForm(productToForm(product));
    setError(null);
    setNotice(null);
    setShowProductForm(true);
  }

  async function saveProduct() {
    startWork();
    try {
      const body = {
        ...productForm,
        categoryId: productForm.categoryId || null,
        brandId: productForm.brandId || null,
        ...(editingProduct ? { expectedUpdatedAt: editingProduct.updated_at } : { isOrderable: false }),
      };
      const saved = editingProduct
        ? await requestJson<Product>(`/api/products/${editingProduct.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          })
        : await requestJson<Product>('/api/products', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          });
      setProducts((current) => editingProduct
        ? current.map((item) => item.id === saved.id ? saved : item)
        : [...current, saved].sort((left, right) => left.code.localeCompare(right.code)));
      setEditingProduct(saved);
      setSelectedProduct(saved);
      setProductForm(productToForm(saved));
      setShowProductForm(false);
      setNotice(editingProduct ? 'Đã cập nhật sản phẩm' : 'Đã tạo sản phẩm; hãy bổ sung SKU trước khi bật đặt hàng');
    } catch (errorValue) {
      fail(errorValue);
    } finally {
      setBusy(false);
    }
  }

  async function patchProductStatus(product: Product, isActive: boolean) {
    startWork();
    try {
      const saved = await requestJson<Product>(`/api/products/${product.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive, expectedUpdatedAt: product.updated_at }),
      });
      setProducts((current) => current.map((item) => item.id === saved.id ? saved : item));
      setNotice(isActive ? 'Đã kích hoạt sản phẩm' : 'Đã vô hiệu sản phẩm');
    } catch (errorValue) {
      fail(errorValue);
    } finally {
      setBusy(false);
    }
  }

  function openCategoryCreate() {
    closeEditors();
    setEditingCategory(null);
    setCategoryForm(EMPTY_CATEGORY);
    setError(null);
    setNotice(null);
    setShowCategoryForm(true);
  }

  function openCategoryEdit(category: ProductCategory) {
    closeEditors();
    setEditingCategory(category);
    setCategoryForm(categoryToForm(category));
    setError(null);
    setNotice(null);
    setShowCategoryForm(true);
  }

  async function saveCategory() {
    startWork();
    try {
      const body = {
        ...categoryForm,
        parentCategoryId: categoryForm.parentCategoryId || null,
        sortOrder: Number(categoryForm.sortOrder || 0),
        ...(editingCategory ? { expectedUpdatedAt: editingCategory.updated_at } : {}),
      };
      const saved = editingCategory
        ? await requestJson<ProductCategory>(`/api/product-categories/${editingCategory.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          })
        : await requestJson<ProductCategory>('/api/product-categories', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          });
      setCategories((current) => editingCategory
        ? current.map((item) => item.id === saved.id ? saved : item)
        : [...current, saved].sort((left, right) => left.sort_order - right.sort_order || left.code.localeCompare(right.code)));
      setShowCategoryForm(false);
      setNotice(editingCategory ? 'Đã cập nhật loại sản phẩm' : 'Đã tạo loại sản phẩm');
    } catch (errorValue) {
      fail(errorValue);
    } finally {
      setBusy(false);
    }
  }

  async function patchCategoryStatus(category: ProductCategory, isActive: boolean) {
    startWork();
    try {
      const saved = await requestJson<ProductCategory>(`/api/product-categories/${category.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive, expectedUpdatedAt: category.updated_at }),
      });
      setCategories((current) => current.map((item) => item.id === saved.id ? saved : item));
      setNotice(isActive ? 'Đã kích hoạt loại sản phẩm' : 'Đã vô hiệu loại sản phẩm');
    } catch (errorValue) {
      fail(errorValue);
    } finally {
      setBusy(false);
    }
  }

  function openBrandCreate() {
    closeEditors();
    setEditingBrand(null);
    setBrandForm(EMPTY_BRAND);
    setError(null);
    setNotice(null);
    setShowBrandForm(true);
  }

  function openBrandEdit(brand: ProductBrand) {
    closeEditors();
    setEditingBrand(brand);
    setBrandForm(brandToForm(brand));
    setError(null);
    setNotice(null);
    setShowBrandForm(true);
  }

  async function saveBrand() {
    startWork();
    try {
      const body = { ...brandForm, ...(editingBrand ? { expectedUpdatedAt: editingBrand.updated_at } : {}) };
      const saved = editingBrand
        ? await requestJson<ProductBrand>(`/api/product-brands/${editingBrand.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          })
        : await requestJson<ProductBrand>('/api/product-brands', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          });
      setBrands((current) => editingBrand
        ? current.map((item) => item.id === saved.id ? saved : item)
        : [...current, saved].sort((left, right) => left.code.localeCompare(right.code)));
      setShowBrandForm(false);
      setNotice(editingBrand ? 'Đã cập nhật nhãn hàng' : 'Đã tạo nhãn hàng');
    } catch (errorValue) {
      fail(errorValue);
    } finally {
      setBusy(false);
    }
  }

  async function patchBrandStatus(brand: ProductBrand, isActive: boolean) {
    startWork();
    try {
      const saved = await requestJson<ProductBrand>(`/api/product-brands/${brand.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive, expectedUpdatedAt: brand.updated_at }),
      });
      setBrands((current) => current.map((item) => item.id === saved.id ? saved : item));
      setNotice(isActive ? 'Đã kích hoạt nhãn hàng' : 'Đã vô hiệu nhãn hàng');
    } catch (errorValue) {
      fail(errorValue);
    } finally {
      setBusy(false);
    }
  }

  function openVariantCreate() {
    closeEditors();
    setEditingVariant(null);
    setVariantForm(EMPTY_VARIANT);
    setError(null);
    setNotice(null);
    setShowVariantForm(true);
  }

  function openVariantEdit(variant: ProductVariant) {
    closeEditors();
    setEditingVariant(variant);
    setVariantForm(variantToForm(variant));
    setError(null);
    setNotice(null);
    setShowVariantForm(true);
  }

  async function saveVariant() {
    if (!selectedProduct) return;
    startWork();
    try {
      const body = { ...variantForm, ...(editingVariant ? { expectedUpdatedAt: editingVariant.updated_at } : {}) };
      const saved = editingVariant
        ? await requestJson<ProductVariant>(`/api/products/${selectedProduct.id}/variants/${editingVariant.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          })
        : await requestJson<ProductVariant>(`/api/products/${selectedProduct.id}/variants`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          });
      setVariants((current) => editingVariant
        ? current.map((item) => item.id === saved.id ? saved : item)
        : [...current, saved].sort((left, right) => left.sku.localeCompare(right.sku)));
      setShowVariantForm(false);
      setNotice(editingVariant ? 'Đã cập nhật SKU' : 'Đã tạo SKU');
    } catch (errorValue) {
      fail(errorValue);
    } finally {
      setBusy(false);
    }
  }

  const productFooter = (
    <>
      <button type="button" className={styles.secondaryButton} onClick={closeEditors} disabled={busy}>Hủy</button>
      <button type="button" className={styles.primaryButton} onClick={() => void saveProduct()} disabled={busy || !productForm.code.trim() || !productForm.name.trim()} data-testid="save-product-button">Lưu sản phẩm</button>
    </>
  );
  const categoryFooter = (
    <>
      <button type="button" className={styles.secondaryButton} onClick={closeEditors} disabled={busy}>Hủy</button>
      <button type="button" className={styles.primaryButton} onClick={() => void saveCategory()} disabled={busy || !categoryForm.code.trim() || !categoryForm.name.trim()} data-testid="save-category-button">Lưu loại</button>
    </>
  );
  const brandFooter = (
    <>
      <button type="button" className={styles.secondaryButton} onClick={closeEditors} disabled={busy}>Hủy</button>
      <button type="button" className={styles.primaryButton} onClick={() => void saveBrand()} disabled={busy || !brandForm.code.trim() || !brandForm.name.trim()} data-testid="save-brand-button">Lưu nhãn hàng</button>
    </>
  );
  const variantFooter = (
    <>
      <button type="button" className={styles.secondaryButton} onClick={closeEditors} disabled={busy}>Hủy</button>
      <button type="button" className={styles.primaryButton} onClick={() => void saveVariant()} disabled={busy || !variantForm.sku.trim() || !variantForm.name.trim()} data-testid="save-variant-button">Lưu SKU</button>
    </>
  );

  return (
    <AppShell title="Danh mục sản phẩm" subtitle="Sản phẩm, loại, nhãn hàng và SKU" kicker="NPP Product Catalog">
      <main className={styles.workspace} data-testid="products-page">
        <div className={styles.toolbar}>
          <div className={styles.tabs} role="tablist" aria-label="Khu vực danh mục sản phẩm">
            <button type="button" className={tab === 'products' ? styles.tabActive : styles.tab} onClick={() => selectTab('products')} data-testid="products-tab">Sản phẩm</button>
            <button type="button" className={tab === 'categories' ? styles.tabActive : styles.tab} onClick={() => selectTab('categories')} data-testid="categories-tab">Loại sản phẩm</button>
            <button type="button" className={tab === 'brands' ? styles.tabActive : styles.tab} onClick={() => selectTab('brands')} data-testid="brands-tab">Nhãn hàng</button>
          </div>
          <button type="button" className={styles.secondaryButton} onClick={() => void reloadAll()} disabled={busy}>Làm mới</button>
        </div>

        {error && !editorOpen ? <div className={styles.errorBanner} role="alert">{error}</div> : null}
        {notice ? <div className={styles.noticeBanner}>{notice}</div> : null}

        {tab === 'products' ? (
          <section>
            <div className={styles.sectionHeader}>
              <div><h2>Sản phẩm</h2><p>{products.length} sản phẩm · {products.filter((item) => item.is_orderable).length} có thể đặt hàng</p></div>
              <button type="button" className={styles.primaryButton} onClick={openProductCreate} data-testid="add-product-button">Thêm sản phẩm</button>
            </div>

            <div className={styles.filters}>
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm mã, tên, loại, nhãn hàng" data-testid="products-search-input" />
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} data-testid="products-status-filter"><option value="all">Tất cả trạng thái</option><option value="active">Hoạt động</option><option value="inactive">Ngừng</option></select>
              <select value={catalogFilter} onChange={(event) => setCatalogFilter(event.target.value as 'all' | 'visible' | 'hidden')}><option value="all">Tất cả hiển thị</option><option value="visible">Hiện catalog</option><option value="hidden">Ẩn catalog</option></select>
              <select value={orderableFilter} onChange={(event) => setOrderableFilter(event.target.value as 'all' | 'yes' | 'no')}><option value="all">Tất cả đặt hàng</option><option value="yes">Có thể đặt</option><option value="no">Chưa thể đặt</option></select>
            </div>

            <div className={styles.tableWrapper}><table className={styles.table}><thead><tr><th>Mã</th><th>Tên</th><th>Loại</th><th>Nhãn hàng</th><th>Catalog</th><th>Đặt hàng</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>
              {visibleProducts.map((product) => <tr key={product.id} data-testid={`product-row-${product.code}`}>
                <td><strong>{product.code}</strong></td><td>{product.name}</td><td>{product.category_name || '—'}</td><td>{product.brand_name || '—'}</td>
                <td>{product.is_catalog_visible ? 'Có' : 'Không'}</td><td>{product.is_orderable ? 'Có' : 'Không'}</td><td>{product.is_active ? 'Hoạt động' : 'Ngừng'}</td>
                <td className={styles.rowActions}><button type="button" onClick={() => void openProductEdit(product)} data-testid={`edit-product-${product.code}`}>Sửa</button><button type="button" onClick={() => void loadVariants(product)} data-testid={`manage-variants-${product.code}`}>SKU</button><button type="button" disabled={busy} onClick={() => void patchProductStatus(product, !product.is_active)}>{product.is_active ? 'Vô hiệu' : 'Kích hoạt'}</button></td>
              </tr>)}
              {visibleProducts.length === 0 ? <tr><td colSpan={8} className={styles.empty}>Không có sản phẩm phù hợp</td></tr> : null}
            </tbody></table></div>

            {selectedProduct ? <div className={styles.variantPanel} data-testid="variant-panel">
              <div className={styles.sectionHeader}><div><h3>SKU của {selectedProduct.code}</h3><p>Quản lý SKU, đơn vị, quy đổi và barcode của sản phẩm.</p></div><button type="button" className={styles.primaryButton} onClick={openVariantCreate} data-testid="add-variant-button">Thêm SKU</button></div>
              <div className={styles.tableWrapper}><table className={styles.table}><thead><tr><th>SKU</th><th>Tên</th><th>Loại</th><th>Tồn chuẩn</th><th>Bán</th><th>Catalog</th><th>Trạng thái</th><th></th></tr></thead><tbody>{variants.map((variant) => <tr key={variant.id} data-testid={`variant-row-${variant.sku}`}><td><strong>{variant.sku}</strong></td><td>{variant.name}</td><td>{variant.variant_kind}</td><td>{variant.is_inventory_base ? 'Có' : 'Không'}</td><td>{variant.is_sellable ? 'Có' : 'Không'}</td><td>{variant.is_catalog_visible ? 'Có' : 'Không'}</td><td>{variant.is_active ? 'Hoạt động' : 'Ngừng'}</td><td><button type="button" onClick={() => openVariantEdit(variant)}>Sửa</button></td></tr>)}{variants.length === 0 ? <tr><td colSpan={8} className={styles.empty}>Sản phẩm chưa có SKU</td></tr> : null}</tbody></table></div>
            </div> : null}
          </section>
        ) : null}

        {tab === 'categories' ? <section>
          <div className={styles.sectionHeader}><div><h2>Loại sản phẩm</h2><p>Phân nhóm cho bộ lọc admin và catalog khách hàng.</p></div><button type="button" className={styles.primaryButton} onClick={openCategoryCreate} data-testid="add-category-button">Thêm loại</button></div>
          <div className={styles.tableWrapper}><table className={styles.table}><thead><tr><th>Mã</th><th>Tên</th><th>Loại cha</th><th>Thứ tự</th><th>Catalog</th><th>Trạng thái</th><th></th></tr></thead><tbody>{categories.map((category) => <tr key={category.id} data-testid={`category-row-${category.code}`}><td><strong>{category.code}</strong></td><td>{category.name}</td><td>{categories.find((item) => item.id === category.parent_category_id)?.name || '—'}</td><td>{category.sort_order}</td><td>{category.is_catalog_visible ? 'Có' : 'Không'}</td><td>{category.is_active ? 'Hoạt động' : 'Ngừng'}</td><td className={styles.rowActions}><button type="button" onClick={() => openCategoryEdit(category)}>Sửa</button><button type="button" disabled={busy} onClick={() => void patchCategoryStatus(category, !category.is_active)}>{category.is_active ? 'Vô hiệu' : 'Kích hoạt'}</button></td></tr>)}</tbody></table></div>
        </section> : null}

        {tab === 'brands' ? <section>
          <div className={styles.sectionHeader}><div><h2>Nhãn hàng</h2><p>Thương hiệu chuẩn gắn với sản phẩm.</p></div><button type="button" className={styles.primaryButton} onClick={openBrandCreate} data-testid="add-brand-button">Thêm nhãn hàng</button></div>
          <div className={styles.tableWrapper}><table className={styles.table}><thead><tr><th>Mã</th><th>Tên</th><th>Catalog</th><th>Trạng thái</th><th></th></tr></thead><tbody>{brands.map((brand) => <tr key={brand.id} data-testid={`brand-row-${brand.code}`}><td><strong>{brand.code}</strong></td><td>{brand.name}</td><td>{brand.is_catalog_visible ? 'Có' : 'Không'}</td><td>{brand.is_active ? 'Hoạt động' : 'Ngừng'}</td><td className={styles.rowActions}><button type="button" onClick={() => openBrandEdit(brand)}>Sửa</button><button type="button" disabled={busy} onClick={() => void patchBrandStatus(brand, !brand.is_active)}>{brand.is_active ? 'Vô hiệu' : 'Kích hoạt'}</button></td></tr>)}</tbody></table></div>
        </section> : null}

        <Modal open={showProductForm} title={editingProduct ? `Sửa ${editingProduct.code}` : 'Thêm sản phẩm'} description="Thông tin sản phẩm dùng chung cho catalog, bán hàng và tồn kho." onClose={closeEditors} testId="product-form" size="large" footer={productFooter}>
          {error ? <div className={styles.errorBanner} role="alert">{error}</div> : null}
          <div className={styles.formGrid}>
            <label>Mã sản phẩm<input value={productForm.code} disabled={Boolean(editingProduct)} onChange={(event) => setProductForm({ ...productForm, code: event.target.value })} data-testid="product-code-input" /></label>
            <label>Tên sản phẩm<input value={productForm.name} onChange={(event) => setProductForm({ ...productForm, name: event.target.value })} data-testid="product-name-input" /></label>
            <label>Tên catalog<input value={productForm.catalogName} onChange={(event) => setProductForm({ ...productForm, catalogName: event.target.value })} /></label>
            <label>Loại<select value={productForm.categoryId} onChange={(event) => setProductForm({ ...productForm, categoryId: event.target.value })}><option value="">Chưa phân loại</option>{categories.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
            <label>Nhãn hàng<select value={productForm.brandId} onChange={(event) => setProductForm({ ...productForm, brandId: event.target.value })}><option value="">Chưa có nhãn hàng</option>{brands.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
            <label className={styles.wide}>Mô tả<textarea value={productForm.description} onChange={(event) => setProductForm({ ...productForm, description: event.target.value })} /></label>
            <label className={styles.wide}>Ghi chú nội bộ<textarea value={productForm.notes} onChange={(event) => setProductForm({ ...productForm, notes: event.target.value })} /></label>
          </div>
          <div className={styles.checks}>
            <label><input type="checkbox" checked={productForm.isCatalogVisible} onChange={(event) => setProductForm({ ...productForm, isCatalogVisible: event.target.checked })} /> Hiện trên catalog</label>
            <label title={!activeSellableVariantExists && editingProduct ? 'Cần ít nhất một SKU hoạt động và được phép bán' : undefined}><input type="checkbox" checked={productForm.isOrderable} disabled={!editingProduct || !activeSellableVariantExists} onChange={(event) => setProductForm({ ...productForm, isOrderable: event.target.checked })} /> Cho phép đặt hàng</label>
            <label><input type="checkbox" checked={productForm.isActive} onChange={(event) => setProductForm({ ...productForm, isActive: event.target.checked })} /> Hoạt động</label>
          </div>
        </Modal>

        <Modal open={showVariantForm} title={editingVariant ? `Sửa ${editingVariant.sku}` : `Thêm SKU cho ${selectedProduct?.code ?? 'sản phẩm'}`} description="SKU xác định đơn vị bán, đơn vị tồn chuẩn và khả năng hiển thị trên catalog." onClose={closeEditors} testId="variant-form" footer={variantFooter}>
          {error ? <div className={styles.errorBanner} role="alert">{error}</div> : null}
          <div className={styles.formGrid}>
            <label>SKU<input value={variantForm.sku} disabled={Boolean(editingVariant)} onChange={(event) => setVariantForm({ ...variantForm, sku: event.target.value })} data-testid="variant-sku-input" /></label>
            <label>Tên SKU<input value={variantForm.name} onChange={(event) => setVariantForm({ ...variantForm, name: event.target.value })} data-testid="variant-name-input" /></label>
            <label>Loại<select value={variantForm.variantKind} onChange={(event) => setVariantForm({ ...variantForm, variantKind: event.target.value as VariantForm['variantKind'] })}><option value="BASE">Lẻ / nền</option><option value="CARTON">Thùng</option><option value="OTHER">Khác</option></select></label>
          </div>
          <div className={styles.checks}><label><input type="checkbox" checked={variantForm.isInventoryBase} onChange={(event) => setVariantForm({ ...variantForm, isInventoryBase: event.target.checked, variantKind: event.target.checked ? 'BASE' : variantForm.variantKind })} /> Đơn vị tồn chuẩn</label><label><input type="checkbox" checked={variantForm.isSellable} onChange={(event) => setVariantForm({ ...variantForm, isSellable: event.target.checked, isCatalogVisible: event.target.checked ? variantForm.isCatalogVisible : false })} /> Được phép bán</label><label><input type="checkbox" checked={variantForm.isCatalogVisible} onChange={(event) => setVariantForm({ ...variantForm, isCatalogVisible: event.target.checked })} /> Hiện catalog</label><label><input type="checkbox" checked={variantForm.isActive} onChange={(event) => setVariantForm({ ...variantForm, isActive: event.target.checked })} /> Hoạt động</label></div>
        </Modal>

        <Modal open={showCategoryForm} title={editingCategory ? `Sửa ${editingCategory.code}` : 'Thêm loại sản phẩm'} description="Loại sản phẩm phục vụ phân nhóm quản trị và catalog khách hàng." onClose={closeEditors} testId="category-form" footer={categoryFooter}>
          {error ? <div className={styles.errorBanner} role="alert">{error}</div> : null}
          <div className={styles.formGrid}><label>Mã loại<input value={categoryForm.code} disabled={Boolean(editingCategory)} onChange={(event) => setCategoryForm({ ...categoryForm, code: event.target.value })} data-testid="category-code-input" /></label><label>Tên loại<input value={categoryForm.name} onChange={(event) => setCategoryForm({ ...categoryForm, name: event.target.value })} data-testid="category-name-input" /></label><label>Loại cha<select value={categoryForm.parentCategoryId} onChange={(event) => setCategoryForm({ ...categoryForm, parentCategoryId: event.target.value })}><option value="">Không có</option>{categories.filter((item) => item.is_active && item.id !== editingCategory?.id).map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label><label>Thứ tự<input type="number" min="0" value={categoryForm.sortOrder} onChange={(event) => setCategoryForm({ ...categoryForm, sortOrder: event.target.value })} /></label><label className={styles.wide}>Mô tả<textarea value={categoryForm.description} onChange={(event) => setCategoryForm({ ...categoryForm, description: event.target.value })} /></label></div>
          <div className={styles.checks}><label><input type="checkbox" checked={categoryForm.isCatalogVisible} onChange={(event) => setCategoryForm({ ...categoryForm, isCatalogVisible: event.target.checked })} /> Hiện catalog</label><label><input type="checkbox" checked={categoryForm.isActive} onChange={(event) => setCategoryForm({ ...categoryForm, isActive: event.target.checked })} /> Hoạt động</label></div>
        </Modal>

        <Modal open={showBrandForm} title={editingBrand ? `Sửa ${editingBrand.code}` : 'Thêm nhãn hàng'} description="Nhãn hàng chuẩn được dùng thống nhất trên sản phẩm và catalog." onClose={closeEditors} testId="brand-form" footer={brandFooter}>
          {error ? <div className={styles.errorBanner} role="alert">{error}</div> : null}
          <div className={styles.formGrid}><label>Mã nhãn hàng<input value={brandForm.code} disabled={Boolean(editingBrand)} onChange={(event) => setBrandForm({ ...brandForm, code: event.target.value })} data-testid="brand-code-input" /></label><label>Tên nhãn hàng<input value={brandForm.name} onChange={(event) => setBrandForm({ ...brandForm, name: event.target.value })} data-testid="brand-name-input" /></label><label className={styles.wide}>Mô tả<textarea value={brandForm.description} onChange={(event) => setBrandForm({ ...brandForm, description: event.target.value })} /></label></div>
          <div className={styles.checks}><label><input type="checkbox" checked={brandForm.isCatalogVisible} onChange={(event) => setBrandForm({ ...brandForm, isCatalogVisible: event.target.checked })} /> Hiện catalog</label><label><input type="checkbox" checked={brandForm.isActive} onChange={(event) => setBrandForm({ ...brandForm, isActive: event.target.checked })} /> Hoạt động</label></div>
        </Modal>
      </main>
    </AppShell>
  );
}
