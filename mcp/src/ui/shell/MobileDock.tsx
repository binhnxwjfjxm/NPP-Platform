"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { HTMLAttributes } from "react";
import type { NavItem } from "./navigation";

type MobileDockProps = HTMLAttributes<HTMLElement> & {
  items: NavItem[];
};

function isItemActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/visits") return pathname === "/visits" || pathname.startsWith("/visits/") || pathname.startsWith("/mcp/sessions/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MobileDock({ items, ...props }: MobileDockProps) {
  const pathname = usePathname();

  return (
    <nav {...props} className="mobile-app-dock" aria-label="Điều hướng tác nghiệp">
      {items.map((item) => {
        const active = isItemActive(pathname, item.href);
        const primary = item.href === "/visits";
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={`mobile-app-dock-link${active ? " active" : ""}${primary ? " primary" : ""}`}
            data-primary-action={primary ? "true" : undefined}
            href={item.href}
            key={item.href}
            prefetch
          >
            <span className="mobile-app-dock-icon" aria-hidden="true">{item.icon}</span>
            <span className="mobile-app-dock-label">{item.shortLabel}</span>
          </Link>
        );
      })}
    </nav>
  );
}
