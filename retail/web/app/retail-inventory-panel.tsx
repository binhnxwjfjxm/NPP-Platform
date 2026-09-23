'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './retail-inventory.module.css';

export type RetailInventoryWarehouse = {
  id: string;
  code: string;
  name: string;
};

type InventoryRow = {
  variantId: string;
  productName: string;
  sku: string;
  onHandQuantity: string;
  reservedQuantity: string;
};

type InventoryResponse = {
  data?: {
    rows?: InventoryRow[];
  };
  error?: {
    message?: string;
  };
};

const quantity = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 6 });

function formatQuantity(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? quantity.format(parsed) : '—';
}

export function RetailInventoryPanel({ warehouses }: { warehouses: RetailInventoryWarehouse[] }) {
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!warehouseId) {
      setRows([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetch(`/api/retail/inventory?warehouseId=${encodeURIComponent(warehouseId)}`, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    }).then(async (response) => {
      const payload = await response.json().catch(() => null) as InventoryResponse | null;
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Chưa thể tải tồn kho.');
      return payload?.data?.rows ?? [];
    }).then((nextRows) => {
      if (!controller.signal.aborted) setRows(nextRows);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Chưa thể tải tồn kho.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [warehouseId]);

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('vi-VN');
    if (!needle) return rows;
    return rows.filter((row) => `${row.productName} ${row.sku}`.toLocaleLowerCase('vi-VN').includes(needle));
  }, [rows, search]);

  return <main className={styles.inventoryPage}>
    <header className={styles.header}>
      <div>
        <p>TỒN KHO</p>
        <h1>Xem nhanh tồn kho</h1>
      </div>
    </header>

    <section className={styles.filters} aria-label="Bộ lọc tồn kho">
      <label>
        <span>Kho</span>
        <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
          {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
        </select>
      </label>
      <label className={styles.search}>
        <span>Tìm kiếm</span>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm sản phẩm / SKU" />
      </label>
    </section>

    {error ? <p className={styles.error} role="alert">{error}</p> : null}

    <section className={styles.stockCard} aria-label="Danh sách tồn kho">
      <div className={styles.stockHeader}>
        <span>Sản phẩm</span>
        <b>Tồn</b>
        <b>Đang giữ</b>
      </div>
      <div className={styles.stockList}>
        {visibleRows.map((row) => <article className={styles.stockRow} key={row.variantId}>
          <span className={styles.product}>
            <strong>{row.productName}</strong>
            <small>SKU: {row.sku}</small>
          </span>
          <strong className={styles.quantityCell}>{formatQuantity(row.onHandQuantity)}</strong>
          <strong className={styles.quantityCell}>{formatQuantity(row.reservedQuantity)}</strong>
        </article>)}
        {loading ? <p className={styles.empty}>Đang tải tồn kho…</p> : null}
        {!loading && visibleRows.length === 0 ? <p className={styles.empty}>Không có sản phẩm phù hợp.</p> : null}
      </div>
    </section>
  </main>;
}
