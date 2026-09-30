import type { Metadata, Viewport } from "next";
import { InteractionFeedbackProvider } from "@/ui/feedback/InteractionFeedbackProvider";
import { McpProductCatalogWarmup } from "@/features/orders/McpProductCatalogWarmup";
import { McpLocalIdentityProvider } from "@/lib/local-read/mcp-local-identity";
import { mcpLocalCacheUserIdFromSession } from "@/lib/local-read/mcp-local-identity-server";
import "@/ui/foundation/tokens.css";
import "@/ui/foundation/base.css";

export const metadata: Metadata = {
  title: "NPP MCP Field",
  description: "Ứng dụng tác nghiệp thị trường của NPP Hưng Phát.",
  applicationName: "NPP MCP Field",
  icons: { icon: "/api/pwa-icon?size=192", shortcut: "/api/pwa-icon?size=192", apple: "/api/pwa-icon?size=512" },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "NPP MCP" },
  other: { "mobile-web-app-capable": "yes" },
  formatDetection: { telephone: false }
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover", themeColor: "#F3F6FA" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const cacheUserId = mcpLocalCacheUserIdFromSession();
  return <html lang="vi"><body><McpLocalIdentityProvider userId={cacheUserId}><McpProductCatalogWarmup /><InteractionFeedbackProvider>{children}</InteractionFeedbackProvider></McpLocalIdentityProvider></body></html>;
}
