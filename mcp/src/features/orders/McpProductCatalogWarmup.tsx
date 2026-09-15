"use client";

import { useEffect } from "react";
import { useMcpLocalUserId } from "@/lib/local-read/mcp-local-identity";
import { warmMcpProductCatalog } from "@/features/orders/mcp-product-local-cache";

const REFRESH_MS = 10 * 60_000;

export function McpProductCatalogWarmup() {
  const userId = useMcpLocalUserId();

  useEffect(() => {
    if (!userId) return;
    void warmMcpProductCatalog();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void warmMcpProductCatalog();
    }, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void warmMcpProductCatalog();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId]);

  return null;
}
