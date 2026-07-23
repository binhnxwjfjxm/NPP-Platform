import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/features/mcp/McpMasterView.tsx", import.meta.url),
  "utf8"
);
const userFacingErrorSource = await readFile(
  new URL("../src/lib/ui/user-facing-error.ts", import.meta.url),
  "utf8"
);
const popupOwnershipCss = await readFile(
  new URL("../src/app/mcp-popup-content-ownership.css", import.meta.url),
  "utf8"
);
const layoutSource = await readFile(
  new URL("../src/app/layout.tsx", import.meta.url),
  "utf8"
);

test("route customer create checks the selected route for exactly one active session", () => {
  assert.match(source, /\/api\/backend\/mcp-settings\/session-status\?routeId=/);
  assert.match(source, /sessions\.filter\([\s\S]*?status === "active"/);
  assert.match(source, /activeSessions\.length === 1/);
});

test("active session choice uses explicit primary and secondary actions", () => {
  assert.match(source, /Tuyến này đang có phiên hoạt động\. Thêm khách vào phiên hiện tại luôn\?/);
  assert.match(source, />Thêm vào tuyến và phiên</);
  assert.match(source, />Chỉ thêm vào tuyến</);
  assert.match(source, /includeActiveSession: true/);
  assert.match(source, /includeActiveSession: false/);
});

test("single-card active-session decision content remains visible after compact popup rules", () => {
  assert.match(layoutSource, /import "\.\/mcp-popup-compact\.css";[\s\S]*?import "\.\/mcp-popup-content-ownership\.css";/);
  assert.match(
    popupOwnershipCss,
    /\.visit-focus-card:first-child:last-child\s*\{\s*display:\s*grid;/,
    "a decision prompt with one owned card must not be hidden by the generic two-action compact rule"
  );
});

test("one user intent keeps one idempotency key and never uses raw route-customer POST", () => {
  assert.match(source, /createIdempotencyKey\("route-customer\.add"\)/);
  assert.match(source, /idempotentMutationFetch\([\s\S]*?"\/api\/route-customers"[\s\S]*?operation: "route-customer\.add"[\s\S]*?\bkey\b/);
  assert.doesNotMatch(
    source,
    /fetch\("\/api\/route-customers",\s*\{\s*method:\s*"POST"/,
    "route customer create must not bypass the idempotent mutation helper"
  );
});

test("success copy distinguishes current-session, next-session and reused outcomes", () => {
  assert.match(source, /Đã thêm điểm bán vào tuyến và phiên hiện tại\./);
  assert.match(source, /Đã thêm điểm bán vào tuyến, áp dụng từ phiên sau\./);
  assert.match(source, /Điểm bán đã tồn tại và được dùng lại/);
});

test("ambiguous and existing active-session conflicts explain the lifecycle action", () => {
  assert.match(userFacingErrorSource, /route_active_session_ambiguous/);
  assert.match(userFacingErrorSource, /nhiều hơn một phiên hoạt động/);
  assert.match(userFacingErrorSource, /route_active_session_exists/);
  assert.match(userFacingErrorSource, /Quản lý phiên/);
});
