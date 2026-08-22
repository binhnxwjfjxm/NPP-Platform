'use client';

import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import SalesOrderCommercialForm from './SalesOrderCommercialForm';
import styles from './sales-orders.module.css';

export { type SalesOrderFormMode } from './SalesOrderCommercialForm';

type SalesOrderFormProps = ComponentProps<typeof SalesOrderCommercialForm>;

export function normalizeVndMinor(value: string | number | null | undefined): string {
  const normalized = String(value ?? '').trim();
  const match = /^(0|[1-9]\d{0,18})(?:\.(\d{1,6}))?$/.exec(normalized);
  if (!match) return normalized;
  const fraction = match[2] ?? '';
  return fraction && /[1-9]/.test(fraction) ? normalized : match[1];
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
  const normalizedVersion = useMemo(() => normalizeVersionForEditing(props.version), [props.version]);

  const handleError = (message: string) => {
    setInlineError(message || null);
    props.onError(message);
  };

  return (
    <>
      <SalesOrderCommercialForm {...props} version={normalizedVersion} onError={handleError} />
      <InlineFormError message={inlineError} />
      <style>{`
        .${styles.orderEditorBody}{grid-auto-rows:max-content}
        .salesOrderFormInlineError{grid-column:1/-1;padding:.65rem .8rem;border:1px solid #e2a696;border-radius:10px;background:#fff3ef;color:#8f3528;font-weight:750}
      `}</style>
    </>
  );
}
