import { createElement } from "react";
import { ImageResponse } from "next/og";

export const runtime = "edge";

const SUPPORTED_SIZES = new Set([192, 512]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedSize = Number(url.searchParams.get("size") || 512);
  const size = SUPPORTED_SIZES.has(requestedSize) ? requestedSize : 512;
  const maskable = url.searchParams.get("maskable") === "1";
  const logoUrl = new URL("/npp-app-icon.png", url.origin).toString();
  const padding = maskable ? Math.round(size * 0.2) : Math.round(size * 0.1);

  const image = createElement(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#fff7ed",
        borderRadius: maskable ? 0 : Math.round(size * 0.18),
        padding
      }
    },
    createElement("img", {
      src: logoUrl,
      alt: "NPP Hùng Phát",
      width: size - padding * 2,
      height: size - padding * 2,
      style: { objectFit: "contain" }
    })
  );

  return new ImageResponse(image, {
    width: size,
    height: size,
    headers: {
      "Cache-Control": "public, max-age=86400, immutable"
    }
  });
}
