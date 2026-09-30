"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import styles from "./McpFoundation.module.css";

export type McpBottomNavItem = {
  href: string;
  label: string;
  icon: ReactNode;
};

function isActiveHref(activeHref: string, href: string) {
  return activeHref === href;
}

function isVisitFlow(pathname: string) {
  return pathname === "/visits"
    || pathname.startsWith("/visits/")
    || pathname === "/mcp/sessions"
    || pathname.startsWith("/mcp/sessions/");
}

export function McpBottomNav({ items, activeHref }: { items: McpBottomNavItem[]; activeHref: string }) {
  const pathname = usePathname();
  const documentNavigation = isVisitFlow(pathname);

  return (
    <nav aria-label="Điều hướng chính" className={styles.bottomNav}>
      {items.map((item) => {
        const active = isActiveHref(activeHref, item.href);
        const content = (
          <>
            <span aria-hidden="true" className={styles.bottomNavIcon}>{item.icon}</span>
            <span className={styles.bottomNavLabel}>{item.label}</span>
          </>
        );
        const className = [styles.bottomNavItem, active ? styles.bottomNavItemActive : ""].filter(Boolean).join(" ");

        if (documentNavigation) {
          return (
            <a
              aria-current={active ? "page" : undefined}
              className={className}
              data-document-navigation="true"
              href={item.href}
              key={item.href}
            >
              {content}
            </a>
          );
        }

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={className}
            data-client-navigation="true"
            href={item.href}
            key={item.href}
            prefetch={false}
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
