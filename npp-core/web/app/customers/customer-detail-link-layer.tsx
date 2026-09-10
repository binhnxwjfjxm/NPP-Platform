'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import type { Customer } from '../../lib/customer-types';
import styles from './customer-detail-link-layer.module.css';

type Target = Readonly<{ customer: Customer; element: HTMLElement }>;

type Props = Readonly<{
  customers: Customer[];
}>;

function rowFor(code: string) {
  return document.querySelector(`[data-testid="customer-row-${code}"]`);
}

function detailTarget(row: Element | null) {
  const cell = row?.querySelector('td:nth-child(2)');
  const target = cell?.querySelector('span:first-of-type');
  return target instanceof HTMLElement ? target : null;
}

export default function CustomerDetailLinkLayer({ customers }: Props) {
  const [targets, setTargets] = useState<Target[]>([]);
  const customerById = useMemo(() => new Map(customers.map((customer) => [customer.id, customer])), [customers]);

  useEffect(() => {
    let deepLinkHandled = false;
    const sync = () => {
      const next = customers.flatMap((customer) => {
        const element = detailTarget(rowFor(customer.code));
        return element ? [{ customer, element }] : [];
      });
      setTargets((current) => {
        if (current.length === next.length && current.every((item, index) => item.element === next[index]?.element)) return current;
        return next;
      });

      if (!deepLinkHandled) {
        const query = new URLSearchParams(window.location.search);
        const editId = query.get('edit');
        const addressesId = query.get('addresses');
        const selected = customerById.get(editId || addressesId || '');
        if (selected) {
          const selector = editId
            ? `[data-testid="edit-customer-${selected.code}"]`
            : `[data-testid="addresses-customer-${selected.code}"]`;
          const button = document.querySelector(selector);
          if (button instanceof HTMLButtonElement) {
            deepLinkHandled = true;
            button.click();
            const nextUrl = new URL(window.location.href);
            nextUrl.searchParams.delete(editId ? 'edit' : 'addresses');
            window.history.replaceState(window.history.state, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
          }
        }
      }
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [customerById, customers]);

  return (
    <>
      {targets.map(({ customer, element }) => createPortal(
        <Link
          key={customer.id}
          href={`/customers/${customer.id}`}
          className={styles.overlayLink}
          aria-label={`Mở hồ sơ ${customer.name}`}
          data-testid={`customer-detail-${customer.code}`}
        />,
        element,
      ))}
    </>
  );
}
