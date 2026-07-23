export type NavItem = { label: string; shortLabel: string; href: string; description: string; icon: string };
export type ShellSection = "overview" | "routes" | "session" | "business";
export type AppMenuGroup = { id: string; label: string; items: NavItem[] };

export const PRIMARY_NAV_ITEMS: NavItem[] = [
  { label: "Tổng quan", shortLabel: "Tổng", href: "/", description: "Tình hình kinh doanh và công việc cần xử lý", icon: "⌂" },
  { label: "MCP", shortLabel: "MCP", href: "/mcp", description: "Quản lý tuyến và phiên đi thị trường", icon: "◇" },
  { label: "Đơn hàng", shortLabel: "Đơn", href: "/orders", description: "Theo dõi đơn hàng và doanh số", icon: "+" },
  { label: "Báo cáo phiên", shortLabel: "Báo cáo", href: "/reports", description: "Báo cáo sau mỗi phiên đi tuyến", icon: "▣" },
  { label: "Kế hoạch", shortLabel: "Việc", href: "/plans", description: "Công việc cần theo dõi và xử lý", icon: "✓" }
];

export const SIDEBAR_NAV_ITEMS: NavItem[] = [
  PRIMARY_NAV_ITEMS[0], PRIMARY_NAV_ITEMS[1],
  { label: "Tuyến bán hàng", shortLabel: "Tuyến", href: "/routes", description: "Quản lý tuyến và điểm bán trong tuyến", icon: "◎" },
  { label: "Đi tuyến hôm nay", shortLabel: "Hôm nay", href: "/visits", description: "Ghi nhận kết quả tại từng điểm bán", icon: "◇" },
  { label: "Lịch sử phiên", shortLabel: "Phiên", href: "/mcp/sessions", description: "Tra cứu các phiên đi tuyến theo ngày", icon: "▤" },
  { label: "Cài đặt MCP", shortLabel: "Mẫu", href: "/mcp-setting", description: "Thiết lập lựa chọn nhanh cho báo cáo", icon: "⚙" },
  { label: "Điểm bán", shortLabel: "Khách", href: "/customers", description: "Hồ sơ và lịch sử chăm sóc điểm bán", icon: "□" },
  PRIMARY_NAV_ITEMS[2], PRIMARY_NAV_ITEMS[3], PRIMARY_NAV_ITEMS[4]
];

export const SETTINGS_NAV_ITEM: NavItem = {
  label: "Cài đặt ứng dụng",
  shortLabel: "Cài đặt",
  href: "/settings",
  description: "Cài ứng dụng và cấu hình hành vi trên thiết bị",
  icon: "⚙"
};

export const APP_MENU_GROUPS: AppMenuGroup[] = [
  {
    id: "today",
    label: "Vận hành hôm nay",
    items: [PRIMARY_NAV_ITEMS[0], SIDEBAR_NAV_ITEMS[3], PRIMARY_NAV_ITEMS[2], PRIMARY_NAV_ITEMS[4]]
  },
  {
    id: "mcp",
    label: "Quản lý MCP",
    items: [PRIMARY_NAV_ITEMS[1], SIDEBAR_NAV_ITEMS[2], SIDEBAR_NAV_ITEMS[4], PRIMARY_NAV_ITEMS[3], SIDEBAR_NAV_ITEMS[6]]
  },
  {
    id: "configuration",
    label: "Thiết lập nghiệp vụ",
    items: [SIDEBAR_NAV_ITEMS[5]]
  }
];

export const NAV_ITEMS = SIDEBAR_NAV_ITEMS;

export function navItemForHref(href: string) {
  return [...SIDEBAR_NAV_ITEMS, SETTINGS_NAV_ITEM]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => item.href === href || (item.href !== "/" && href.startsWith(`${item.href}/`))) || PRIMARY_NAV_ITEMS[0];
}

export function shellSectionForHref(href: string): ShellSection {
  if (href === "/") return "overview";
  if (href === "/routes" || href.startsWith("/routes/")) return "routes";
  if (href === "/visits" || href.startsWith("/visits/") || href.startsWith("/mcp/sessions")) return "session";
  return "business";
}
