'use client';

import { useMemo, useState } from 'react';
import { AppShell } from '../components/app-shell';
import { Product, ProductBrand, ProductCategory } from '../../lib/product-types';
import styles from './products.module.css';

type Props = {
  initialProducts: Product[];
  initialCategories: ProductCategory[];
  initialBrands: ProductBrand[];
  initialError?: string | null;
};

type FilterState = 'all' | 'active' | 'inactive';

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

export default function ProductWorkspace({
  initialProducts,
  initialCategories,
  initialBrands,
  initialError = null,
}: Props) {
  const [products, setProducts] = useState(initialProducts);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterState>('all');
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);

  const normalizedSearch = normalizeSearch(search);
  const visibleProducts = useMemo(() => products
    .filter((product) => {
      const statusMatch = statusFilter === 'all' || (statusFilter === 'active' ? product.is_active : !product.is_active);
      const searchMatch = !normalizedSearch || [
        product.code,
        product.name,
        product.catalog_name,
        product.category_code,
        product.category_name,
        product.brand_code,
        product.brand_name,
      ].some((value) => value?.toLowerCase().includes(normalizedSearch));
      return statusMatch && searchMatch;
    })
    .slice(0, 100), [products, normalizedSearch, statusFilter]);

  const counts = useMemo(() => ({
    total: products.length,
    active: products.filter((product) => product.is_active).length,
    inactive: products.filter((product) => !product.is_active).length,
    orderable: products.filter((product) => product.is_orderable).length,
  }), [products]);

  async function loadProducts() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/products?limit=1000', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload?.data) {
        throw new Error(payload?.error?.message || 'Không thể tải dữ liệu sản phẩm');
      }
      setProducts(payload.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không thể tải dữ liệu sản phẩm');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Danh mục sản phẩm" subtitle="Quản lý thương hiệu, loại và sản phẩm" kicker="NPP Product Catalog">
      <div className={styles.workspace}>
        <div className={styles.headerBar}>
          <div>
            <p className={styles.summary}>Tổng số sản phẩm: <strong>{counts.total}</strong></p>
            <p className={styles.summary}>Kích hoạt: <strong>{counts.active}</strong>, Ngừng hoạt động: <strong>{counts.inactive}</strong>, Có thể đặt hàng: <strong>{counts.orderable}</strong></p>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.refreshButton} disabled={busy} onClick={() => void loadProducts()}>
              Làm mới
            </button>
          </div>
        </div>

        <div className={styles.filters}>
          <input
            className={styles.searchInput}
            type="search"
            placeholder="Tìm mã, tên, loại hoặc nhãn hàng"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select className={styles.select} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as FilterState)}>
            <option value="all">Tất cả trạng thái</option>
            <option value="active">Đang hoạt động</option>
            <option value="inactive">Ngừng hoạt động</option>
          </select>
        </div>

        {error ? <div className={styles.errorBanner}>{error}</div> : null}

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Mã</th>
                <th>Tên sản phẩm</th>
                <th>Loại</th>
                <th>Nhãn hàng</th>
                <th>Hiển thị</th>
                <th>Đặt hàng</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {visibleProducts.map((product) => (
                <tr key={product.id}>
                  <td>{product.code}</td>
                  <td>{product.name}</td>
                  <td>{product.category_name || '-'}</td>
                  <td>{product.brand_name || '-'}</td>
                  <td>{product.is_catalog_visible ? 'Có' : 'Không'}</td>
                  <td>{product.is_orderable ? 'Có' : 'Không'}</td>
                  <td>{product.is_active ? 'Hoạt động' : 'Ngừng'}</td>
                </tr>
              ))}
              {visibleProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} className={styles.emptyRow}>Không có sản phẩm phù hợp</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className={styles.legend}>
          <p>Danh sách chỉ hiển thị tối đa 100 sản phẩm cho lần xem đầu tiên.</p>
          <p>Sử dụng bộ lọc để thu hẹp kết quả theo trạng thái hoặc tìm nhanh.</p>
        </div>
      </div>
    </AppShell>
  );
}
