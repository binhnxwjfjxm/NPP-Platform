'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentProps } from 'react';
import { AppShell as CoreAppShell } from './app-shell-core';
import styles from './app-shell-user-tabs.module.css';

type AppShellProps = ComponentProps<typeof CoreAppShell>;

function UserAccessTabs() {
  const pathname = usePathname();
  const inUserArea = pathname === '/access/users' || pathname.startsWith('/access/users/');
  if (!inUserArea) return null;

  const scopesActive = pathname.startsWith('/access/users/scopes');
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

/**
 * Shared NPP Operations shell.
 *
 * Business modules must stay discoverable in the persistent left navigation.
 * Page-specific actions belong in `actions`; navigation must not appear and
 * disappear according to the current pathname.
 */
export function AppShell({ children, ...props }: AppShellProps) {
  return (
    <CoreAppShell {...props}>
      <UserAccessTabs />
      {children}
    </CoreAppShell>
  );
}
