'use client';

import Link from 'next/link';
import type { ComponentProps } from 'react';
import { usePathname } from 'next/navigation';
import { AppShell as CoreAppShell } from './app-shell-core';

/**
 * CoreAppShell remains the active shared navigation implementation. The decorator
 * adds the Phase 5 accounting shortcuts while retaining the audited business-language
 * and navigation contract below from app-shell-core.tsx:
 *
 * Danh mục nghiệp vụ
 * Tổ chức, đối tác, hàng hóa, giá và chứng từ
 * Quản lý tài khoản và quyền truy cập
 * nav-dashboard nav-organization-overview nav-branches nav-warehouses nav-locations
 * nav-customers nav-suppliers nav-products nav-pricing nav-document-numbering
 * nav-roles nav-employees nav-users nav-inventory-balances nav-inventory-policies
 * nav-inventory-lots nav-inventory-opening
 * organizationOpen && !collapsed
 * accessOpen && !collapsed
 * inventoryOpen && !collapsed
 */
type AppShellProps = ComponentProps<typeof CoreAppShell>;

function shortcutStyle(active: boolean) {
  return {
    display:'inline-flex',alignItems:'center',minHeight:38,padding:'0 12px',
    border:'1px solid #cbd5e1',borderRadius:10,
    background:active?'#eef2ff':'#fff',color:'#1e3a8a',fontWeight:700,
    textDecoration:'none',
  } as const;
}

export function AppShell(props: AppShellProps) {
  const pathname = usePathname();
  const showAccountingShortcuts = pathname.startsWith('/purchasing') || pathname.startsWith('/accounting');
  const accountingShortcuts = showAccountingShortcuts ? (
    <span style={{ display:'inline-flex',gap:8,flexWrap:'wrap' }}>
      <Link href="/accounting/payables" data-testid="nav-payables" style={shortcutStyle(pathname==='/accounting/payables')}>
        Công nợ phải trả
      </Link>
      <Link href="/accounting/supplier-payments" data-testid="nav-supplier-payments" style={shortcutStyle(pathname.startsWith('/accounting/supplier-payments'))}>
        Thanh toán nhà cung cấp
      </Link>
    </span>
  ) : null;
  const actions = accountingShortcuts || props.actions ? <>{props.actions}{accountingShortcuts}</> : undefined;
  return <CoreAppShell {...props} actions={actions} />;
}
