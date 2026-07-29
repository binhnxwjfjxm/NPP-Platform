'use client';

import { useMemo, useRef, useState } from 'react';
import { AppShell } from '../components/app-shell';
import VietnamAdministrativeFields from '../components/vietnam-administrative-fields';
import styles from './suppliers.module.css';
import type { Supplier } from '../../lib/supplier-types';

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean };
};

type FilterState = 'all' | 'active' | 'inactive';
type SupplierEditor = { mode: 'create' | 'edit'; id: string | null } | null;

type SupplierDraft = {
  code: string;
  name: string;
  taxId: string;
  bankAccount: string;
  bankName: string;
  avgDeliveryDays: string;
  purchaseOwnerEmployeeId: string;
  street: string;
  province: string;
  ward: string;
  district: string;
};

type Props = {
  initialSuppliers: Supplier[];
  initialError?: string | null;
};

class UiRequestError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

function emptySupplierDraft(): SupplierDraft {
  return {
    code: '',
    name: '',
    taxId: '',
    bankAccount: '',
    bankName: '',
    avgDeliveryDays: '',
    purchaseOwnerEmployeeId: '',
    street: '',
    province: '',
    ward: '',
    district: '',
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
  const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!response.ok || payload.data === undefined) {
    throw new UiRequestError(
      payload.error?.code || 'REQUEST_FAILED',
      payload.error?.message || 'Không thể kết nối dịch vụ nhà cung cấp',
    );
  }
  return payload.data;
}

export default function SupplierWorkspace({ initialSuppliers, initialError = null }: Props) {
  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [statusFilter, setStatusFilter] = useState<FilterState>('all');
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<SupplierEditor>(null);
  const [draft, setDraft] = useState<SupplierDraft>(emptySupplierDraft());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingCreatedSupplier, setPendingCreatedSupplier] = useState<Supplier | null>(null);
  const supplierCreateKey = useRef<string | null>(null);
  const supplierAddressKey = useRef<string | null>(null);

  const visibleSuppliers = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('vi-VN');
    return suppliers
      .filter((supplier) => {
        const statusMatches = statusFilter === 'all'
          || (statusFilter === 'active' ? supplier.is_active : !supplier.is_active);
        const text = [supplier.code, supplier.name, supplier.tax_id, supplier.bank_account]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase('vi-VN');
        return statusMatches && (!term || text.includes(term));
      })
      .sort((left, right) => left.code.localeCompare(right.code));
  }, [search, statusFilter, suppliers]);

  async function loadAll(message?: string) {
    setBusy('load');
    setError(null);
    try {
      setSuppliers(await requestJson<Supplier[]>('/api/suppliers?limit=1000'));
      if (message) setNotice(message);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Không tải được dữ liệu nhà cung cấp');
    } finally {
      setBusy(null);
    }
  }

  function resetCreateState() {
    supplierCreateKey.current = null;
    supplierAddressKey.current = null;
    setPendingCreatedSupplier(null);
  }

  function openCreate() {
    resetCreateState();
    setDraft(emptySupplierDraft());
    setEditor({ mode: 'create', id: null });
    setError(null);
    setNotice(null);
  }

  function openEdit(supplier: Supplier) {
    resetCreateState();
    setDraft({
      ...emptySupplierDraft(),
      code: supplier.code,
      name: supplier.name,
      taxId: supplier.tax_id ?? '',
      bankAccount: supplier.bank_account ?? '',
      bankName: supplier.bank_name ?? '',
      avgDeliveryDays: supplier.avg_delivery_days === null ? '' : String(supplier.avg_delivery_days),
      purchaseOwnerEmployeeId: supplier.purchase_owner_employee_id ?? '',
    });
    setEditor({ mode: 'edit', id: supplier.id });
    setError(null);
    setNotice(null);
  }

  async function handleFailure(failure: unknown) {
    const next = failure instanceof UiRequestError
      ? failure
      : new UiRequestError('REQUEST_FAILED', failure instanceof Error ? failure.message : 'Yêu cầu không thành công');
    if (next.code === 'CONFLICT') {
      await loadAll();
      setError('Dữ liệu đã thay đổi ở nơi khác. Danh sách đã được tải lại. Vui lòng kiểm tra và thao tác lại.');
      return;
    }
    setError(next.message);
  }

  async function submitSupplier(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = editor?.mode === 'edit' ? suppliers.find((item) => item.id === editor.id) : null;
    setBusy('save');
    setError(null);
    setNotice(null);
    try {
      let savedSupplier = current;
      if (current) {
        savedSupplier = await requestJson<Supplier>(`/api/suppliers/${current.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: draft.name.trim(),
            taxId: draft.taxId.trim() || null,
            bankAccount: draft.bankAccount.trim() || null,
            bankName: draft.bankName.trim() || null,
            avgDeliveryDays: draft.avgDeliveryDays.trim() === '' ? null : Number(draft.avgDeliveryDays),
            purchaseOwnerEmployeeId: draft.purchaseOwnerEmployeeId.trim() || null,
            expectedUpdatedAt: current.updated_at,
          }),
        });
      } else if (pendingCreatedSupplier) {
        savedSupplier = pendingCreatedSupplier;
      } else {
        supplierCreateKey.current ??= `web-${crypto.randomUUID()}`;
        savedSupplier = await requestJson<Supplier>('/api/suppliers', {
          method: 'POST',
          headers: { 'Idempotency-Key': supplierCreateKey.current },
          body: JSON.stringify({
            code: draft.code.trim().toUpperCase(),
            name: draft.name.trim(),
            taxId: draft.taxId.trim() || null,
            bankAccount: draft.bankAccount.trim() || null,
            bankName: draft.bankName.trim() || null,
            avgDeliveryDays: draft.avgDeliveryDays.trim() === '' ? null : Number(draft.avgDeliveryDays),
            purchaseOwnerEmployeeId: draft.purchaseOwnerEmployeeId.trim() || null,
          }),
        });
        setPendingCreatedSupplier(savedSupplier);
      }

      if (!current && savedSupplier && draft.street.trim() && draft.province && draft.ward) {
        supplierAddressKey.current ??= `web-${crypto.randomUUID()}`;
        await requestJson(`/api/suppliers/${savedSupplier.id}/addresses`, {
          method: 'POST',
          headers: { 'Idempotency-Key': supplierAddressKey.current },
          body: JSON.stringify({
            addressType: 'business',
            street: draft.street.trim(),
            city: draft.ward,
            province: draft.province,
            postalCode: null,
            country: 'Việt Nam',
            isPrimary: true,
            isActive: true,
          }),
        });
      }

      setEditor(null);
      setDraft(emptySupplierDraft());
      resetCreateState();
      await loadAll(current ? 'Nhà cung cấp đã được cập nhật.' : 'Nhà cung cấp và địa chỉ mặc định đã được tạo.');
    } catch (failure) {
      await handleFailure(failure);
      setBusy(null);
    }
  }

  async function toggleSupplier(supplier: Supplier) {
    setBusy(`toggle-${supplier.id}`);
    setError(null);
    setNotice(null);
    try {
      await requestJson<Supplier>(`/api/suppliers/${supplier.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          isActive: !supplier.is_active,
          expectedUpdatedAt: supplier.updated_at,
        }),
      });
      await loadAll(supplier.is_active ? 'Nhà cung cấp đã ngừng sử dụng.' : 'Nhà cung cấp đã được đưa vào sử dụng.');
    } catch (failure) {
      await handleFailure(failure);
      setBusy(null);
    }
  }

  return (
    <AppShell
      title="Nhà cung cấp"
      subtitle="Quản lý hồ sơ, địa chỉ, thông tin thuế, ngân hàng và thời gian giao hàng của nhà cung cấp."
    >
      <div className={styles.page} data-testid="suppliers-page">
        <section className={styles.summary}>
          <div><strong>{suppliers.length}</strong><span>Tổng nhà cung cấp</span></div>
          <div><strong>{suppliers.filter((item) => item.is_active).length}</strong><span>Đang hoạt động</span></div>
          <button type="button" onClick={openCreate} disabled={busy !== null}>Thêm nhà cung cấp</button>
        </section>

        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {notice ? <p className={styles.notice}>{notice}</p> : null}

        <section className={styles.toolbar}>
          <input data-testid="suppliers-search-input" type="search" placeholder="Tìm theo mã, tên, mã số thuế hoặc tài khoản" value={search} onChange={(event) => setSearch(event.target.value)} />
          <select data-testid="suppliers-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as FilterState)}>
            <option value="all">Tất cả trạng thái</option>
            <option value="active">Hoạt động</option>
            <option value="inactive">Không hoạt động</option>
          </select>
          <button type="button" onClick={() => void loadAll()} disabled={busy !== null}>Cập nhật dữ liệu</button>
        </section>

        <section className={styles.tableCard}>
          <table><thead><tr><th>Mã</th><th>Tên nhà cung cấp</th><th>Mã số thuế</th><th>Ngân hàng</th><th>Giao hàng</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
            <tbody>{visibleSuppliers.map((supplier) => (
              <tr key={supplier.id} data-testid={`supplier-row-${supplier.code}`}>
                <td className={styles.code}>{supplier.code}</td><td>{supplier.name}</td><td>{supplier.tax_id || '—'}</td><td>{supplier.bank_name || supplier.bank_account || '—'}</td><td>{supplier.avg_delivery_days === null ? '—' : `${supplier.avg_delivery_days} ngày`}</td><td><span className={supplier.is_active ? styles.active : styles.inactive}>{supplier.is_active ? 'Hoạt động' : 'Không hoạt động'}</span></td>
                <td className={styles.actions}><button data-testid={`edit-supplier-${supplier.code}`} type="button" onClick={() => openEdit(supplier)} disabled={busy !== null}>Sửa</button><button type="button" onClick={() => void toggleSupplier(supplier)} disabled={busy !== null}>{supplier.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}</button></td>
              </tr>
            ))}</tbody>
          </table>
          {visibleSuppliers.length === 0 ? <p className={styles.empty}>Không có nhà cung cấp phù hợp.</p> : null}
        </section>

        {editor ? (
          <div className={styles.modalBackdrop} role="presentation">
            <form className={styles.modal} onSubmit={submitSupplier}>
              <header><div><p>Danh mục nhà cung cấp</p><h2>{editor.mode === 'create' ? 'Thêm nhà cung cấp' : 'Chỉnh sửa nhà cung cấp'}</h2></div><button type="button" onClick={() => setEditor(null)} disabled={busy !== null}>Đóng</button></header>
              <div className={styles.formGrid}>
                <label>Mã nhà cung cấp<input data-testid="supplier-code-input" value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} disabled={editor.mode === 'edit' || busy !== null} required /></label>
                <label>Tên nhà cung cấp<input data-testid="supplier-name-input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} disabled={busy !== null} required /></label>
                <label>Mã số thuế<input data-testid="supplier-tax-id-input" value={draft.taxId} onChange={(event) => setDraft({ ...draft, taxId: event.target.value })} disabled={busy !== null} /></label>
                <label>Số tài khoản<input data-testid="supplier-bank-account-input" value={draft.bankAccount} onChange={(event) => setDraft({ ...draft, bankAccount: event.target.value })} disabled={busy !== null} /></label>
                <label>Tên ngân hàng<input data-testid="supplier-bank-name-input" value={draft.bankName} onChange={(event) => setDraft({ ...draft, bankName: event.target.value })} disabled={busy !== null} /></label>
                <label>Thời gian giao hàng trung bình<input data-testid="supplier-avg-delivery-days-input" type="number" min="0" max="3650" value={draft.avgDeliveryDays} onChange={(event) => setDraft({ ...draft, avgDeliveryDays: event.target.value })} disabled={busy !== null} /></label>
                {editor.mode === 'create' ? <>
                  <label>Địa chỉ chi tiết<input data-testid="supplier-street-input" value={draft.street} onChange={(event) => setDraft({ ...draft, street: event.target.value })} disabled={busy !== null} required /></label>
                  <VietnamAdministrativeFields province={draft.province} ward={draft.ward} district={draft.district} onChange={(next) => setDraft((current) => ({ ...current, ...next }))} required testIdPrefix="supplier" />
                </> : null}
              </div>
              <footer><button type="button" onClick={() => setEditor(null)} disabled={busy !== null}>Hủy</button><button type="submit" disabled={busy !== null}>{busy === 'save' ? 'Đang lưu…' : 'Lưu'}</button></footer>
            </form>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
