import { executeWriteCommand } from "./write-command.js";
import { createPostgresqlWriteTransaction } from "./postgresql-write-repository.js";
import { providerPersistence } from "./provider-runtime.js";

export const POSTGRESQL_REPORT_RPC_NAMES = Object.freeze(new Set([
  "mcp_idempotent_create_report_from_session_customer"
]));

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function fail(code, statusCode = 400) {
  const error = new Error(code);
  error.code = code;
  error.providerMessage = code;
  error.statusCode = statusCode;
  throw error;
}

function requestContext(config, args) {
  const source = object(args.p_context);
  const installationId = text(source.installationId) || text(config.installationId);
  if (!installationId) fail("installation_id_required");
  if (text(source.installationId) && text(config.installationId) && source.installationId !== config.installationId) {
    fail("installation_scope_mismatch", 403);
  }
  return Object.freeze({
    requestId: text(source.requestId) || `req_report_${Date.now()}`,
    idempotencyKey: text(source.idempotencyKey),
    receivedAt: text(source.receivedAt) || new Date().toISOString(),
    installation: Object.freeze({
      id: installationId,
      nppCode: text(source.nppCode) || text(config.nppCode)
    }),
    actor: Object.freeze({
      id: text(source.actorId) || text(config.legacyActorId) || "service:mcp",
      type: text(source.actorType) || "service",
      authentication: text(source.actorAuthentication) || "backend-token"
    }),
    principal: config.servicePrincipal,
    auth: Object.freeze({ mode: config.authMode, authenticated: true })
  });
}

async function createReport(client, args, context) {
  const sessionCustomerId = text(args.p_session_customer_id);
  if (!sessionCustomerId) fail("session_customer_id_required");
  const selected = await client.query(
    `SELECT sc.*, s.status AS session_status, s.session_date, s.sales, s.route_name
     FROM mcp.mcp_session_customers sc
     JOIN mcp.mcp_route_sessions s
       ON s.installation_id = sc.installation_id
      AND s.id = sc.session_id
     WHERE sc.installation_id = $1 AND sc.id = $2
     FOR UPDATE OF sc, s`,
    [context.installation.id, sessionCustomerId]
  );
  const customer = selected.rows?.[0];
  if (!customer) fail("session_customer_not_found", 404);
  if (customer.session_status !== "active") fail("session_read_only", 409);
  if (customer.report_id) fail("session_customer_report_already_exists", 409);

  const reportType = text(args.p_report_type) || "market_report";
  const content = text(args.p_content);
  if (!content) fail("report_content_required");
  const rawPayload = {
    ...object(args.p_raw_payload),
    foundation_context: object(args.p_context),
    session_customer_id: customer.id,
    route_customer_id: customer.route_customer_id
  };
  const inserted = await client.query(
    `INSERT INTO mcp.market_reports (
       installation_id, report_date, sales, market_area, route_name,
       market_type, report_type, content,
       price_summary, competitor_summary, display_summary, stock_summary,
       demand_summary, opportunity_summary, risk_summary, next_action, note,
       selected_competitor_ids, selected_used_product_ids, selected_setting_item_ids,
       raw_payload
     ) VALUES (
       $1, $2::date, $3, $4, $5,
       $6, $6, $7,
       $8, $9, $10, $11,
       $12, $13, $14, $15, $16,
       $17::jsonb, $18::jsonb, $19::jsonb,
       $20::jsonb
     )
     RETURNING *`,
    [
      context.installation.id,
      customer.session_date,
      customer.sales,
      customer.area,
      customer.route_name,
      reportType,
      content,
      text(args.p_price_summary),
      text(args.p_competitor_summary),
      text(args.p_display_summary),
      text(args.p_stock_summary),
      text(args.p_demand_summary),
      text(args.p_opportunity_summary),
      text(args.p_risk_summary),
      text(args.p_next_action),
      text(args.p_note) || content,
      json(array(args.p_selected_competitor_ids)),
      json(array(args.p_selected_used_product_ids)),
      json(array(args.p_selected_setting_item_ids)),
      json(rawPayload)
    ]
  );
  const report = inserted.rows[0];
  await client.query(
    `UPDATE mcp.mcp_session_customers
     SET report_id = $3::text,
         visit_status = 'visited',
         status = 'done',
         raw_payload = COALESCE(raw_payload, '{}'::jsonb) ||
           jsonb_build_object('latest_report_id', $3::text),
         updated_at = now()
     WHERE installation_id = $1 AND id = $2`,
    [context.installation.id, customer.id, report.id]
  );
  await client.query(
    `UPDATE mcp.mcp_route_sessions
     SET report_count = report_count + 1,
         updated_at = now()
     WHERE installation_id = $1 AND id = $2`,
    [context.installation.id, customer.session_id]
  );
  return {
    id: report.id,
    reportId: report.id,
    sessionCustomerId: customer.id,
    reportType: report.report_type,
    content: report.content,
    priceSummary: report.price_summary,
    competitorSummary: report.competitor_summary,
    displaySummary: report.display_summary,
    stockSummary: report.stock_summary,
    demandSummary: report.demand_summary,
    opportunitySummary: report.opportunity_summary,
    riskSummary: report.risk_summary,
    nextAction: report.next_action,
    note: report.note,
    selectedCompetitorIds: report.selected_competitor_ids,
    selectedUsedProductIds: report.selected_used_product_ids,
    selectedSettingItemIds: report.selected_setting_item_ids
  };
}

function repositoryFactory(client) {
  return Object.freeze({
    report: Object.freeze({
      create(args, context) {
        return createReport(client, args, context);
      }
    })
  });
}

export async function postgresqlReportRpc(config, name, args = {}) {
  if (!POSTGRESQL_REPORT_RPC_NAMES.has(name)) fail("postgresql_rpc_not_implemented", 503);
  try {
    const context = requestContext(config, args);
    const persistence = providerPersistence();
    const transaction = createPostgresqlWriteTransaction(persistence, {
      domainRepositoryFactory: repositoryFactory
    });
    return await executeWriteCommand({
      context,
      commandName: "mcp.report.create-from-session",
      permission: "mcp.report.write",
      payload: Object.fromEntries(Object.entries(args).filter(([key]) => key !== "p_context")),
      aggregate: (result) => ({ type: "market_report", id: result.reportId, version: 1 }),
      eventType: "mcp.report.created",
      transaction,
      mutate: (tx) => tx.repositories.report.create(args, context)
    });
  } catch (error) {
    if (!error.providerMessage) error.providerMessage = text(error.code) || text(error.message) || "provider_request_failed";
    throw error;
  }
}
