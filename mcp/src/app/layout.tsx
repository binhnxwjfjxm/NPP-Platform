import type { Metadata, Viewport } from "next";
import { InteractionFeedbackProvider } from "@/ui/feedback/InteractionFeedbackProvider";
import "./globals.css";
import "./mobile.css";
import "./order-create-workspace.css";
import "./order-popups.css";
import "./outlet-profile.css";
import "./polish.css";
import "./dashboard-home.css";
import "./compact-operational.css";
import "./mcp-popup-compact.css";
import "./mcp-popup-content-ownership.css";
import "./mcp-order-tea-filter.css";
import "./mcp-order-selected-compact.css";
import "./mcp-order-mobile-workbench.css";
import "./mcp-order-tree-readable.css";
import "./mcp-order-report-style.css";
import "./mcp-report-branch.css";
import "./mcp-sessions-compact.css";
import "./mcp-sessions-color.css";
import "./mcp-compact-ui.css";
import "./mcp-session-add-customer.css";
import "./mcp-order-main-final.css";
import "./mcp-scroll-restore.css";
import "./export-menu-fix.css";
import "./npp-theme.css";
import "./app-shell-contract.css";

export const metadata: Metadata = {
  title: "MCP-Plan",
  description: "Quản lý nhà phân phối, tuyến bán hàng, điểm bán, đơn hàng và công việc.",
  applicationName: "MCP-Plan",
  icons: {
    icon: "/pwa-icon.svg",
    shortcut: "/pwa-icon.svg",
    apple: "/pwa-icon.svg"
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "MCP-Plan"
  },
  other: {
    "mobile-web-app-capable": "yes"
  },
  formatDetection: { telephone: false }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "auto",
  themeColor: "#F7F3ED"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="vi"><body><InteractionFeedbackProvider>{children}</InteractionFeedbackProvider></body></html>;
}
