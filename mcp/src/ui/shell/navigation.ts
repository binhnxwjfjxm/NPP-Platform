export type NavItem = { label: string; shortLabel: string; href: string; description: string; icon: string };
export type ShellSection = "overview" | "routes" | "session" | "business";
export type AppMenuGroup = { id: string; label: string; items: NavItem[] };

const OVERVIEW_NAV_ITEM: NavItem = {
  label: "Tổng quan",
  shortLabel: "Tổng",
  href: "/",
  description: "Tình hình kinh doanh và công việc cần xử lý",
  icon: "⌂"
};

const MCP_NAV_ITEM: NavItem = {
  label: "MCP",
  shortLabel: "MCP",
  href: "/mcp",
  description: "Quản lý tuyến và phiên đi thị trường",
  icon: "◇"
};

const ROUTES_NAV_ITEM: NavItem = {
  label: "Tuyến bán hàng",
  shortLabel: "Tuyến",
  href: "/routes",
  description: "Quản lý tuyến và điểm bán trong tuyến",
  icon: "◎"
};

const VISITS_NAV_ITEM: NavItem = {
  label: "Đi tuyến hôm nay",
  shortLabel: "Đi tuyến",
  href: "/visits",
  description: "Ghi nhận kết quả tại từng điểm bán",
  icon: "◉"
};

const SESSION_HISTORY_NAV_ITEM: NavItem = {
  label: "Lịch sử phiên",
  shortLabel: "Phiên",
  href: "/mcp/sessions",
  description: "Tra cứu các phiên đi tuyến theo ngày",
  icon: "▤"
};

const CUSTOMERS_NAV_ITEM: NavItem = {
  label: "Điểm bán",
  shortLabel: "Khách",
  href: "/customers",
  description: "Hồ sơ và lịch sử chăm sóc điểm bán",
  icon: "□"
};

const ORDERS_NAV_ITEM: NavItem = {
  label: "Đơn hàng",
  shortLabel: "Đơn",
  href: "/orders",
  description: "Theo dõi đơn hàng và doanh số",
  icon: "+"
};

const REPORTS_NAV_ITEM: NavItem = {
  label: "Báo cáo phiên",
  shortLabel: "Báo cáo",
  href: "/reports",
  description: "Báo cáo sau mỗi phiên đi tuyến",
  icon: "▣"
};

export const FIELD_CHECKS_NAV_ITEM: NavItem = {
  label: "Kết quả thử sản phẩm",
  shortLabel: "Thử SP",
  href: "/field-checks",
  description: "Theo dõi và cập nhật kết quả thử sản phẩm tại điểm bán",
  icon: "◈"
};

const PLANS_NAV_ITEM: NavItem = {
  label: "Kế hoạch",
  shortLabel: "Việc",
  href: "/plans",
  description: "Công việc cần theo dõi và xử lý",
  icon: "✓"
};

const MCP_SETTINGS_NAV_ITEM: NavItem = {
  label: "Cài đặt MCP",
  shortLabel: "Mẫu",
  href: "/mcp-setting",
  description: "Thiết lập lựa chọn nhanh cho báo cáo",
  icon: "⚙"
};

export const PRIMARY_NAV_ITEMS: NavItem[] = [
  OVERVIEW_NAV_ITEM,
  MCP_NAV_ITEM,
  ORDERS_NAV_ITEM,
  REPORTS_NAV_ITEM,
  PLANS_NAV_ITEM
];

export const SIDEBAR_NAV_ITEMS: NavItem[] = [
  OVERVIEW_NAV_ITEM,
  MCP_NAV_ITEM,
  ROUTES_NAV_ITEM,
  VISITS_NAV_ITEM,
  SESSION_HISTORY_NAV_ITEM,
  CUSTOMERS_NAV_ITEM,
  ORDERS_NAV_ITEM,
  REPORTS_NAV_ITEM,
  FIELD_CHECKS_NAV_ITEM,
  PLANS_NAV_ITEM,
  MCP_SETTINGS_NAV_ITEM
];

export const FIELD_DOCK_ITEMS: NavItem[] = [
  OVERVIEW_NAV_ITEM,
  ROUTES_NAV_ITEM,
  VISITS_NAV_ITEM,
  ORDERS_NAV_ITEM,
  REPORTS_NAV_ITEM
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
    items: [OVERVIEW_NAV_ITEM, VISITS_NAV_ITEM, ORDERS_NAV_ITEM, PLANS_NAV_ITEM]
  },
  {
    id: "mcp",
    label: "Quản lý MCP",
    items: [MCP_NAV_ITEM, ROUTES_NAV_ITEM, SESSION_HISTORY_NAV_ITEM, CUSTOMERS_NAV_ITEM, REPORTS_NAV_ITEM, FIELD_CHECKS_NAV_ITEM]
  },
  {
    id: "configuration",
    label: "Thiết lập nghiệp vụ",
    items: [MCP_SETTINGS_NAV_ITEM]
  }
];

export const NAV_ITEMS = SIDEBAR_NAV_ITEMS;

export function navItemForHref(href: string) {
  return [...SIDEBAR_NAV_ITEMS, SETTINGS_NAV_ITEM]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => item.href === href || (item.href !== "/" && href.startsWith(`${item.href}/`))) || OVERVIEW_NAV_ITEM;
}

export function shellSectionForHref(href: string): ShellSection {
  if (href === "/") return "overview";
  if (href === "/routes" || href.startsWith("/routes/")) return "routes";
  if (href === "/visits" || href.startsWith("/visits/") || href.startsWith("/mcp/sessions")) return "session";
  return "business";
}
