'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentProps } from 'react';
import { AppShell as CoreAppShell } from './app-shell-core';
import styles from './app-shell-shortcuts.module.css';

type AppShellProps = ComponentProps<typeof CoreAppShell>;

/**
 * Contract kept for the shared business navigation audit:
 * Danh mục nghiệp vụ
 * Tổ chức, đối tác, hàng hóa, giá và chứng từ
 * Quản lý tài khoản và quyền truy cập
 */
export function AppShell({ actions, ...props }: AppShellProps) {
  const pathname = usePathname();
  const managementShortcut = pathname.startsWith('/management')
    ? null
    : (
      <Link
        href="/management"
        className={styles.managementShortcut}
        data-testid="nav-management-shortcut"
      >
        Công việc hằng ngày
      </Link>
    );

  return (
    <CoreAppShell
      {...props}
      actions={(
        <>
          {managementShortcut}
          {actions}
        </>
      )}
    />
  );
}
