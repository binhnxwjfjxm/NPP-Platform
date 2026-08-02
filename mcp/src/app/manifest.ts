import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MCP-Plan",
    short_name: "MCP-Plan",
    description: "Quản lý nhà phân phối, tuyến bán hàng, điểm bán, đơn hàng và công việc.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F7F3ED",
    theme_color: "#F7F3ED",
    orientation: "portrait",
    icons: [
      { src: "/npp-app-icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/npp-app-icon.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
