import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const previewPath = new URL("../src/features/mcp/RouteCustomerMediaPreview.tsx", import.meta.url);
const cssPath = new URL("../src/features/mcp/McpCustomerProfileSheet.module.css", import.meta.url);

test("route customer detail uses a large horizontal private-photo gallery", async () => {
  const [preview, css] = await Promise.all([
    readFile(previewPath, "utf8"),
    readFile(cssPath, "utf8")
  ]);

  assert.match(preview, /data-route-customer-media-gallery="true"/);
  assert.match(preview, /styles\.previewScroller/);
  assert.match(preview, /styles\.previewCard/);
  assert.match(preview, /\{index \+ 1\}\/\{media\.length\}/);
  assert.match(preview, /target="_blank"/);
  assert.match(preview, /loading="lazy"/);
  assert.match(preview, /\/api\/backend\/outlet-media\/customer-profile\?routeCustomerId=/);
  assert.doesNotMatch(preview, /styles\.mediaGrid/);
  assert.doesNotMatch(preview, /styles\.mediaCard/);
  assert.doesNotMatch(preview, /outlet-media\/delete/);
  assert.doesNotMatch(preview, /uploadOutletPhoto/);

  assert.match(css, /\.previewScroller\s*\{[\s\S]*?overflow-x:\s*auto;/);
  assert.match(css, /\.previewScroller\s*\{[\s\S]*?scroll-snap-type:\s*x mandatory;/);
  assert.match(css, /\.previewCard\s*\{[\s\S]*?scroll-snap-align:\s*start;/);
  assert.match(css, /\.previewCard\s*\{[\s\S]*?flex:\s*0 0 min\(72vw, 280px\);/);
  assert.match(css, /\.previewCard\s*\{[\s\S]*?max-width:\s*280px;/);
});
