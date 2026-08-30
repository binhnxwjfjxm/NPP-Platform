'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import styles from './global-quick-actions.module.css';

type QuickActionIconName = 'plus' | 'customer' | 'product';

type QuickAction = Readonly<{
  href: string;
  label: string;
  icon: QuickActionIconName;
  testId: string;
  primary?: boolean;
}>;

const QUICK_ACTIONS: ReadonlyArray<QuickAction> = [
  { href: '/products', label: 'Sản phẩm', icon: 'product', testId: 'quick-action-products' },
  { href: '/customers', label: 'Khách hàng', icon: 'customer', testId: 'quick-action-customers' },
  { href: '/sales/sales-orders?quickAction=create', label: 'Tạo đơn bán', icon: 'plus', testId: 'quick-action-create-sales-order', primary: true },
];

function QuickActionIcon({ name }: { name: QuickActionIconName }) {
  const paths: Record<QuickActionIconName, React.ReactNode> = {
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    customer: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
    product: <><path d="m4 8 8-4 8 4-8 4-8-4Z" /><path d="m4 8v8l8 4 8-4V8" /><path d="M12 12v8" /></>,
  };

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={styles.icon}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

export function GlobalQuickActions() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  function handlePointerEnter(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse') return;
    setOpen(true);
  }

  function handlePointerLeave(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse') return;
    setOpen(false);
  }

  if (pathname === '/' || pathname.startsWith('/login')) return null;

  return (
    <div
      ref={rootRef}
      className={`${styles.quickActions} ${open ? styles.quickActionsOpen : ''}`}
      data-testid="global-quick-actions"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <div
        id="global-quick-actions-menu"
        className={styles.quickActionList}
        aria-hidden={!open}
      >
        {QUICK_ACTIONS.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            target="_blank"
            rel="noopener noreferrer"
            prefetch={false}
            tabIndex={open ? 0 : -1}
            className={`${styles.quickActionItem} ${action.primary ? styles.quickActionPrimary : ''}`}
            data-testid={action.testId}
            onClick={() => setOpen(false)}
          >
            <span className={styles.quickActionLabel}>{action.label}</span>
            <span className={styles.quickActionIcon}><QuickActionIcon name={action.icon} /></span>
          </Link>
        ))}
      </div>

      <button
        type="button"
        className={styles.quickActionTrigger}
        aria-label={open ? 'Đóng thao tác nhanh' : 'Mở thao tác nhanh'}
        aria-expanded={open}
        aria-controls="global-quick-actions-menu"
        title={open ? 'Đóng thao tác nhanh' : 'Thao tác nhanh'}
        data-testid="global-quick-actions-trigger"
        onClick={() => setOpen((current) => !current)}
      >
        <span className={styles.quickActionTriggerIcon}><QuickActionIcon name="plus" /></span>
      </button>
    </div>
  );
}
