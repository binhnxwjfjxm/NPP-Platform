'use client';

import { useEffect, useState } from 'react';
import type { ComponentProps } from 'react';
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

  if (!permissionState.loaded) {
    return <div role="status" aria-live="polite">Đang kiểm tra quyền truy cập đơn đặt hàng…</div>;
  }

  return <PurchaseOrderEditorV4 {...props} permissionKeys={permissionState.keys} />;
}
