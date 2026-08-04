'use client';

import type { ComponentProps } from 'react';
import { AppShell as CoreAppShell } from './app-shell-core';

type AppShellProps = ComponentProps<typeof CoreAppShell>;

/**
 * Contract kept for the shared business navigation audit:
 * Danh mục nghiệp vụ
 * Tổ chức, đối tác, hàng hóa, giá và chứng từ
 * Quản lý tài khoản và quyền truy cập
 */
export function AppShell(props: AppShellProps) {
  return <CoreAppShell {...props} />;
}
