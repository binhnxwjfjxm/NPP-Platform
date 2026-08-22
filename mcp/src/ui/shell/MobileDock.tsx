"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type CSSProperties, type HTMLAttributes } from "react";
import { NavIcon } from "./NavIcon";
import type { NavItem } from "./navigation";

type MobileDockProps = HTMLAttributes<HTMLElement> & {
  items: NavItem[];
};

function isItemActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/visits") return pathname === "/visits" || pathname.startsWith("/visits/") || pathname.startsWith("/mcp/sessions/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isVisitFlow(pathname: string) {
  return pathname === "/visits"
    || pathname.startsWith("/visits/")
    || pathname === "/mcp/sessions"
    || pathname.startsWith("/mcp/sessions/");
}

export function MobileDock({ items, style, ...props }: MobileDockProps) {
  const pathname = usePathname();
  const activeIndex = Math.max(0, items.findIndex((item) => isItemActive(pathname, item.href)));
  const [intentIndex, setIntentIndex] = useState<number | null>(null);
  const visualIndex = intentIndex ?? activeIndex;
  const dockStyle = {
    ...style,
    "--mobile-dock-index": visualIndex,
    "--mobile-dock-offset": `${visualIndex * 100}%`
  } as CSSProperties;

  return (
    <nav {...props} className="mobile-app-dock" style={dockStyle} aria-label="Điều hướng tác nghiệp">
      <span className="mobile-app-dock-indicator" aria-hidden="true" />
      {items.map((item, index) => {
        const active = isItemActive(pathname, item.href);
        const primary = item.href === "/visits";
        const intended = intentIndex === index;
        const documentNavigation = primary || isVisitFlow(pathname);
        const className = `mobile-app-dock-link bottom-nav-link${active ? " active" : ""}${primary ? " primary" : ""}`;
        const content = (
          <>
            <span className="mobile-app-dock-icon nav-icon" aria-hidden="true"><NavIcon name={item.icon} width="22" height="22" /></span>
            <span className="mobile-app-dock-label nav-label">{item.shortLabel}</span>
          </>
        );
        const interactionProps = {
          onBlur: () => setIntentIndex(null),
          onFocus: () => setIntentIndex(index),
          onPointerCancel: () => setIntentIndex(null),
          onPointerDown: () => setIntentIndex(index)
        };

        if (documentNavigation) {
          return (
            <a
              aria-current={active ? "page" : undefined}
              className={className}
              data-document-navigation="true"
              data-interaction-feedback="selection"
              data-motion-intent={intended ? "true" : undefined}
              data-primary-action={primary ? "true" : undefined}
              href={item.href}
              key={item.href}
              {...interactionProps}
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
            data-interaction-feedback="selection"
            data-motion-intent={intended ? "true" : undefined}
            data-primary-action={primary ? "true" : undefined}
            href={item.href}
            key={item.href}
            prefetch={false}
            {...interactionProps}
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
