'use client';

import Link from 'next/link';
import type { ComponentProps } from 'react';
import type { InventoryExportScope } from '../../lib/inventory-data-export-model';
import InventoryExportAction from '../inventory/inventory-export-action';
import { AppShell as CoreAppShell } from './app-shell-core';
import styles from './app-shell-user-tabs.module.css';

type AppShellProps = ComponentProps<typeof CoreAppShell>;
type UserAccessTab = 'accounts' | 'scopes';

function UserAccessTabs({ active }: { active: UserAccessTab }) {
  const scopesActive = active === 'scopes';
  return (
    <nav className={styles.tabs} aria-label="Quản lý người dùng">
      <Link
        href="/access/users"
        className={scopesActive ? styles.tab : styles.tabActive}
        aria-current={scopesActive ? undefined : 'page'}
      >
        Tài khoản
      </Link>
      <Link
        href="/access/users/scopes"
        className={scopesActive ? styles.tabActive : styles.tab}
        aria-current={scopesActive ? 'page' : undefined}
      >
        Phạm vi chi nhánh &amp; kho
      </Link>
    </nav>
  );
}

function inventoryExportScope(title: string): InventoryExportScope | null {
  if (title === 'Tra cứu tồn kho') return 'balances';
  if (title === 'Lô hàng') return 'lots';
  if (title === 'Chính sách quản lý lô') return 'tracking-policies';
  return null;
}

/**
 * Shared NPP Operations shell.
 *
 * Business modules stay discoverable in the persistent left navigation.
 * User-account child tabs are page-local navigation and do not change the
 * persistent sidebar contract.
 */
export function AppShell({ children, ...props }: AppShellProps) {
  const userTab: UserAccessTab | null = props.title === 'Người dùng'
    ? 'accounts'
    : props.title === 'Phạm vi chi nhánh & kho'
      ? 'scopes'
      : null;
  const exportScope = inventoryExportScope(props.title);
  const combinedActions = (props.actions != null || exportScope !== null) ? (
    <>
      {props.actions}
      {exportScope ? <InventoryExportAction scope={exportScope} /> : null}
    </>
  ) : undefined;

  return (
    <CoreAppShell {...props} actions={combinedActions}>
      {userTab ? <UserAccessTabs active={userTab} /> : null}
      {children}
    </CoreAppShell>
  );
}
