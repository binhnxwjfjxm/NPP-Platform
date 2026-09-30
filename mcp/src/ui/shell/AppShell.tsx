"use client";

import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { ReportsModeTabs } from "@/features/market-reports/ReportsModeTabs";
import { McpBottomNav } from "@/ui/foundation";
import { AppTopBar, MobileAppMenuProvider } from "./MobileAppMenu";
import { NavIcon } from "./NavIcon";
import {
  PRIMARY_NAV_ITEMS,
  navItemForHref,
  primaryNavItemForHref,
  shellSectionForHref,
  type NavItem
} from "./navigation";
import styles from "./AppShell.module.css";

type AppShellProps = { children: ReactNode; activeHref?: string };

function NavLinks({ activeHref, items }: { activeHref: string; items: NavItem[] }) {
  const activePrimaryHref = primaryNavItemForHref(activeHref).href;

  return (
    <nav className={styles.primaryNav} aria-label="Điều hướng chính">
      {items.map((item) => {
        const active = item.href === activePrimaryHref;
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={active ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}
            href={item.href}
            key={item.href}
            prefetch={false}
          >
            <span className={styles.navIcon} aria-hidden="true"><NavIcon name={item.icon} width="21" height="21" /></span>
            <span className={styles.navCopy}>
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children, activeHref = "/" }: AppShellProps) {
  const section = shellSectionForHref(activeHref);
  const current = navItemForHref(activeHref);
  const activePrimary = primaryNavItemForHref(activeHref);
  const bottomItems = PRIMARY_NAV_ITEMS.map((item) => ({
    href: item.href,
    label: item.shortLabel,
    icon: <NavIcon name={item.icon} width="22" height="22" />
  }));

  return (
    <MobileAppMenuProvider>
      <div
        className={styles.shell}
        data-active-href={activeHref}
        data-mcp-app-shell="true"
        data-shell-section={section}
      >
        <aside className={styles.sidebar} data-mcp-sidebar="true">
          <div className={styles.brand}>
            <img className={styles.brandLogo} src="/npp-app-icon.png" alt="MCP Field" />
            <div className={styles.brandCopy}>
              <strong>MCP-Plan</strong>
              <span>Tác nghiệp thị trường</span>
            </div>
          </div>
          <NavLinks activeHref={activeHref} items={PRIMARY_NAV_ITEMS} />
          <div className={styles.sidebarContext}>
            <small>Màn hình đang mở</small>
            <strong>{current.label}</strong>
          </div>
        </aside>

        <div className={styles.contentShell} data-mcp-app-content-shell="true">
          <AppTopBar activeHref={activeHref} />
          <main className={styles.main} data-mcp-scroll-region="true">
            {activeHref === "/reports" ? <Suspense fallback={null}><ReportsModeTabs /></Suspense> : null}
            {children}
          </main>
          <div
            className={styles.bottomNavSlot}
            data-mcp-bottom-navigation="true"
            data-navigation-item-count={PRIMARY_NAV_ITEMS.length}
          >
            <McpBottomNav items={bottomItems} activeHref={activePrimary.href} />
          </div>
        </div>
      </div>
    </MobileAppMenuProvider>
  );
}
