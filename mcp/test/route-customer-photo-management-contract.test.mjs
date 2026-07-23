import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [master, manager, client, profile, preview, css, backend, migration, workflow, browserSmoke] = await Promise.all([
  read("../src/features/mcp/McpMasterView.tsx"),
  read("../src/features/mcp/OutletPhotoManager.tsx"),
  read("../src/features/mcp/outlet-media-client.ts"),
  read("../src/features/mcp/McpCustomerProfileSheet.tsx"),
  read("../src/features/mcp/RouteCustomerMediaPreview.tsx"),
  read("../src/features/mcp/McpCustomerProfileSheet.module.css"),
  read("../apps/backend/foundation/outlet-media.js"),
  read("../supabase/migrations/20260720210000_allow_route_customer_profile_media.sql"),
  read("../.github/workflows/f05-ui-browser-smoke.yml"),
  read("../test/ui/route-customer-photo-management-browser-smoke.mjs")
]);

test("edit mode alone mounts the shared manager", () => {
  assert.match(master, /import \{ OutletPhotoManager \}/);
  assert.match(master, /mode === "edit" && customer \? <OutletPhotoManager/);
  assert.match(master, /routeCustomerId=\{customer\.id\}/);
  assert.match(master, /active=\{open && mode === "edit"\}/);
  assert.doesNotMatch(master, /mode === "create"[^\n]{0,300}<OutletPhotoManager/);
  assert.match(manager, /if \(!active \|\| !routeCustomerId\) return null/);
  assert.match(profile, /<OutletPhotoManager/);
});

test("create mode cannot request customer profile before an id exists", () => {
  assert.match(manager, /if \(!active \|\| !routeCustomerId\) return/);
  assert.match(manager, /if \(active && routeCustomerId\)/);
  assert.match(browserSmoke, /create mode must not call customer-profile before routeCustomerId exists/);
});

test("manager owns private read, preview, add, delete, retry and refresh", () => {
  assert.match(manager, /customer-profile\?routeCustomerId=/);
  assert.match(manager, /capture="environment"/);
  assert.match(manager, /type="file" accept="image\/\*" multiple/);
  assert.match(manager, /Ảnh điểm bán đang chờ tải/);
  assert.match(manager, /uploadOutletPhoto\(photo, \{ routeCustomerId, sessionId, location \}\)/);
  assert.match(manager, /outlet-media\/delete/);
  assert.match(manager, /buildOutletPhotoDrafts\(files, remaining\)/);
  assert.match(manager, /"Thử lại"/);
  assert.match(manager, /disabled=\{busy \|\| remaining <= 0\}/);
  assert.match(manager, /await loadProfile\(\)/);
  assert.match(manager, /router\.refresh\(\)/);
  assert.match(manager, /await onChanged\?\.\(\)/);
  assert.doesNotMatch(`${manager}\n${client}\n${backend}`, /outlet-media\/replace/);
});

test("stored photos plus drafts are hard-capped at three in UI and database owner", () => {
  assert.match(client, /export const MAX_OUTLET_PHOTOS = 3/);
  assert.match(manager, /Math\.min\(MAX_OUTLET_PHOTOS, requestedLimit\)/);
  assert.match(manager, /Math\.min\(MAX_OUTLET_PHOTOS, profile\?\.mediaLimit \|\| MAX_OUTLET_PHOTOS\)/);
  assert.match(manager, /limit - media\.length - drafts\.length/);
  assert.match(manager, /MAX_OUTLET_PHOTOS - media\.length/);
  assert.match(migration, /select count\(\*\) into v_active_media_count/i);
  assert.match(migration, /status in \('pending', 'ready', 'deleting', 'delete_failed'\)/i);
  assert.match(migration, /if v_active_media_count >= 3 then/i);
  assert.match(migration, /outlet_media_limit_reached/i);
  assert.match(client, /code === "outlet_media_limit_reached"/);
  assert.match(client, /Điểm bán chỉ lưu tối đa \$\{MAX_OUTLET_PHOTOS\} ảnh/);
  assert.match(browserSmoke, /stored photos plus drafts must never exceed three/);
});

test("media mutation locks related controls without treating an empty GPS as zero zero", () => {
  assert.match(manager, /const mutationBusy = processing \|\| saving \|\| Boolean\(deletingId\)/);
  assert.match(manager, /onBusyChange\?\.\(mutationBusy\)/);
  assert.match(master, /const locked = saving \|\| mediaBusy/);
  assert.match(master, /draft\.geoLat\.trim\(\) && draft\.geoLng\.trim\(\)/);
  assert.match(master, /draft\.geoAccuracy\.trim\(\) && Number\.isFinite\(accuracy\) \? accuracy : null/);
});

test("upload order remains init then signed PUT then finalize", () => {
  const init = client.indexOf("outlet-media/upload-init");
  const put = client.indexOf('method: "PUT"');
  const done = client.indexOf("outlet-media/upload-finalize");
  assert.ok(init >= 0 && put > init && done > put);
  assert.match(client, /sessionId\?: string \| null/);
  assert.match(browserSmoke, /upload-init -> signed PUT -> upload-finalize order/);
});

test("fixed-route uploads reuse the existing owner with an optional session", () => {
  assert.match(migration, /alter column session_id drop not null/i);
  assert.match(migration, /create or replace function public\.mcp_prepare_outlet_media_upload/i);
  assert.match(migration, /if nullif\(btrim\(coalesce\(p_session_id, ''\)\), ''\) is not null then/i);
  assert.match(migration, /perform public\.mcp_assert_session_mutable\(v_session\.id\)/i);
  assert.match(migration, /route_customer_route_mismatch/i);
  assert.doesNotMatch(migration, /session_id_required/i);
  assert.doesNotMatch(migration, /grant .* to (?:anon|authenticated)/i);
  assert.match(migration, /to service_role/i);
});

test("route preview is a bounded horizontal gallery rather than the manager grid", () => {
  assert.match(preview, /styles\.previewScroller/);
  assert.match(preview, /styles\.previewCard/);
  assert.doesNotMatch(preview, /styles\.mediaGrid/);
  assert.match(css, /\.previewScroller\s*\{[\s\S]*?overflow-x:\s*auto;/);
  assert.match(css, /scroll-snap-type:\s*x mandatory/);
  assert.match(css, /scroll-snap-align:\s*start/);
  assert.match(css, /flex:\s*0 0 min\(72vw, 280px\)/);
  assert.match(css, /max-width:\s*280px/);
  assert.match(css, /aspect-ratio:\s*4 \/ 3;[\s\S]*?object-fit:\s*cover/);
  assert.match(preview, /target="_blank"/);
});

test("browser-facing photo code exposes no public bucket or object key", () => {
  for (const source of [master, manager, client, profile, preview, browserSmoke]) {
    assert.doesNotMatch(source, /hung-phat|object[_A-Z]?key|r2\.cloudflarestorage\.com/i);
  }
  assert.doesNotMatch(backend, /objectKey:\s*media\.object_key/);
});

test("PR browser workflow executes the route customer photo smoke", () => {
  assert.match(workflow, /test\/ui\/route-customer-photo-management-browser-smoke\.mjs/);
  assert.match(workflow, /route-customer-photo-management\.log/);
  assert.match(browserSmoke, /gallery must not overflow the page or sheet/);
  assert.match(browserSmoke, /edit submit must lock during media deletion/);
  assert.match(browserSmoke, /delete must go through outlet-media\/delete/);
});