import { normalizeIdempotencyProviderError } from "./idempotency.js";
import { supabaseRpc } from "./supabase-adapter.js";

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function badRequest(code) {
  const error = new Error(code);
  error.statusCode = 400;
  throw error;
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
  if (code.endsWith("_not_found")) error.statusCode = 404;
  else if (code.includes("closed") || code.includes("read_only") || code.includes("already_exists")) error.statusCode = 409;
  else if (code.includes("required") || code.startsWith("invalid_")) error.statusCode = 400;
  return error;
}

function normalizedOrderItems(value) {
  if (!Array.isArray(value) || value.length === 0) badRequest("order_items_required");
  return value.map((item) => {
    const row = object(item);
    const productName = text(row.productName || row.product_name);
    const quantity = Number(row.quantity || 0);
    const unitPrice = Number(row.unitPrice ?? row.unit_price ?? 0);
    const discount = Number(row.discount || 0);
    if (!productName) badRequest("product_name_required");
    if (!Number.isFinite(quantity) || quantity <= 0) badRequest("quantity_required");
    if (!Number.isFinite(unitPrice) || unitPrice < 0) badRequest("invalid_unit_price");
    if (!Number.isFinite(discount) || discount < 0) badRequest("invalid_discount");
    return {
      productId: text(row.productId || row.product_id),
      variantId: text(row.variantId || row.variant_id),
      productName,
      sku: text(row.sku),
      unit: text(row.unit),
      quantity,
      unitPrice,
      discount,
      note: text(row.note)
    };
  });
}

const TEST_STATUSES = new Set(["pending", "tested", "ok", "interested", "sample", "follow", "bad", "retry"]);

function normalizedTestResults(body) {
  const input = Array.isArray(body.results) ? body.results : Array.isArray(body.items) ? body.items : [];
  if (!input.length) badRequest("test_results_required");
  return input.map((item) => {
    const row = object(item);
    const productId = text(row.productId || row.product_id);
    const productName = text(row.productName || row.product_name);
    const status = String(row.status || body.testStatus || body.test_status || "tested").trim().toLowerCase();
    if (!productId && !productName) badRequest("product_name_required");
    if (!TEST_STATUSES.has(status)) badRequest("invalid_test_status");
    return { productId, productName, status, note: text(row.note) };
  });
}

function normalizedReportSelection(value) {
  return Array.isArray(value)
    ? value.map((item) => {
        const row = object(item);
        return {
          id: String(row.id || row.key || row.value || row.label || "").trim(),
          label: text(row.label),
          value: text(row.value),
          groupTitle: text(row.groupTitle),
          category: text(row.category),
          brandName: text(row.brandName),
          productId: text(row.productId)
        };
      }).filter((item) => item.id)
    : [];
}

function selectionIds(items) {
  return Array.from(new Set(items.map((item) => item.id).filter(Boolean)));
}

function reportFallbackContent(fields, competitors, products, context) {
  const parts = [];
  if (competitors.length) parts.push(`Đối thủ: ${competitors.map((item) => item.label || item.value || item.id).join(", ")}`);
  if (products.length) parts.push(`Sản phẩm đang dùng: ${products.map((item) => item.label || item.value || item.id).join(", ")}`);
  for (const key of ["priceSummary", "competitorSummary", "displaySummary", "stockSummary", "demandSummary", "opportunitySummary", "riskSummary", "nextAction", "note"]) {
    const value = text(fields[key]);
    if (value) parts.push(value);
  }
  return parts.join("\n") || `Báo cáo thị trường: ${text(context.customerName || context.customer_name) || "khách trong phiên"}`;
}

export async function createSessionCustomerOrder(body, context, config, options) {
  const sessionCustomerId = text(body.sessionCustomerId || body.session_customer_id || body.id);
  if (!sessionCustomerId) badRequest("session_customer_id_required");
  try {
    return await supabaseRpc(config, "mcp_idempotent_create_order_from_session_customer", {
      p_session_customer_id: sessionCustomerId,
      p_items: normalizedOrderItems(body.items),
      p_note: text(body.note),
      p_status: text(body.status) || "confirmed",
      p_context: foundationContext(context)
    }, { fetchImpl: options?.fetchImpl || fetch });
  } catch (error) {
    throw normalizeMutationError(error);
  }
}

export async function createSessionCustomerTest(body, context, config, options) {
  const sessionCustomerId = text(body.sessionCustomerId || body.session_customer_id || body.id);
  if (!sessionCustomerId) badRequest("session_customer_id_required");
  try {
    return await supabaseRpc(config, "mcp_idempotent_create_test_from_session_customer", {
      p_session_customer_id: sessionCustomerId,
      p_file_id: text(body.fileId || body.file_id || body.testFileId || body.test_file_id),
      p_file_title: text(body.fileTitle || body.file_title) || "Test nhanh từ checklist",
      p_results: normalizedTestResults(body),
      p_note: text(body.note),
      p_status: text(body.customerStatus || body.customer_status) || "tested",
      p_context: foundationContext(context)
    }, { fetchImpl: options?.fetchImpl || fetch });
  } catch (error) {
    throw normalizeMutationError(error);
  }
}

export async function createSessionCustomerReport(body, context, config, options) {
  const sessionCustomerId = text(body.sessionCustomerId || body.session_customer_id || body.id);
  if (!sessionCustomerId) badRequest("session_customer_id_required");
  const fields = object(body.fields);
  const selected = object(body.selected);
  const businessContext = object(body.context);
  const competitors = normalizedReportSelection(selected.competitors);
  const usedProducts = normalizedReportSelection(selected.usedProducts);
  const settingItems = normalizedReportSelection(selected.settingItems);
  const allItems = settingItems.length ? settingItems : [...competitors, ...usedProducts];
  const reportType = String(body.reportType || body.report_type || "market_report").trim().toLowerCase();
  if (!new Set(["market_report", "price", "competitor", "display", "stock", "demand", "general"]).has(reportType)) badRequest("invalid_report_type");
  const content = text(body.content) || reportFallbackContent(fields, competitors, usedProducts.length ? usedProducts : allItems, businessContext);
  try {
    return await supabaseRpc(config, "mcp_idempotent_create_report_from_session_customer", {
      p_session_customer_id: sessionCustomerId,
      p_report_type: reportType,
      p_content: content,
      p_price_summary: text(fields.priceSummary),
      p_competitor_summary: text(fields.competitorSummary),
      p_display_summary: text(fields.displaySummary),
      p_stock_summary: text(fields.stockSummary),
      p_demand_summary: text(fields.demandSummary),
      p_opportunity_summary: text(fields.opportunitySummary),
      p_risk_summary: text(fields.riskSummary),
      p_next_action: text(fields.nextAction),
      p_note: text(fields.note) || content,
      p_raw_payload: {
        context: businessContext,
        fields,
        selected: { competitors, usedProducts, settingItems: allItems },
        inputSessionCustomerId: text(body.sessionCustomerId || body.session_customer_id),
        resolvedSessionCustomerId: sessionCustomerId
      },
      p_selected_competitor_ids: selectionIds(competitors),
      p_selected_used_product_ids: selectionIds(usedProducts),
      p_selected_setting_item_ids: selectionIds(allItems),
      p_context: foundationContext(context)
    }, { fetchImpl: options?.fetchImpl || fetch });
  } catch (error) {
    throw normalizeMutationError(error);
  }
}

export async function createSessionCustomerFollowup(body, context, config, options) {
  const sessionCustomerId = text(body.sessionCustomerId || body.session_customer_id || body.id);
  const title = text(body.title || body.followupTitle || body.followup_title);
  const priority = String(body.priority || "medium").trim().toLowerCase();
  if (!sessionCustomerId) badRequest("session_customer_id_required");
  if (!title) badRequest("followup_title_required");
  if (!["low", "medium", "high", "urgent"].includes(priority)) badRequest("invalid_priority");
  try {
    return await supabaseRpc(config, "mcp_idempotent_create_followup_from_session_customer", {
      p_session_customer_id: sessionCustomerId,
      p_title: title,
      p_due_date: text(body.dueDate || body.due_date),
      p_priority: priority,
      p_owner: text(body.owner),
      p_note: text(body.note),
      p_followup_type: text(body.followupType || body.followup_type || body.type) || "general",
      p_context: foundationContext(context)
    }, { fetchImpl: options?.fetchImpl || fetch });
  } catch (error) {
    throw normalizeMutationError(error);
  }
}
