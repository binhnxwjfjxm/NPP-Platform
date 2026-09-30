"use client";

import { useRouter } from "next/navigation";
import { McpCard, McpList, McpListRow, McpPageHeader, McpStatusPill } from "@/ui/foundation";
import { useMcpAccess } from "@/lib/use-mcp-access";
import { AppShell } from "@/ui/shell/AppShell";
import { MORE_MENU_GROUPS, requiredNavigationPermission } from "@/ui/shell/navigation";
import { NavIcon } from "@/ui/shell/NavIcon";
import { McpLogoutButton } from "@/features/settings/McpLogoutButton";
import styles from "./MorePage.module.css";

export function MorePage() {
  const router = useRouter();
  const access = useMcpAccess();
  const groups = MORE_MENU_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      const permission = item.permission || requiredNavigationPermission(item.href);
      return !permission || access.hasPermission(permission);
    })
  })).filter((group) => group.items.length > 0);

  return (
    <AppShell activeHref="/more">
      <div className={styles.page} data-primary-screen="more">
        <McpPageHeader
          eyebrow="MCP Field"
          title="Thêm"
          description="Các chức năng quản lý, báo cáo và thiết lập được gom tại một nơi để 5 khu vực chính luôn ổn định."
          actions={<McpStatusPill tone="primary">Đầy đủ nghiệp vụ</McpStatusPill>}
        />

        <div className={styles.groups}>
          {groups.map((group) => (
            <McpCard className={styles.groupCard} key={group.id}>
              <div className={styles.groupHeading}>
                <h2>{group.label}</h2>
                <span>{group.items.length} chức năng</span>
              </div>
              <McpList>
                {group.items.map((item) => (
                  <McpListRow
                    key={item.id}
                    leading={<span className={styles.itemIcon}><NavIcon name={item.icon} width="21" height="21" /></span>}
                    title={item.label}
                    description={item.description}
                    trailing={<span className={styles.chevron} aria-hidden="true">›</span>}
                    onClick={() => router.push(item.href)}
                  />
                ))}
              </McpList>
            </McpCard>
          ))}

          <McpCard className={styles.accountCard}>
            <div>
              <h2>Tài khoản</h2>
              <p>Đăng xuất khỏi thiết bị này và xóa dữ liệu đọc nhanh của tài khoản hiện tại.</p>
            </div>
            <McpLogoutButton className={styles.logoutButton} />
          </McpCard>
        </div>
      </div>
    </AppShell>
  );
}
