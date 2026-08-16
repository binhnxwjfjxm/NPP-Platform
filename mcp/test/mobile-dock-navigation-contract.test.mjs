import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const dock = await readFile("src/ui/shell/MobileDock.tsx", "utf8");
const geometry = await readFile("src/app/mobile-app-geometry.css", "utf8");
const experience = await readFile("src/app/mobile-app-experience.css", "utf8");

test("bottom dock remains a document-level escape from pending app-router transitions", () => {
  assert.doesNotMatch(dock, /from "next\/link"/);
  assert.match(dock, /<a[\s\S]*?data-document-navigation="true"[\s\S]*?href=\{item\.href\}/);
  assert.doesNotMatch(dock, /prefetch|preventDefault|setTimeout/);
});

test("visits entry resolves redirects before a route shell can stream", async () => {
  await assert.rejects(
    access("src/app/visits/loading.tsx"),
    (error) => error && error.code === "ENOENT"
  );
});

test("dock motion starts on interaction intent without delaying native navigation", () => {
  assert.match(dock, /--mobile-dock-index/);
  assert.match(dock, /--mobile-dock-offset/);
  assert.match(dock, /onPointerDown=\{\(\) => setIntentIndex\(index\)\}/);
  assert.match(dock, /data-motion-intent=\{intended \? "true" : undefined\}/);
  assert.match(dock, /data-interaction-feedback="selection"/);
  assert.doesNotMatch(dock, /className="mobile-app-dock bottom-nav"/);
  assert.match(geometry, /transition:\s*transform 175ms[\s\S]*opacity 140ms/);
  assert.match(geometry, /transition:\s*transform 155ms[\s\S]*opacity 135ms/);
  assert.match(geometry, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(geometry, /transition:[^;]*(height|box-shadow|backdrop-filter|filter)/);
});

test("modern dock geometry has one canonical owner and lighter compositing", () => {
  assert.match(geometry, /Canonical geometry \+ motion owner/);
  assert.match(geometry, /grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(geometry, /env\(safe-area-inset-bottom\)/);
  assert.match(geometry, /backdrop-filter:\s*blur\(10px\) saturate\(1\.08\) !important/);
  assert.doesNotMatch(experience, /\.mobile-app-dock\s*\{[^}]*grid-template-columns/);
  assert.doesNotMatch(experience, /\.mobile-app-dock\s*\{[^}]*backdrop-filter/);
});
