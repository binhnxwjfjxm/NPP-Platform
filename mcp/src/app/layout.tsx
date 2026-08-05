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
import "./hung-phat-mobile-foundation.css";
import "./mobile-app-experience.css";
import "./mobile-app-geometry.css";

export const metadata: Metadata = {
  title: "NPP MCP Field",
  description: "Ứng dụng tác nghiệp thị trường của NPP Hưng Phát.",
  applicationName: "NPP MCP Field",
  icons: {
    icon: "/api/pwa-icon?size=192",
    shortcut: "/api/pwa-icon?size=192",
    apple: "/api/pwa-icon?size=512"
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "NPP MCP"
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
  viewportFit: "cover",
  themeColor: "#754706"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="vi"><body><InteractionFeedbackProvider>{children}</InteractionFeedbackProvider></body></html>;
}
