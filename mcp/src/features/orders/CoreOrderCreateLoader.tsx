"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { CustomerOnboardingQueueItem } from "@/features/accounts/customer-onboarding.types";
import { BottomSheet } from "@/ui/overlay/BottomSheet";
import { CoreOrderCreateSheet } from "./CoreOrderCreateSheet";

type Envelope = {
  data?: { items?: CustomerOnboardingQueueItem[] };
  error?: string | { message?: string };
  detail?: string;
  message?: string;
};

function errorMessage(payload: Envelope, fallback: string) {
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  if (payload.error && typeof payload.error === "object" && payload.error.message?.trim()) return payload.error.message;
  return payload.detail || payload.message || fallback;
}

function linkedOnly(items: CustomerOnboardingQueueItem[]) {
  return items.filter((item) => (
    (item.status === "approved" || item.status === "linked_existing")
    && Boolean(item.coreCustomerId)
    && Boolean(item.coreCustomerAddressId)
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
  const router = useRouter();
  const [linkedCustomers, setLinkedCustomers] = useState<CustomerOnboardingQueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/backend/customer-verifications", {
      cache: "no-store",
      headers: { Accept: "application/json" }
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as Envelope;
        if (!response.ok) throw new Error(errorMessage(payload, "Không tải được khách công ty"));
        return linkedOnly(Array.isArray(payload.data?.items) ? payload.data.items : []);
      })
      .then((items) => {
        if (!cancelled) setLinkedCustomers(items);
      })
      .catch((cause) => {
        if (!cancelled) {
          setLinkedCustomers([]);
          setError(cause instanceof Error ? cause.message : "Không tải được khách công ty");
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
        description="Chỉ khách đã mở hoặc liên kết mã mới được tạo đơn."
        variant="workspace"
      >
        <div className="card">
          <strong>{loading ? "Đang tải khách công ty..." : error}</strong>
          <p className="page-subtitle">{error ? "Không mở form với dữ liệu khách chưa xác định." : "Đang lấy danh sách khách đủ điều kiện."}</p>
          {error ? <button className="button" type="button" onClick={onClose}>Đóng</button> : null}
        </div>
      </BottomSheet>
    );
  }

  return (
    <CoreOrderCreateSheet
      open={open}
      linkedCustomers={linkedCustomers}
      onClose={onClose}
      onCreated={(orderCode) => {
        onCreated(orderCode);
        router.refresh();
      }}
    />
  );
}
