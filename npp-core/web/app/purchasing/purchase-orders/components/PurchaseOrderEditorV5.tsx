'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ComponentProps } from 'react';
import type { PurchaseOrder } from '../../../../lib/purchase-order-types';
import { PURCHASE_ORDER_PERMISSION_KEYS } from '../../../../lib/purchase-order-types';
import type { PurchaseOrderBootstrap } from '../../../../lib/purchase-order-bootstrap';
import PurchaseOrderEditorV4 from './PurchaseOrderEditorV4';

type Props = Omit<ComponentProps<typeof PurchaseOrderEditorV4>, 'permissionKeys'>;

type ApiEnvelope<T> = {
  data?: T;
};

type PermissionState = {
  loaded: boolean;
  keys: string[];
};

function redactPurchaseOrderPrice(purchaseOrder: PurchaseOrder | null): PurchaseOrder | null {
  if (!purchaseOrder) return null;
  const {
    subtotal: _subtotal,
    discountTotal: _discountTotal,
    taxTotal: _taxTotal,
    total: _total,
    ...safeOrder
  } = purchaseOrder;
  return {
    ...safeOrder,
    lines: purchaseOrder.lines?.map((line) => {
      const {
        unitPrice: _unitPrice,
        discountMode: _discountMode,
        discountValue: _discountValue,
        discountAmount: _discountAmount,
        taxRate: _taxRate,
        taxAmount: _taxAmount,
        lineTotal: _lineTotal,
        purchasePriceId: _purchasePriceId,
        purchasePriceSource: _purchasePriceSource,
        purchasePriceResolvedAt: _purchasePriceResolvedAt,
        supplierSkuSnapshot: _supplierSkuSnapshot,
        priceOverrideReason: _priceOverrideReason,
        ...safeLine
      } = line;
      return safeLine;
    }),
  };
}

export default function PurchaseOrderEditorV5(props: Props) {
  const [permissionState, setPermissionState] = useState<PermissionState>({ loaded: false, keys: [] });

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/purchase-orders/bootstrap', {
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as ApiEnvelope<PurchaseOrderBootstrap>;
        if (!response.ok || !payload.data) return [];
        return payload.data.permissionKeys;
      })
      .then((keys) => {
        if (!controller.signal.aborted) {
          setPermissionState({ loaded: true, keys: Array.isArray(keys) ? keys : [] });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setPermissionState({ loaded: true, keys: [] });
      });
    return () => controller.abort();
  }, []);

  const safePurchaseOrder = useMemo(() => (
    permissionState.keys.includes(PURCHASE_ORDER_PERMISSION_KEYS.priceRead)
      ? props.purchaseOrder
      : redactPurchaseOrderPrice(props.purchaseOrder)
  ), [permissionState.keys, props.purchaseOrder]);

  if (!permissionState.loaded) {
    return <div role="status" aria-live="polite">Đang kiểm tra quyền truy cập đơn đặt hàng…</div>;
  }

  return (
    <PurchaseOrderEditorV4
      {...props}
      purchaseOrder={safePurchaseOrder}
      permissionKeys={permissionState.keys}
    />
  );
}
