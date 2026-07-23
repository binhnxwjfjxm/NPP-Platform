"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { APP_MENU_GROUPS, navItemForHref } from "./navigation";
import styles from "./MobileAppMenu.module.css";

export type MobileAppMenuItem = {
  id: string;
  label: string;
  description?: string;
  icon: string;
  tone?: "default" | "danger";
  disabled?: boolean;
  keepOpen?: boolean;
  onSelect: () => void | boolean | Promise<void | boolean>;
};

export type MobileAppMenuRegistration = {
  title?: string;
  description?: string;
  items: MobileAppMenuItem[];
  message?: string | null;
};

type MobileAppMenuContextValue = {
  register: (registration: MobileAppMenuRegistration) => () => void;
  openMenu: () => void;
  menuOpen: boolean;
};

const MobileAppMenuContext = createContext<MobileAppMenuContextValue | null>(null);

export function useRegisterMobileAppMenu(registration: MobileAppMenuRegistration) {
  const context = useContext(MobileAppMenuContext);
  if (!context) throw new Error("useRegisterMobileAppMenu must be used inside MobileAppMenuProvider");

  useEffect(() => context.register(registration), [context, registration]);
}

export function MobileAppMenuProvider({ children }: { children: ReactNode }) {
  const parent = useContext(MobileAppMenuContext);
  if (parent) return <>{children}</>;
  return <MobileAppMenuRoot>{children}</MobileAppMenuRoot>;
}

export function AppTopBar({ activeHref }: { activeHref: string }) {
  const context = useContext(MobileAppMenuContext);
  if (!context) throw new Error("AppTopBar must be used inside MobileAppMenuProvider");
  const current = navItemForHref(activeHref);

  return (
    <header className={styles.topBar} data-app-top-bar>
      <div className={styles.topBarIdentity}>
        <span className={styles.topBarMark} aria-hidden="true">HP</span>
        <span className={styles.topBarCopy}>
          <small>MCP-Plan</small>
          <strong>{current.label}</strong>
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
        <div data-app-top-bar-tools style={{ display: "flex", alignItems: "center", gap: 8 }} />
        <button
          aria-expanded={context.menuOpen}
          aria-haspopup="dialog"
          aria-label="Mở menu ứng dụng"
          className={styles.trigger}
          type="button"
          onClick={context.openMenu}
        >
          <span aria-hidden="true">☰</span>
        </button>
      </div>
    </header>
  );
}

type TopMenuPanelProps = {
  children: ReactNode;
  description: string;
  onClose: () => void;
  open: boolean;
  title: string;
};

function TopMenuPanel({ children, description, onClose, open, title }: TopMenuPanelProps) {
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);

  useEffect(() => setMounted(true), []);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open || !mounted) return;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousOverscroll = body.style.overscrollBehavior;
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "contain";

    const focusFrame = window.requestAnimationFrame(() => panelRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      body.style.overflow = previousOverflow;
      body.style.overscrollBehavior = previousOverscroll;
    };
  }, [mounted, open]);

  if (!mounted || !open) return null;

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) closeRef.current();
  }

  return createPortal(
    <div className={styles.menuBackdrop} role="presentation" onClick={handleBackdropClick}>
      <section
        ref={panelRef}
        className={styles.menuPanel}
        data-app-menu-panel="true"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <header className={styles.panelHeader}>
          <div className={styles.panelTitle}>
            <span className={styles.panelMark} aria-hidden="true">HP</span>
            <div>
              <h2 id={titleId}>{title}</h2>
              <p id={descriptionId}>{description}</p>
            </div>
          </div>
          <button className={styles.panelClose} type="button" aria-label="Đóng" onClick={() => closeRef.current()}>×</button>
        </header>
        <div className={styles.panelBody}>{children}</div>
      </section>
    </div>,
    document.body
  );
}

function MobileAppMenuRoot({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [registration, setRegistration] = useState<MobileAppMenuRegistration | null>(null);

  const register = useCallback((next: MobileAppMenuRegistration) => {
    setRegistration(next);
    return () => {
      setRegistration((current) => (current === next ? null : current));
    };
  }, []);
  const openMenu = useCallback(() => setOpen(true), []);
  const contextValue = useMemo(() => ({ register, openMenu, menuOpen: open }), [register, openMenu, open]);
  const isSettings = pathname === "/settings";

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  async function handleItem(item: MobileAppMenuItem) {
    if (item.disabled) return;
    if (!item.keepOpen) setOpen(false);
    const result = await item.onSelect();
    if (item.keepOpen && result === true) setOpen(false);
  }

  function navigate(href: string) {
    setOpen(false);
    router.push(href);
  }

  function handleSettings() {
    setOpen(false);
    if (isSettings) {
      if (window.history.length > 1) router.back();
      else router.push("/");
      return;
    }
    router.push("/settings");
  }

  function isActive(href: string) {
    return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
  }

  const contextualItems = registration?.items || [];
  const title = registration?.title || "Menu MCP";
  const description = registration?.description || "Chuyển phân hệ, mở tác vụ màn hình và cấu hình ứng dụng.";

  return (
    <MobileAppMenuContext.Provider value={contextValue}>
      {children}
      <TopMenuPanel open={open} onClose={() => setOpen(false)} title={title} description={description}>
        <div className={styles.menuList}>
          {contextualItems.length ? (
            <section className={styles.menuSection} aria-label="Tác vụ màn hình">
              <div className={styles.sectionHeading}>
                <strong>Tác vụ màn hình</strong>
                <small>Áp dụng cho nội dung đang mở</small>
              </div>
              {contextualItems.map((item) => (
                <button
                  className={`${styles.menuItem} ${item.tone === "danger" ? styles.danger : ""}`}
                  disabled={item.disabled}
                  key={item.id}
                  type="button"
                  onClick={() => void handleItem(item)}
                >
                  <span className={styles.menuIcon} aria-hidden="true">{item.icon}</span>
                  <span className={styles.menuCopy}>
                    <strong>{item.label}</strong>
                    {item.description ? <small>{item.description}</small> : null}
                  </span>
                  <span className={styles.menuChevron} aria-hidden="true">›</span>
                </button>
              ))}
            </section>
          ) : null}

          {APP_MENU_GROUPS.map((group) => (
            <section className={styles.menuSection} aria-label={group.label} key={group.id}>
              <div className={styles.sectionHeading}><strong>{group.label}</strong></div>
              <div className={styles.navigationGrid}>
                {group.items.map((item) => (
                  <button
                    aria-current={isActive(item.href) ? "page" : undefined}
                    className={`${styles.navItem} ${isActive(item.href) ? styles.navItemActive : ""}`}
                    key={item.href}
                    type="button"
                    onClick={() => navigate(item.href)}
                  >
                    <span className={styles.navIcon} aria-hidden="true">{item.icon}</span>
                    <span className={styles.navCopy}>
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}

          <div className={styles.divider} />
          <button className={`${styles.menuItem} ${isSettings ? styles.menuItemActive : ""}`} type="button" onClick={handleSettings}>
            <span className={styles.menuIcon} aria-hidden="true">⚙</span>
            <span className={styles.menuCopy}>
              <strong>{isSettings ? "Đóng cài đặt" : "Cài đặt ứng dụng"}</strong>
              <small>{isSettings ? "Quay lại màn hình trước." : "Cấu hình dữ liệu và hành vi ứng dụng."}</small>
            </span>
            <span className={styles.menuChevron} aria-hidden="true">›</span>
          </button>

          {registration?.message ? <p className={styles.error}>{registration.message}</p> : null}
        </div>
      </TopMenuPanel>
    </MobileAppMenuContext.Provider>
  );
}
