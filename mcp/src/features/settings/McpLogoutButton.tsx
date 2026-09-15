"use client";

import { useState } from "react";
import { clearMcpLocalReadForCurrentUser } from "@/lib/local-read/use-mcp-shell";

export function McpLogoutButton() {
  const [pending, setPending] = useState(false);

  async function logout() {
    if (pending) return;
    setPending(true);
    try {
      await clearMcpLocalReadForCurrentUser();
      await fetch("/api/auth/logout", { method: "POST", cache: "no-store", redirect: "manual" }).catch(() => null);
    } finally {
      window.location.assign("/login");
    }
  }

  return <button className="button" type="button" disabled={pending} onClick={() => void logout()}>{pending ? "Đang đăng xuất..." : "Đăng xuất"}</button>;
}
