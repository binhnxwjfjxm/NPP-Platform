import test from "node:test";
import assert from "node:assert/strict";
import {
  createReportSettingGroup,
  createReportSettingItem,
  updateReportSettingGroup,
  updateReportSettingItem
} from "./report-setting-mutations.js";

const config = {
  supabaseUrl: "https://example.supabase.co",
  supabaseServiceRoleKey: "server-only-key"
};

const context = {
  requestId: "request-setting-12345678",
  idempotencyKey: "setting-idempotency-1",
  receivedAt: "2026-07-16T13:30:00.000Z",
  installation: { id: "installation-a", nppCode: "NPP-A" },
  actor: { id: "service:npp-a:mcp-v1", type: "service", authentication: "proxy-token" }
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function capture(payload = { id: "row-1" }) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse(payload);
    }
  };
}

test("group create uses deterministic key and service-role RPC context", async () => {
  const provider = capture({ id: "group-1", group_key: "san_pham_dang_dung" });
  const result = await createReportSettingGroup({
    title: "Sản phẩm đang dùng",
    description: "Nhóm chung",
    sortOrder: 2
  }, context, config, provider);

  assert.equal(result.id, "group-1");
  assert.equal(provider.calls.length, 1);
  assert.match(provider.calls[0].url, /\/rest\/v1\/rpc\/mcp_idempotent_create_report_setting_group$/);
  const args = JSON.parse(provider.calls[0].init.body);
  assert.equal(args.p_group_key, "san_pham_dang_dung");
  assert.equal(args.p_group_type, "market_report");
  assert.equal(args.p_status, "active");
  assert.equal(args.p_context.requestId, "request-setting-12345678");
  assert.equal(args.p_context.installationId, "installation-a");
  assert.equal(args.p_context.actorId, "service:npp-a:mcp-v1");
});

test("group update sends only a whitelisted normalized patch", async () => {
  const provider = capture({ id: "group-1", status: "inactive" });
  await updateReportSettingGroup({
    groupId: "group-1",
    description: "",
    status: "INACTIVE"
  }, context, config, provider);

  assert.match(provider.calls[0].url, /\/rest\/v1\/rpc\/mcp_idempotent_update_report_setting_group$/);
  const args = JSON.parse(provider.calls[0].init.body);
  assert.deepEqual(args.p_patch, { description: null, status: "inactive" });
  assert.equal(args.p_group_id, "group-1");
});

test("item create and update use Foundation RPC ownership", async () => {
  const createProvider = capture({ id: "item-1", item_key: "tra_sua" });
  await createReportSettingItem({
    groupId: "group-1",
    label: "Trà sữa",
    value: "",
    category: "Đồ uống",
    brandName: "MCP",
    sortOrder: 3
  }, context, config, createProvider);
  const createArgs = JSON.parse(createProvider.calls[0].init.body);
  assert.match(createProvider.calls[0].url, /\/rest\/v1\/rpc\/mcp_idempotent_create_report_setting_item$/);
  assert.equal(createArgs.p_item_key, "tra_sua");
  assert.equal(createArgs.p_value, "Trà sữa");
  assert.equal(createArgs.p_context.nppCode, "NPP-A");

  const updateProvider = capture({ id: "item-1", status: "inactive" });
  await updateReportSettingItem({ itemId: "item-1", status: "inactive", productId: "" }, context, config, updateProvider);
  assert.match(updateProvider.calls[0].url, /\/rest\/v1\/rpc\/mcp_idempotent_update_report_setting_item$/);
  const updateArgs = JSON.parse(updateProvider.calls[0].init.body);
  assert.deepEqual(updateArgs.p_patch, { product_id: null, status: "inactive" });
});

test("validation fails before provider access and never falls back to timestamp keys", async () => {
  let providerCalls = 0;
  const fetchImpl = async () => {
    providerCalls += 1;
    throw new Error("provider_must_not_be_called");
  };

  await assert.rejects(
    createReportSettingGroup({ title: "---" }, context, config, { fetchImpl }),
    (error) => error.code === "invalid_group_key" && error.statusCode === 400
  );
  await assert.rejects(
    createReportSettingItem({ groupId: "group-1", label: "***" }, context, config, { fetchImpl }),
    (error) => error.code === "invalid_item_key" && error.statusCode === 400
  );
  await assert.rejects(
    updateReportSettingGroup({ groupId: "group-1" }, context, config, { fetchImpl }),
    (error) => error.code === "report_setting_patch_required" && error.statusCode === 400
  );
  await assert.rejects(
    updateReportSettingItem({ itemId: "item-1", sortOrder: 1.2 }, context, config, { fetchImpl }),
    (error) => error.code === "invalid_sort_order" && error.statusCode === 400
  );
  assert.equal(providerCalls, 0);
});

test("business errors are canonical while unknown provider failures remain neutral", async () => {
  await assert.rejects(
    updateReportSettingGroup(
      { groupId: "missing", status: "inactive" },
      context,
      config,
      { fetchImpl: async () => jsonResponse({ message: "report_setting_group_not_found" }, 400) }
    ),
    (error) => error.code === "report_setting_group_not_found" && error.statusCode === 404
  );
  await assert.rejects(
    createReportSettingItem(
      { groupId: "group-1", label: "Trà sữa" },
      context,
      config,
      { fetchImpl: async () => jsonResponse({ message: "report_setting_item_key_conflict" }, 400) }
    ),
    (error) => error.code === "report_setting_item_key_conflict" && error.statusCode === 409
  );
  await assert.rejects(
    createReportSettingGroup(
      { title: "Đối thủ" },
      context,
      config,
      { fetchImpl: async () => jsonResponse({ message: "duplicate key value violates unique constraint", details: "secret" }, 500) }
    ),
    (error) => error.message === "provider_request_failed" && error.statusCode === 502 && !error.code
  );
});
