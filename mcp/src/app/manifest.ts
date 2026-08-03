import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NPP MCP Field",
    short_name: "NPP MCP",
    description: "Ứng dụng tác nghiệp thị trường của NPP Hùng Phát",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fff7ed",
    theme_color: "#9a3412",
    orientation: "portrait",
    icons: [
      { src: "/api/pwa-icon?size=192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/api/pwa-icon?size=512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/api/pwa-icon?size=512&maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
