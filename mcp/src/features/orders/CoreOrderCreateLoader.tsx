"use client";

import { dispatchMcpLocalResourceRefresh, useMcpLocalResource } from "@/lib/local-read/use-mcp-local-resource";
import { CoreOrderCreateSheet, type OrderCustomerItem } from "./CoreOrderCreateSheet";

export function CoreOrderCreateLoader({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (orderCode: string) => void }) {
  const customers = useMcpLocalResource<OrderCustomerItem[]>("customers");
  return (
    <CoreOrderCreateSheet
      open={open}
      customers={customers.data ?? []}
      onClose={onClose}
      onCreated={(orderCode) => {
        dispatchMcpLocalResourceRefresh("orders");
        onCreated(orderCode);
      }}
    />
  );
}
