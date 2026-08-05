import Link from "next/link";
import type { ReactNode } from "react";
import { FIELD_DOCK_ITEMS, SIDEBAR_NAV_ITEMS, navItemForHref, shellSectionForHref, type NavItem } from "./navigation";
import { AppTopBar, MobileAppMenuProvider } from "./MobileAppMenu";
import { MobileDock } from "./MobileDock";
import { MobileHomeLaunchpad } from "./MobileHomeLaunchpad";

const BOTTOM_NAV_LIMIT = 5;
const BOTTOM_NAV_ITEMS = FIELD_DOCK_ITEMS.slice(0, BOTTOM_NAV_LIMIT);

type AppShellProps = { children: ReactNode; activeHref?: string };

function NavLinks({ activeHref, items }: { activeHref: string; items: NavItem[] }) {
  return (
    <nav className="sidebar-nav" aria-label="Điều hướng chính">
      {items.map((item) => {
        const isActive = item.href === activeHref;
        return (
          <Link className={isActive ? "sidebar-link active" : "sidebar-link"} href={item.href} key={item.href} prefetch>
            <span className="nav-icon" aria-hidden="true">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function mobileBackHref(activeHref: string) {
  if (activeHref.startsWith("/mcp/sessions")) return "/visits";
  if (activeHref.startsWith("/customers")) return "/routes";
  if (activeHref.startsWith("/visits")) return "/routes";
  return "/";
}

function MobileContextBar({ activeHref }: { activeHref: string }) {
  if (activeHref === "/") return null;
  const current = navItemForHref(activeHref);
  return (
    <div className="mobile-context-bar" data-mobile-context-bar>
      <Link className="mobile-context-back" href={mobileBackHref(activeHref)} prefetch aria-label="Quay lại">
        <span aria-hidden="true">‹</span>
      </Link>
      <div className="mobile-context-copy">
        <small>MCP Field</small>
        <strong>{current.label}</strong>
      </div>
      <span className="mobile-context-status">Tác nghiệp</span>
    </div>
  );
}

export function AppShell({ children, activeHref = "/" }: AppShellProps) {
  const section = shellSectionForHref(activeHref);
  return (
    <MobileAppMenuProvider>
      <div className="app-shell" data-shell-section={section} data-active-href={activeHref}>
        <aside className="sidebar">
          <div className="sidebar-brand">
            <img className="sidebar-brand-logo" src="/npp-app-icon.png" alt="NPP" />
            <div>
              <div className="sidebar-title">MCP-Plan</div>
              <div className="sidebar-subtitle">Quản lý tuyến bán hàng, điểm bán, đơn hàng và công việc.</div>
            </div>
          </div>
          <NavLinks activeHref={activeHref} items={SIDEBAR_NAV_ITEMS} />
          <Link className={activeHref === "/settings" ? "sidebar-link active utility-link" : "sidebar-link utility-link"} href="/settings" prefetch>
            <span className="nav-icon" aria-hidden="true">⚙</span><span>Cài đặt ứng dụng</span>
          </Link>
          <div className="sidebar-footer">MCP-Plan · Quản lý phân phối</div>
        </aside>
        <div className="app-content-shell" data-app-content-shell>
          <AppTopBar activeHref={activeHref} />
          <MobileContextBar activeHref={activeHref} />
          <main className="main" data-app-scroll-region>
            {activeHref === "/" ? <MobileHomeLaunchpad /> : null}
            {children}
          </main>
          <MobileDock items={BOTTOM_NAV_ITEMS} data-bottom-navigation="true" data-navigation-item-count={BOTTOM_NAV_ITEMS.length} />
        </div>
      </div>
    </MobileAppMenuProvider>
  );
}
