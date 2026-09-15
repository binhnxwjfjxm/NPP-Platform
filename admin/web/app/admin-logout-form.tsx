"use client";

import { useState } from "react";
import { AdminIcon } from "./admin-icons";
import { clearAdminLocalReadForCurrentUser } from "./local-read/use-admin-local-read";

export function AdminLogoutForm() {
  const [busy, setBusy] = useState(false);

  return (
    <form
      action="/api/auth/logout"
      method="post"
      onSubmit={(event) => {
        if (busy) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        setBusy(true);
        void (async () => {
          try {
            await clearAdminLocalReadForCurrentUser();
          } finally {
            try {
              await fetch("/api/auth/logout", { method: "POST", cache: "no-store", credentials: "same-origin" });
            } finally {
              window.location.assign("/login");
            }
          }
        })();
      }}
    >
      <button className="menuItem adminLogoutItem" type="submit" disabled={busy} aria-busy={busy}>
        <span className="menuIcon"><AdminIcon name="lock" size={20} /></span>
        <span><strong>{busy ? "Đang đăng xuất..." : "Đăng xuất"}</strong><small>Kết thúc phiên quản trị hiện tại</small></span>
      </button>
    </form>
  );
}
