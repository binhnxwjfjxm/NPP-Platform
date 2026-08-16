"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useMcpAccess } from "@/lib/use-mcp-access";
import { FIELD_DOCK_ITEMS, SETTINGS_NAV_ITEM, SIDEBAR_NAV_ITEMS, shellSectionForHref, type NavItem } from "./navigation";
import { AppTopBar, MobileAppMenuProvider } from "./MobileAppMenu";
import { MobileDock } from "./MobileDock";
import { MobileHomeLaunchpad } from "./MobileHomeLaunchpad";
import { NavIcon } from "./NavIcon";

const BOTTOM_NAV_LIMIT = 5;
const BOTTOM_NAV_ITEMS = FIELD_DOCK_ITEMS.slice(0, BOTTOM_NAV_LIMIT);

type AppShellProps = { children: ReactNode; activeHref?: string };

function NavLinks({ activeHref, items }: { activeHref: string; items: NavItem[] }) {
  return (
    <nav className="sidebar-nav" aria-label="Điều hướng chính">
      {items.map((item) => {
        const isActive = item.href === activeHref;
        return (
          <Link className={isActive ? "sidebar-link active" : "sidebar-link"} href={item.href} key={item.href} prefetch={false}>
            <span className="nav-icon" aria-hidden="true"><NavIcon name={item.icon} width="20" height="20" /></span>
            <span className="nav-label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function requiredNavigationPermission(href: string) {
  if (href === "/routes") return "mcp.route.write";
  if (href === "/mcp-setting") return "mcp.report-setting.write";
  return null;
}

export function AppShell({ children, activeHref = "/" }: AppShellProps) {
  const section = shellSectionForHref(activeHref);
  const access = useMcpAccess();
  const sidebarItems = SIDEBAR_NAV_ITEMS.filter((item) => {
    const permission = requiredNavigationPermission(item.href);
    return !permission || access.hasPermission(permission);
  });

  return (
    <MobileAppMenuProvider>
      <div className="app-shell" data-shell-section={section} data-active-href={activeHref}>
        <aside className="sidebar">
          <div className="sidebar-brand">
            <img className="sidebar-brand-logo" src="/npp-app-icon.png" alt="Công Ty" />
            <div>
              <div className="sidebar-title">MCP-Plan</div>
              <div className="sidebar-subtitle">Quản lý hoạt động thị trường, điểm bán, đơn hàng và công việc.</div>
            </div>
          </div>
          <NavLinks activeHref={activeHref} items={sidebarItems} />
          <Link className={activeHref === "/settings" ? "sidebar-link active utility-link" : "sidebar-link utility-link"} href="/settings" prefetch={false}>
            <span className="nav-icon" aria-hidden="true"><NavIcon name={SETTINGS_NAV_ITEM.icon} width="20" height="20" /></span><span>Cài đặt ứng dụng</span>
          </Link>
          <div className="sidebar-footer">MCP-Plan · Hoạt động thị trường</div>
        </aside>
        <div className="app-content-shell" data-app-content-shell>
          <AppTopBar activeHref={activeHref} />
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
