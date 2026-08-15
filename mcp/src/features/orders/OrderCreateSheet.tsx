"use client";

import type { RouteCustomerItem } from "@/features/mcp/route-customers.types";
import type { OrderSessionOption } from "./order-create.types";
import { CoreOrderCreateLoader } from "./CoreOrderCreateLoader";

export function OrderCreateSheet({
  open,
  onClose,
  onCreated
}: {
  open: boolean;
  customers: RouteCustomerItem[];
  sessions: OrderSessionOption[];
  onClose: () => void;
  onCreated: (orderCode: string) => void;
}) {
  return (
    <CoreOrderCreateLoader
      open={open}
      onClose={onClose}
      onCreated={onCreated}
    />
  );
}
