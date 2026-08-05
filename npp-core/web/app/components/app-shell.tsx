'use client';

import type { ComponentProps } from 'react';
import { AppShell as CoreAppShell } from './app-shell-core';

type AppShellProps = ComponentProps<typeof CoreAppShell>;

/**
 * Shared NPP Operations shell.
 *
 * Business modules must stay discoverable in the persistent left navigation.
 * Page-specific actions belong in `actions`; navigation must not appear and
 * disappear according to the current pathname.
 */
export function AppShell(props: AppShellProps) {
  return <CoreAppShell {...props} />;
}
