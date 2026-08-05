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
  const nppOperationsUrl = process.env.NPP_OPERATIONS_URL?.trim() || 'https://npp-platform.vercel.app';
  const appLogoUrl = process.env.NEXT_PUBLIC_APP_LOGO_URL?.trim()
    || 'https://office.nguyenlieuhungphat.com/logo-transparent.png';

  return (
    <div className="shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Admin MCP/NPP - Trang tổng hợp">
          <span className="brandLogoFrame">
            <img className="brandLogo" src={appLogoUrl} alt="Logo Hưng Phát Company" />
          </span>
          <span className="brandCopy">
            <strong>Admin MCP/NPP</strong>
            <span>Tổng hợp và ngoại lệ cấp quản lý</span>
          </span>
        </Link>
        <nav className="nav" aria-label="Điều hướng quản lý">
          <Link href="/">Tổng hợp</Link>
          <Link href="/customer-onboarding">Ngoại lệ cấp quản lý</Link>
          <a href={`${nppOperationsUrl.replace(/\/$/, '')}/management`}>NPP Operations</a>
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
