'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AppShell as CoreAppShell } from './app-shell-core';

type AppShellProps = {
  title: string;
  subtitle?: string;
  kicker?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
};

const linkStyle: React.CSSProperties = {
  display: 'inline-flex',
  minHeight: 38,
  alignItems: 'center',
  justifyContent: 'center',
  padding: '8px 13px',
  border: '1px solid #d8d1cb',
  borderRadius: 8,
  background: '#fff',
  color: '#4b4039',
  fontSize: '0.78rem',
  fontWeight: 680,
  textDecoration: 'none',
};

export function AppShell({ title, subtitle, kicker, children, actions }: AppShellProps) {
  const pathname = usePathname();
  const numberingLink = pathname === '/document-numbering' ? null : (
    <Link href="/document-numbering" style={linkStyle} data-testid="nav-document-numbering">Số chứng từ</Link>
  );
  return (
    <CoreAppShell
      title={title}
      subtitle={subtitle}
      kicker={kicker}
      actions={<>{numberingLink}{actions}</>}
    >
      {children}
    </CoreAppShell>
  );
}
