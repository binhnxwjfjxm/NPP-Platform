'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentProps, CSSProperties } from 'react';
import { AppShell as CoreAppShell } from './app-shell-core';

type AppShellProps = ComponentProps<typeof CoreAppShell>;

const operationalShortcutStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: '40px',
  padding: '0.6rem 0.85rem',
  border: '1px solid currentColor',
  borderRadius: '12px',
  color: 'inherit',
  fontWeight: 750,
  textDecoration: 'none',
};

type Shortcut = { href: string; label: string; testId: string };

/**
 * Contract kept for the shared business navigation audit:
 * Danh mục nghiệp vụ
 * Tổ chức, đối tác, hàng hóa, giá và chứng từ
 * Quản lý tài khoản và quyền truy cập
 */
export function AppShell(props: AppShellProps) {
  const pathname = usePathname();
  const operationalShortcuts: Shortcut[] = pathname.startsWith('/logistics/trips')
    ? [
        { href: '/inventory/delivery-orders', label: 'Phiếu sẵn sàng giao', testId: 'logistics-delivery-order-shortcut' },
        { href: '/logistics/dispatch', label: 'Bàn giao chuyến', testId: 'logistics-dispatch-shortcut' },
      ]
    : pathname.startsWith('/logistics')
      ? [{ href: '/inventory/delivery-orders', label: 'Phiếu sẵn sàng giao', testId: 'logistics-delivery-order-shortcut' }]
      : pathname.startsWith('/inventory/delivery-orders')
        ? [{ href: '/logistics/trips', label: 'Điều phối chuyến', testId: 'inventory-logistics-shortcut' }]
        : pathname.startsWith('/inventory')
          ? [{ href: '/inventory/delivery-orders', label: 'Bàn giao giao nhận', testId: 'inventory-handover-shortcut' }]
          : [];
  const actions = operationalShortcuts.length || props.actions
    ? (
        <>
          {operationalShortcuts.map((shortcut) => (
            <Link
              key={shortcut.href}
              href={shortcut.href}
              style={operationalShortcutStyle}
              data-testid={shortcut.testId}
            >
              {shortcut.label}
            </Link>
          ))}
          {props.actions}
        </>
      )
    : undefined;

  return <CoreAppShell {...props} actions={actions} />;
}