/* eslint-disable @next/next/no-img-element */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createIdempotencyKey } from '@npp/contracts';
import {
  CUSTOMER_MEDIA_MAX_PHOTOS,
  compressCustomerPhoto,
} from '@npp/contracts/customer-media-browser';
import type { Customer, CustomerAddress, CustomerGroup } from '../../lib/customer-types';
import VietnamAdministrativeFields from './vietnam-administrative-fields';
import styles from './customer-quick-setup.module.css';

type EmployeeOption = {
  id: string;
  code: string;
  full_name: string;
  is_active: boolean;
};

type ProvinceOption = {
  code: string;
  name: string;
  shortName: string;
  placeType: string;
};

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

type AddressDraft = {
  label: string;
  recipientName: string;
  phone: string;
  locationUrl: string;
  addressLine1: string;
  addressLine2: string;
  ward: string;
  district: string;
  province: string;
  postalCode: string;
  countryCode: string;
  isDefault: boolean;
  isActive: boolean;
};

type CustomerMedia = {
  id: string;
  customerId: string;
  sourceApp: 'CORE' | 'MCP';
  capturedAt: string | null;
  viewUrl: string | null;
};

type MediaList = { media: CustomerMedia[]; maxPhotos: number };
type PrepareResult = { mediaId: string; putUrl: string; mimeType: string; expiresIn: number };
type ApiEnvelope<T> = { data?: T; error?: { message?: string; code?: string } };

type ReferenceEnvelope = {
  data?: { provinces?: ProvinceOption[] };
  error?: { message?: string };
};

const EMPTY_CUSTOMER: CustomerDraft = {
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

const EMPTY_ADDRESS: AddressDraft = {
  label: '',
  recipientName: '',
  phone: '',
  locationUrl: '',
  addressLine1: '',
  addressLine2: '',
  ward: '',
  district: '',
  province: '',
  postalCode: '',
  countryCode: 'VN',
  isDefault: false,
  isActive: true,
};

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
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message || 'Yêu cầu không thành công.');
  }
  return payload.data;
}

function customerToDraft(customer: Customer): CustomerDraft {
  return {
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
  };
}

function addressToDraft(address: CustomerAddress): AddressDraft {
  return {
    label: address.label,
    recipientName: address.recipient_name ?? '',
    phone: address.phone ?? '',
    locationUrl: address.location_url ?? '',
    addressLine1: address.address_line1,
    addressLine2: address.address_line2 ?? '',
    ward: address.ward ?? '',
    district: address.district ?? '',
    province: address.province ?? '',
    postalCode: address.postal_code ?? '',
    countryCode: address.country_code || 'VN',
    isDefault: address.is_default,
    isActive: address.is_active,
  };
}

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase('vi');
}

function locationUrlError(value: string) {
  const normalized = value.trim();
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
      return 'Link định vị phải là URL HTTPS hợp lệ.';
    }
  } catch {
    return 'Link định vị phải là URL HTTPS hợp lệ.';
  }
  return null;
}

export default function CustomerQuickSetupWorkspace() {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const customerCreateKey = useRef('');
  const addressCreateKey = useRef('');
  const mediaUploadKeys = useRef(new Map<string, { clientUploadId: string; prepareKey: string; finalizeKey: string }>());
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [groups, setGroups] = useState<CustomerGroup[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [provinces, setProvinces] = useState<ProvinceOption[]>([]);
  const [search, setSearch] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [customerDraft, setCustomerDraft] = useState<CustomerDraft>(EMPTY_CUSTOMER);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [addressId, setAddressId] = useState('');
  const [creatingAddress, setCreatingAddress] = useState(false);
  const [addressDraft, setAddressDraft] = useState<AddressDraft>(EMPTY_ADDRESS);
  const [media, setMedia] = useState<CustomerMedia[]>([]);
  const [maxPhotos, setMaxPhotos] = useState(CUSTOMER_MEDIA_MAX_PHOTOS);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>('initial');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedCustomer = customers.find((item) => item.id === customerId) ?? null;
  const selectedAddress = addresses.find((item) => item.id === addressId) ?? null;
  const visibleCustomers = useMemo(() => {
    const term = normalizeSearch(search);
    if (!term) return customers;
    return customers.filter((item) => [item.name, item.code, item.phone, item.group_name, item.responsible_employee_name]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase('vi').includes(term)));
  }, [customers, search]);

  function clearFeedback() {
    setError(null);
    setNotice(null);
  }

  async function loadAddresses(nextCustomerId: string) {
    const next = await requestJson<CustomerAddress[]>(`/api/customers/${nextCustomerId}/addresses`);
    setAddresses(next);
    const preferred = next.find((item) => item.is_default && item.is_active) ?? next[0] ?? null;
    setAddressId(preferred?.id ?? '');
    setCreatingAddress(false);
    setAddressDraft(preferred ? addressToDraft(preferred) : EMPTY_ADDRESS);
  }

  async function loadMedia(nextCustomerId: string) {
    const result = await requestJson<MediaList>(`/api/customers/${nextCustomerId}/media`);
    setMedia(result.media.slice(0, result.maxPhotos || CUSTOMER_MEDIA_MAX_PHOTOS));
    setMaxPhotos(result.maxPhotos || CUSTOMER_MEDIA_MAX_PHOTOS);
  }

  async function loadSideData(nextCustomerId: string) {
    setBusy('side');
    try {
      await Promise.all([loadAddresses(nextCustomerId), loadMedia(nextCustomerId)]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không tải được chi tiết khách hàng.');
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      requestJson<Customer[]>('/api/customers?limit=1000'),
      requestJson<CustomerGroup[]>('/api/customer-groups?limit=1000'),
      requestJson<EmployeeOption[]>('/api/access/employees?limit=1000'),
      fetch('/api/reference/vietnam-administrative-units', { cache: 'force-cache' })
        .then(async (response) => {
          const payload = await response.json().catch(() => ({})) as ReferenceEnvelope;
          if (!response.ok || !payload.data) throw new Error(payload.error?.message || 'Không tải được tỉnh/thành');
          return payload.data.provinces ?? [];
        }),
    ])
      .then(([nextCustomers, nextGroups, nextEmployees, nextProvinces]) => {
        if (cancelled) return;
        setCustomers(nextCustomers);
        setGroups(nextGroups);
        setEmployees(nextEmployees);
        setProvinces(nextProvinces);
        setBusy(null);
      })
      .catch((caught) => {
        if (cancelled) return;
        setBusy(null);
        setError(caught instanceof Error ? caught.message : 'Không tải được dữ liệu khách hàng.');
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedCustomer || creatingCustomer) return;
    setCustomerDraft(customerToDraft(selectedCustomer));
  }, [selectedCustomer?.id, selectedCustomer?.updated_at, creatingCustomer]);

  function chooseCustomer(nextCustomerId: string) {
    clearFeedback();
    setCreatingCustomer(false);
    setCustomerId(nextCustomerId);
    const next = customers.find((item) => item.id === nextCustomerId) ?? null;
    setCustomerDraft(next ? customerToDraft(next) : EMPTY_CUSTOMER);
    setAddresses([]);
    setAddressId('');
    setCreatingAddress(false);
    setAddressDraft(EMPTY_ADDRESS);
    setMedia([]);
    if (nextCustomerId) void loadSideData(nextCustomerId);
  }

  function startCustomerCreate() {
    clearFeedback();
    customerCreateKey.current = createIdempotencyKey('customer.quick.create');
    setCreatingCustomer(true);
    setCustomerId('');
    setCustomerDraft(EMPTY_CUSTOMER);
    setAddresses([]);
    setAddressId('');
    setCreatingAddress(false);
    setAddressDraft(EMPTY_ADDRESS);
    setMedia([]);
  }

  async function saveCustomer() {
    clearFeedback();
    if (!customerDraft.code.trim() || !customerDraft.name.trim()) {
      setError('Cần nhập mã khách hàng và tên khách hàng.');
      return;
    }
    const paymentTermsDays = Number(customerDraft.paymentTermsDays || 0);
    if (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0) {
      setError('Thời hạn thanh toán phải là số ngày hợp lệ.');
      return;
    }

    setBusy('customer');
    try {
      const commonBody = {
        name: customerDraft.name.trim(),
        groupId: customerDraft.groupId || null,
        responsibleEmployeeId: customerDraft.responsibleEmployeeId || null,
        phone: customerDraft.phone.trim() || null,
        email: customerDraft.email.trim() || null,
        taxCode: customerDraft.taxCode.trim() || null,
        paymentTermsDays,
        creditLimit: customerDraft.creditLimit.trim() || '0',
        notes: customerDraft.notes.trim() || null,
      };
      const saved = selectedCustomer && !creatingCustomer
        ? await requestJson<Customer>(`/api/customers/${selectedCustomer.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ ...commonBody, expectedUpdatedAt: selectedCustomer.updated_at }),
          })
        : await requestJson<Customer>('/api/customers', {
            method: 'POST',
            headers: { 'Idempotency-Key': customerCreateKey.current || (customerCreateKey.current = createIdempotencyKey('customer.quick.create')) },
            body: JSON.stringify({ ...commonBody, code: customerDraft.code.trim().toUpperCase() }),
          });

      setCustomers((current) => {
        const exists = current.some((item) => item.id === saved.id);
        return (exists ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved])
          .sort((left, right) => left.name.localeCompare(right.name, 'vi'));
      });
      setCustomerId(saved.id);
      if (creatingCustomer) customerCreateKey.current = '';
      setCreatingCustomer(false);
      setCustomerDraft(customerToDraft(saved));
      setNotice(selectedCustomer && !creatingCustomer ? 'Đã cập nhật khách hàng.' : 'Đã tạo khách hàng.');
      if (!selectedCustomer || creatingCustomer) await loadSideData(saved.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không lưu được khách hàng.');
    } finally {
      setBusy(null);
    }
  }

  async function toggleCustomerStatus() {
    if (!selectedCustomer) return;
    clearFeedback();
    setBusy('customer-status');
    try {
      const saved = await requestJson<Customer>(`/api/customers/${selectedCustomer.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          isActive: !selectedCustomer.is_active,
          expectedUpdatedAt: selectedCustomer.updated_at,
        }),
      });
      setCustomers((current) => current.map((item) => item.id === saved.id ? saved : item));
      setNotice(saved.is_active ? 'Đã đưa khách hàng vào sử dụng.' : 'Đã ngừng sử dụng khách hàng.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không đổi được trạng thái khách hàng.');
    } finally {
      setBusy(null);
    }
  }

  function chooseAddress(nextAddressId: string) {
    clearFeedback();
    setCreatingAddress(false);
    setAddressId(nextAddressId);
    const next = addresses.find((item) => item.id === nextAddressId) ?? null;
    setAddressDraft(next ? addressToDraft(next) : EMPTY_ADDRESS);
  }

  function startAddressCreate() {
    if (!selectedCustomer) return;
    clearFeedback();
    addressCreateKey.current = createIdempotencyKey('customer.quick.address.create');
    setCreatingAddress(true);
    setAddressId('');
    setAddressDraft({ ...EMPTY_ADDRESS, recipientName: selectedCustomer.name });
  }

  async function saveAddress() {
    if (!selectedCustomer) return;
    clearFeedback();
    if (!addressDraft.label.trim() || !addressDraft.addressLine1.trim()) {
      setError('Cần nhập tên địa chỉ và địa chỉ chi tiết.');
      return;
    }
    const urlError = locationUrlError(addressDraft.locationUrl);
    if (urlError) {
      setError(urlError);
      return;
    }

    setBusy('address');
    try {
      const body = {
        label: addressDraft.label.trim(),
        recipientName: addressDraft.recipientName.trim() || null,
        phone: addressDraft.phone.trim() || null,
        locationUrl: addressDraft.locationUrl.trim() || null,
        addressLine1: addressDraft.addressLine1.trim(),
        addressLine2: addressDraft.addressLine2.trim() || null,
        ward: addressDraft.ward.trim() || null,
        district: addressDraft.district.trim() || null,
        province: addressDraft.province.trim() || null,
        postalCode: addressDraft.postalCode.trim() || null,
        countryCode: addressDraft.countryCode.trim().toUpperCase() || 'VN',
        isDefault: addressDraft.isDefault,
        isActive: addressDraft.isActive,
      };
      const saved = selectedAddress && !creatingAddress
        ? await requestJson<CustomerAddress>(`/api/customers/${selectedCustomer.id}/addresses/${selectedAddress.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ ...body, expectedUpdatedAt: selectedAddress.updated_at }),
          })
        : await requestJson<CustomerAddress>(`/api/customers/${selectedCustomer.id}/addresses`, {
            method: 'POST',
            headers: { 'Idempotency-Key': addressCreateKey.current || (addressCreateKey.current = createIdempotencyKey('customer.quick.address.create')) },
            body: JSON.stringify(body),
          });
      await loadAddresses(selectedCustomer.id);
      setAddressId(saved.id);
      if (creatingAddress) addressCreateKey.current = '';
      setCreatingAddress(false);
      setAddressDraft(addressToDraft(saved));
      setNotice(selectedAddress && !creatingAddress ? 'Đã cập nhật địa chỉ.' : 'Đã thêm địa chỉ.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không lưu được địa chỉ.');
    } finally {
      setBusy(null);
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!selectedCustomer || !files?.length) return;
    const available = Math.max(0, maxPhotos - media.length);
    if (!available) {
      setError(`Khách hàng chỉ lưu tối đa ${maxPhotos} ảnh.`);
      return;
    }
    clearFeedback();
    setBusy('media');
    try {
      for (const source of Array.from(files).slice(0, available)) {
        const fingerprint = `${source.name}:${source.size}:${source.lastModified}:${source.type}`;
        const keys = mediaUploadKeys.current.get(fingerprint) ?? {
          clientUploadId: crypto.randomUUID(),
          prepareKey: createIdempotencyKey('web-customer-media-prepare'),
          finalizeKey: createIdempotencyKey('web-customer-media-finalize'),
        };
        mediaUploadKeys.current.set(fingerprint, keys);
        const compressed = await compressCustomerPhoto(source);
        const prepared = await requestJson<PrepareResult>(`/api/customers/${selectedCustomer.id}/media`, {
          method: 'POST',
          headers: { 'Idempotency-Key': keys.prepareKey },
          body: JSON.stringify({
            action: 'prepare',
            clientUploadId: keys.clientUploadId,
            mimeType: compressed.file.type,
            byteSize: compressed.file.size,
          }),
        });
        const upload = await fetch(prepared.putUrl, {
          method: 'PUT',
          headers: { 'Content-Type': compressed.file.type },
          body: compressed.file,
        });
        if (!upload.ok) throw new Error(`Kho ảnh từ chối ảnh (${upload.status}).`);
        await requestJson(`/api/customers/${selectedCustomer.id}/media`, {
          method: 'POST',
          headers: { 'Idempotency-Key': keys.finalizeKey },
          body: JSON.stringify({
            action: 'finalize',
            mediaId: prepared.mediaId,
            width: compressed.width,
            height: compressed.height,
          }),
        });
        mediaUploadKeys.current.delete(fingerprint);
      }
      await loadMedia(selectedCustomer.id);
      setNotice('Đã cập nhật ảnh khách hàng.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không tải được ảnh khách hàng.');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
      setBusy(null);
    }
  }

  return (
    <section className={styles.workspace} data-testid="customer-quick-setup">
      <div className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Thao tác nhanh</span>
          <h2>Thiết lập nhanh khách hàng</h2>
          <p>Chọn một khách để chỉnh thông tin, địa chỉ và ảnh ngay tại một màn hình.</p>
        </div>
        <button type="button" className={styles.primaryButton} onClick={startCustomerCreate} disabled={busy !== null}>+ Thêm khách hàng</button>
      </div>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <label className={styles.searchLabel}>
            Tìm khách hàng
            <input type="search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Tên, mã, SĐT..." data-testid="quick-customer-search" />
          </label>
          <div className={styles.customerList}>
            {visibleCustomers.map((customer) => (
              <button key={customer.id} type="button" className={customer.id === customerId ? styles.customerActive : styles.customerButton} onClick={() => chooseCustomer(customer.id)}>
                <strong>{customer.name}</strong>
                <span>{customer.code}{customer.phone ? ` · ${customer.phone}` : ''}</span>
                <small>{customer.group_name || 'Chưa phân nhóm'} · {customer.responsible_employee_name || 'Chưa giao phụ trách'}</small>
              </button>
            ))}
            {busy === 'initial' ? <p className={styles.empty}>Đang tải khách hàng…</p> : null}
            {busy !== 'initial' && visibleCustomers.length === 0 ? <p className={styles.empty}>Không có khách hàng phù hợp.</p> : null}
          </div>
        </aside>

        <div className={styles.content}>
          {selectedCustomer || creatingCustomer ? (
            <>
              <section className={styles.card}>
                <div className={styles.cardHeader}>
                  <div><span className={styles.step}>1</span><div><h3>Thông tin khách hàng</h3><p>Tên khách được ưu tiên hiển thị; mã khách chỉ là định danh.</p></div></div>
                  {selectedCustomer ? <span className={styles.statusPill}>{selectedCustomer.is_active ? 'Đang hoạt động' : 'Không hoạt động'}</span> : null}
                </div>
                <div className={styles.grid2}>
                  <label>Mã khách hàng<input value={customerDraft.code} disabled={Boolean(selectedCustomer) && !creatingCustomer} onChange={(event) => setCustomerDraft({ ...customerDraft, code: event.currentTarget.value.toUpperCase() })} /></label>
                  <label>Tên khách hàng<input value={customerDraft.name} onChange={(event) => setCustomerDraft({ ...customerDraft, name: event.currentTarget.value })} /></label>
                  <label>Nhóm khách hàng<select value={customerDraft.groupId} onChange={(event) => setCustomerDraft({ ...customerDraft, groupId: event.currentTarget.value })}><option value="">Chưa phân nhóm</option>{groups.filter((item) => item.is_active || item.id === selectedCustomer?.group_id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                  <label>Nhân viên phụ trách<select value={customerDraft.responsibleEmployeeId} onChange={(event) => setCustomerDraft({ ...customerDraft, responsibleEmployeeId: event.currentTarget.value })}><option value="">Chưa giao phụ trách</option>{employees.filter((item) => item.is_active || item.id === selectedCustomer?.responsible_employee_id).map((item) => <option key={item.id} value={item.id}>{item.full_name} · {item.code}</option>)}</select></label>
                  <label>Số điện thoại<input value={customerDraft.phone} onChange={(event) => setCustomerDraft({ ...customerDraft, phone: event.currentTarget.value })} /></label>
                  <label>Email<input type="email" value={customerDraft.email} onChange={(event) => setCustomerDraft({ ...customerDraft, email: event.currentTarget.value })} /></label>
                  <label>Mã số thuế<input value={customerDraft.taxCode} onChange={(event) => setCustomerDraft({ ...customerDraft, taxCode: event.currentTarget.value })} /></label>
                  <label>Thời hạn thanh toán (ngày)<input inputMode="numeric" value={customerDraft.paymentTermsDays} onChange={(event) => setCustomerDraft({ ...customerDraft, paymentTermsDays: event.currentTarget.value })} /></label>
                  <label>Hạn mức tín dụng<input inputMode="decimal" value={customerDraft.creditLimit} onChange={(event) => setCustomerDraft({ ...customerDraft, creditLimit: event.currentTarget.value })} /></label>
                  <label className={styles.span2}>Ghi chú<textarea rows={3} value={customerDraft.notes} onChange={(event) => setCustomerDraft({ ...customerDraft, notes: event.currentTarget.value })} /></label>
                </div>
                <div className={styles.actions}>
                  {selectedCustomer ? <button type="button" className={styles.secondaryButton} onClick={() => void toggleCustomerStatus()} disabled={busy !== null}>{selectedCustomer.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}</button> : null}
                  <button type="button" className={styles.primaryButton} onClick={() => void saveCustomer()} disabled={busy !== null}>Lưu khách hàng</button>
                </div>
              </section>

              {selectedCustomer ? (
                <>
                  <section className={styles.card}>
                    <div className={styles.cardHeader}>
                      <div><span className={styles.step}>2</span><div><h3>Địa chỉ</h3><p>Chọn địa chỉ có sẵn để sửa hoặc thêm địa chỉ mới.</p></div></div>
                      <button type="button" className={styles.secondaryButton} onClick={startAddressCreate} disabled={busy !== null}>+ Thêm địa chỉ</button>
                    </div>
                    <div className={styles.addressStrip}>
                      {addresses.map((address) => <button key={address.id} type="button" className={address.id === addressId ? styles.addressActive : styles.addressButton} onClick={() => chooseAddress(address.id)}><strong>{address.label}</strong><span>{address.is_default ? 'Mặc định' : 'Địa chỉ'} · {address.is_active ? 'Đang dùng' : 'Ngừng dùng'}</span></button>)}
                      {addresses.length === 0 && !creatingAddress ? <span className={styles.empty}>Khách hàng chưa có địa chỉ.</span> : null}
                    </div>
                    {selectedAddress || creatingAddress ? (
                      <div className={styles.grid2}>
                        <label>Tên địa chỉ<input value={addressDraft.label} onChange={(event) => setAddressDraft({ ...addressDraft, label: event.currentTarget.value })} /></label>
                        <label>Người nhận<input value={addressDraft.recipientName} onChange={(event) => setAddressDraft({ ...addressDraft, recipientName: event.currentTarget.value })} /></label>
                        <label>Số điện thoại<input value={addressDraft.phone} onChange={(event) => setAddressDraft({ ...addressDraft, phone: event.currentTarget.value })} /></label>
                        <label>Link định vị<input value={addressDraft.locationUrl} onChange={(event) => setAddressDraft({ ...addressDraft, locationUrl: event.currentTarget.value })} placeholder="https://..." /></label>
                        <label className={styles.span2}>Địa chỉ chi tiết<input value={addressDraft.addressLine1} onChange={(event) => setAddressDraft({ ...addressDraft, addressLine1: event.currentTarget.value })} /></label>
                        <label className={styles.span2}>Thông tin bổ sung<input value={addressDraft.addressLine2} onChange={(event) => setAddressDraft({ ...addressDraft, addressLine2: event.currentTarget.value })} /></label>
                        <VietnamAdministrativeFields initialProvinces={provinces} province={addressDraft.province} ward={addressDraft.ward} district={addressDraft.district} onChange={(next) => setAddressDraft({ ...addressDraft, ...next })} testIdPrefix="quick-customer-address" />
                        <label>Mã bưu chính<input value={addressDraft.postalCode} onChange={(event) => setAddressDraft({ ...addressDraft, postalCode: event.currentTarget.value })} /></label>
                        <label>Quốc gia<input value={addressDraft.countryCode} onChange={(event) => setAddressDraft({ ...addressDraft, countryCode: event.currentTarget.value.toUpperCase() })} /></label>
                        <div className={`${styles.checks} ${styles.span2}`}><label><input type="checkbox" checked={addressDraft.isDefault} onChange={(event) => setAddressDraft({ ...addressDraft, isDefault: event.currentTarget.checked })} /> Địa chỉ mặc định</label><label><input type="checkbox" checked={addressDraft.isActive} onChange={(event) => setAddressDraft({ ...addressDraft, isActive: event.currentTarget.checked })} /> Đang sử dụng</label></div>
                        <div className={`${styles.actions} ${styles.span2}`}><button type="button" className={styles.primaryButton} onClick={() => void saveAddress()} disabled={busy !== null}>Lưu địa chỉ</button></div>
                      </div>
                    ) : null}
                  </section>

                  <section className={styles.card}>
                    <div className={styles.cardHeader}>
                      <div><span className={styles.step}>3</span><div><h3>Ảnh khách hàng</h3><p>{media.length}/{maxPhotos} ảnh · bấm vào ảnh để xem lớn.</p></div></div>
                      <label className={styles.primaryButton} aria-disabled={busy !== null || media.length >= maxPhotos || !selectedCustomer.is_active}>Thêm ảnh<input ref={fileInput} type="file" accept="image/*" multiple hidden disabled={busy !== null || media.length >= maxPhotos || !selectedCustomer.is_active} onChange={(event) => void uploadFiles(event.currentTarget.files)} /></label>
                    </div>
                    <div className={styles.mediaGrid}>
                      {media.map((item, index) => item.viewUrl ? (
                        <button key={item.id} type="button" className={styles.mediaButton} onClick={() => setPreviewUrl(item.viewUrl)} data-testid={`quick-customer-media-${index}`}>
                          <img src={item.viewUrl} alt={`Ảnh ${selectedCustomer.name} ${index + 1}`} loading="lazy" />
                          <span>{item.sourceApp === 'MCP' ? 'MCP Thị trường' : 'Công Ty'}{item.capturedAt ? ` · ${new Date(item.capturedAt).toLocaleDateString('vi-VN')}` : ''}</span>
                        </button>
                      ) : null)}
                      {media.length === 0 ? <div className={styles.emptyState}><strong>Chưa có ảnh khách hàng</strong><span>Thêm ảnh ngay tại đây khi cần.</span></div> : null}
                    </div>
                  </section>
                </>
              ) : null}
            </>
          ) : (
            <div className={styles.emptyState}><strong>Chọn khách hàng để thiết lập</strong><span>Danh sách bên trái dùng tên khách làm thông tin chính.</span></div>
          )}
        </div>
      </div>

      {previewUrl ? (
        <div className={styles.previewBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setPreviewUrl(null); }}>
          <section className={styles.previewDialog} role="dialog" aria-modal="true" aria-label="Xem ảnh khách hàng">
            <button type="button" className={styles.previewClose} onClick={() => setPreviewUrl(null)}>Đóng</button>
            <img src={previewUrl} alt={`Ảnh lớn ${selectedCustomer?.name ?? 'khách hàng'}`} />
          </section>
        </div>
      ) : null}
    </section>
  );
}
