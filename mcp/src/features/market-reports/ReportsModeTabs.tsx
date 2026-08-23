"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import styles from "./ReportsModeTabs.module.css";

type ReportsMode = "proposals" | "reports";

export function ReportsModeTabs() {
  const searchParams = useSearchParams();
  const active: ReportsMode = searchParams.get("view") === "proposals" ? "proposals" : "reports";

  return (
    <nav className={styles.tabs} aria-label="Chuyển nội dung Báo cáo">
      <Link
        className={active === "proposals" ? styles.active : styles.tab}
        href="/reports?view=proposals"
        prefetch={false}
        aria-current={active === "proposals" ? "page" : undefined}
      >
        Đề xuất
      </Link>
      <Link
        className={active === "reports" ? styles.active : styles.tab}
        href="/reports?view=reports"
        prefetch={false}
        aria-current={active === "reports" ? "page" : undefined}
      >
        Báo cáo
      </Link>
    </nav>
  );
}
