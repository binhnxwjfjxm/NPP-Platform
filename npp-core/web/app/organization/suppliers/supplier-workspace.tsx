'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import styles from '../organization.module.css';
import type { Supplier } from '../../../lib/supplier-types';

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
};

type Props = {
  initialSuppliers: Supplier[];
  initialError?: string | null;
};

function emptySupplierDraft(): SupplierDraft {
  return {
    code: '',
    name: '',
    taxId: '',
    bankAccount: '',
    bankName: '',
    avgDeliveryDays: '',
    purchaseOwnerEmployeeId: '',
  };
}

export default function SupplierWorkspace({ initialSuppliers, initialError }: Props) {
  const [suppliers, setSuppliers] = useState<Supplier[]>(initialSuppliers);
  const [filter, setFilter] = useState<FilterState>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [editor, setEditor] = useState<SupplierEditor>(null);
  const [draft, setDraft] = useState<SupplierDraft>(emptySupplierDraft());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError || null);

  const filtered = suppliers.filter((s) => {
    if (filter === 'active' && !s.is_active) return false;
    if (filter === 'inactive' && s.is_active) return false;
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      return (
        s.code.toLowerCase().includes(search) ||
        s.name.toLowerCase().includes(search) ||
        (s.tax_id?.toLowerCase().includes(search) ?? false)
      );
    }
    return true;
  });

  const handleCreateClick = () => {
    setEditor({ mode: 'create', id: null });
    setDraft(emptySupplierDraft());
    setError(null);
  };

  const handleEditClick = (supplier: Supplier) => {
    setEditor({ mode: 'edit', id: supplier.id });
    setDraft({
      code: supplier.code,
      name: supplier.name,
      taxId: supplier.tax_id || '',
      bankAccount: supplier.bank_account || '',
      bankName: supplier.bank_name || '',
      avgDeliveryDays: supplier.avg_delivery_days?.toString() || '',
      purchaseOwnerEmployeeId: supplier.purchase_owner_employee_id || '',
    });
    setError(null);
  };

  const handleCancel = () => {
    setEditor(null);
    setDraft(emptySupplierDraft());
  };

  const handleToggleStatus = async (supplier: Supplier) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/suppliers/${supplier.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isActive: !supplier.is_active,
          expectedUpdatedAt: supplier.updated_at,
        }),
      });

      const envelope: ApiEnvelope<Supplier> = await response.json();
      if (envelope.error) {
        setError(envelope.error.message || 'Failed to update supplier');
        return;
      }

      if (envelope.data) {
        setSuppliers(suppliers.map((s) => (s.id === supplier.id ? envelope.data! : s)));
      }
    } catch (e) {
      setError('Failed to update supplier');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    try {
      const method = editor?.mode === 'create' ? 'POST' : 'PATCH';
      const endpoint = editor?.mode === 'create' ? '/api/suppliers' : `/api/suppliers/${editor?.id}`;
      const body = editor?.mode === 'create'
        ? draft
        : {
            ...draft,
            expectedUpdatedAt: suppliers.find((s) => s.id === editor?.id)?.updated_at,
          };

      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(editor?.mode === 'create' ? { 'Idempotency-Key': `web-supplier-${Date.now()}` } : {}),
        },
        body: JSON.stringify(body),
      });

      const envelope: ApiEnvelope<Supplier> = await response.json();
      if (envelope.error) {
        setError(envelope.error.message || 'Failed to save supplier');
        return;
      }

      if (envelope.data) {
        if (editor?.mode === 'create') {
          setSuppliers([...suppliers, envelope.data]);
        } else {
          setSuppliers(suppliers.map((s) => (s.id === envelope.data!.id ? envelope.data! : s)));
        }
        setEditor(null);
        setDraft(emptySupplierDraft());
      }
    } catch (e) {
      setError('Failed to save supplier');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Nhà cung cấp</h1>
          <button onClick={handleCreateClick} disabled={loading}>
            Thêm nhà cung cấp
          </button>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.controls}>
          <input
            type="text"
            placeholder="Tìm kiếm..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            disabled={loading}
          />
          <div className={styles.filters}>
            {(['all', 'active', 'inactive'] as const).map((f) => (
              <label key={f}>
                <input
                  type="radio"
                  name="filter"
                  value={f}
                  checked={filter === f}
                  onChange={() => setFilter(f)}
                  disabled={loading}
                />
                {f === 'all' ? 'Tất cả' : f === 'active' ? 'Hoạt động' : 'Không hoạt động'}
              </label>
            ))}
          </div>
        </div>

        {editor && (
          <div className={styles.editor}>
            <h2>{editor.mode === 'create' ? 'Thêm nhà cung cấp' : 'Chỉnh sửa nhà cung cấp'}</h2>
            <div className={styles.form}>
              <input
                type="text"
                placeholder="Mã"
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                disabled={loading || editor.mode === 'edit'}
              />
              <input
                type="text"
                placeholder="Tên"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                disabled={loading}
              />
              <input
                type="text"
                placeholder="Mã số thuế"
                value={draft.taxId}
                onChange={(e) => setDraft({ ...draft, taxId: e.target.value })}
                disabled={loading}
              />
              <input
                type="text"
                placeholder="Số tài khoản ngân hàng"
                value={draft.bankAccount}
                onChange={(e) => setDraft({ ...draft, bankAccount: e.target.value })}
                disabled={loading}
              />
              <input
                type="text"
                placeholder="Tên ngân hàng"
                value={draft.bankName}
                onChange={(e) => setDraft({ ...draft, bankName: e.target.value })}
                disabled={loading}
              />
              <input
                type="number"
                placeholder="Thời gian giao hàng trung bình (ngày)"
                value={draft.avgDeliveryDays}
                onChange={(e) => setDraft({ ...draft, avgDeliveryDays: e.target.value })}
                disabled={loading}
              />
            </div>
            <div className={styles.actions}>
              <button onClick={handleSave} disabled={loading}>
                Lưu
              </button>
              <button onClick={handleCancel} disabled={loading}>
                Hủy
              </button>
            </div>
          </div>
        )}

        <table className={styles.table}>
          <thead>
            <tr>
              <th>Mã</th>
              <th>Tên</th>
              <th>Mã số thuế</th>
              <th>NgB</th>
              <th>Trạng thái</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((supplier) => (
              <tr key={supplier.id}>
                <td>{supplier.code}</td>
                <td>{supplier.name}</td>
                <td>{supplier.tax_id || '-'}</td>
                <td>{supplier.avg_delivery_days || '-'}</td>
                <td>{supplier.is_active ? 'Hoạt động' : 'Không hoạt động'}</td>
                <td>
                  <button onClick={() => handleEditClick(supplier)} disabled={loading}>
                    Sửa
                  </button>
                  <button onClick={() => handleToggleStatus(supplier)} disabled={loading}>
                    {supplier.is_active ? 'Vô hiệu' : 'Kích hoạt'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && <p className={styles.empty}>Không có nhà cung cấp</p>}
      </div>
    </AppShell>
  );
}
