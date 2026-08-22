"use client";

import { useEffect, useState } from "react";
import { BottomSheet } from "@/ui/overlay/BottomSheet";
import { CoreOrderCreateSheet, type OrderCustomerItem } from "./CoreOrderCreateSheet";

type Envelope = {
  data?: { customers?: OrderCustomerItem[] };
  error?: string | { message?: string };
  detail?: string;
  message?: string;
};

function errorMessage(payload: Envelope, fallback: string) {
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  if (payload.error && typeof payload.error === "object" && payload.error.message?.trim()) return payload.error.message;
  return payload.detail || payload.message || fallback;
}

function eligibleCustomers(items: OrderCustomerItem[]) {
  return items.filter((item) => (
    item.status === "active"
    && Boolean(item.id)
    && Boolean(item.defaultAddressId)
  ));
}

export function CoreOrderCreateLoader({
  open,
  onClose,
  onCreated
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (orderCode: string) => void;
}) {
  const [customers, setCustomers] = useState<OrderCustomerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/backend/core-customers", {
      cache: "no-store",
      headers: { Accept: "application/json" }
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as Envelope;
        if (!response.ok) throw new Error(errorMessage(payload, "Không tải được khách Công Ty"));
        return eligibleCustomers(Array.isArray(payload.data?.customers) ? payload.data.customers : []);
      })
      .then((items) => {
        if (!cancelled) setCustomers(items);
      })
      .catch((cause) => {
        if (!cancelled) {
          setCustomers([]);
          setError(cause instanceof Error ? cause.message : "Không tải được khách Công Ty");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (open && (loading || error)) {
    return (
      <BottomSheet
        open={open}
        onClose={onClose}
        title="Tạo đơn hàng"
        description="Chọn khách Công Ty đang hoạt động và có địa chỉ giao hàng."
        variant="workspace"
      >
        <div className="card">
          <strong>{loading ? "Đang tải khách Công Ty..." : error}</strong>
          <p className="page-subtitle">{error ? "Không mở form với dữ liệu khách chưa xác định." : "Đang lấy danh sách khách được phép bán."}</p>
          {error ? <button className="button" type="button" onClick={onClose}>Đóng</button> : null}
        </div>
      </BottomSheet>
    );
  }

  return (
    <CoreOrderCreateSheet
      open={open}
      customers={customers}
      onClose={onClose}
      onCreated={onCreated}
    />
  );
}
