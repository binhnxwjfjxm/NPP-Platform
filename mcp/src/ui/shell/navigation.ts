import type { NavIconName } from "./NavIcon";

export type NavItem = {
  label: string;
  shortLabel: string;
  href: string;
  description: string;
  icon: NavIconName;
};

export type MoreMenuItem = NavItem & {
  id: string;
  permission?: string;
};

export type MoreMenuGroup = {
  id: string;
  label: string;
  items: MoreMenuItem[];
};

export type ShellSection = "overview" | "routes" | "session" | "business";

export const TODAY_NAV_ITEM: NavItem = {
  label: "Hôm nay",
  shortLabel: "Hôm nay",
  href: "/",
  description: "Tuyến, tiến độ và công việc cần xử lý trong ngày",
  icon: "⌂"
};

export const VISITS_NAV_ITEM: NavItem = {
  label: "Đi tuyến",
  shortLabel: "Đi tuyến",
  href: "/visits",
  description: "Làm việc theo tuyến và ghi nhận kết quả tại điểm bán",
  icon: "◉"
};

export const CUSTOMERS_NAV_ITEM: NavItem = {
  label: "Điểm bán",
  shortLabel: "Điểm bán",
  href: "/customers",
  description: "Tra cứu điểm bán, khách Công Ty và thông tin liên hệ",
  icon: "□"
};

export const ORDERS_NAV_ITEM: NavItem = {
  label: "Đơn hàng",
  shortLabel: "Đơn hàng",
  href: "/orders",
  description: "Theo dõi và tạo đơn hàng",
  icon: "+"
};

export const MORE_NAV_ITEM: NavItem = {
  label: "Thêm",
  shortLabel: "Thêm",
  href: "/more",
  description: "Mở các chức năng quản lý, báo cáo và thiết lập",
  icon: "⋯"
};

const ROUTES_NAV_ITEM: NavItem = {
  label: "Tuyến cố định",
  shortLabel: "Tuyến",
  href: "/routes",
  description: "Xem tuyến được Công Ty thiết lập và quản lý điểm bán",
  icon: "◎"
};

const SESSION_HISTORY_NAV_ITEM: NavItem = {
  label: "Lịch sử phiên",
  shortLabel: "Phiên",
  href: "/mcp/sessions",
  description: "Tra cứu các phiên đi tuyến theo ngày",
  icon: "▤"
};

const REPORTS_NAV_ITEM: NavItem = {
  label: "Báo cáo",
  shortLabel: "Báo cáo",
  href: "/reports",
  description: "Báo cáo phiên, kết quả và nội dung đã ghi nhận",
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
  label: "Kế hoạch & Công việc",
  shortLabel: "Công việc",
  href: "/plans",
  description: "Theo dõi công việc cần xử lý và chăm sóc tiếp theo",
  icon: "✓"
};

const CUSTOMER_ONBOARDING_NAV_ITEM: NavItem = {
  label: "Mở hoặc liên kết mã khách",
  shortLabel: "Mở mã",
  href: "/customers/onboarding",
  description: "Mở hoặc liên kết điểm bán với khách Công Ty",
  icon: "◇"
};

const MCP_SETTINGS_NAV_ITEM: NavItem = {
  label: "Thiết lập báo cáo thị trường",
  shortLabel: "Báo cáo",
  href: "/mcp-setting",
  description: "Quản lý lựa chọn dùng chung cho báo cáo thị trường",
  icon: "⚙"
};

export const SETTINGS_NAV_ITEM: NavItem = {
  label: "Thiết lập",
  shortLabel: "Thiết lập",
  href: "/settings",
  description: "Cài ứng dụng, phản hồi thao tác và tài khoản",
  icon: "⚙"
};

const MCP_LEGACY_NAV_ITEM: NavItem = {
  label: "Đi tuyến",
  shortLabel: "Đi tuyến",
  href: "/mcp",
  description: "Lối vào cũ của màn đi tuyến",
  icon: "◉"
};

export const PRIMARY_NAV_ITEMS: NavItem[] = [
  TODAY_NAV_ITEM,
  VISITS_NAV_ITEM,
  CUSTOMERS_NAV_ITEM,
  ORDERS_NAV_ITEM,
  MORE_NAV_ITEM
];

export const SIDEBAR_NAV_ITEMS = PRIMARY_NAV_ITEMS;
export const FIELD_DOCK_ITEMS = PRIMARY_NAV_ITEMS;

export const MORE_MENU_GROUPS: MoreMenuGroup[] = [
  {
    id: "route",
    label: "Đi tuyến",
    items: [
      { ...ROUTES_NAV_ITEM, id: "fixed-routes" },
      { ...SESSION_HISTORY_NAV_ITEM, id: "session-history" }
    ]
  },
  {
    id: "reports",
    label: "Báo cáo & Công việc",
    items: [
      { ...REPORTS_NAV_ITEM, id: "reports" },
      { ...FIELD_CHECKS_NAV_ITEM, id: "product-trials" },
      {
        id: "data-exports",
        label: "Xuất dữ liệu",
        shortLabel: "Xuất dữ liệu",
        href: "/mcp/sessions",
        description: "Xuất dữ liệu phiên, đơn hàng, báo cáo và công việc từ khu vực lịch sử phiên",
        icon: "▤"
      },
      { ...PLANS_NAV_ITEM, id: "plans" },
      {
        id: "proposals",
        label: "Đề xuất",
        shortLabel: "Đề xuất",
        href: "/reports?view=proposals",
        description: "Gửi và theo dõi đề xuất quản lý",
        icon: "◇"
      }
    ]
  },
  {
    id: "customers",
    label: "Khách hàng",
    items: [
      { ...CUSTOMER_ONBOARDING_NAV_ITEM, id: "customer-onboarding" }
    ]
  },
  {
    id: "settings",
    label: "Thiết lập",
    items: [
      { ...MCP_SETTINGS_NAV_ITEM, id: "report-settings", permission: "mcp.report-setting.write" },
      { ...SETTINGS_NAV_ITEM, id: "app-settings" }
    ]
  }
];

export const APP_MENU_GROUPS = [
  {
    id: "primary",
    label: "Điều hướng",
    items: PRIMARY_NAV_ITEMS
  }
];

const CANONICAL_ROUTE_ITEMS = [
  CUSTOMER_ONBOARDING_NAV_ITEM,
  SESSION_HISTORY_NAV_ITEM,
  MCP_SETTINGS_NAV_ITEM,
  FIELD_CHECKS_NAV_ITEM,
  ROUTES_NAV_ITEM,
  VISITS_NAV_ITEM,
  CUSTOMERS_NAV_ITEM,
  ORDERS_NAV_ITEM,
  REPORTS_NAV_ITEM,
  PLANS_NAV_ITEM,
  SETTINGS_NAV_ITEM,
  MORE_NAV_ITEM,
  MCP_LEGACY_NAV_ITEM,
  TODAY_NAV_ITEM
];

function normalizeHref(href: string) {
  const pathname = href.split("?")[0] || "/";
  if (pathname === "/actions") return "/plans";
  if (pathname === "/mcp/settings") return "/mcp-setting";
  if (pathname === "/visits/order-intent") return "/orders";
  return pathname;
}

export function requiredNavigationPermission(href: string) {
  const pathname = normalizeHref(href);
  if (pathname === "/mcp-setting" || pathname.startsWith("/mcp-setting/")) return "mcp.report-setting.write";
  return null;
}

export function navItemForHref(href: string) {
  const normalizedHref = normalizeHref(href);
  return [...CANONICAL_ROUTE_ITEMS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => item.href === normalizedHref || (item.href !== "/" && normalizedHref.startsWith(`${item.href}/`)))
    || TODAY_NAV_ITEM;
}

export function primaryNavItemForHref(href: string) {
  const normalizedHref = normalizeHref(href);
  if (normalizedHref === "/") return TODAY_NAV_ITEM;
  if (normalizedHref === "/visits" || normalizedHref.startsWith("/visits/") || normalizedHref === "/mcp") return VISITS_NAV_ITEM;
  if (normalizedHref === "/customers" || (normalizedHref.startsWith("/customers/") && !normalizedHref.startsWith("/customers/onboarding"))) return CUSTOMERS_NAV_ITEM;
  if (normalizedHref === "/orders" || normalizedHref.startsWith("/orders/")) return ORDERS_NAV_ITEM;
  return MORE_NAV_ITEM;
}

export function shellSectionForHref(href: string): ShellSection {
  const normalizedHref = normalizeHref(href);
  if (normalizedHref === "/") return "overview";
  if (normalizedHref === "/routes" || normalizedHref.startsWith("/routes/")) return "routes";
  if (normalizedHref === "/visits" || normalizedHref.startsWith("/visits/") || normalizedHref.startsWith("/mcp/sessions")) return "session";
  return "business";
}
