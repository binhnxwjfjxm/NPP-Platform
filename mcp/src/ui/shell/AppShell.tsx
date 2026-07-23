import Link from "next/link";
import type { ReactNode } from "react";
import { PRIMARY_NAV_ITEMS, SIDEBAR_NAV_ITEMS, shellSectionForHref, type NavItem } from "./navigation";
import { AppTopBar, MobileAppMenuProvider } from "./MobileAppMenu";

const BOTTOM_NAV_LIMIT = 5;
const BOTTOM_NAV_ITEMS = PRIMARY_NAV_ITEMS.slice(0, BOTTOM_NAV_LIMIT);

type AppShellProps = { children: ReactNode; activeHref?: string };

function NavLinks({ activeHref, items, mode }: { activeHref: string; items: NavItem[]; mode: "sidebar" | "bottom" }) {
  const style = mode === "bottom" ? { gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` } : undefined;
  return <nav
    className={mode === "sidebar" ? "sidebar-nav" : "bottom-nav"}
    data-bottom-navigation={mode === "bottom" ? "true" : undefined}
    data-navigation-item-count={mode === "bottom" ? items.length : undefined}
    style={style}
    aria-label="Điều hướng chính"
  >
    {items.map((item) => {
      const isActive = item.href === activeHref;
      const className = mode === "sidebar" ? (isActive ? "sidebar-link active" : "sidebar-link") : (isActive ? "bottom-nav-link active" : "bottom-nav-link");
      return <Link className={className} href={item.href} key={item.href} prefetch><span className="nav-icon" aria-hidden="true">{item.icon}</span><span className="nav-label">{mode === "sidebar" ? item.label : item.shortLabel}</span></Link>;
    })}
  </nav>;
}

export function AppShell({ children, activeHref = "/" }: AppShellProps) {
  const section = shellSectionForHref(activeHref);
  return <MobileAppMenuProvider><div className="app-shell" data-shell-section={section} data-active-href={activeHref}>
    <aside className="sidebar">
      <div className="sidebar-brand"><div className="sidebar-title">MCP-Plan</div><div className="sidebar-subtitle">Quản lý tuyến bán hàng, điểm bán, đơn hàng và công việc.</div></div>
      <NavLinks activeHref={activeHref} items={SIDEBAR_NAV_ITEMS} mode="sidebar" />
      <Link className={activeHref === "/settings" ? "sidebar-link active utility-link" : "sidebar-link utility-link"} href="/settings" prefetch><span className="nav-icon" aria-hidden="true">⚙</span><span>Cài đặt ứng dụng</span></Link>
      <div className="sidebar-footer">MCP-Plan · Quản lý phân phối</div>
    </aside>
    <div className="app-content-shell" data-app-content-shell>
      <AppTopBar activeHref={activeHref} />
      <main className="main" data-app-scroll-region>{children}</main>
      <NavLinks activeHref={activeHref} items={BOTTOM_NAV_ITEMS} mode="bottom" />
    </div>
  </div></MobileAppMenuProvider>;
}
