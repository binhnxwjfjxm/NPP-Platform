'use client';

import { canonicalDecimalString, canonicalVndMinorString } from '@npp/contracts';
import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import type { SalesOrder, SalesOrderVersion } from '../../../lib/sales-order-types';
import SalesOrderCommercialForm from './SalesOrderCommercialForm';
import { activeVersion, apiRequest } from './sales-order-ui';
import styles from './sales-orders.module.css';

export { type SalesOrderFormMode } from './SalesOrderCommercialForm';

type SalesOrderFormProps = ComponentProps<typeof SalesOrderCommercialForm>;

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

export default function SalesOrderForm(props: SalesOrderFormProps) {
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [copyVersion, setCopyVersion] = useState<SalesOrderVersion | null>(null);
  const [copyLoading, setCopyLoading] = useState(false);
  const copyHandledRef = useRef(false);
  const onCloseRef = useRef(props.onClose);
  const onErrorRef = useRef(props.onError);

  useEffect(() => {
    onCloseRef.current = props.onClose;
  }, [props.onClose]);

  useEffect(() => {
    onErrorRef.current = props.onError;
  }, [props.onError]);

  useEffect(() => {
    if (copyHandledRef.current || props.mode !== 'create' || props.version) return;

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
        if (source.status !== 'cancelled') {
          throw new Error('Chỉ sao chép đơn đã hủy sang đơn bán hàng mới.');
        }
        const sourceVersion = activeVersion(source);
        if (!sourceVersion) {
          throw new Error('Đơn đã hủy không còn dữ liệu phiên bản để sao chép.');
        }
        setCopyVersion(prepareSalesOrderCopyVersion(sourceVersion));
        setCopyLoading(false);
      })
      .catch((error) => {
        if (disposed) return;
        setCopyLoading(false);
        onErrorRef.current(error instanceof Error ? error.message : 'Không nạp được đơn đã hủy để sao chép.');
        onCloseRef.current();
      });

    return () => {
      disposed = true;
    };
  }, [props.mode, props.version]);

  const normalizedVersion = useMemo(
    () => normalizeVersionForEditing(props.version ?? copyVersion),
    [copyVersion, props.version],
  );

  const handleError = (message: string) => {
    setInlineError(message || null);
    props.onError(message);
  };

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
            <p>Đang nạp dữ liệu từ đơn đã hủy…</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <>
      <SalesOrderCommercialForm
        key={normalizedVersion?.id ?? 'new-sales-order'}
        {...props}
        version={normalizedVersion}
        onError={handleError}
      />
      <InlineFormError message={inlineError} />
      <style>{`
        .${styles.orderEditorModal}{width:min(1520px,calc(100vw - 1rem));height:min(96vh,1020px)}
        .${styles.orderEditorBody}{grid-auto-rows:max-content}
        .${styles.compactHeader}{align-items:start}
        .${styles.skuResults}{max-height:min(500px,calc(100dvh - 220px))}
        .salesOrderFormInlineError{grid-column:1/-1;padding:.65rem .8rem;border:1px solid #e2a696;border-radius:10px;background:#fff3ef;color:#8f3528;font-weight:750}
        .${styles.lineTableHeader}>span:nth-child(5),.${styles.lineTableHeader}>span:nth-child(6){text-align:center}
        .${styles.directPriceInput}{text-align:center!important}
        .${styles.discountControls} select{text-align:center!important;text-align-last:center}
        .${styles.discountControls} input{text-align:center!important}
      `}</style>
    </>
  );
}
