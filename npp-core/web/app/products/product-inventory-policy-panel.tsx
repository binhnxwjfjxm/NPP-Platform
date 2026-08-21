'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useMemo, useRef, useState } from 'react';
import styles from './product-inventory-policy.module.css';

type PolicyProduct = {
  id: string;
  code: string;
  name: string;
  isInventoryManaged: boolean;
  updatedAt: string;
};

type ErrorPayload = { error?: { message?: string } };

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
  });
  const payload = await response.json().catch(() => null) as { data?: T } & ErrorPayload | null;
  if (!response.ok || !payload || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    throw new Error(payload?.error?.message ?? 'Không thể cập nhật chính sách Kho');
  }
  return payload.data as T;
}

export default function ProductInventoryPolicyPanel() {
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState<PolicyProduct[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products;
    return products.filter((product) => [product.code, product.name].some((value) => value.toLowerCase().includes(term)));
  }, [products, search]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setProducts(await requestJson<PolicyProduct[]>('/api/products/inventory-policies'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể tải chính sách Kho');
    } finally {
      setLoading(false);
    }
  }

  function openPanel() {
    setOpen(true);
    setNotice(null);
    void load();
  }

  async function changePolicy(product: PolicyProduct) {
    const nextManaged = !product.isInventoryManaged;
    const targetLabel = nextManaged ? 'Qua kho' : 'Không qua kho';
    const confirmed = window.confirm(
      nextManaged
        ? `Chuyển ${product.code} sang Qua kho? Sản phẩm sẽ tham gia giữ hàng và xuất/nhập Kho.`
        : `Chuyển ${product.code} sang Không qua kho? Sản phẩm vẫn bán được nhưng không giữ, nhập hoặc trừ Kho.`,
    );
    if (!confirmed) return;

    const slot = `${product.id}:${nextManaged ? 'managed' : 'non-managed'}:${product.updatedAt}`;
    let key = keys.current.get(slot);
    if (!key) {
      key = createIdempotencyKey('product-inventory-policy');
      keys.current.set(slot, key);
    }

    setBusyId(product.id);
    setError(null);
    setNotice(null);
    try {
      const saved = await requestJson<PolicyProduct>(`/api/products/${product.id}/inventory-policy`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ isInventoryManaged: nextManaged, expectedUpdatedAt: product.updatedAt }),
      });
      keys.current.delete(slot);
      setProducts((current) => current.map((item) => item.id === saved.id ? saved : item));
      setNotice(`Đã chuyển ${saved.code} sang ${targetLabel}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể cập nhật chính sách Kho');
    } finally {
      setBusyId(null);
    }
  }

  return <>
    <button className={styles.launcher} type="button" onClick={openPanel}>Chính sách Kho</button>
    {open ? <section className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Chính sách Kho của sản phẩm">
      <div className={styles.dialog}>
        <header className={styles.header}>
          <div><p>QUẢN LÝ SẢN PHẨM</p><h2>Qua kho / Không qua kho</h2><span>Hàng mua dùm có thể nằm chung đơn bán nhưng không làm tăng, giữ hoặc trừ tồn.</span></div>
          <button type="button" onClick={() => setOpen(false)}>Đóng</button>
        </header>
        <div className={styles.toolbar}>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm mã hoặc tên sản phẩm" autoFocus />
          <button type="button" onClick={() => void load()} disabled={loading || busyId !== null}>{loading ? 'Đang tải…' : 'Làm mới'}</button>
        </div>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Mã</th><th>Sản phẩm</th><th>Chính sách Kho</th><th>Thao tác</th></tr></thead>
            <tbody>
              {visible.map((product) => <tr key={product.id}>
                <td><strong>{product.code}</strong></td>
                <td>{product.name}</td>
                <td><span className={product.isInventoryManaged ? styles.managed : styles.nonManaged}>{product.isInventoryManaged ? 'Qua kho' : 'Không qua kho'}</span></td>
                <td><button type="button" disabled={busyId !== null} onClick={() => void changePolicy(product)}>{busyId === product.id ? 'Đang cập nhật…' : product.isInventoryManaged ? 'Chuyển Không qua kho' : 'Chuyển Qua kho'}</button></td>
              </tr>)}
              {!loading && visible.length === 0 ? <tr><td colSpan={4} className={styles.empty}>Không có sản phẩm phù hợp</td></tr> : null}
            </tbody>
          </table>
        </div>
        <footer className={styles.footer}>Hàng Không qua kho không được dùng trong Đơn mua hàng hoặc Nhập kho thủ công.</footer>
      </div>
    </section> : null}
  </>;
}
