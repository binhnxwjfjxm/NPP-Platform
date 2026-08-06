import Link from 'next/link';
import type { ReactNode } from 'react';
import { AdminIcon } from './admin-icons';

type AdminSection = 'overview' | 'exceptions';

export function AdminShell({
  activeSection,
  kicker,
  title,
  subtitle,
  children,
}: {
  activeSection: AdminSection;
  kicker: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const nppOperationsUrl = (process.env.NPP_OPERATIONS_URL?.trim() || 'https://npp-platform.vercel.app').replace(/\/$/, '');
  const appLogoUrl = process.env.NEXT_PUBLIC_APP_LOGO_URL?.trim()
    || 'https://office.nguyenlieuhungphat.com/logo-transparent.png';

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbarInner">
          <Link className="brand" href="/" aria-label="Admin MCP/NPP - Trang tổng hợp">
            <span className="brandLogoFrame">
              <img className="brandLogo" src={appLogoUrl} alt="Logo Hưng Phát Company" />
            </span>
            <span className="brandCopy">
              <strong>Admin MCP/NPP</strong>
              <span>Tổng hợp và ngoại lệ cấp quản lý</span>
            </span>
          </Link>

          <nav className="desktopNav" aria-label="Điều hướng quản lý">
            <Link className={activeSection === 'overview' ? 'navLink isActive' : 'navLink'} href="/">
              <AdminIcon name="overview" size={21} />
              <span>Tổng hợp</span>
            </Link>
            <Link className={activeSection === 'exceptions' ? 'navLink isActive' : 'navLink'} href="/customer-onboarding">
              <AdminIcon name="exception" size={21} />
              <span>Ngoại lệ cấp quản lý</span>
            </Link>
          </nav>

          <details className="appMenu">
            <summary className="menuTrigger" aria-label="Mở menu ứng dụng">
              <AdminIcon name="menu" size={22} />
            </summary>
            <div className="menuPanel">
              <p className="menuEyebrow">Điều hướng</p>
              <Link className={activeSection === 'overview' ? 'menuItem mobileMenuItem isActive' : 'menuItem mobileMenuItem'} href="/">
                <span className="menuIcon"><AdminIcon name="overview" size={20} /></span>
                <span><strong>Tổng hợp</strong><small>Toàn cảnh dành cho quản lý</small></span>
              </Link>
              <Link className={activeSection === 'exceptions' ? 'menuItem mobileMenuItem isActive' : 'menuItem mobileMenuItem'} href="/customer-onboarding">
                <span className="menuIcon"><AdminIcon name="exception" size={20} /></span>
                <span><strong>Ngoại lệ cấp quản lý</strong><small>Ranh giới và việc vượt quyền</small></span>
              </Link>
              <a className="menuItem" href={`${nppOperationsUrl}/management`}>
                <span className="menuIcon"><AdminIcon name="operations" size={20} /></span>
                <span><strong>NPP Operations</strong><small>Xử lý công việc hằng ngày</small></span>
                <AdminIcon className="menuExternal" name="external" size={17} />
              </a>
            </div>
          </details>
        </div>
      </header>

      <main className="main">
        <header className="pageHeader">
          <p className="kicker">{kicker}</p>
          <h1>{title}</h1>
          <p className="pageSubtitle">{subtitle}</p>
        </header>
        {children}
      </main>
    </div>
  );
}
