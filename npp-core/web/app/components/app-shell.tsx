'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentProps, CSSProperties } from 'react';
import { AppShell as CoreAppShell } from './app-shell-core';

type AppShellProps = ComponentProps<typeof CoreAppShell>;

const inventoryShortcutStyle: CSSProperties = {
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

/**
 * Contract kept for the shared business navigation audit:
 * Danh mục nghiệp vụ
 * Tổ chức, đối tác, hàng hóa, giá và chứng từ
 * Quản lý tài khoản và quyền truy cập
 */
export function AppShell(props: AppShellProps) {
  const pathname = usePathname();
  const inventoryShortcut = pathname.startsWith('/inventory')
    ? pathname.startsWith('/inventory/delivery-orders')
      ? { href: '/inventory/fulfillment', label: 'Chuẩn bị hàng' }
      : { href: '/inventory/delivery-orders', label: 'Bàn giao giao nhận' }
    : null;
  const actions = inventoryShortcut || props.actions
    ? (
        <>
          {inventoryShortcut ? (
            <Link
              href={inventoryShortcut.href}
              style={inventoryShortcutStyle}
              data-testid="inventory-handover-shortcut"
            >
              {inventoryShortcut.label}
            </Link>
          ) : null}
          {props.actions}
        </>
      )
    : undefined;

  return <CoreAppShell {...props} actions={actions} />;
}
