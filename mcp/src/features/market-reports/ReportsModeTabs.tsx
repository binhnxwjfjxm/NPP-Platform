import Link from "next/link";
import styles from "./ReportsModeTabs.module.css";

type ReportsMode = "proposals" | "reports";

export function ReportsModeTabs({ active }: { active: ReportsMode }) {
  return (
    <nav className={styles.tabs} aria-label="Chế độ Báo cáo MCP">
      <Link className={active === "proposals" ? styles.active : styles.tab} href="/reports?view=proposals" prefetch={false}>
        Đề xuất
      </Link>
      <Link className={active === "reports" ? styles.active : styles.tab} href="/reports?view=reports" prefetch={false}>
        Báo cáo
      </Link>
    </nav>
  );
}
