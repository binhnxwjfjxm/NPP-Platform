"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

type BottomSheetProps = {
  title: string;
  description?: string;
  open?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  onClose?: () => void;
  variant?: "default" | "compact" | "workspace";
};

const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  background: "rgba(16, 24, 40, 0.54)",
  padding: "12px",
  overscrollBehavior: "contain",
  touchAction: "auto"
};

const workspaceBackdropStyle: CSSProperties = {
  ...backdropStyle,
  alignItems: "stretch",
  background: "var(--panel)",
  padding: 0
};

const defaultSheetStyle: CSSProperties = {
  width: "min(760px, 100%)",
  maxHeight: "min(88dvh, 760px)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  background: "var(--panel)",
  color: "var(--text)",
  border: "1px solid var(--line)",
  borderRadius: "24px 24px 18px 18px",
  boxShadow: "0 -24px 70px rgba(16, 24, 40, 0.28)",
  overscrollBehavior: "contain",
  touchAction: "pan-y"
};

const compactSheetStyle: CSSProperties = {
  ...defaultSheetStyle,
  width: "min(920px, 100%)",
  maxHeight: "min(92dvh, 860px)",
  borderRadius: "16px 16px 12px 12px",
  boxShadow: "0 -18px 52px rgba(16, 24, 40, 0.22)"
};

const workspaceSheetStyle: CSSProperties = {
  ...defaultSheetStyle,
  width: "100vw",
  height: "100dvh",
  maxWidth: "none",
  maxHeight: "100dvh",
  gap: 0,
  border: 0,
  borderRadius: 0,
  boxShadow: "none",
  padding: 0,
  touchAction: "auto"
};

const handleStyle: CSSProperties = {
  width: 44,
  height: 5,
  flex: "0 0 auto",
  alignSelf: "center",
  borderRadius: 999,
  background: "var(--line)",
  margin: "10px 0 4px"
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 16,
  flex: "0 0 auto",
  padding: "14px 20px 12px",
  borderBottom: "1px solid var(--line)"
};

const compactHeaderStyle: CSSProperties = {
  ...headerStyle,
  padding: "10px 14px 9px"
};

const workspaceHeaderStyle: CSSProperties = {
  ...headerStyle,
  minHeight: 58,
  alignItems: "center",
  padding: "max(8px, env(safe-area-inset-top)) 12px 8px",
  background: "var(--panel)"
};

const bodyStyle: CSSProperties = {
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
  padding: "18px 20px 20px",
  overscrollBehavior: "contain",
  WebkitOverflowScrolling: "touch",
  touchAction: "pan-y"
};

const compactBodyStyle: CSSProperties = {
  ...bodyStyle,
  padding: "10px 14px 12px"
};

const workspaceBodyStyle: CSSProperties = {
  ...bodyStyle,
  overflow: "hidden",
  padding: "8px",
  touchAction: "auto"
};

const footerStyle: CSSProperties = {
  flex: "0 0 auto",
  padding: "14px 20px calc(14px + env(safe-area-inset-bottom))",
  borderTop: "1px solid var(--line)",
  background: "var(--panel)"
};

const compactFooterStyle: CSSProperties = {
  ...footerStyle,
  padding: "9px 14px calc(9px + env(safe-area-inset-bottom))"
};

const workspaceFooterStyle: CSSProperties = {
  ...footerStyle,
  padding: "8px 10px max(8px, env(safe-area-inset-bottom))"
};

function backdropVariantStyle(variant: BottomSheetProps["variant"]) {
  return variant === "workspace" ? workspaceBackdropStyle : backdropStyle;
}

function sheetStyle(variant: BottomSheetProps["variant"]) {
  if (variant === "workspace") return workspaceSheetStyle;
  if (variant === "compact") return compactSheetStyle;
  return defaultSheetStyle;
}

function headerVariantStyle(variant: BottomSheetProps["variant"]) {
  if (variant === "workspace") return workspaceHeaderStyle;
  if (variant === "compact") return compactHeaderStyle;
  return headerStyle;
}

function bodyVariantStyle(variant: BottomSheetProps["variant"]) {
  if (variant === "workspace") return workspaceBodyStyle;
  if (variant === "compact") return compactBodyStyle;
  return bodyStyle;
}

function footerVariantStyle(variant: BottomSheetProps["variant"]) {
  if (variant === "workspace") return workspaceFooterStyle;
  if (variant === "compact") return compactFooterStyle;
  return footerStyle;
}

export function BottomSheet({ title, description, open = false, children, footer, onClose, variant = "default" }: BottomSheetProps) {
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const sheetRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || !mounted) return;

    const body = document.body;
    const html = document.documentElement;
    const scrollY = window.scrollY;
    const previousBody = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
      overscrollBehavior: body.style.overscrollBehavior
    };
    const previousHtml = {
      overflow: html.style.overflow,
      overscrollBehavior: html.style.overscrollBehavior
    };

    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "contain";
    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "contain";

    const focusFrame = window.requestAnimationFrame(() => {
      sheetRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current?.();
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      body.style.position = previousBody.position;
      body.style.top = previousBody.top;
      body.style.left = previousBody.left;
      body.style.right = previousBody.right;
      body.style.width = previousBody.width;
      body.style.overflow = previousBody.overflow;
      body.style.overscrollBehavior = previousBody.overscrollBehavior;
      html.style.overflow = previousHtml.overflow;
      html.style.overscrollBehavior = previousHtml.overscrollBehavior;
      window.scrollTo(0, scrollY);
    };
  }, [mounted, open]);

  if (!mounted || !open) return null;

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (variant !== "workspace" && event.target === event.currentTarget) onCloseRef.current?.();
  }

  const variantClass = variant === "default" ? "bottom-sheet" : `bottom-sheet bottom-sheet-${variant}`;

  return createPortal(
    <div className="sheet-backdrop" role="presentation" onClick={handleBackdropClick} style={backdropVariantStyle(variant)}>
      <section
        ref={sheetRef}
        className={variantClass}
        data-variant={variant}
        data-fullscreen={variant === "workspace" ? "true" : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        style={sheetStyle(variant)}
      >
        {variant === "workspace" ? null : <div className="sheet-handle" style={handleStyle} />}
        <header className="sheet-header" style={headerVariantStyle(variant)}>
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <button className="sheet-close" type="button" aria-label="Đóng" onClick={() => onCloseRef.current?.()}>
            ×
          </button>
        </header>
        <div className="sheet-body" style={bodyVariantStyle(variant)}>{children}</div>
        {footer ? <footer className="sheet-footer" style={footerVariantStyle(variant)}>{footer}</footer> : null}
      </section>
    </div>,
    document.body
  );
}
