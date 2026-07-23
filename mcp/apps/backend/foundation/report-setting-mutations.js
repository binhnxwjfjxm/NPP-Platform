import { normalizeIdempotencyProviderError } from "./idempotency.js";
import { supabaseRpc } from "./supabase-adapter.js";

const MAX_SORT_ORDER = 100000;
const SETTING_STATUSES = new Set(["active", "inactive"]);

function badRequest(code) {
  const error = new Error(code);
  error.statusCode = 400;
  error.code = code;
  throw error;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function requiredText(value, code, maxLength) {
  const normalized = text(value);
  if (!normalized) badRequest(code);
  if (normalized.length > maxLength) badRequest(`invalid_${code.replace(/_required$/, "")}`);
  return normalized;
}

function nullableText(value, code, maxLength) {
  const normalized = text(value);
  if (normalized && normalized.length > maxLength) badRequest(code);
  return normalized;
}

function metadata(value) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) badRequest("invalid_meta");
  return value;
}

function settingKey(value, code) {
  const normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized || normalized.length > 120) badRequest(code);
  return normalized;
}

function sortOrder(value) {
  const parsed = Number(value ?? 0);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_SORT_ORDER) badRequest("invalid_sort_order");
  return parsed;
}

function settingStatus(value) {
  const normalized = String(value ?? "active").trim().toLowerCase();
  if (!SETTING_STATUSES.has(normalized)) badRequest("invalid_setting_status");
  return normalized;
}

function groupType(value) {
  const normalized = String(value ?? "market_report").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(normalized)) badRequest("invalid_group_type");
  return normalized;
}

function foundationContext(context) {
  return {
    requestId: context.requestId,
    idempotencyKey: context.idempotencyKey || null,
    receivedAt: context.receivedAt || null,
    installationId: context.installation.id,
    nppCode: context.installation.nppCode,
    actorId: context.actor.id,
    actorType: context.actor.type,
    actorAuthentication: context.actor.authentication || null
  };
}

function providerBusinessCode(error) {
  const normalized = String(error?.providerMessage || "").trim().toLowerCase();
  return /^[a-z][a-z0-9_]{2,127}$/.test(normalized) ? normalized : null;
}

function normalizeMutationError(error) {
  if (normalizeIdempotencyProviderError(error)) return error;

  const code = providerBusinessCode(error);
  if (!code) return error;
  error.code = code;
  if (code.endsWith("_not_found")) {
    error.statusCode = 404;
  } else if (code.includes("_conflict") || code.includes("already_exists")) {
    error.statusCode = 409;
  } else if (code.includes("required") || code.startsWith("invalid_")) {
    error.statusCode = 400;
  }
  return error;
}

export async function createReportSettingGroup(body, context, config, options) {
  const fetchImpl = options?.fetchImpl || fetch;
  const title = requiredText(body.title, "title_required", 200);
  try {
    return await supabaseRpc(config, "mcp_idempotent_create_report_setting_group", {
      p_group_key: settingKey(body.key ?? title, "invalid_group_key"),
      p_title: title,
      p_group_type: groupType(body.groupType ?? body.group_type),
      p_description: nullableText(body.description, "invalid_description", 2000),
      p_sort_order: sortOrder(body.sortOrder ?? body.sort_order),
      p_status: settingStatus(body.status),
      p_meta: metadata(body.meta),
      p_context: foundationContext(context)
    }, { fetchImpl });
  } catch (error) {
    throw normalizeMutationError(error);
  }
}

export async function updateReportSettingGroup(body, context, config, options) {
  const fetchImpl = options?.fetchImpl || fetch;
  const groupId = requiredText(body.groupId ?? body.group_id, "group_id_required", 200);
  const patch = {};
  if (hasOwn(body, "key")) patch.group_key = settingKey(body.key, "invalid_group_key");
  if (hasOwn(body, "title")) patch.title = requiredText(body.title, "title_required", 200);
  if (hasOwn(body, "description")) patch.description = nullableText(body.description, "invalid_description", 2000);
  if (hasOwn(body, "sortOrder") || hasOwn(body, "sort_order")) patch.sort_order = sortOrder(body.sortOrder ?? body.sort_order);
  if (hasOwn(body, "status")) patch.status = settingStatus(body.status);
  if (hasOwn(body, "meta")) patch.meta = metadata(body.meta);
  if (Object.keys(patch).length === 0) badRequest("report_setting_patch_required");
  try {
    return await supabaseRpc(config, "mcp_idempotent_update_report_setting_group", {
      p_group_id: groupId,
      p_patch: patch,
      p_context: foundationContext(context)
    }, { fetchImpl });
  } catch (error) {
    throw normalizeMutationError(error);
  }
}

export async function createReportSettingItem(body, context, config, options) {
  const fetchImpl = options?.fetchImpl || fetch;
  const groupId = requiredText(body.groupId ?? body.group_id, "group_id_required", 200);
  const label = requiredText(body.label, "label_required", 200);
  const value = nullableText(body.value, "invalid_value", 500) || label;
  try {
    return await supabaseRpc(config, "mcp_idempotent_create_report_setting_item", {
      p_group_id: groupId,
      p_item_key: settingKey(body.key ?? label, "invalid_item_key"),
      p_label: label,
      p_value: value,
      p_category: nullableText(body.category, "invalid_category", 500),
      p_brand_name: nullableText(body.brandName ?? body.brand_name, "invalid_brand_name", 500),
      p_product_id: nullableText(body.productId ?? body.product_id, "invalid_product_id", 200),
      p_sort_order: sortOrder(body.sortOrder ?? body.sort_order),
      p_status: settingStatus(body.status),
      p_meta: metadata(body.meta),
      p_context: foundationContext(context)
    }, { fetchImpl });
  } catch (error) {
    throw normalizeMutationError(error);
  }
}

export async function updateReportSettingItem(body, context, config, options) {
  const fetchImpl = options?.fetchImpl || fetch;
  const itemId = requiredText(body.itemId ?? body.item_id, "item_id_required", 200);
  const patch = {};
  if (hasOwn(body, "key")) patch.item_key = settingKey(body.key, "invalid_item_key");
  if (hasOwn(body, "label")) patch.label = requiredText(body.label, "label_required", 200);
  if (hasOwn(body, "value")) patch.value = nullableText(body.value, "invalid_value", 500);
  if (hasOwn(body, "category")) patch.category = nullableText(body.category, "invalid_category", 500);
  if (hasOwn(body, "brandName") || hasOwn(body, "brand_name")) patch.brand_name = nullableText(body.brandName ?? body.brand_name, "invalid_brand_name", 500);
  if (hasOwn(body, "productId") || hasOwn(body, "product_id")) patch.product_id = nullableText(body.productId ?? body.product_id, "invalid_product_id", 200);
  if (hasOwn(body, "sortOrder") || hasOwn(body, "sort_order")) patch.sort_order = sortOrder(body.sortOrder ?? body.sort_order);
  if (hasOwn(body, "status")) patch.status = settingStatus(body.status);
  if (hasOwn(body, "meta")) patch.meta = metadata(body.meta);
  if (Object.keys(patch).length === 0) badRequest("report_setting_patch_required");
  try {
    return await supabaseRpc(config, "mcp_idempotent_update_report_setting_item", {
      p_item_id: itemId,
      p_patch: patch,
      p_context: foundationContext(context)
    }, { fetchImpl });
  } catch (error) {
    throw normalizeMutationError(error);
  }
}
