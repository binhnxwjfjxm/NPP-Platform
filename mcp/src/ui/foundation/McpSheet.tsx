"use client";

import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./McpFoundation.module.css";

type McpSheetProps = {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
};

export function McpSheet({ open, title, description, children, footer, onClose }: McpSheetProps) {
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
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    const focusFrame = window.requestAnimationFrame(() => sheetRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      body.style.overflow = previousOverflow;
    };
  }, [mounted, open]);

  if (!mounted || !open) return null;

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onCloseRef.current();
  }

  return createPortal(
    <div className={styles.sheetBackdrop} onClick={handleBackdropClick} role="presentation">
      <section
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={styles.sheet}
        ref={sheetRef}
        role="dialog"
        tabIndex={-1}
      >
        <div aria-hidden="true" className={styles.sheetHandle} />
        <header className={styles.sheetHeader}>
          <div className={styles.sheetHeading}>
            <h2 className={styles.sheetTitle} id={titleId}>{title}</h2>
            {description ? <p className={styles.sheetDescription} id={descriptionId}>{description}</p> : null}
          </div>
          <button aria-label="Đóng" className={styles.sheetClose} onClick={() => onCloseRef.current()} type="button">×</button>
        </header>
        <div className={styles.sheetBody}>{children}</div>
        {footer ? <footer className={styles.sheetFooter}>{footer}</footer> : null}
      </section>
    </div>,
    document.body
  );
}
