import Link from 'next/link';
import type { ReactNode } from 'react';
import { AdminIcon } from './admin-icons';

type AdminSection = 'overview' | 'exceptions' | 'menu';

function BottomNavItem({
  active,
  href,
  icon,
  label,
}: {
  active: boolean;
  href: string;
  icon: 'overview' | 'exception' | 'menu';
  label: string;
}) {
  return (
    <Link
      aria-current={active ? 'page' : undefined}
      className={active ? 'adminBottomItem isActive' : 'adminBottomItem'}
      href={href}
    >
      <AdminIcon name={icon} size={22} />
      <span>{label}</span>
    </Link>
  );
}

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
    <div className="shell adminAppShell" data-admin-app-shell data-active-section={activeSection}>
      <header className="topbar adminAppTopbar">
        <div className="topbarInner">
          <Link className="brand" href="/" aria-label="Admin MCP/NPP - Trang tổng hợp">
            <span className="brandLogoFrame">
              <img className="brandLogo" src={appLogoUrl} alt="Logo Hưng Phát Company" />
            </span>
            <span className="brandCopy">
              <strong className="brandProductName">Admin MCP/NPP</strong>
              <span className="brandDescriptor">Tổng hợp và ngoại lệ cấp quản lý</span>
              <small className="brandMobileEyebrow">Admin Hưng Phát</small>
              <strong className="brandScreenName">{title}</strong>
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

          <details className="appMenu desktopAppMenu">
            <summary className="menuTrigger" aria-label="Mở menu ứng dụng">
              <AdminIcon name="menu" size={22} />
            </summary>
            <div className="menuPanel">
              <p className="menuEyebrow">Điều hướng</p>
              <Link className={activeSection === 'overview' ? 'menuItem isActive' : 'menuItem'} href="/">
                <span className="menuIcon"><AdminIcon name="overview" size={20} /></span>
                <span><strong>Tổng hợp</strong><small>Toàn cảnh dành cho quản lý</small></span>
              </Link>
              <Link className={activeSection === 'exceptions' ? 'menuItem isActive' : 'menuItem'} href="/customer-onboarding">
                <span className="menuIcon"><AdminIcon name="exception" size={20} /></span>
                <span><strong>Ngoại lệ cấp quản lý</strong><small>Ranh giới và việc vượt quyền</small></span>
              </Link>
              <Link className={activeSection === 'menu' ? 'menuItem isActive' : 'menuItem'} href="/menu">
                <span className="menuIcon"><AdminIcon name="menu" size={20} /></span>
                <span><strong>Menu ứng dụng</strong><small>Ứng dụng liên quan và thông tin PWA</small></span>
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

      <main className="main adminAppMain">
        <header className="pageHeader adminPageHeader">
          <p className="kicker">{kicker}</p>
          <h1>{title}</h1>
          <p className="pageSubtitle">{subtitle}</p>
        </header>
        {children}
      </main>

      <nav className="adminBottomNav" aria-label="Điều hướng ứng dụng">
        <BottomNavItem active={activeSection === 'overview'} href="/" icon="overview" label="Tổng quan" />
        <BottomNavItem active={activeSection === 'exceptions'} href="/customer-onboarding" icon="exception" label="Ngoại lệ" />
        <BottomNavItem active={activeSection === 'menu'} href="/menu" icon="menu" label="Menu" />
      </nav>
    </div>
  );
}
