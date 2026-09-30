import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./McpFoundation.module.css";

export type McpBottomNavItem = {
  href: string;
  label: string;
  icon: ReactNode;
};

function isActiveHref(activeHref: string, href: string) {
  if (href === "/") return activeHref === "/";
  return activeHref === href || activeHref.startsWith(`${href}/`);
}

export function McpBottomNav({ items, activeHref }: { items: McpBottomNavItem[]; activeHref: string }) {
  return (
    <nav aria-label="Điều hướng chính" className={styles.bottomNav}>
      {items.map((item) => {
        const active = isActiveHref(activeHref, item.href);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={[styles.bottomNavItem, active ? styles.bottomNavItemActive : ""].filter(Boolean).join(" ")}
            href={item.href}
            key={item.href}
            prefetch={false}
          >
            <span aria-hidden="true" className={styles.bottomNavIcon}>{item.icon}</span>
            <span className={styles.bottomNavLabel}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
