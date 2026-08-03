import Link from 'next/link';
import type { ReactNode } from 'react';

export function AdminShell({
  kicker,
  title,
  subtitle,
  action,
  children,
}: {
  kicker: string;
  title: string;
  subtitle: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <strong>Admin MCP/NPP</strong>
          <span>Trung tâm điều hành Hưng Phát</span>
        </Link>
        <nav className="nav" aria-label="Điều hướng quản lý">
          <Link href="/">Tổng hợp</Link>
          <Link href="/customer-onboarding">Duyệt khách hàng</Link>
          <a href={process.env.NPP_OPERATIONS_URL || 'https://office.nguyenlieuhungphat.com'}>NPP Operations</a>
        </nav>
      </header>
      <main className="main">
        <header className="pageHeader">
          <div>
            <p className="kicker">{kicker}</p>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          {action}
        </header>
        {children}
      </main>
    </div>
  );
}
