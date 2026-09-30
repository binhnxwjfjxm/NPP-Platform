import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MCP Field",
    short_name: "MCP",
    description: "Ứng dụng tác nghiệp thị trường",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F3F6FA",
    theme_color: "#1677FF",
    orientation: "portrait",
    icons: [
      { src: "/api/pwa-icon?size=192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/api/pwa-icon?size=512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/api/pwa-icon?size=512&maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
