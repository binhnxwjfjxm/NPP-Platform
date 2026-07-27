'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/app-shell';
import shellStyles from '../components/app-shell.module.css';
import styles from '../organization/organization.module.css';
import customerStyles from './customers.module.css';
import type { Customer, CustomerAddress, CustomerGroup } from '../../lib/customer-types';
import { formatCompactNumber, matchTerm, normalizeSearch, toUpperCode } from '../../lib/organization-types';

type EmployeeOption = {
  id: string;
  code: string;
  full_name: string;
  is_active: boolean;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean };
};

type FilterState = 'all' | 'active' | 'inactive';
type Section = 'customers' | 'groups';
type CustomerEditor = { mode: 'create' | 'edit'; id: string | null } | null;
type GroupEditor = { mode: 'create' | 'edit'; id: string | null } | null;
type AddressEditor = { mode: 'create' | 'edit'; id: string | null } | null;

type CustomerDraft = {
  code: string;
  name: string;
  groupId: string;
  responsibleEmployeeId: string;
  phone: string;
  email: string;
  taxCode: string;
  paymentTermsDays: string;
  creditLimit: string;
  notes: string;
};

type GroupDraft = { code: string; name: string; description: string };
type AddressDraft = {
  label: string;
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  ward: string;
  district: string;
  province: string;
  postalCode: string;
  countryCode: string;
  isDefault: boolean;
};

type Props = {
  initialCustomers: Customer[];
  initialGroups: CustomerGroup[];
  initialError?: string | null;
};

class UiRequestError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function emptyCustomerDraft(): CustomerDraft {
  return {
    code: '',
    name: '',
    groupId: '',
    responsibleEmployeeId: '',
    phone: '',
    email: '',
    taxCode: '',
    paymentTermsDays: '0',
    creditLimit: '0',
    notes: '',
  };
}

function emptyGroupDraft(): GroupDraft {
  return { code: '', name: '', description: '' };
}

function emptyAddressDraft(): AddressDraft {
  return {
    label: '',
    recipientName: '',
    phone: '',
    addressLine1: '',
    addressLine2: '',
    ward: '',
    district: '',
    province: '',
    postalCode: '',
    countryCode: 'VN',
    isDefault: false,
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
    throw new UiRequestError(payload.error?.code || 'REQUEST_FAILED', payload.error?.message || 'Không thể kết nối dịch vụ khách hàng');
  }
  return payload.data;
}

function money(value: string) {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 2 }).format(number)
    : value;
}

export default function CustomerWorkspace({ initialCustomers, initialGroups, initialError = null }: Props) {
  const [customers, setCustomers] = useState(initialCustomers);
  const [groups, setGroups] = useState(initialGroups);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [section, setSection] = useState<Section>('customers');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterState>('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [customerEditor, setCustomerEditor] = useState<CustomerEditor>(null);
  const [groupEditor, setGroupEditor] = useState<GroupEditor>(null);
  const [addressEditor, setAddressEditor] = useState<AddressEditor>(null);
  const [addressCustomerId, setAddressCustomerId] = useState<string | null>(null);
  const [customerDraft, setCustomerDraft] = useState<CustomerDraft>(emptyCustomerDraft());
  const [groupDraft, setGroupDraft] = useState<GroupDraft>(emptyGroupDraft());
  const [addressDraft, setAddressDraft] = useState<AddressDraft>(emptyAddressDraft());

  const normalizedSearch = normalizeSearch(search);
  const visibleCustomers = useMemo(() => customers
    .filter((customer) => {
      const statusMatches = statusFilter === 'all' || (statusFilter === 'active' ? customer.is_active : !customer.is_active);
      const groupMatches = groupFilter === 'all' || customer.group_id === groupFilter;
      const textMatches = !normalizedSearch || matchTerm(
        customer.code,
        customer.name,
        customer.phone,
        customer.email,
        customer.tax_code,
        customer.group_name,
        customer.responsible_employee_name,
      ).includes(normalizedSearch);
      return statusMatches && groupMatches && textMatches;
    })
    .sort((left, right) => left.code.localeCompare(right.code)), [customers, groupFilter, normalizedSearch, statusFilter]);

  const counts = useMemo(() => {
    const active = customers.filter((customer) => customer.is_active).length;
    return { total: customers.length, active, inactive: customers.length - active };
  }, [customers]);

  const addressCustomer = addressCustomerId ? customers.find((customer) => customer.id === addressCustomerId) ?? null : null;

  async function loadAll(message?: string) {
    setBusy('load');
    setError(null);
    setNotice(null);
    try {
      const [nextCustomers, nextGroups, nextEmployees] = await Promise.all([
        requestJson<Customer[]>('/api/customers?limit=1000'),
        requestJson<CustomerGroup[]>('/api/customer-groups?limit=1000'),
        requestJson<EmployeeOption[]>('/api/access/employees?active=true&limit=1000'),
      ]);
      setCustomers(nextCustomers);
      setGroups(nextGroups);
      setEmployees(nextEmployees);
      if (message) setNotice(message);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được dữ liệu khách hàng');
    } finally {
      setBusy(null);
    }
  }

  async function loadAddresses(customerId: string) {
    setBusy('addresses');
    setError(null);
    try {
      setAddresses(await requestJson<CustomerAddress[]>(`/api/customers/${customerId}/addresses`));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được địa chỉ khách hàng');
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void requestJson<EmployeeOption[]>('/api/access/employees?active=true&limit=1000')
      .then(setEmployees)
      .catch(() => setEmployees([]));
  }, []);

  async function handleFailure(failure: unknown, reload?: () => Promise<void>) {
    const nextError = failure instanceof UiRequestError ? failure : new UiRequestError('REQUEST_FAILED', failure instanceof Error ? failure.message : 'Yêu cầu không thành công');
    if (nextError.code === 'CONFLICT' && reload) {
      await reload();
      setError('Dữ liệu đã thay đổi ở nơi khác. Danh sách đã được tải lại, anh vui lòng kiểm tra rồi thao tác lại.');
    } else {
      setError(nextError.message);
    }
  }

  function openCustomerCreate() {
    setCustomerDraft(emptyCustomerDraft());
    setCustomerEditor({ mode: 'create', id: null });
  }

  function openCustomerEdit(customer: Customer) {
    setCustomerDraft({
      code: customer.code,
      name: customer.name,
      groupId: customer.group_id ?? '',
      responsibleEmployeeId: customer.responsible_employee_id ?? '',
      phone: customer.phone ?? '',
      email: customer.email ?? '',
      taxCode: customer.tax_code ?? '',
      paymentTermsDays: String(customer.payment_terms_days),
      creditLimit: customer.credit_limit,
      notes: customer.notes ?? '',
    });
    setCustomerEditor({ mode: 'edit', id: customer.id });
  }

  async function submitCustomer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = customerEditor?.mode === 'edit' ? customers.find((item) => item.id === customerEditor.id) : null;
    setBusy('save-customer');
    setError(null);
    try {
      await requestJson<Customer>(current ? `/api/customers/${current.id}` : '/api/customers', {
        method: current ? 'PATCH' : 'POST',
        headers: current ? undefined : { 'Idempotency-Key': `web-${crypto.randomUUID()}` },
        body: JSON.stringify({
          ...(current ? {} : { code: toUpperCode(customerDraft.code) }),
          name: customerDraft.name.trim(),
          groupId: customerDraft.groupId || null,
          responsibleEmployeeId: customerDraft.responsibleEmployeeId || null,
          phone: customerDraft.phone.trim() || null,
          email: customerDraft.email.trim() || null,
          taxCode: customerDraft.taxCode.trim() || null,
          paymentTermsDays: Number(customerDraft.paymentTermsDays),
          creditLimit: customerDraft.creditLimit.trim() || '0',
          notes: customerDraft.notes.trim() || null,
          ...(current ? { expectedUpdatedAt: current.updated_at } : {}),
        }),
      });
      setCustomerEditor(null);
      await loadAll(current ? 'Thông tin khách hàng đã được cập nhật.' : 'Khách hàng đã được tạo.');
    } catch (failure) {
      await handleFailure(failure, () => loadAll());
      setBusy(null);
    }
  }

  async function toggleCustomer(customer: Customer) {
    setBusy(`customer-${customer.id}`);
    setError(null);
    try {
      await requestJson<Customer>(`/api/customers/${customer.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !customer.is_active, expectedUpdatedAt: customer.updated_at }),
      });
      await loadAll(customer.is_active ? 'Khách hàng đã được ngừng hoạt động.' : 'Khách hàng đã được kích hoạt.');
    } catch (failure) {
      await handleFailure(failure, () => loadAll());
      setBusy(null);
    }
  }

  function openGroupCreate() {
    setGroupDraft(emptyGroupDraft());
    setGroupEditor({ mode: 'create', id: null });
  }

  function openGroupEdit(group: CustomerGroup) {
    setGroupDraft({ code: group.code, name: group.name, description: group.description ?? '' });
    setGroupEditor({ mode: 'edit', id: group.id });
  }

  async function submitGroup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = groupEditor?.mode === 'edit' ? groups.find((item) => item.id === groupEditor.id) : null;
    setBusy('save-group');
    setError(null);
    try {
      await requestJson<CustomerGroup>(current ? `/api/customer-groups/${current.id}` : '/api/customer-groups', {
        method: current ? 'PATCH' : 'POST',
        headers: current ? undefined : { 'Idempotency-Key': `web-${crypto.randomUUID()}` },
        body: JSON.stringify({
          ...(current ? {} : { code: toUpperCode(groupDraft.code) }),
          name: groupDraft.name.trim(),
          description: groupDraft.description.trim() || null,
          ...(current ? { expectedUpdatedAt: current.updated_at } : {}),
        }),
      });
      setGroupEditor(null);
      await loadAll(current ? 'Nhóm khách hàng đã được cập nhật.' : 'Nhóm khách hàng đã được tạo.');
    } catch (failure) {
      await handleFailure(failure, () => loadAll());
      setBusy(null);
    }
  }

  async function toggleGroup(group: CustomerGroup) {
    setBusy(`group-${group.id}`);
    setError(null);
    try {
      await requestJson<CustomerGroup>(`/api/customer-groups/${group.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !group.is_active, expectedUpdatedAt: group.updated_at }),
      });
      await loadAll(group.is_active ? 'Nhóm khách hàng đã được ngừng hoạt động.' : 'Nhóm khách hàng đã được kích hoạt.');
    } catch (failure) {
      await handleFailure(failure, () => loadAll());
      setBusy(null);
    }
  }

  async function openAddresses(customer: Customer) {
    setAddressCustomerId(customer.id);
    setAddressEditor(null);
    setAddressDraft(emptyAddressDraft());
    await loadAddresses(customer.id);
  }

  function openAddressCreate() {
    setAddressDraft(emptyAddressDraft());
    setAddressEditor({ mode: 'create', id: null });
  }

  function openAddressEdit(address: CustomerAddress) {
    setAddressDraft({
      label: address.label,
      recipientName: address.recipient_name ?? '',
      phone: address.phone ?? '',
      addressLine1: address.address_line1,
      addressLine2: address.address_line2 ?? '',
      ward: address.ward ?? '',
      district: address.district ?? '',
      province: address.province ?? '',
      postalCode: address.postal_code ?? '',
      countryCode: address.country_code,
      isDefault: address.is_default,
    });
    setAddressEditor({ mode: 'edit', id: address.id });
  }

  async function submitAddress(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!addressCustomerId) return;
    const current = addressEditor?.mode === 'edit' ? addresses.find((item) => item.id === addressEditor.id) : null;
    setBusy('save-address');
    setError(null);
    try {
      await requestJson<CustomerAddress>(
        current
          ? `/api/customers/${addressCustomerId}/addresses/${current.id}`
          : `/api/customers/${addressCustomerId}/addresses`,
        {
          method: current ? 'PATCH' : 'POST',
          headers: current ? undefined : { 'Idempotency-Key': `web-${crypto.randomUUID()}` },
          body: JSON.stringify({
            label: addressDraft.label.trim(),
            recipientName: addressDraft.recipientName.trim() || null,
            phone: addressDraft.phone.trim() || null,
            addressLine1: addressDraft.addressLine1.trim(),
            addressLine2: addressDraft.addressLine2.trim() || null,
            ward: addressDraft.ward.trim() || null,
            district: addressDraft.district.trim() || null,
            province: addressDraft.province.trim() || null,
            postalCode: addressDraft.postalCode.trim() || null,
            countryCode: addressDraft.countryCode.trim().toUpperCase() || 'VN',
            isDefault: addressDraft.isDefault,
            ...(current ? { expectedUpdatedAt: current.updated_at } : {}),
          }),
        },
      );
      setAddressEditor(null);
      await loadAddresses(addressCustomerId);
      setNotice(current ? 'Địa chỉ đã được cập nhật.' : 'Địa chỉ đã được thêm.');
    } catch (failure) {
      await handleFailure(failure, () => loadAddresses(addressCustomerId));
      setBusy(null);
    }
  }

  async function patchAddress(address: CustomerAddress, body: Record<string, unknown>, message: string) {
    if (!addressCustomerId) return;
    setBusy(`address-${address.id}`);
    setError(null);
    try {
      await requestJson<CustomerAddress>(`/api/customers/${addressCustomerId}/addresses/${address.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...body, expectedUpdatedAt: address.updated_at }),
      });
      await loadAddresses(addressCustomerId);
      setNotice(message);
    } catch (failure) {
      await handleFailure(failure, () => loadAddresses(addressCustomerId));
      setBusy(null);
    }
  }

  const shellActions = (
    <>
      <button
        type="button"
        className={joinClasses(shellStyles.actionButton, customerStyles.disabled, busy === 'load' && customerStyles.loading)}
        onClick={() => void loadAll('Dữ liệu đã được cập nhật.')}
        disabled={busy !== null}
      >
        {busy === 'load' ? 'Đang cập nhật…' : 'Cập nhật dữ liệu'}
      </button>
      <button
        type="button"
        className={joinClasses(shellStyles.actionButton, shellStyles.actionButtonPrimary)}
        onClick={section === 'customers' ? openCustomerCreate : openGroupCreate}
        data-testid={section === 'customers' ? 'customers-topbar-create-button' : 'customer-groups-topbar-create-button'}
      >
        {section === 'customers' ? 'Thêm khách hàng' : 'Thêm nhóm'}
      </button>
    </>
  );

  return (
    <AppShell
      title="Khách hàng"
      subtitle="Quản lý nhóm, hồ sơ khách hàng, điều khoản thanh toán, hạn mức và địa chỉ giao dịch."
      kicker="NPP Core · Dữ liệu nền"
      actions={shellActions}
    >
      <section className={styles.page} data-testid="customers-page">
        {(error || notice) ? (
          <div className={joinClasses(styles.banner, error ? styles.bannerError : styles.bannerSuccess)} role="status">
            {error ?? notice}
          </div>
        ) : null}

        <div className={customerStyles.sectionTabs} aria-label="Khu vực quản lý">
          <button type="button" aria-pressed={section === 'customers'} onClick={() => setSection('customers')}>Khách hàng</button>
          <button type="button" aria-pressed={section === 'groups'} onClick={() => setSection('groups')}>Nhóm khách hàng</button>
        </div>

        {section === 'customers' ? (
          <>
            <section className={styles.summaryGrid} aria-label="Số liệu khách hàng">
              <article className={styles.summaryCard}><span>Tổng khách hàng</span><strong>{formatCompactNumber(counts.total)}</strong><small>Toàn bộ hồ sơ hiện có</small></article>
              <article className={styles.summaryCard}><span>Đang hoạt động</span><strong>{formatCompactNumber(counts.active)}</strong><small>Sẵn sàng sử dụng nghiệp vụ</small></article>
              <article className={styles.summaryCard}><span>Không hoạt động</span><strong>{formatCompactNumber(counts.inactive)}</strong><small>Được giữ lại, không xóa cứng</small></article>
            </section>

            <section className={joinClasses(styles.toolbar, customerStyles.toolbarGrid)}>
              <div className={styles.toolbarSearch}>
                <label htmlFor="customers-search">Tìm kiếm khách hàng</label>
                <input id="customers-search" data-testid="customers-search-input" type="search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Mã, tên, điện thoại, mã số thuế" />
              </div>
              <div className={styles.toolbarFilter}>
                <label htmlFor="customers-status-filter">Trạng thái</label>
                <select id="customers-status-filter" data-testid="customers-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value as FilterState)}>
                  <option value="all">Tất cả</option><option value="active">Đang hoạt động</option><option value="inactive">Không hoạt động</option>
                </select>
              </div>
              <div className={styles.toolbarFilter}>
                <label htmlFor="customers-group-filter">Nhóm khách hàng</label>
                <select id="customers-group-filter" data-testid="customers-group-filter" value={groupFilter} onChange={(event) => setGroupFilter(event.currentTarget.value)}>
                  <option value="all">Tất cả nhóm</option>
                  {groups.map((group) => <option key={group.id} value={group.id}>{group.code} · {group.name}</option>)}
                </select>
              </div>
            </section>

            <section className={styles.tableSection}>
              <div className={styles.panelHeader}><div><p className={styles.panelKicker}>Danh sách</p><h2>Khách hàng</h2></div><span className={styles.panelChip}>{visibleCustomers.length} khách hàng</span></div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Mã / tên</th><th>Nhóm / phụ trách</th><th>Liên hệ</th><th>Thanh toán</th><th>Trạng thái</th><th>Hành động</th></tr></thead>
                  <tbody>
                    {visibleCustomers.map((customer) => (
                      <tr key={customer.id} data-testid={`customer-row-${customer.code}`}>
                        <td><div className={styles.entityStack}><strong className={customerStyles.code}>{customer.code}</strong><span>{customer.name}</span><span>{customer.tax_code || 'Chưa có mã số thuế'}</span></div></td>
                        <td><div className={styles.entityStack}><strong>{customer.group_name || 'Chưa phân nhóm'}</strong><span>{customer.responsible_employee_name || 'Chưa giao phụ trách'}</span></div></td>
                        <td><div className={styles.entityStack}><strong>{customer.phone || '—'}</strong><span>{customer.email || '—'}</span></div></td>
                        <td><div className={styles.entityStack}><strong>{money(customer.credit_limit)}</strong><span>{customer.payment_terms_days} ngày · Hạn mức không phải công nợ</span></div></td>
                        <td><span className={joinClasses(styles.statusPill, customer.is_active ? styles.toneSuccess : styles.toneDanger)}>{customer.is_active ? 'Đang hoạt động' : 'Không hoạt động'}</span></td>
                        <td className={styles.rowActions}>
                          <button type="button" data-testid={`edit-customer-${customer.code}`} onClick={() => openCustomerEdit(customer)}>Sửa</button>
                          <button type="button" data-testid={`addresses-customer-${customer.code}`} onClick={() => void openAddresses(customer)}>Địa chỉ</button>
                          <button type="button" className={joinClasses(customerStyles.disabled, busy === `customer-${customer.id}` && customerStyles.loading)} disabled={busy !== null} onClick={() => void toggleCustomer(customer)}>{customer.is_active ? 'Ngừng' : 'Kích hoạt'}</button>
                        </td>
                      </tr>
                    ))}
                    {visibleCustomers.length === 0 ? <tr><td colSpan={6} className={customerStyles.empty}>Không có khách hàng phù hợp.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : (
          <section className={styles.tableSection} data-testid="customer-groups-page">
            <div className={styles.panelHeader}><div><p className={styles.panelKicker}>Phân loại</p><h2>Nhóm khách hàng</h2></div><span className={styles.panelChip}>{groups.length} nhóm</span></div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Mã</th><th>Tên</th><th>Mô tả</th><th>Trạng thái</th><th>Hành động</th></tr></thead>
                <tbody>
                  {groups.map((group) => (
                    <tr key={group.id} data-testid={`customer-group-row-${group.code}`}>
                      <td className={customerStyles.code}>{group.code}</td><td>{group.name}</td><td>{group.description || '—'}</td>
                      <td><span className={joinClasses(styles.statusPill, group.is_active ? styles.toneSuccess : styles.toneDanger)}>{group.is_active ? 'Đang hoạt động' : 'Không hoạt động'}</span></td>
                      <td className={styles.rowActions}>
                        <button type="button" onClick={() => openGroupEdit(group)}>Sửa</button>
                        <button type="button" className={joinClasses(customerStyles.disabled, busy === `group-${group.id}` && customerStyles.loading)} disabled={busy !== null} onClick={() => void toggleGroup(group)}>{group.is_active ? 'Ngừng' : 'Kích hoạt'}</button>
                      </td>
                    </tr>
                  ))}
                  {groups.length === 0 ? <tr><td colSpan={5} className={customerStyles.empty}>Chưa có nhóm khách hàng.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {customerEditor ? (
          <div className={styles.modalBackdrop} role="presentation">
            <section className={joinClasses(styles.modal, customerStyles.modalWide)} role="dialog" aria-modal="true" aria-label="Biểu mẫu khách hàng">
              <div className={styles.modalHeader}><h3>{customerEditor.mode === 'create' ? 'Thêm khách hàng' : 'Sửa khách hàng'}</h3><button type="button" className={styles.modalClose} onClick={() => setCustomerEditor(null)}>Đóng</button></div>
              <form className={styles.form} onSubmit={submitCustomer}>
                <div className={customerStyles.formGrid}>
                  <label>Mã khách hàng<input data-testid="customer-code-input" value={customerDraft.code} onChange={(event) => { const next = event.currentTarget.value; setCustomerDraft((value) => ({ ...value, code: next })); }} disabled={customerEditor.mode === 'edit'} required /></label>
                  <label>Tên khách hàng<input data-testid="customer-name-input" value={customerDraft.name} onChange={(event) => { const next = event.currentTarget.value; setCustomerDraft((value) => ({ ...value, name: next })); }} required /></label>
                  <label>Nhóm khách hàng<select value={customerDraft.groupId} onChange={(event) => { const next = event.currentTarget.value; setCustomerDraft((value) => ({ ...value, groupId: next })); }}><option value="">Không phân nhóm</option>{groups.filter((group) => group.is_active || group.id === customerDraft.groupId).map((group) => <option key={group.id} value={group.id}>{group.code} · {group.name}</option>)}</select></label>
                  <label>Nhân sự phụ trách<select value={customerDraft.responsibleEmployeeId} onChange={(event) => { const next = event.currentTarget.value; setCustomerDraft((value) => ({ ...value, responsibleEmployeeId: next })); }}><option value="">Chưa giao phụ trách</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.code} · {employee.full_name}</option>)}</select></label>
                  <label>Điện thoại<input data-testid="customer-phone-input" value={customerDraft.phone} onChange={(event) => { const next = event.currentTarget.value; setCustomerDraft((value) => ({ ...value, phone: next })); }} /></label>
                  <label>Email<input data-testid="customer-email-input" type="email" value={customerDraft.email} onChange={(event) => { const next = event.currentTarget.value; setCustomerDraft((value) => ({ ...value, email: next })); }} /></label>
                  <label>Mã số thuế<input value={customerDraft.taxCode} onChange={(event) => { const next = event.currentTarget.value; setCustomerDraft((value) => ({ ...value, taxCode: next })); }} /></label>
                  <label>Thời hạn thanh toán (ngày)<input type="number" min="0" max="3650" value={customerDraft.paymentTermsDays} onChange={(event) => { const next = event.currentTarget.value; setCustomerDraft((value) => ({ ...value, paymentTermsDays: next })); }} /></label>
                  <label>Hạn mức tín dụng<input type="number" min="0" step="0.01" value={customerDraft.creditLimit} onChange={(event) => { const next = event.currentTarget.value; setCustomerDraft((value) => ({ ...value, creditLimit: next })); }} /></label>
                  <label className={customerStyles.fullWidth}>Ghi chú<textarea value={customerDraft.notes} onChange={(event) => { const next = event.currentTarget.value; setCustomerDraft((value) => ({ ...value, notes: next })); }} /></label>
                </div>
                <div className={styles.formActions}><button type="button" className={styles.secondaryButton} onClick={() => setCustomerEditor(null)}>Hủy</button><button type="submit" className={joinClasses(styles.primaryButton, customerStyles.disabled, busy === 'save-customer' && customerStyles.loading)} disabled={busy !== null}>{busy === 'save-customer' ? 'Đang lưu…' : 'Lưu khách hàng'}</button></div>
              </form>
            </section>
          </div>
        ) : null}

        {groupEditor ? (
          <div className={styles.modalBackdrop} role="presentation">
            <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Biểu mẫu nhóm khách hàng">
              <div className={styles.modalHeader}><h3>{groupEditor.mode === 'create' ? 'Thêm nhóm khách hàng' : 'Sửa nhóm khách hàng'}</h3><button type="button" className={styles.modalClose} onClick={() => setGroupEditor(null)}>Đóng</button></div>
              <form className={styles.form} onSubmit={submitGroup}>
                <div className={customerStyles.formGrid}>
                  <label>Mã nhóm<input data-testid="customer-group-code-input" value={groupDraft.code} onChange={(event) => { const next = event.currentTarget.value; setGroupDraft((value) => ({ ...value, code: next })); }} disabled={groupEditor.mode === 'edit'} required /></label>
                  <label>Tên nhóm<input data-testid="customer-group-name-input" value={groupDraft.name} onChange={(event) => { const next = event.currentTarget.value; setGroupDraft((value) => ({ ...value, name: next })); }} required /></label>
                  <label className={customerStyles.fullWidth}>Mô tả<textarea value={groupDraft.description} onChange={(event) => { const next = event.currentTarget.value; setGroupDraft((value) => ({ ...value, description: next })); }} /></label>
                </div>
                <div className={styles.formActions}><button type="button" className={styles.secondaryButton} onClick={() => setGroupEditor(null)}>Hủy</button><button type="submit" className={joinClasses(styles.primaryButton, customerStyles.disabled, busy === 'save-group' && customerStyles.loading)} disabled={busy !== null}>{busy === 'save-group' ? 'Đang lưu…' : 'Lưu nhóm'}</button></div>
              </form>
            </section>
          </div>
        ) : null}

        {addressCustomer ? (
          <div className={styles.modalBackdrop} role="presentation">
            <section className={joinClasses(styles.modal, customerStyles.modalWide)} role="dialog" aria-modal="true" aria-label="Quản lý địa chỉ khách hàng">
              <div className={styles.modalHeader}><div><p className={styles.panelKicker}>{addressCustomer.code}</p><h3>Địa chỉ · {addressCustomer.name}</h3></div><button type="button" className={styles.modalClose} onClick={() => { setAddressCustomerId(null); setAddressEditor(null); }}>Đóng</button></div>
              <div className={customerStyles.splitGrid}>
                <div>
                  <div className={styles.panelHeader}><h2>Địa chỉ đã lưu</h2><button type="button" className={styles.primaryButton} onClick={openAddressCreate} disabled={!addressCustomer.is_active} title={addressCustomer.is_active ? undefined : 'Không thể thêm địa chỉ cho khách hàng không hoạt động'}>Thêm địa chỉ</button></div>
                  <div className={customerStyles.addressList}>
                    {addresses.map((address) => (
                      <article key={address.id} className={customerStyles.addressCard}>
                        <div className={customerStyles.addressHeader}><strong>{address.label}{address.is_default ? ' · Mặc định' : ''}</strong><span className={joinClasses(styles.statusPill, address.is_active ? styles.toneSuccess : styles.toneDanger)}>{address.is_active ? 'Hoạt động' : 'Ngừng'}</span></div>
                        <div className={customerStyles.addressMeta}>{[address.address_line1, address.address_line2, address.ward, address.district, address.province].filter(Boolean).join(', ')}</div>
                        <div className={styles.rowActions}><button type="button" onClick={() => openAddressEdit(address)}>Sửa</button>{!address.is_default && address.is_active ? <button type="button" onClick={() => void patchAddress(address, { isDefault: true }, 'Đã đặt địa chỉ mặc định.')}>Đặt mặc định</button> : null}<button type="button" onClick={() => void patchAddress(address, { isActive: !address.is_active }, address.is_active ? 'Địa chỉ đã ngừng hoạt động.' : 'Địa chỉ đã được kích hoạt.')}>{address.is_active ? 'Ngừng' : 'Kích hoạt'}</button></div>
                      </article>
                    ))}
                    {addresses.length === 0 ? <div className={customerStyles.empty}>Chưa có địa chỉ.</div> : null}
                  </div>
                </div>
                <div>
                  {addressEditor ? (
                    <form className={styles.form} onSubmit={submitAddress}>
                      <div className={customerStyles.formGrid}>
                        <label>Nhãn địa chỉ<input data-testid="customer-address-label-input" value={addressDraft.label} onChange={(event) => { const next = event.currentTarget.value; setAddressDraft((value) => ({ ...value, label: next })); }} required /></label>
                        <label>Người nhận<input value={addressDraft.recipientName} onChange={(event) => { const next = event.currentTarget.value; setAddressDraft((value) => ({ ...value, recipientName: next })); }} /></label>
                        <label>Điện thoại<input value={addressDraft.phone} onChange={(event) => { const next = event.currentTarget.value; setAddressDraft((value) => ({ ...value, phone: next })); }} /></label>
                        <label>Quốc gia<input value={addressDraft.countryCode} maxLength={2} onChange={(event) => { const next = event.currentTarget.value; setAddressDraft((value) => ({ ...value, countryCode: next })); }} /></label>
                        <label className={customerStyles.fullWidth}>Địa chỉ dòng 1<input data-testid="customer-address-line1-input" value={addressDraft.addressLine1} onChange={(event) => { const next = event.currentTarget.value; setAddressDraft((value) => ({ ...value, addressLine1: next })); }} required /></label>
                        <label className={customerStyles.fullWidth}>Địa chỉ dòng 2<input value={addressDraft.addressLine2} onChange={(event) => { const next = event.currentTarget.value; setAddressDraft((value) => ({ ...value, addressLine2: next })); }} /></label>
                        <label>Phường/xã<input value={addressDraft.ward} onChange={(event) => { const next = event.currentTarget.value; setAddressDraft((value) => ({ ...value, ward: next })); }} /></label>
                        <label>Quận/huyện<input value={addressDraft.district} onChange={(event) => { const next = event.currentTarget.value; setAddressDraft((value) => ({ ...value, district: next })); }} /></label>
                        <label>Tỉnh/thành<input value={addressDraft.province} onChange={(event) => { const next = event.currentTarget.value; setAddressDraft((value) => ({ ...value, province: next })); }} /></label>
                        <label>Mã bưu chính<input value={addressDraft.postalCode} onChange={(event) => { const next = event.currentTarget.value; setAddressDraft((value) => ({ ...value, postalCode: next })); }} /></label>
                        <label className={joinClasses(customerStyles.inlineCheck, customerStyles.fullWidth)}><input type="checkbox" checked={addressDraft.isDefault} onChange={(event) => { const next = event.currentTarget.checked; setAddressDraft((value) => ({ ...value, isDefault: next })); }} />Đặt làm địa chỉ mặc định</label>
                      </div>
                      <div className={styles.formActions}><button type="button" className={styles.secondaryButton} onClick={() => setAddressEditor(null)}>Hủy</button><button type="submit" className={joinClasses(styles.primaryButton, customerStyles.disabled, busy === 'save-address' && customerStyles.loading)} disabled={busy !== null}>{busy === 'save-address' ? 'Đang lưu…' : 'Lưu địa chỉ'}</button></div>
                    </form>
                  ) : <div className={customerStyles.empty}>Chọn “Thêm địa chỉ” hoặc “Sửa” để nhập thông tin.</div>}
                </div>
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
