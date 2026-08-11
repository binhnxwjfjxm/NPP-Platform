'use client';

import type { ComponentProps, ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AppShell as CoreAppShell } from './app-shell-core';
import styles from './app-shell-context-actions.module.css';

type AppShellProps = ComponentProps<typeof CoreAppShell>;

type ExchangeShortcut = { tab: 'products' | 'pricing' | 'stocktake' | 'quotation' | 'movements'; label: string };

function exchangeShortcut(pathname: string): ExchangeShortcut | null {
  if (pathname === '/products' || pathname.startsWith('/products/')) return { tab: 'products', label: 'Nhập / xuất sản phẩm' };
  if (pathname === '/pricing' || pathname.startsWith('/pricing/')) return { tab: 'pricing', label: 'Nhập / xuất giá bán' };
  if (pathname === '/inventory/stocktakes' || pathname.startsWith('/inventory/stocktakes/')) return { tab: 'stocktake', label: 'Nhập / xuất kiểm kê' };
  if (pathname === '/inventory/balances' || pathname.startsWith('/inventory/balances/')) return { tab: 'movements', label: 'Xem biến động kho' };
  if (pathname === '/sales/sales-orders' || pathname.startsWith('/sales/sales-orders/') || pathname === '/management') return { tab: 'quotation', label: 'Lập báo giá' };
  return null;
}

function appendAction(actions: ReactNode, shortcut: ExchangeShortcut | null) {
  if (!shortcut) return actions;
  return <div className={styles.actions}><Link className={styles.exchangeLink} href={`/operations/data-exchange?tab=${shortcut.tab}`}>{shortcut.label}</Link>{actions}</div>;
}

/** Shared NPP Operations shell. Page-specific data tools remain reachable from the business screen that uses them. */
export function AppShell({ actions, ...props }: AppShellProps) {
  const pathname = usePathname();
  return <CoreAppShell {...props} actions={appendAction(actions, exchangeShortcut(pathname))} />;
}
