'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Customer } from '../../lib/customer-types';
import shellStyles from '../components/app-shell.module.css';
import styles from '../organization/organization.module.css';
import customerStyles from './customers.module.css';
import CustomerMediaDialog from './customer-media-dialog';

type Props = { customers: Customer[] };
type ApiEnvelope<T> = { data?: T };

export default function CustomerMediaLauncher({ customers }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [options, setOptions] = useState(customers);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [search, setSearch] = useState('');
  const [topbarActions, setTopbarActions] = useState<HTMLElement | null>(null);
  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('vi');
    if (!term) return options.slice(0, 100);
    return options
      .filter((customer) => [customer.code, customer.name, customer.phone]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('vi').includes(term)))
      .slice(0, 100);
  }, [options, search]);

  useEffect(() => {
    const actions = document.querySelector(`.${shellStyles.topbarActions}`);
    setTopbarActions(actions instanceof HTMLElement ? actions : null);
    return () => setTopbarActions(null);
  }, []);

  async function openPicker() {
    setPickerOpen(true);
    try {
      const response = await fetch('/api/customers?limit=1000', { cache: 'no-store', headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => ({})) as ApiEnvelope<Customer[]>;
      if (response.ok && Array.isArray(payload.data)) setOptions(payload.data);
    } catch {
      // Initial server-loaded options remain usable when refresh is temporarily unavailable.
    }
  }

  const launcherButton = (
    <button
      type="button"
      data-testid="customer-media-launcher"
      className={shellStyles.actionButton}
      onClick={() => void openPicker()}
      style={{ order: -1 }}
    >
      Ảnh khách
    </button>
  );

  return (
    <>
      {topbarActions ? createPortal(launcherButton, topbarActions) : null}

      {pickerOpen && !selected ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setPickerOpen(false); }}>
          <section className={`${styles.modal} ${customerStyles.modalWide}`} role="dialog" aria-modal="true" aria-label="Chọn khách hàng để quản lý ảnh">
            <div className={styles.modalHeader}>
              <div><p className={styles.panelKicker}>Kho ảnh dùng chung</p><h3>Chọn khách hàng</h3></div>
              <button type="button" className={styles.modalClose} onClick={() => setPickerOpen(false)}>Đóng</button>
            </div>
            <label>
              Tìm khách hàng
              <input
                autoFocus
                type="search"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder="Mã, tên hoặc số điện thoại"
              />
            </label>
            <div className={customerStyles.addressList}>
              {visible.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  className={customerStyles.addressCard}
                  onClick={() => setSelected(customer)}
                  style={{ textAlign: 'left', cursor: 'pointer' }}
                >
                  <strong>{customer.code} · {customer.name}</strong>
                  <div className={customerStyles.addressMeta}>{customer.phone || 'Chưa có số điện thoại'}</div>
                </button>
              ))}
              {visible.length === 0 ? <div className={customerStyles.empty}>Không có khách hàng phù hợp.</div> : null}
            </div>
          </section>
        </div>
      ) : null}

      {selected ? (
        <CustomerMediaDialog
          customer={selected}
          onClose={() => { setSelected(null); setPickerOpen(false); setSearch(''); }}
        />
      ) : null}
    </>
  );
}
