'use client';

import { canonicalDecimalString, canonicalVndMinorString } from '@npp/contracts';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import type { SalesOrder, SalesOrderVersion } from '../../../lib/sales-order-types';
import SalesOrderCommercialForm from './SalesOrderCommercialForm';
import { activeVersion, apiRequest } from './sales-order-ui';
import styles from './sales-orders.module.css';

export { type SalesOrderFormMode } from './SalesOrderCommercialForm';

type SalesOrderFormProps = ComponentProps<typeof SalesOrderCommercialForm>;
type SalesOrderEditorTarget = Readonly<{
  mode: SalesOrderFormProps['mode'];
  orderId: SalesOrderFormProps['orderId'];
  version: SalesOrderFormProps['version'];
}>;

const SALES_ORDER_DIALOG_SELECTOR = '[role="dialog"][aria-label="Biểu mẫu đơn bán hàng"]';
const CUSTOMER_SEARCH_SELECTOR = '[data-testid="sales-customer-search-input"]';
const CUSTOMER_RESULTS_SELECTOR = '[data-testid="sales-customer-results"]';
const PRODUCT_SEARCH_SELECTOR = '[aria-label="Nhập hàng hóa"] input[autocomplete="off"]';
const QUICK_CUSTOMER_SELECTOR = '[aria-label="Tạo nhanh khách hàng"]';
const QUANTITY_INPUT_PREFIX = 'Số lượng ';
const PRICE_INPUT_PREFIX = 'Đơn giá ';

export function captureSalesOrderEditorTarget(
  mode: SalesOrderFormProps['mode'],
  orderId: SalesOrderFormProps['orderId'],
  version: SalesOrderFormProps['version'],
): SalesOrderEditorTarget {
  return Object.freeze({
    mode,
    orderId: mode === 'create' ? undefined : orderId,
    version: version ?? null,
  });
}

export function normalizeVndMinor(value: string | number | null | undefined): string {
  const normalized = String(value ?? '').trim();
  return canonicalVndMinorString(normalized) ?? normalized;
}

export function normalizeEditableDecimal(value: string | number | null | undefined): string {
  const normalized = String(value ?? '').trim();
  return canonicalDecimalString(normalized, { allowNegative: false }) ?? normalized;
}

export function normalizeVersionForEditing(
  version: SalesOrderFormProps['version'],
): SalesOrderFormProps['version'] {
  if (!version?.lines) return version;
  return {
    ...version,
    lines: version.lines.map((line) => ({
      ...line,
      baseUnitPrice: normalizeVndMinor(line.baseUnitPrice),
      systemUnitPrice: normalizeVndMinor(line.systemUnitPrice),
      unitPrice: normalizeVndMinor(line.unitPrice),
      discountValue: normalizeEditableDecimal(line.discountValue),
    })),
  };
}

export function prepareSalesOrderCopyVersion(version: SalesOrderVersion): SalesOrderVersion {
  return {
    ...version,
    requestedDeliveryDate: null,
    priceOverrideReason: null,
    lines: version.lines?.map((line) => ({
      ...line,
      priceSource: 'PRICE_ENGINE' as const,
      manualOverrideReason: null,
      pricingTrace: [],
    })),
  };
}

function InlineFormError({ message }: { message: string | null }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setTarget(document.querySelector<HTMLElement>(`.${styles.orderEditorFooter}`));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  if (!message || !target) return null;
  return createPortal(
    <div className="salesOrderFormInlineError" role="alert" data-testid="sales-order-form-error">
      {message}
    </div>,
    target,
  );
}

function focusAndSelect(input: HTMLInputElement | null): boolean {
  if (!input || input.disabled) return false;
  input.focus();
  input.select();
  return true;
}

function customerResultButtons(dialog: HTMLElement): HTMLButtonElement[] {
  return Array.from(dialog.querySelectorAll<HTMLButtonElement>(`${CUSTOMER_RESULTS_SELECTOR} button:not(:disabled)`));
}

function shortcutTargetIsIgnored(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(QUICK_CUSTOMER_SELECTOR)) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return target.tagName === 'TEXTAREA';
}

function useSalesOrderKeyboardShortcuts(disabled: boolean) {
  useEffect(() => {
    if (disabled) return;
    const dialog = document.querySelector<HTMLElement>(SALES_ORDER_DIALOG_SELECTOR);
    if (!dialog) return;

    const customerSearch = dialog.querySelector<HTMLInputElement>(CUSTOMER_SEARCH_SELECTOR);
    const productSearch = dialog.querySelector<HTMLInputElement>(PRODUCT_SEARCH_SELECTOR);
    customerSearch?.setAttribute('aria-keyshortcuts', 'F4');
    productSearch?.setAttribute('aria-keyshortcuts', 'F3');

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (shortcutTargetIsIgnored(event.target)) return;

      const currentDialog = document.querySelector<HTMLElement>(SALES_ORDER_DIALOG_SELECTOR);
      if (!currentDialog) return;
      const currentCustomerSearch = currentDialog.querySelector<HTMLInputElement>(CUSTOMER_SEARCH_SELECTOR);
      const currentProductSearch = currentDialog.querySelector<HTMLInputElement>(PRODUCT_SEARCH_SELECTOR);

      if (event.key === 'F4' && focusAndSelect(currentCustomerSearch)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key === 'F3' && focusAndSelect(currentProductSearch)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const target = event.target;
      if (target instanceof HTMLInputElement && target === currentCustomerSearch) {
        const buttons = customerResultButtons(currentDialog);
        if (buttons.length === 0) return;
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          event.stopPropagation();
          buttons[0]?.focus();
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          event.stopPropagation();
          buttons.at(-1)?.focus();
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          buttons[0]?.click();
          return;
        }
      }

      if (target instanceof HTMLButtonElement && target.closest(CUSTOMER_RESULTS_SELECTOR)) {
        const buttons = customerResultButtons(currentDialog);
        const index = buttons.indexOf(target);
        if (index < 0) return;
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          event.stopPropagation();
          buttons[Math.min(index + 1, buttons.length - 1)]?.focus();
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          event.stopPropagation();
          if (index === 0) currentCustomerSearch?.focus();
          else buttons[index - 1]?.focus();
          return;
        }
      }

      if (!(target instanceof HTMLInputElement)) return;
      const ariaLabel = target.getAttribute('aria-label') ?? '';
      if (!ariaLabel.startsWith(QUANTITY_INPUT_PREFIX)) return;
      const line = target.closest('article');
      if (!line) return;

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const direction = event.key === 'ArrowUp' ? 'Tăng số lượng ' : 'Giảm số lượng ';
        const action = line.querySelector<HTMLButtonElement>(`button[aria-label^="${direction}"]`);
        if (!action || action.disabled) return;
        event.preventDefault();
        event.stopPropagation();
        action.click();
        target.select();
        return;
      }

      if (event.key === 'Tab') {
        const priceInput = line.querySelector<HTMLInputElement>(`input[aria-label^="${PRICE_INPUT_PREFIX}"]`);
        if (!priceInput || priceInput.disabled) return;
        event.preventDefault();
        event.stopPropagation();
        focusAndSelect(priceInput);
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      customerSearch?.removeAttribute('aria-keyshortcuts');
      productSearch?.removeAttribute('aria-keyshortcuts');
    };
  }, [disabled]);
}

export default function SalesOrderForm(props: SalesOrderFormProps) {
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [copyVersion, setCopyVersion] = useState<SalesOrderVersion | null>(null);
  const [copyLoading, setCopyLoading] = useState(false);
  const copyHandledRef = useRef(false);
  const onCloseRef = useRef(props.onClose);
  const onErrorRef = useRef(props.onError);
  const editorTargetRef = useRef<SalesOrderEditorTarget | null>(null);
  if (!editorTargetRef.current) {
    editorTargetRef.current = captureSalesOrderEditorTarget(props.mode, props.orderId, props.version);
  }
  const editorTarget = editorTargetRef.current;

  useEffect(() => {
    onCloseRef.current = props.onClose;
  }, [props.onClose]);

  useEffect(() => {
    onErrorRef.current = props.onError;
  }, [props.onError]);

  useEffect(() => {
    if (copyHandledRef.current || editorTarget.mode !== 'create' || editorTarget.version) return;

    const params = new URLSearchParams(window.location.search);
    const copyFrom = params.get('copyFrom')?.trim();
    if (!copyFrom) return;
    copyHandledRef.current = true;

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete('copyFrom');
    window.history.replaceState(
      window.history.state,
      '',
      `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`,
    );

    let disposed = false;
    setCopyLoading(true);
    onErrorRef.current('');

    void apiRequest<SalesOrder>(`/api/sales-orders/${encodeURIComponent(copyFrom)}`)
      .then((source) => {
        if (disposed) return;
        const sourceVersion = activeVersion(source);
        if (!sourceVersion) {
          throw new Error('Đơn nguồn không còn dữ liệu phiên bản để sao chép.');
        }
        setCopyVersion(prepareSalesOrderCopyVersion(sourceVersion));
        setCopyLoading(false);
      })
      .catch((error) => {
        if (disposed) return;
        setCopyLoading(false);
        onErrorRef.current(error instanceof Error ? error.message : 'Không nạp được đơn nguồn để sao chép.');
        onCloseRef.current();
      });

    return () => {
      disposed = true;
    };
  }, [editorTarget]);

  const normalizedVersion = useMemo(
    () => normalizeVersionForEditing(editorTarget.version ?? copyVersion),
    [copyVersion, editorTarget],
  );

  const handleError = useCallback((message: string) => {
    setInlineError(message || null);
    onErrorRef.current(message);
  }, []);

  useSalesOrderKeyboardShortcuts(copyLoading);

  if (copyLoading) {
    return (
      <div className={styles.modalBackdrop} role="presentation">
        <section
          className={styles.orderEditorModal}
          role="dialog"
          aria-modal="true"
          aria-label="Đang chuẩn bị đơn bán hàng mới"
        >
          <header className={styles.modalHeader}>
            <div>
              <p className={styles.eyebrow}>Bán hàng</p>
              <h2>Đang chuẩn bị đơn mới</h2>
            </div>
          </header>
          <div className={styles.orderEditorBody}>
            <p>Đang nạp dữ liệu từ đơn nguồn…</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <>
      <SalesOrderCommercialForm
        key={`${editorTarget.mode}:${editorTarget.orderId ?? 'new-sales-order'}:${normalizedVersion?.id ?? 'no-version'}`}
        {...props}
        mode={editorTarget.mode}
        orderId={editorTarget.orderId}
        version={normalizedVersion}
        onError={handleError}
      />
      <InlineFormError message={inlineError} />
      <style>{`
        .${styles.orderEditorModal}{width:min(1520px,calc(100vw - 1rem));height:min(96vh,1020px)}
        .${styles.orderEditorBody}{grid-auto-rows:max-content}
        .${styles.compactHeader}{align-items:start}
        .${styles.skuResults}{max-height:min(500px,calc(100dvh - 220px))}
        .${styles.skuResults}[data-testid="sales-customer-results"] button:focus-visible{outline:2px solid currentColor;outline-offset:-2px}
        .salesOrderFormInlineError{grid-column:1/-1;padding:.65rem .8rem;border:1px solid #e2a696;border-radius:10px;background:#fff3ef;color:#8f3528;font-weight:750}
        .${styles.lineTableHeader}>span:nth-child(5),.${styles.lineTableHeader}>span:nth-child(6){text-align:center}
        .${styles.directPriceInput}{text-align:center!important}
        .${styles.discountControls} select{text-align:center!important;text-align-last:center}
        .${styles.discountControls} input{text-align:center!important}
      `}</style>
    </>
  );
}