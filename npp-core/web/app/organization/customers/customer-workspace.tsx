'use client';

import { useMemo, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import shellStyles from '../../components/app-shell.module.css';
import styles from '../organization/organization.module.css';
import type { Customer } from '../../../lib/customer-types';
import { formatCompactNumber, matchTerm, normalizeSearch, toUpperCode } from '../../../lib/organization-types';

type FilterState = 'all' | 'active' | 'inactive';
type EditorState = { mode: 'create' | 'edit'; customerId: string | null } | null;

type CustomerDraft = {
  code: string;
  name: string;
  address: string;
  phone: string;
  email: string;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean };
};

type Props = {
  initialCustomers: Customer[];
  initialError?: string | null;
};

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function emptyDraft(): CustomerDraft {
  return { code: '', name: '', address: '', phone: '', email: '' };
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
    throw new Error(payload.error?.message || 'Không thể kết nối dịch vụ khách hàng');
  }

  return payload.data;
}

export default function CustomerWorkspace({ initialCustomers, initialError = null }: Props) {
  const [customers, setCustomers] = useState(initialCustomers);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterState>('all');
  const [editor, setEditor] = useState<EditorState>(null);
  const [draft, setDraft] = useState<CustomerDraft>(emptyDraft());

  const normalizedSearch = normalizeSearch(search);
  const visibleCustomers = useMemo(() => customers
    .filter((customer) => {
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? customer.is_active : !customer.is_active);
      const matchesText = !normalizedSearch || matchTerm(customer.code, customer.name, customer.address, customer.phone, customer.email).includes(normalizedSearch);
      return matchesStatus && matchesText;
    })
    .sort((left, right) => left.code.localeCompare(right.code)), [customers, normalizedSearch, statusFilter]);

  const counts = useMemo(() => {
    const active = customers.filter((customer) => customer.is_active).length;
    return {
      total: customers.length,
      active,
      inactive: customers.length - active,
    };
  }, [customers]);

  async function loadAll(successMessage = 'Danh sách khách hàng đã được cập nhật.') {
    setBusy('load');
    setError(null);
    setNotice(null);
    try {
      const nextCustomers = await requestJson<Customer[]>('/api/customers?limit=1000');
      setCustomers(nextCustomers);
      setNotice(successMessage);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được danh sách khách hàng');
    } finally {
      setBusy(null);
    }
  }

  function openCreate() {
    setError(null);
    setNotice(null);
    setDraft(emptyDraft());
    setEditor({ mode: 'create', customerId: null });
  }

  function openEdit(customerId: string) {
    const customer = customers.find((item) => item.id === customerId);
    if (!customer) return;
    setError(null);
    setNotice(null);
    setDraft({
      code: customer.code,
      name: customer.name,
      address: customer.address ?? '',
      phone: customer.phone ?? '',
      email: customer.email ?? '',
    });
    setEditor({ mode: 'edit', customerId });
  }

  async function submitCustomer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('save');
    setError(null);
    setNotice(null);

    const current = editor?.mode === 'edit'
      ? customers.find((customer) => customer.id === editor.customerId)
      : null;

    const payload = {
      ...(editor?.mode === 'create' ? { code: toUpperCode(draft.code) } : {}),
      name: draft.name.trim(),
      address: draft.address.trim() || null,
      phone: draft.phone.trim() || null,
      email: draft.email.trim() || null,
      ...(current ? { expectedUpdatedAt: current.updated_at } : {}),
    };

    try {
      const path = current ? `/api/customers/${current.id}` : '/api/customers';
      await requestJson<Customer>(path, {
        method: current ? 'PATCH' : 'POST',
        headers: current ? undefined : { 'Idempotency-Key': `web-${crypto.randomUUID()}` },
        body: JSON.stringify(payload),
      });
      setEditor(null);
      await loadAll(current ? 'Thông tin khách hàng đã được cập nhật.' : 'Khách hàng đã được tạo.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không lưu được khách hàng');
      setBusy(null);
    }
  }

  async function confirmToggle(customerId: string) {
    const customer = customers.find((item) => item.id === customerId);
    if (!customer) return;

    setBusy('toggle');
    setError(null);
    setNotice(null);
    try {
      await requestJson<Customer>(`/api/customers/${customer.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          isActive: !customer.is_active,
          expectedUpdatedAt: customer.updated_at,
        }),
      });
      await loadAll(customer.is_active ? 'Khách hàng đã được ngừng hoạt động.' : 'Khách hàng đã được kích hoạt.');
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Không cập nhật được trạng thái khách hàng');
      setBusy(null);
    }
  }

  const shellActions = (
    <>
      <button type="button" className={shellStyles.actionButton} onClick={() => void loadAll()} disabled={busy !== null}>
        {busy === 'load' ? 'Đang cập nhật…' : 'Cập nhật dữ liệu'}
      </button>
      <button
        type="button"
        className={joinClasses(shellStyles.actionButton, shellStyles.actionButtonPrimary)}
        onClick={openCreate}
        data-testid="customers-topbar-create-button"
      >
        Thêm khách hàng
      </button>
    </>
  );

  return (
    <AppShell
      title="Khách hàng"
      subtitle="Quản lý danh mục khách hàng để phục vụ bán hàng và giao tiếp.
      "
      kicker="Quản trị hệ thống · Khách hàng"
      actions={shellActions}
    >
      <section className={styles.page} data-testid="customers-page">
        {(error || notice) ? (
          <div className={joinClasses(styles.banner, error ? styles.bannerError : styles.bannerSuccess)} role="status">
            {error ?? notice}
          </div>
        ) : null}

        <section className={styles.summaryGrid} aria-label="Số liệu khách hàng">
          <article className={styles.summaryCard}>
            <span>Tổng khách hàng</span>
            <strong>{formatCompactNumber(counts.total)}</strong>
            <small>Toàn bộ khách hàng trong installation hiện tại</small>
          </article>
          <article className={styles.summaryCard}>
            <span>Đang hoạt động</span>
            <strong>{formatCompactNumber(counts.active)}</strong>
            <small>{counts.inactive} khách hàng đã ngừng hoạt động</small>
          </article>
        </section>

        <section className={styles.toolbar}>
          <div className={styles.toolbarSearch}>
            <label htmlFor="customers-search">Tìm kiếm khách hàng</label>
            <input
              id="customers-search"
              data-testid="customers-search-input"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="Tìm theo mã, tên, địa chỉ, email hoặc điện thoại"
            />
          </div>
          <div className={styles.toolbarFilter}>
            <label htmlFor="customers-status-filter">Trạng thái</label>
            <select
              id="customers-status-filter"
              data-testid="customers-status-filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.currentTarget.value as FilterState)}
            >
              <option value="all">Tất cả</option>
              <option value="active">Đang hoạt động</option>
              <option value="inactive">Ngừng hoạt động</option>
            </select>
          </div>
        </section>

        <section className={styles.tableSection}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.panelKicker}>Danh sách khách hàng</p>
              <h2>Thông tin cơ bản</h2>
            </div>
            <span className={styles.panelChip}>{visibleCustomers.length} khách hàng</span>
          </div>

          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Tên</th>
                  <th>Địa chỉ</th>
                  <th>Liên hệ</th>
                  <th>Trạng thái</th>
                  <th>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {visibleCustomers.map((customer) => (
                  <tr key={customer.id} data-testid={`customer-row-${customer.code}`}>
                    <td>{customer.code}</td>
                    <td>{customer.name}</td>
                    <td>{customer.address || 'Chưa có'}</td>
                    <td>
                      <div>{customer.phone || '—'}</div>
                      <div>{customer.email || '—'}</div>
                    </td>
                    <td>
                      <span className={customer.is_active ? styles.toneSuccess : styles.toneDanger}>
                        {customer.is_active ? 'Đang hoạt động' : 'Ngừng hoạt động'}
                      </span>
                    </td>
                    <td className={styles.rowActions}>
                      <button type="button" data-testid={`edit-customer-${customer.code}`} onClick={() => openEdit(customer.id)}>
                        Sửa
                      </button>
                      <button type="button" data-testid={`toggle-customer-${customer.code}`} onClick={() => void confirmToggle(customer.id)}>
                        {customer.is_active ? 'Ngừng' : 'Kích hoạt'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {editor ? (
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.panelKicker}>{editor.mode === 'create' ? 'Tạo mới' : 'Chỉnh sửa'}</p>
                <h2>{editor.mode === 'create' ? 'Khách hàng mới' : 'Chỉnh sửa thông tin khách hàng'}</h2>
              </div>
            </div>

            <form onSubmit={submitCustomer} className={styles.form}>
              <div className={styles.formGrid}>
                {editor.mode === 'create' ? (
                  <label>
                    Mã khách hàng
                    <input
                      data-testid="customer-code-input"
                      value={draft.code}
                      onChange={(event) => setDraft((current) => ({ ...current, code: event.currentTarget.value }))}
                      required
                    />
                  </label>
                ) : (
                  <label>
                    Mã khách hàng
                    <input value={draft.code} disabled />
                  </label>
                )}

                <label>
                  Tên khách hàng
                  <input
                    data-testid="customer-name-input"
                    value={draft.name}
                    onChange={(event) => setDraft((current) => ({ ...current, name: event.currentTarget.value }))}
                    required
                  />
                </label>

                <label>
                  Địa chỉ
                  <input
                    data-testid="customer-address-input"
                    value={draft.address}
                    onChange={(event) => setDraft((current) => ({ ...current, address: event.currentTarget.value }))}
                  />
                </label>

                <label>
                  Điện thoại
                  <input
                    data-testid="customer-phone-input"
                    value={draft.phone}
                    onChange={(event) => setDraft((current) => ({ ...current, phone: event.currentTarget.value }))}
                  />
                </label>

                <label>
                  Email
                  <input
                    data-testid="customer-email-input"
                    value={draft.email}
                    onChange={(event) => setDraft((current) => ({ ...current, email: event.currentTarget.value }))}
                    type="email"
                  />
                </label>
              </div>

              <div className={styles.formActions}>
                <button type="button" className={styles.secondaryButton} onClick={() => setEditor(null)}>
                  Hủy
                </button>
                <button type="submit" className={styles.primaryButton} disabled={busy === 'save'}>
                  {busy === 'save' ? 'Đang lưu…' : editor.mode === 'create' ? 'Tạo khách hàng' : 'Lưu thay đổi'}
                </button>
              </div>
            </form>
          </section>
        ) : null}
      </section>
    </AppShell>
  );
}
