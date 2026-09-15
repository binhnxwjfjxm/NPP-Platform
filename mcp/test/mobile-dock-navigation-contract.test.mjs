import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const dock = await readFile("src/ui/shell/MobileDock.tsx", "utf8");
const launchpad = await readFile("src/ui/shell/MobileHomeLaunchpad.tsx", "utf8");
const ordersData = await readFile("src/lib/api/orders-data.ts", "utf8");
const geometry = await readFile("src/app/mobile-app-geometry.css", "utf8");
const experience = await readFile("src/app/mobile-app-experience.css", "utf8");

test("bottom dock uses fast client navigation to enter visits and keeps document-level escape only inside visit flow", () => {
  assert.match(dock, /import Link from "next\/link"/);
  assert.match(dock, /function isVisitFlow\(pathname: string\)/);
  assert.match(dock, /const documentNavigation = isVisitFlow\(pathname\)/);
  assert.doesNotMatch(dock, /const documentNavigation = primary \|\| isVisitFlow\(pathname\)/);
  assert.match(dock, /<a[\s\S]*?data-document-navigation="true"[\s\S]*?href=\{item\.href\}/);
  assert.match(dock, /<Link[\s\S]*?data-client-navigation="true"[\s\S]*?href=\{item\.href\}[\s\S]*?prefetch=\{false\}/);
  assert.doesNotMatch(dock, /preventDefault|setTimeout/);
});

test("visits entry owns local-first redirect decisions without a route loading boundary", async () => {
  await assert.rejects(
    access("src/app/visits/loading.tsx"),
    (error) => error && error.code === "ENOENT"
  );
});

test("home shortcuts avoid background route storms and enter visits with client navigation", () => {
  assert.match(launchpad, /<Link className="mobile-home-primary-action" data-client-navigation="true" href="\/visits" prefetch=\{false\}>/);
  assert.match(launchpad, /<Link href=\{item\.href\} key=\{item\.href\} prefetch=\{false\}>/);
  assert.doesNotMatch(launchpad, /data-document-navigation="true" href="\/visits"/);
  assert.doesNotMatch(launchpad, /prefetch=\{item\.href !== "\/orders"\}/);
});

test("orders read only fetches item rows for orders that are actually loaded", () => {
  assert.match(ordersData, /select: "id,order_code,order_date,created_at,customer_name,raw_payload,area,sales,source_type,subtotal,discount_total,grand_total,status"/);
  assert.match(ordersData, /const orderIds = \[\.\.\.new Set\(orderRows\.map/);
  assert.match(ordersData, /filters: \{ order_id: `in\.\(\$\{orderIds\.join\(","\)\}\)` \}/);
  assert.doesNotMatch(ordersData, /Promise\.all\(\[\s*backendReadRows<Row>\("orders"[\s\S]*backendReadRows<Row>\("order_items"/);
});

test("dock motion starts on interaction intent without delaying navigation", () => {
  assert.match(dock, /--mobile-dock-index/);
  assert.match(dock, /--mobile-dock-offset/);
  assert.match(dock, /onPointerDown: \(\) => setIntentIndex\(index\)/);
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
