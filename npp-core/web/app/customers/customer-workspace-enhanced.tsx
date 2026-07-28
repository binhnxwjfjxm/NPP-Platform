'use client';

import { useRef, useState } from 'react';
import styles from '../organization/organization.module.css';
import customerStyles from './customers.module.css';
import type { Customer, CustomerGroup } from '../../lib/customer-types';
import CustomerWorkspace from './customer-workspace';

type Props = {
  initialCustomers: Customer[];
  initialGroups: CustomerGroup[];
  initialError?: string | null;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string };
};

type CreatedCustomer = { id: string; code: string; name: string };

type Draft = {
  code: string;
  name: string;
  groupId: string;
  phone: string;
  email: string;
  taxCode: string;
  addressLabel: string;
  recipientName: string;
  addressPhone: string;
  addressLine1: string;
  addressLine2: string;
  ward: string;
  district: string;
  province: string;
  postalCode: string;
};

const PROVINCES = [
  'An Giang',
  'Bắc Ninh',
  'Cà Mau',
  'Cao Bằng',
  'Cần Thơ',
  'Đà Nẵng',
  'Đắk Lắk',
  'Điện Biên',
  'Đồng Nai',
  'Đồng Tháp',
  'Gia Lai',
  'Hà Nội',
  'Hà Tĩnh',
  'Hải Phòng',
  'Huế',
  'Hưng Yên',
  'Khánh Hòa',
  'Lai Châu',
  'Lâm Đồng',
  'Lạng Sơn',
  'Lào Cai',
  'Nghệ An',
  'Ninh Bình',
  'Phú Thọ',
  'Quảng Ngãi',
  'Quảng Ninh',
  'Quảng Trị',
  'Sơn La',
  'Tây Ninh',
  'Thái Nguyên',
  'Thanh Hóa',
  'Thành phố Hồ Chí Minh',
  'Tuyên Quang',
  'Vĩnh Long',
] as const;

function emptyDraft(): Draft {
  return {
    code: '',
    name: '',
    groupId: '',
    phone: '',
    email: '',
    taxCode: '',
    addressLabel: 'Địa chỉ giao dịch',
    recipientName: '',
    addressPhone: '',
    addressLine1: '',
    addressLine2: '',
    ward: '',
    district: '',
    province: '',
    postalCode: '',
  };
}

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
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
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message || payload.error?.code || 'Không thể lưu khách hàng');
  }
  return payload.data;
}

export default function CustomerWorkspaceEnhanced(props: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [createdCustomer, setCreatedCustomer] = useState<CreatedCustomer | null>(null);
  const keys = useRef({ customer: '', address: '' });

  function beginCreate() {
    keys.current = {
      customer: `web-customer-${crypto.randomUUID()}`,
      address: `web-address-${crypto.randomUUID()}`,
    };
    setDraft(emptyDraft());
    setCreatedCustomer(null);
    setError(null);
    setOpen(true);
  }

  function handleClickCapture(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-testid="customers-topbar-create-button"]')) return;
    event.preventDefault();
    event.stopPropagation();
    beginCreate();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      let customer = createdCustomer;
      if (!customer) {
        customer = await requestJson<CreatedCustomer>('/api/customers', {
          method: 'POST',
          headers: { 'Idempotency-Key': keys.current.customer },
          body: JSON.stringify({
            code: draft.code.trim().toUpperCase(),
            name: draft.name.trim(),
            groupId: draft.groupId || null,
            responsibleEmployeeId: null,
            phone: draft.phone.trim() || null,
            email: draft.email.trim() || null,
            taxCode: draft.taxCode.trim() || null,
            paymentTermsDays: 0,
            creditLimit: '0',
            notes: null,
          }),
        });
        setCreatedCustomer(customer);
      }

      await requestJson(`/api/customers/${customer.id}/addresses`, {
        method: 'POST',
        headers: { 'Idempotency-Key': keys.current.address },
        body: JSON.stringify({
          label: draft.addressLabel.trim(),
          recipientName: draft.recipientName.trim() || draft.name.trim(),
          phone: draft.addressPhone.trim() || draft.phone.trim() || null,
          addressLine1: draft.addressLine1.trim(),
          addressLine2: draft.addressLine2.trim() || null,
          ward: draft.ward.trim() || null,
          district: draft.district.trim() || null,
          province: draft.province || null,
          postalCode: draft.postalCode.trim() || null,
          countryCode: 'VN',
          isDefault: true,
        }),
      });

      window.location.assign('/customers');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Không thể lưu khách hàng và địa chỉ';
      setError(createdCustomer
        ? `Khách hàng đã được tạo; địa chỉ chưa lưu. ${message}`
        : message);
    } finally {
      setBusy(false);
    }
  }

  const customerLocked = Boolean(createdCustomer);

  return (
    <div onClickCapture={handleClickCapture}>
      <CustomerWorkspace {...props} />

      {open ? (
        <div className={styles.modalBackdrop} role="presentation">
          <section
            className={joinClasses(styles.modal, customerStyles.modalWide)}
            role="dialog"
            aria-modal="true"
            aria-label="Thêm khách hàng và địa chỉ"
          >
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.panelKicker}>Tạo mới hai bước</p>
                <h3>Khách hàng và địa chỉ mặc định</h3>
              </div>
              <button type="button" className={styles.modalClose} onClick={() => setOpen(false)} disabled={busy}>
                Đóng
              </button>
            </div>

            {error ? <div className={styles.bannerError} role="alert">{error}</div> : null}
            {createdCustomer ? (
              <div className={styles.bannerSuccess} role="status">
                Đã tạo {createdCustomer.code} · {createdCustomer.name}. Hãy lưu lại phần địa chỉ.
              </div>
            ) : null}

            <form className={styles.form} onSubmit={submit}>
              <div className={customerStyles.formGrid}>
                <label>
                  Mã khách hàng
                  <input
                    data-testid="enhanced-customer-code-input"
                    value={draft.code}
                    onChange={(event) => setDraft((value) => ({ ...value, code: event.currentTarget.value }))}
                    disabled={customerLocked}
                    required
                  />
                </label>
                <label>
                  Tên khách hàng
                  <input
                    data-testid="enhanced-customer-name-input"
                    value={draft.name}
                    onChange={(event) => setDraft((value) => ({ ...value, name: event.currentTarget.value }))}
                    disabled={customerLocked}
                    required
                  />
                </label>
                <label>
                  Nhóm khách hàng
                  <select
                    value={draft.groupId}
                    onChange={(event) => setDraft((value) => ({ ...value, groupId: event.currentTarget.value }))}
                    disabled={customerLocked}
                  >
                    <option value="">Không phân nhóm</option>
                    {props.initialGroups.filter((group) => group.is_active).map((group) => (
                      <option key={group.id} value={group.id}>{group.code} · {group.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Điện thoại khách hàng
                  <input value={draft.phone} onChange={(event) => setDraft((value) => ({ ...value, phone: event.currentTarget.value }))} disabled={customerLocked} />
                </label>
                <label>
                  Email
                  <input type="email" value={draft.email} onChange={(event) => setDraft((value) => ({ ...value, email: event.currentTarget.value }))} disabled={customerLocked} />
                </label>
                <label>
                  Mã số thuế
                  <input value={draft.taxCode} onChange={(event) => setDraft((value) => ({ ...value, taxCode: event.currentTarget.value }))} disabled={customerLocked} />
                </label>

                <div className={customerStyles.fullWidth}><strong>Địa chỉ mặc định</strong></div>
                <label>
                  Nhãn địa chỉ
                  <input value={draft.addressLabel} onChange={(event) => setDraft((value) => ({ ...value, addressLabel: event.currentTarget.value }))} required />
                </label>
                <label>
                  Người nhận
                  <input value={draft.recipientName} onChange={(event) => setDraft((value) => ({ ...value, recipientName: event.currentTarget.value }))} />
                </label>
                <label>
                  Điện thoại nhận hàng
                  <input value={draft.addressPhone} onChange={(event) => setDraft((value) => ({ ...value, addressPhone: event.currentTarget.value }))} />
                </label>
                <label>
                  Tỉnh/thành phố
                  <select
                    data-testid="customer-province-select"
                    value={draft.province}
                    onChange={(event) => setDraft((value) => ({ ...value, province: event.currentTarget.value }))}
                    required
                  >
                    <option value="">Chọn tỉnh/thành phố</option>
                    {PROVINCES.map((province) => <option key={province} value={province}>{province}</option>)}
                  </select>
                </label>
                <label>
                  Quận/huyện
                  <input value={draft.district} onChange={(event) => setDraft((value) => ({ ...value, district: event.currentTarget.value }))} />
                </label>
                <label>
                  Phường/xã
                  <input value={draft.ward} onChange={(event) => setDraft((value) => ({ ...value, ward: event.currentTarget.value }))} />
                </label>
                <label className={customerStyles.fullWidth}>
                  Địa chỉ dòng 1
                  <input
                    data-testid="enhanced-customer-address-line1-input"
                    value={draft.addressLine1}
                    onChange={(event) => setDraft((value) => ({ ...value, addressLine1: event.currentTarget.value }))}
                    required
                  />
                </label>
                <label className={customerStyles.fullWidth}>
                  Địa chỉ dòng 2
                  <input value={draft.addressLine2} onChange={(event) => setDraft((value) => ({ ...value, addressLine2: event.currentTarget.value }))} />
                </label>
                <label>
                  Mã bưu chính
                  <input value={draft.postalCode} onChange={(event) => setDraft((value) => ({ ...value, postalCode: event.currentTarget.value }))} />
                </label>
              </div>

              <div className={styles.formActions}>
                <button type="button" className={styles.secondaryButton} onClick={() => setOpen(false)} disabled={busy}>Hủy</button>
                <button type="submit" className={styles.primaryButton} disabled={busy} data-testid="save-customer-with-address-button">
                  {busy ? 'Đang lưu…' : createdCustomer ? 'Lưu lại địa chỉ' : 'Lưu khách hàng và địa chỉ'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
