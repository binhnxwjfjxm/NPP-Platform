import { executeWriteCommand } from "./write-command.js";
import { createPostgresqlWriteTransaction } from "./postgresql-write-repository.js";
import { providerPersistence } from "./provider-runtime.js";

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const READ_TABLES = new Set([
  "mcp_routes",
  "mcp_route_customers",
  "mcp_route_sessions",
  "mcp_session_customers",
  "mcp_visits",
  "mcp_followups",
  "mcp_session_reports",
  "market_reports",
  "mcp_report_setting_groups",
  "mcp_report_settings",
  "mcp_report_templates",
  "test_files",
  "test_file_products",
  "test_customers",
  "test_customer_results",
  "orders",
  "order_items",
  "accounts",
  "products",
  "product_variants",
  "mcp_outlet_media"
]);

function businessError(code, statusCode = 400, details = null) {
  const error = new Error(code);
  error.code = code;
  error.providerMessage = code;
  error.statusCode = statusCode;
  if (details) error.publicDetails = details;
  return error;
}

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

function numeric(value, fallback = 0) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function installationId(context) {
  const value = text(context?.installation?.id);
  if (!value) throw businessError("installation_id_required", 400);
  return value;
}

function requestContext(config, args) {
  const source = object(args?.p_context);
  const requestId = text(source.requestId) || `req_compat_${Date.now()}`;
  const idempotencyKey = text(source.idempotencyKey);
  return Object.freeze({
    requestId,
    installation: Object.freeze({
      id: text(source.installationId) || config.installationId,
      nppCode: text(source.nppCode) || config.nppCode
    }),
    actor: Object.freeze({
      id: text(source.actorId) || config.legacyActorId,
      type: text(source.actorType) || "service",
      authentication: text(source.actorAuthentication) || "backend-token"
    }),
    principal: config.servicePrincipal,
    auth: Object.freeze({ mode: config.authMode, authenticated: true }),
    idempotencyKey,
    receivedAt: text(source.receivedAt) || new Date().toISOString()
  });
}

function routeResult(row) {
  return {
    id: row.id,
    routeId: row.id,
    routeCode: row.route_code,
    routeName: row.route_name,
    area: row.area,
    weekday: row.weekday,
    sales: row.sales,
    distributorId: row.distributor_id,
    active: row.active,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function routeCustomerResult(row, extra = {}) {
  return {
    id: row.id,
    routeCustomerId: row.id,
    routeId: row.route_id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    accountName: row.customer_name,
    phone: row.phone,
    area: row.area,
    address: row.address,
    sortOrder: row.sort_order,
    active: row.active,
    note: row.note,
    geoLat: row.geo_lat,
    geoLng: row.geo_lng,
    geoAccuracy: row.geo_accuracy,
    geoSource: row.geo_source,
    googleMapsUrl: row.google_maps_url,
    syncStatus: row.sync_status,
    ...extra
  };
}

function sessionResult(row, extra = {}) {
  return {
    id: row.id,
    sessionId: row.id,
    routeId: row.route_id,
    routeName: row.route_name,
    sessionDate: row.session_date,
    sales: row.sales,
    area: row.area,
    status: row.status,
    plannedCustomers: row.planned_customers,
    visitedCustomers: row.visited_customers,
    orderCount: row.order_count,
    testCount: row.test_count,
    reportCount: row.report_count,
    followupCount: row.followup_count,
    note: row.note,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    ...extra
  };
}

function sessionCustomerResult(row, extra = {}) {
  return {
    id: row.id,
    sessionCustomerId: row.id,
    sessionId: row.session_id,
    routeId: row.route_id,
    routeCustomerId: row.route_customer_id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    accountName: row.account_name,
    phone: row.phone,
    area: row.area,
    address: row.address,
    sortOrder: row.sort_order,
    source: row.source,
    status: row.status,
    visitStatus: row.visit_status,
    statusReason: row.status_reason,
    orderId: row.order_id,
    testId: row.test_id,
    reportId: row.report_id,
    followupCount: row.followup_count,
    checkedIn: row.checked_in,
    checkinAt: row.checkin_at,
    checkinLat: row.checkin_lat,
    checkinLng: row.checkin_lng,
    checkinAccuracy: row.checkin_accuracy,
    checkinSource: row.checkin_source,
    note: row.note,
    ...extra
  };
}

async function requireRoute(client, context, routeId, { active = false, lock = false } = {}) {
  const result = await client.query(
    `SELECT * FROM mcp.mcp_routes
     WHERE installation_id = $1 AND id = $2${active ? " AND active IS TRUE" : ""}${lock ? " FOR UPDATE" : ""}`,
    [installationId(context), text(routeId)]
  );
  const row = result.rows?.[0];
  if (!row) throw businessError(active ? "route_inactive_or_not_found" : "route_not_found", 404);
  return row;
}

async function requireRouteCustomer(client, context, id, { lock = false } = {}) {
  const result = await client.query(
    `SELECT * FROM mcp.mcp_route_customers
     WHERE installation_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [installationId(context), text(id)]
  );
  const row = result.rows?.[0];
  if (!row) throw businessError("route_customer_not_found", 404);
  return row;
}

async function requireSession(client, context, id, { mutable = false, lock = false } = {}) {
  const result = await client.query(
    `SELECT * FROM mcp.mcp_route_sessions
     WHERE installation_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [installationId(context), text(id)]
  );
  const row = result.rows?.[0];
  if (!row) throw businessError("session_not_found", 404);
  if (mutable && row.status !== "active") throw businessError("session_read_only", 409);
  return row;
}

async function requireSessionCustomer(client, context, id, { mutable = false, lock = false } = {}) {
  const result = await client.query(
    `SELECT sc.*, s.status AS session_status
     FROM mcp.mcp_session_customers sc
     JOIN mcp.mcp_route_sessions s ON s.id = sc.session_id AND s.installation_id = sc.installation_id
     WHERE sc.installation_id = $1 AND sc.id = $2${lock ? " FOR UPDATE OF sc, s" : ""}`,
    [installationId(context), text(id)]
  );
  const row = result.rows?.[0];
  if (!row) throw businessError("session_customer_not_found", 404);
  if (mutable && row.session_status !== "active") throw businessError("session_read_only", 409);
  return row;
}

async function createRoute(client, args, context) {
  const result = await client.query(
    `INSERT INTO mcp.mcp_routes (
       installation_id, distributor_id, route_name, area, weekday, note, raw_payload
     ) VALUES ($1, $2, $3, $4, $5, $6, jsonb_build_object('foundation_context', $7::jsonb))
     RETURNING *`,
    [
      installationId(context), text(args.p_distributor_id), text(args.p_route_name), text(args.p_area),
      args.p_weekday == null ? null : Number(args.p_weekday), text(args.p_note), json(args.p_context || {})
    ]
  );
  return routeResult(result.rows[0]);
}

async function updateRoute(client, args, context) {
  await requireRoute(client, context, args.p_route_id, { lock: true });
  const result = await client.query(
    `UPDATE mcp.mcp_routes
     SET route_name = COALESCE($3, route_name),
         area = COALESCE($4, area),
         weekday = COALESCE($5, weekday),
         note = CASE WHEN $6::boolean THEN $7 ELSE note END,
         active = COALESCE($8, active),
         distributor_id = CASE WHEN $9::boolean THEN $10 ELSE distributor_id END,
         raw_payload = jsonb_set(COALESCE(raw_payload, '{}'::jsonb), '{foundation_context}', $11::jsonb, true),
         updated_at = now()
     WHERE installation_id = $1 AND id = $2
     RETURNING *`,
    [
      installationId(context), text(args.p_route_id), text(args.p_route_name), text(args.p_area),
      args.p_weekday == null ? null : Number(args.p_weekday),
      Object.prototype.hasOwnProperty.call(args, "p_note"), text(args.p_note),
      args.p_active == null ? null : Boolean(args.p_active),
      Object.prototype.hasOwnProperty.call(args, "p_distributor_id"), text(args.p_distributor_id),
      json(args.p_context || {})
    ]
  );
  return routeResult(result.rows[0]);
}

async function addRouteCustomer(client, args, context) {
  const route = await requireRoute(client, context, args.p_route_id, { active: true, lock: true });
  const sortResult = await client.query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
     FROM mcp.mcp_route_customers WHERE installation_id = $1 AND route_id = $2`,
    [installationId(context), route.id]
  );
  const sortOrder = args.p_sort_order == null
    ? Number(sortResult.rows?.[0]?.next_order || 0)
    : Number(args.p_sort_order);
  const inserted = await client.query(
    `INSERT INTO mcp.mcp_route_customers (
       installation_id, route_id, customer_id, customer_name, phone, area, address,
       sort_order, note, geo_lat, geo_lng, geo_accuracy, geo_source, geo_captured_at,
       google_maps_url, raw_payload
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12, $13, CASE WHEN $10::numeric IS NULL THEN NULL ELSE now() END,
       $14, jsonb_build_object('foundation_context', $15::jsonb)
     ) RETURNING *`,
    [
      installationId(context), route.id, text(args.p_customer_id), text(args.p_customer_name),
      text(args.p_phone), text(args.p_area), text(args.p_address), sortOrder, text(args.p_note),
      args.p_geo_lat, args.p_geo_lng, args.p_geo_accuracy, text(args.p_geo_source),
      text(args.p_google_maps_url), json(args.p_context || {})
    ]
  );
  let sessionCustomerId = null;
  if (args.p_include_active_session === true) {
    const session = await requireSession(client, context, args.p_active_session_id, { mutable: true, lock: true });
    if (session.route_id !== route.id) throw businessError("active_session_route_mismatch", 400);
    const sessionRow = await client.query(
      `INSERT INTO mcp.mcp_session_customers (
         installation_id, session_id, route_id, route_customer_id, customer_id,
         customer_name, account_name, phone, area, address, sort_order, source, note, raw_payload
       ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, 'added', $11,
         jsonb_build_object('foundation_context', $12::jsonb))
       RETURNING id`,
      [
        installationId(context), session.id, route.id, inserted.rows[0].id, text(args.p_customer_id),
        text(args.p_customer_name), text(args.p_phone), text(args.p_area), text(args.p_address),
        sortOrder, text(args.p_note), json(args.p_context || {})
      ]
    );
    sessionCustomerId = sessionRow.rows[0].id;
    await client.query(
      `UPDATE mcp.mcp_route_sessions
       SET planned_customers = planned_customers + 1, updated_at = now()
       WHERE installation_id = $1 AND id = $2`,
      [installationId(context), session.id]
    );
  }
  return routeCustomerResult(inserted.rows[0], { sessionCustomerId });
}

async function updateRouteCustomer(client, args, context) {
  await requireRouteCustomer(client, context, args.p_route_customer_id, { lock: true });
  const result = await client.query(
    `UPDATE mcp.mcp_route_customers
     SET customer_name = COALESCE($3, customer_name),
         phone = CASE WHEN $4::boolean THEN $5 ELSE phone END,
         area = CASE WHEN $6::boolean THEN $7 ELSE area END,
         address = CASE WHEN $8::boolean THEN $9 ELSE address END,
         sort_order = COALESCE($10, sort_order),
         note = CASE WHEN $11::boolean THEN $12 ELSE note END,
         active = COALESCE($13, active),
         geo_lat = CASE WHEN $14::boolean THEN $15 ELSE geo_lat END,
         geo_lng = CASE WHEN $14::boolean THEN $16 ELSE geo_lng END,
         geo_accuracy = CASE WHEN $14::boolean THEN $17 ELSE geo_accuracy END,
         geo_source = CASE WHEN $14::boolean THEN $18 ELSE geo_source END,
         geo_captured_at = CASE WHEN $14::boolean THEN now() ELSE geo_captured_at END,
         google_maps_url = CASE WHEN $19::boolean THEN $20 ELSE google_maps_url END,
         raw_payload = jsonb_set(COALESCE(raw_payload, '{}'::jsonb), '{foundation_context}', $21::jsonb, true),
         updated_at = now()
     WHERE installation_id = $1 AND id = $2
     RETURNING *`,
    [
      installationId(context), text(args.p_route_customer_id), text(args.p_customer_name),
      Object.prototype.hasOwnProperty.call(args, "p_phone"), text(args.p_phone),
      Object.prototype.hasOwnProperty.call(args, "p_area"), text(args.p_area),
      Object.prototype.hasOwnProperty.call(args, "p_address"), text(args.p_address),
      args.p_sort_order == null ? null : Number(args.p_sort_order),
      Object.prototype.hasOwnProperty.call(args, "p_note"), text(args.p_note),
      args.p_active == null ? null : Boolean(args.p_active),
      args.p_geo_lat != null || args.p_geo_lng != null,
      args.p_geo_lat, args.p_geo_lng, args.p_geo_accuracy, text(args.p_geo_source),
      Object.prototype.hasOwnProperty.call(args, "p_google_maps_url"), text(args.p_google_maps_url),
      json(args.p_context || {})
    ]
  );
  return routeCustomerResult(result.rows[0]);
}

async function openRouteSession(client, args, context) {
  const route = await requireRoute(client, context, args.p_route_id, { active: true, lock: true });
  const existing = await client.query(
    `SELECT id FROM mcp.mcp_route_sessions
     WHERE installation_id = $1 AND route_id = $2 AND status = 'active' FOR UPDATE`,
    [installationId(context), route.id]
  );
  if (existing.rows?.[0]) throw businessError("active_session_already_exists", 409);
  const count = await client.query(
    `SELECT COUNT(*)::integer AS count FROM mcp.mcp_route_customers
     WHERE installation_id = $1 AND route_id = $2 AND active IS TRUE`,
    [installationId(context), route.id]
  );
  const created = await client.query(
    `INSERT INTO mcp.mcp_route_sessions (
       installation_id, route_id, route_name, session_date, sales, area, status,
       planned_customers, opened_at, raw_payload
     ) VALUES ($1, $2, $3, $4::date, $5, $6, 'active', $7, now(),
       jsonb_build_object('foundation_context', $8::jsonb))
     RETURNING *`,
    [
      installationId(context), route.id, route.route_name, args.p_session_date,
      text(args.p_owner) || route.sales, route.area, Number(count.rows?.[0]?.count || 0),
      json(args.p_context || {})
    ]
  );
  await client.query(
    `INSERT INTO mcp.mcp_session_customers (
       installation_id, session_id, route_id, route_customer_id, customer_id,
       customer_name, account_name, phone, area, address, sort_order, source, note, raw_payload
     )
     SELECT installation_id, $3, route_id, id, customer_id,
            customer_name, customer_name, phone, area, address, sort_order, 'planned', note,
            jsonb_build_object('route_customer_snapshot', to_jsonb(rc))
     FROM mcp.mcp_route_customers rc
     WHERE installation_id = $1 AND route_id = $2 AND active IS TRUE
     ORDER BY sort_order, id`,
    [installationId(context), route.id, created.rows[0].id]
  );
  return sessionResult(created.rows[0]);
}

async function updateRouteSession(client, args, context) {
  const session = await requireSession(client, context, args.p_session_id, { lock: true });
  if (session.status !== "active" && args.p_status !== session.status) throw businessError("session_read_only", 409);
  const nextStatus = text(args.p_status) || session.status;
  const result = await client.query(
    `UPDATE mcp.mcp_route_sessions
     SET session_date = COALESCE($3::date, session_date),
         status = $4,
         note = CASE WHEN $5::boolean THEN $6 ELSE note END,
         closed_at = CASE WHEN $4 IN ('done', 'cancelled') THEN COALESCE(closed_at, now()) ELSE NULL END,
         raw_payload = jsonb_set(COALESCE(raw_payload, '{}'::jsonb), '{foundation_context}', $7::jsonb, true),
         updated_at = now()
     WHERE installation_id = $1 AND id = $2
     RETURNING *`,
    [
      installationId(context), session.id, args.p_session_date || null, nextStatus,
      Object.prototype.hasOwnProperty.call(args, "p_note"), text(args.p_note), json(args.p_context || {})
    ]
  );
  return sessionResult(result.rows[0]);
}

async function deleteEmptyRouteSession(client, args, context) {
  const session = await requireSession(client, context, args.p_session_id, { lock: true });
  const activity = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM mcp.mcp_session_customers
       WHERE installation_id = $1 AND session_id = $2
         AND (checked_in IS TRUE OR visit_status <> 'pending' OR order_id IS NOT NULL OR test_id IS NOT NULL
              OR report_id IS NOT NULL OR followup_count > 0)
     ) AS exists`,
    [installationId(context), session.id]
  );
  if (activity.rows?.[0]?.exists || session.order_count > 0 || session.test_count > 0 || session.report_count > 0 || session.followup_count > 0) {
    throw businessError("session_has_activity", 409);
  }
  await client.query(
    `DELETE FROM mcp.mcp_route_sessions WHERE installation_id = $1 AND id = $2`,
    [installationId(context), session.id]
  );
  return { id: session.id, sessionId: session.id, deleted: true };
}

async function setSessionCustomerStatus(client, args, context) {
  const row = await requireSessionCustomer(client, context, args.p_session_customer_id, { mutable: true, lock: true });
  const result = await client.query(
    `UPDATE mcp.mcp_session_customers
     SET visit_status = $3,
         status = CASE WHEN $3 = 'visited' THEN 'done' ELSE $3 END,
         status_reason = $4,
         note = COALESCE($5, note),
         raw_payload = jsonb_set(COALESCE(raw_payload, '{}'::jsonb), '{foundation_context}', $6::jsonb, true),
         updated_at = now()
     WHERE installation_id = $1 AND id = $2
     RETURNING *`,
    [installationId(context), row.id, text(args.p_visit_status), text(args.p_status_reason), text(args.p_note), json(args.p_context || {})]
  );
  const visited = await client.query(
    `SELECT COUNT(*) FILTER (WHERE visit_status = 'visited')::integer AS visited
     FROM mcp.mcp_session_customers WHERE installation_id = $1 AND session_id = $2`,
    [installationId(context), row.session_id]
  );
  await client.query(
    `UPDATE mcp.mcp_route_sessions SET visited_customers = $3, updated_at = now()
     WHERE installation_id = $1 AND id = $2`,
    [installationId(context), row.session_id, Number(visited.rows?.[0]?.visited || 0)]
  );
  return sessionCustomerResult(result.rows[0]);
}

async function addSessionCustomer(client, args, context) {
  const session = await requireSession(client, context, args.p_session_id, { mutable: true, lock: true });
  let routeCustomer = null;
  if (text(args.p_route_customer_id)) {
    routeCustomer = await requireRouteCustomer(client, context, args.p_route_customer_id, { lock: true });
    if (routeCustomer.route_id !== session.route_id) throw businessError("route_customer_route_mismatch", 400);
  } else {
    routeCustomer = await addRouteCustomer(client, {
      p_route_id: session.route_id,
      p_customer_name: args.p_customer_name,
      p_customer_id: args.p_customer_id,
      p_phone: args.p_phone,
      p_area: args.p_area,
      p_address: args.p_address,
      p_note: args.p_note,
      p_geo_lat: args.p_geo_lat,
      p_geo_lng: args.p_geo_lng,
      p_geo_accuracy: args.p_geo_accuracy,
      p_geo_source: args.p_geo_source,
      p_google_maps_url: args.p_google_maps_url,
      p_include_active_session: false,
      p_context: args.p_context
    }, context);
    routeCustomer = await requireRouteCustomer(client, context, routeCustomer.routeCustomerId, { lock: true });
  }
  const duplicate = await client.query(
    `SELECT id FROM mcp.mcp_session_customers
     WHERE installation_id = $1 AND session_id = $2 AND route_customer_id = $3`,
    [installationId(context), session.id, routeCustomer.id]
  );
  if (duplicate.rows?.[0]) throw businessError("session_customer_already_exists", 409);
  const sort = await client.query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
     FROM mcp.mcp_session_customers WHERE installation_id = $1 AND session_id = $2`,
    [installationId(context), session.id]
  );
  const inserted = await client.query(
    `INSERT INTO mcp.mcp_session_customers (
       installation_id, session_id, route_id, route_customer_id, customer_id,
       customer_name, account_name, phone, area, address, sort_order, source, note, raw_payload
     ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, 'added', $11,
       jsonb_build_object('foundation_context', $12::jsonb))
     RETURNING *`,
    [
      installationId(context), session.id, session.route_id, routeCustomer.id,
      text(args.p_customer_id) || routeCustomer.customer_id,
      text(args.p_customer_name) || routeCustomer.customer_name,
      text(args.p_phone) || routeCustomer.phone,
      text(args.p_area) || routeCustomer.area,
      text(args.p_address) || routeCustomer.address,
      Number(sort.rows?.[0]?.next_order || 0), text(args.p_note), json(args.p_context || {})
    ]
  );
  await client.query(
    `UPDATE mcp.mcp_route_sessions SET planned_customers = planned_customers + 1, updated_at = now()
     WHERE installation_id = $1 AND id = $2`,
    [installationId(context), session.id]
  );
  return sessionCustomerResult(inserted.rows[0], { routeCustomer: routeCustomerResult(routeCustomer) });
}

async function setSessionCustomerCheckin(client, args, context) {
  const row = await requireSessionCustomer(client, context, args.p_session_customer_id, { mutable: true, lock: true });
  const checkedIn = args.p_checked_in === true;
  const result = await client.query(
    `UPDATE mcp.mcp_session_customers
     SET checked_in = $3,
         checkin_at = CASE WHEN $3 THEN now() ELSE NULL END,
         checkin_lat = CASE WHEN $3 THEN $4 ELSE NULL END,
         checkin_lng = CASE WHEN $3 THEN $5 ELSE NULL END,
         checkin_accuracy = CASE WHEN $3 THEN $6 ELSE NULL END,
         checkin_source = CASE WHEN $3 THEN $7 ELSE NULL END,
         raw_payload = jsonb_set(COALESCE(raw_payload, '{}'::jsonb), '{foundation_context}', $8::jsonb, true),
         updated_at = now()
     WHERE installation_id = $1 AND id = $2
     RETURNING *`,
    [installationId(context), row.id, checkedIn, args.p_geo_lat, args.p_geo_lng, args.p_geo_accuracy, text(args.p_geo_source), json(args.p_context || {})]
  );
  return sessionCustomerResult(result.rows[0]);
}

async function recordSessionCustomerResult(client, args, context) {
  const row = await requireSessionCustomer(client, context, args.p_session_customer_id, { mutable: true, lock: true });
  const payload = {
    resultType: text(args.p_result_type),
    hasOrder: args.p_has_order,
    hasTest: args.p_has_test,
    hasReport: args.p_has_report,
    foundationContext: args.p_context || {}
  };
  const result = await client.query(
    `UPDATE mcp.mcp_session_customers
     SET order_id = COALESCE($3, order_id),
         test_id = COALESCE($4, test_id),
         report_id = COALESCE($5, report_id),
         note = COALESCE($6, note),
         visit_status = 'visited',
         status = 'done',
         raw_payload = COALESCE(raw_payload, '{}'::jsonb) || jsonb_build_object('result', $7::jsonb),
         updated_at = now()
     WHERE installation_id = $1 AND id = $2
     RETURNING *`,
    [installationId(context), row.id, text(args.p_order_id), text(args.p_test_id), text(args.p_report_id), text(args.p_note), json(payload)]
  );
  return sessionCustomerResult(result.rows[0]);
}

function normalizedItems(args) {
  return array(args.p_items).map((item) => ({
    productId: text(item.productId ?? item.product_id),
    variantId: text(item.variantId ?? item.variant_id),
    productName: text(item.productName ?? item.product_name),
    sku: text(item.sku),
    unit: text(item.unit),
    quantity: numeric(item.quantity),
    unitPrice: numeric(item.unitPrice ?? item.unit_price),
    discount: numeric(item.discount),
    note: text(item.note)
  }));
}

async function insertOrder(client, context, values) {
  const items = normalizedItems({ p_items: values.items });
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const discountTotal = items.reduce((sum, item) => sum + item.discount, 0);
  const grandTotal = subtotal - discountTotal;
  const order = await client.query(
    `INSERT INTO mcp.orders (
       installation_id, order_date, sales, customer_id, customer_name, customer_phone,
       area, delivery_address, source_type, source_id, status,
       subtotal, discount_total, grand_total, note, raw_payload
     ) VALUES ($1, current_date, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       $11, $12, $13, $14, jsonb_build_object('foundation_context', $15::jsonb))
     RETURNING *`,
    [
      installationId(context), values.sales, values.customerId, values.customerName, values.customerPhone,
      values.area, values.deliveryAddress, values.sourceType, values.sourceId, values.status,
      subtotal, discountTotal, grandTotal, values.note, json(values.foundationContext || {})
    ]
  );
  for (const item of items) {
    await client.query(
      `INSERT INTO mcp.order_items (
         installation_id, order_id, product_id, variant_id, product_name, sku, unit,
         quantity, unit_price, discount, line_total, note, raw_payload
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, '{}'::jsonb)`,
      [
        installationId(context), order.rows[0].id, item.productId, item.variantId, item.productName,
        item.sku, item.unit, item.quantity, item.unitPrice, item.discount,
        item.quantity * item.unitPrice - item.discount, item.note
      ]
    );
  }
  return {
    id: order.rows[0].id,
    orderId: order.rows[0].id,
    orderCode: order.rows[0].order_code,
    customerId: order.rows[0].customer_id,
    customerName: order.rows[0].customer_name,
    status: order.rows[0].status,
    subtotal,
    discountTotal,
    grandTotal,
    items
  };
}

async function createOrder(client, args, context) {
  let customer = {
    customerId: null,
    customerName: text(args.p_customer_name),
    customerPhone: text(args.p_customer_phone),
    area: text(args.p_area),
    deliveryAddress: text(args.p_delivery_address)
  };
  let sourceId = null;
  if (text(args.p_customer_mode) === "existing") {
    const routeCustomer = await requireRouteCustomer(client, context, args.p_route_customer_id);
    sourceId = routeCustomer.id;
    customer = {
      customerId: routeCustomer.customer_id,
      customerName: routeCustomer.customer_name,
      customerPhone: routeCustomer.phone,
      area: routeCustomer.area,
      deliveryAddress: routeCustomer.address
    };
  }
  return insertOrder(client, context, {
    ...customer,
    sales: text(args.p_sales),
    sourceType: sourceId ? "route_customer" : "manual",
    sourceId,
    status: text(args.p_status) || "confirmed",
    items: args.p_items,
    note: text(args.p_note),
    foundationContext: args.p_context
  });
}

async function createOrderFromSessionCustomer(client, args, context) {
  const customer = await requireSessionCustomer(client, context, args.p_session_customer_id, { mutable: true, lock: true });
  if (customer.order_id) throw businessError("session_customer_order_already_exists", 409);
  const order = await insertOrder(client, context, {
    customerId: customer.customer_id,
    customerName: customer.customer_name,
    customerPhone: customer.phone,
    area: customer.area,
    deliveryAddress: customer.address,
    sales: null,
    sourceType: "session_customer",
    sourceId: customer.id,
    status: text(args.p_status) || "confirmed",
    items: args.p_items,
    note: text(args.p_note),
    foundationContext: args.p_context
  });
  await client.query(
    `UPDATE mcp.mcp_session_customers SET order_id = $3, visit_status = 'visited', status = 'done', updated_at = now()
     WHERE installation_id = $1 AND id = $2`,
    [installationId(context), customer.id, order.orderId]
  );
  await client.query(
    `UPDATE mcp.mcp_route_sessions SET order_count = order_count + 1, updated_at = now()
     WHERE installation_id = $1 AND id = $2`,
    [installationId(context), customer.session_id]
  );
  return { ...order, sessionCustomerId: customer.id };
}

async function createTestFromSessionCustomer(client, args, context) {
  const customer = await requireSessionCustomer(client, context, args.p_session_customer_id, { mutable: true, lock: true });
  let fileId = text(args.p_file_id);
  if (fileId) {
    const existing = await client.query(
      `SELECT id FROM mcp.test_files WHERE installation_id = $1 AND id = $2`,
      [installationId(context), fileId]
    );
    if (!existing.rows?.[0]) throw businessError("test_file_not_found", 404);
  } else {
    const file = await client.query(
      `INSERT INTO mcp.test_files (installation_id, title, sales, status, note, raw_payload)
       VALUES ($1, $2, NULL, 'draft', $3, jsonb_build_object('foundation_context', $4::jsonb))
       RETURNING id`,
      [installationId(context), text(args.p_file_title) || "Test nhanh từ checklist", text(args.p_note), json(args.p_context || {})]
    );
    fileId = file.rows[0].id;
  }
  const testCustomer = await client.query(
    `INSERT INTO mcp.test_customers (
       installation_id, file_id, customer_id, customer_name, phone, area, status, note, raw_payload
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
       jsonb_build_object('session_customer_id', $9, 'foundation_context', $10::jsonb))
     RETURNING id`,
    [
      installationId(context), fileId, customer.customer_id, customer.customer_name, customer.phone,
      customer.area, text(args.p_status) || "tested", text(args.p_note), customer.id, json(args.p_context || {})
    ]
  );
  const results = array(args.p_results);
  for (const item of results) {
    await client.query(
      `INSERT INTO mcp.test_customer_results (
         installation_id, file_id, customer_id, product_id, product_name, status, note, raw_payload
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, '{}'::jsonb)`,
      [
        installationId(context), fileId, testCustomer.rows[0].id,
        text(item.productId ?? item.product_id), text(item.productName ?? item.product_name),
        text(item.status) || "tested", text(item.note)
      ]
    );
  }
  await client.query(
    `UPDATE mcp.mcp_session_customers SET test_id = $3, visit_status = 'visited', status = 'done', updated_at = now()
     WHERE installation_id = $1 AND id = $2`,
    [installationId(context), customer.id, testCustomer.rows[0].id]
  );
  await client.query(
    `UPDATE mcp.mcp_route_sessions SET test_count = test_count + 1, updated_at = now()
     WHERE installation_id = $1 AND id = $2`,
    [installationId(context), customer.session_id]
  );
  return {
    fileId,
    testId: testCustomer.rows[0].id,
    testCustomerId: testCustomer.rows[0].id,
    sessionCustomerId: customer.id,
    results
  };
}

async function createReportFromSessionCustomer(client, args, context) {
  const customer = await requireSessionCustomer(client, context, args.p_session_customer_id, { mutable: true, lock: true });
  const session = await requireSession(client, context, customer.session_id);
  const report = await client.query(
    `INSERT INTO mcp.market_reports (
       installation_id, report_date, sales, market_area, route_name, market_type,
       competitor_summary, price_summary, demand_summary, opportunity_summary,
       risk_summary, next_action, note, raw_payload
     ) VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
       COALESCE($14::jsonb, '{}'::jsonb) || jsonb_build_object(
         'content', $15, 'display_summary', $16, 'stock_summary', $17,
         'selected_competitor_ids', $18::jsonb, 'selected_used_product_ids', $19::jsonb,
         'selected_setting_item_ids', $20::jsonb, 'session_customer_id', $21,
         'foundation_context', $22::jsonb))
     RETURNING *`,
    [
      installationId(context), session.session_date, session.sales, customer.area, session.route_name,
      text(args.p_report_type), text(args.p_competitor_summary), text(args.p_price_summary),
      text(args.p_demand_summary), text(args.p_opportunity_summary), text(args.p_risk_summary),
      text(args.p_next_action), text(args.p_note), json(args.p_raw_payload || {}), text(args.p_content),
      text(args.p_display_summary), text(args.p_stock_summary), json(args.p_selected_competitor_ids || []),
      json(args.p_selected_used_product_ids || []), json(args.p_selected_setting_item_ids || []), customer.id,
      json(args.p_context || {})
    ]
  );
  await client.query(
    `UPDATE mcp.mcp_session_customers SET report_id = $3, visit_status = 'visited', status = 'done', updated_at = now()
     WHERE installation_id = $1 AND id = $2`,
    [installationId(context), customer.id, report.rows[0].id]
  );
  await client.query(
    `UPDATE mcp.mcp_route_sessions SET report_count = report_count + 1, updated_at = now()
     WHERE installation_id = $1 AND id = $2`,
    [installationId(context), customer.session_id]
  );
  return {
    id: report.rows[0].id,
    reportId: report.rows[0].id,
    sessionCustomerId: customer.id,
    reportType: report.rows[0].market_type,
    content: text(args.p_content),
    note: report.rows[0].note
  };
}

async function createFollowupFromSessionCustomer(client, args, context) {
  const customer = await requireSessionCustomer(client, context, args.p_session_customer_id, { mutable: true, lock: true });
  const followup = await client.query(
    `INSERT INTO mcp.mcp_followups (
       installation_id, session_id, session_customer_id, route_id, route_customer_id,
       customer_id, customer_name, followup_type, title, due_date, status,
       priority, owner, note, raw_payload
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, 'pending', $11, $12, $13,
       jsonb_build_object('foundation_context', $14::jsonb))
     RETURNING *`,
    [
      installationId(context), customer.session_id, customer.id, customer.route_id, customer.route_customer_id,
      customer.customer_id, customer.customer_name, text(args.p_followup_type) || "general", text(args.p_title),
      args.p_due_date || null, text(args.p_priority) || "medium", text(args.p_owner), text(args.p_note),
      json(args.p_context || {})
    ]
  );
  await client.query(
    `UPDATE mcp.mcp_session_customers SET followup_count = followup_count + 1, updated_at = now()
     WHERE installation_id = $1 AND id = $2`,
    [installationId(context), customer.id]
  );
  await client.query(
    `UPDATE mcp.mcp_route_sessions SET followup_count = followup_count + 1, updated_at = now()
     WHERE installation_id = $1 AND id = $2`,
    [installationId(context), customer.session_id]
  );
  return {
    id: followup.rows[0].id,
    followupId: followup.rows[0].id,
    sessionCustomerId: customer.id,
    title: followup.rows[0].title,
    dueDate: followup.rows[0].due_date,
    priority: followup.rows[0].priority,
    status: followup.rows[0].status
  };
}

async function createSessionReportSnapshot(client, args, context) {
  const session = await requireSession(client, context, args.p_session_id, { lock: true });
  const customers = await client.query(
    `SELECT * FROM mcp.mcp_session_customers
     WHERE installation_id = $1 AND session_id = $2 ORDER BY sort_order, id`,
    [installationId(context), session.id]
  );
  const details = customers.rows || [];
  const snapshot = await client.query(
    `INSERT INTO mcp.mcp_session_reports (
       installation_id, session_id, route_id, route_name, session_date, sales,
       status, kpis, overview, customer_details, snapshot_source, snapshot_at, raw_payload
     ) VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7::jsonb, $8::jsonb, $9::jsonb, $10, now(),
       jsonb_build_object('foundation_context', $11::jsonb))
     RETURNING *`,
    [
      installationId(context), session.id, session.route_id, session.route_name, session.session_date, session.sales,
      json([
        { key: "planned", value: session.planned_customers },
        { key: "visited", value: session.visited_customers },
        { key: "orders", value: session.order_count },
        { key: "tests", value: session.test_count },
        { key: "reports", value: session.report_count },
        { key: "followups", value: session.followup_count }
      ]),
      json({ status: session.status, area: session.area, note: session.note }),
      json(details), text(args.p_source) || "manual_snapshot", json(args.p_context || {})
    ]
  );
  return {
    id: snapshot.rows[0].id,
    reportId: snapshot.rows[0].id,
    sessionId: session.id,
    snapshotSource: snapshot.rows[0].snapshot_source,
    snapshotAt: snapshot.rows[0].snapshot_at
  };
}

async function saveSessionReportAiResult(client, args, context) {
  await requireSession(client, context, args.p_session_id, { lock: true });
  const result = await client.query(
    `UPDATE mcp.mcp_session_reports
     SET ai_result = $3::jsonb,
         ai_analyzed_at = COALESCE($4::timestamptz, now()),
         raw_payload = jsonb_set(COALESCE(raw_payload, '{}'::jsonb), '{ai_foundation_context}', $5::jsonb, true),
         updated_at = now()
     WHERE id = (
       SELECT id FROM mcp.mcp_session_reports
       WHERE installation_id = $1 AND session_id = $2
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE
     )
     RETURNING *`,
    [installationId(context), text(args.p_session_id), json(args.p_ai_result || {}), args.p_analyzed_at || null, json(args.p_context || {})]
  );
  if (!result.rows?.[0]) throw businessError("session_report_not_found", 404);
  return {
    id: result.rows[0].id,
    reportId: result.rows[0].id,
    sessionId: result.rows[0].session_id,
    aiResult: result.rows[0].ai_result,
    aiAnalyzedAt: result.rows[0].ai_analyzed_at
  };
}

async function updateFieldCheckResult(client, args, context) {
  const result = await client.query(
    `UPDATE mcp.test_customer_results
     SET product_id = COALESCE($3, product_id),
         product_name = $4,
         status = $5,
         note = $6,
         raw_payload = COALESCE(raw_payload, '{}'::jsonb) || jsonb_build_object(
           'session_customer_id', $7,
           'input_meta', $8::jsonb,
           'foundation_context', $9::jsonb
         ),
         updated_at = now()
     WHERE installation_id = $1 AND id = $2
     RETURNING *`,
    [
      installationId(context), text(args.p_result_id), text(args.p_product_id), text(args.p_product_name),
      text(args.p_status), text(args.p_note), text(args.p_session_customer_id), json(args.p_input_meta || {}),
      json(args.p_context || {})
    ]
  );
  if (!result.rows?.[0]) throw businessError("field_check_result_not_found", 404);
  return {
    id: result.rows[0].id,
    resultId: result.rows[0].id,
    productId: result.rows[0].product_id,
    productName: result.rows[0].product_name,
    status: result.rows[0].status,
    note: result.rows[0].note
  };
}

async function createReportSettingGroup(client, args, context) {
  const result = await client.query(
    `INSERT INTO mcp.mcp_report_setting_groups (
       installation_id, group_key, group_name, description, sort_order, active, raw_payload
     ) VALUES ($1, $2, $3, $4, $5, $6,
       COALESCE($7::jsonb, '{}'::jsonb) || jsonb_build_object('group_type', $8, 'foundation_context', $9::jsonb))
     RETURNING *`,
    [
      installationId(context), text(args.p_group_key), text(args.p_title), text(args.p_description),
      Number(args.p_sort_order || 0), text(args.p_status) !== "inactive", json(args.p_meta || {}),
      text(args.p_group_type) || "market_report", json(args.p_context || {})
    ]
  );
  return {
    id: result.rows[0].id,
    groupId: result.rows[0].id,
    key: result.rows[0].group_key,
    title: result.rows[0].group_name,
    groupType: result.rows[0].raw_payload?.group_type,
    description: result.rows[0].description,
    sortOrder: result.rows[0].sort_order,
    status: result.rows[0].active ? "active" : "inactive",
    meta: result.rows[0].raw_payload
  };
}

async function updateReportSettingGroup(client, args, context) {
  const patch = object(args.p_patch);
  const existing = await client.query(
    `SELECT * FROM mcp.mcp_report_setting_groups
     WHERE installation_id = $1 AND id = $2 FOR UPDATE`,
    [installationId(context), text(args.p_group_id)]
  );
  if (!existing.rows?.[0]) throw businessError("report_setting_group_not_found", 404);
  const row = existing.rows[0];
  const result = await client.query(
    `UPDATE mcp.mcp_report_setting_groups
     SET group_key = $3, group_name = $4, description = $5, sort_order = $6, active = $7,
         raw_payload = $8::jsonb, updated_at = now()
     WHERE installation_id = $1 AND id = $2 RETURNING *`,
    [
      installationId(context), row.id, text(patch.group_key) || row.group_key,
      text(patch.title) || row.group_name,
      Object.prototype.hasOwnProperty.call(patch, "description") ? text(patch.description) : row.description,
      Object.prototype.hasOwnProperty.call(patch, "sort_order") ? Number(patch.sort_order) : row.sort_order,
      Object.prototype.hasOwnProperty.call(patch, "status") ? patch.status !== "inactive" : row.active,
      json({ ...object(row.raw_payload), ...object(patch.meta), foundation_context: args.p_context || {} })
    ]
  );
  return createReportSettingGroupResult(result.rows[0]);
}

function createReportSettingGroupResult(row) {
  return {
    id: row.id,
    groupId: row.id,
    key: row.group_key,
    title: row.group_name,
    groupType: row.raw_payload?.group_type || "market_report",
    description: row.description,
    sortOrder: row.sort_order,
    status: row.active ? "active" : "inactive",
    meta: row.raw_payload
  };
}

async function createReportSettingItem(client, args, context) {
  const group = await client.query(
    `SELECT id FROM mcp.mcp_report_setting_groups
     WHERE installation_id = $1 AND id = $2`,
    [installationId(context), text(args.p_group_id)]
  );
  if (!group.rows?.[0]) throw businessError("report_setting_group_not_found", 404);
  const result = await client.query(
    `INSERT INTO mcp.mcp_report_settings (
       installation_id, group_id, setting_key, setting_name, value, value_type,
       sort_order, active, raw_payload
     ) VALUES ($1, $2, $3, $4, to_jsonb($5::text), 'text', $6, $7,
       COALESCE($8::jsonb, '{}'::jsonb) || jsonb_build_object(
         'category', $9, 'brand_name', $10, 'product_id', $11,
         'foundation_context', $12::jsonb))
     RETURNING *`,
    [
      installationId(context), text(args.p_group_id), text(args.p_item_key), text(args.p_label),
      text(args.p_value), Number(args.p_sort_order || 0), text(args.p_status) !== "inactive",
      json(args.p_meta || {}), text(args.p_category), text(args.p_brand_name), text(args.p_product_id),
      json(args.p_context || {})
    ]
  );
  return reportSettingItemResult(result.rows[0]);
}

function reportSettingItemResult(row) {
  const value = typeof row.value === "string" ? row.value : row.value ?? null;
  return {
    id: row.id,
    itemId: row.id,
    groupId: row.group_id,
    key: row.setting_key,
    label: row.setting_name,
    value,
    category: row.raw_payload?.category || null,
    brandName: row.raw_payload?.brand_name || null,
    productId: row.raw_payload?.product_id || null,
    sortOrder: row.sort_order,
    status: row.active ? "active" : "inactive",
    meta: row.raw_payload
  };
}

async function updateReportSettingItem(client, args, context) {
  const patch = object(args.p_patch);
  const existing = await client.query(
    `SELECT * FROM mcp.mcp_report_settings
     WHERE installation_id = $1 AND id = $2 FOR UPDATE`,
    [installationId(context), text(args.p_item_id)]
  );
  if (!existing.rows?.[0]) throw businessError("report_setting_item_not_found", 404);
  const row = existing.rows[0];
  const raw = {
    ...object(row.raw_payload),
    ...(Object.prototype.hasOwnProperty.call(patch, "category") ? { category: text(patch.category) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "brand_name") ? { brand_name: text(patch.brand_name) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "product_id") ? { product_id: text(patch.product_id) } : {}),
    ...object(patch.meta),
    foundation_context: args.p_context || {}
  };
  const value = Object.prototype.hasOwnProperty.call(patch, "value") ? text(patch.value) : row.value;
  const result = await client.query(
    `UPDATE mcp.mcp_report_settings
     SET setting_key = $3, setting_name = $4, value = $5::jsonb,
         sort_order = $6, active = $7, raw_payload = $8::jsonb, updated_at = now()
     WHERE installation_id = $1 AND id = $2 RETURNING *`,
    [
      installationId(context), row.id, text(patch.item_key) || row.setting_key,
      text(patch.label) || row.setting_name, json(value),
      Object.prototype.hasOwnProperty.call(patch, "sort_order") ? Number(patch.sort_order) : row.sort_order,
      Object.prototype.hasOwnProperty.call(patch, "status") ? patch.status !== "inactive" : row.active,
      json(raw)
    ]
  );
  return reportSettingItemResult(result.rows[0]);
}

async function executeCompatibility(client, name, args, context) {
  switch (name) {
    case "mcp_idempotent_create_route": return createRoute(client, args, context);
    case "mcp_idempotent_update_route": return updateRoute(client, args, context);
    case "mcp_idempotent_add_route_customer": return addRouteCustomer(client, args, context);
    case "mcp_idempotent_update_route_customer": return updateRouteCustomer(client, args, context);
    case "mcp_idempotent_open_route_session": return openRouteSession(client, args, context);
    case "mcp_idempotent_update_route_session": return updateRouteSession(client, args, context);
    case "mcp_idempotent_delete_empty_route_session": return deleteEmptyRouteSession(client, args, context);
    case "mcp_idempotent_set_session_customer_status": return setSessionCustomerStatus(client, args, context);
    case "mcp_idempotent_add_session_customer": return addSessionCustomer(client, args, context);
    case "mcp_idempotent_set_session_customer_checkin": return setSessionCustomerCheckin(client, args, context);
    case "mcp_idempotent_record_session_customer_result": return recordSessionCustomerResult(client, args, context);
    case "mcp_idempotent_create_order": return createOrder(client, args, context);
    case "mcp_idempotent_create_order_from_session_customer": return createOrderFromSessionCustomer(client, args, context);
    case "mcp_idempotent_create_test_from_session_customer": return createTestFromSessionCustomer(client, args, context);
    case "mcp_idempotent_create_report_from_session_customer": return createReportFromSessionCustomer(client, args, context);
    case "mcp_idempotent_create_followup_from_session_customer": return createFollowupFromSessionCustomer(client, args, context);
    case "mcp_idempotent_create_session_report_snapshot": return createSessionReportSnapshot(client, args, context);
    case "mcp_idempotent_save_session_report_ai_result": return saveSessionReportAiResult(client, args, context);
    case "mcp_idempotent_update_field_check_result": return updateFieldCheckResult(client, args, context);
    case "mcp_idempotent_create_report_setting_group": return createReportSettingGroup(client, args, context);
    case "mcp_idempotent_update_report_setting_group": return updateReportSettingGroup(client, args, context);
    case "mcp_idempotent_create_report_setting_item": return createReportSettingItem(client, args, context);
    case "mcp_idempotent_update_report_setting_item": return updateReportSettingItem(client, args, context);
    default: throw businessError("postgresql_rpc_not_implemented", 503, { name });
  }
}

function compatibilityRepositoryFactory(client) {
  return Object.freeze({
    compatibility: Object.freeze({
      execute(name, args, context) {
        return executeCompatibility(client, name, args, context);
      }
    })
  });
}

const CONTRACTS = Object.freeze({
  mcp_idempotent_create_route: ["mcp.route.create", "mcp.route.write", "mcp.route.created", "route", "routeId"],
  mcp_idempotent_update_route: ["mcp.route.update", "mcp.route.write", "mcp.route.updated", "route", "routeId"],
  mcp_idempotent_add_route_customer: ["mcp.route-customer.create", "mcp.route-customer.write", "mcp.route-customer.created", "route_customer", "routeCustomerId"],
  mcp_idempotent_update_route_customer: ["mcp.route-customer.update", "mcp.route-customer.write", "mcp.route-customer.updated", "route_customer", "routeCustomerId"],
  mcp_idempotent_open_route_session: ["mcp.session.open", "mcp.session.write", "mcp.session.opened", "route_session", "sessionId"],
  mcp_idempotent_update_route_session: ["mcp.session.update", "mcp.session.write", "mcp.session.updated", "route_session", "sessionId"],
  mcp_idempotent_delete_empty_route_session: ["mcp.session.delete-empty", "mcp.session.write", "mcp.session.deleted", "route_session", "sessionId"],
  mcp_idempotent_set_session_customer_status: ["mcp.session-customer.status", "mcp.session-customer.write", "mcp.session-customer.status-updated", "session_customer", "sessionCustomerId"],
  mcp_idempotent_add_session_customer: ["mcp.session-customer.create", "mcp.session-customer.write", "mcp.session-customer.created", "session_customer", "sessionCustomerId"],
  mcp_idempotent_set_session_customer_checkin: ["mcp.session-customer.checkin", "mcp.session-customer.write", "mcp.session-customer.checkin-updated", "session_customer", "sessionCustomerId"],
  mcp_idempotent_record_session_customer_result: ["mcp.session-customer.result", "mcp.session-customer.write", "mcp.session-customer.result-recorded", "session_customer", "sessionCustomerId"],
  mcp_idempotent_create_order: ["mcp.order.create", "mcp.order.write", "mcp.order.created", "order", "orderId"],
  mcp_idempotent_create_order_from_session_customer: ["mcp.order.create-from-session", "mcp.order.write", "mcp.order.created", "order", "orderId"],
  mcp_idempotent_create_test_from_session_customer: ["mcp.test.create-from-session", "mcp.test.write", "mcp.test.created", "field_test", "testId"],
  mcp_idempotent_create_report_from_session_customer: ["mcp.report.create-from-session", "mcp.report.write", "mcp.report.created", "market_report", "reportId"],
  mcp_idempotent_create_followup_from_session_customer: ["mcp.followup.create-from-session", "mcp.followup.write", "mcp.followup.created", "followup", "followupId"],
  mcp_idempotent_create_session_report_snapshot: ["mcp.session-report.snapshot", "mcp.report.write", "mcp.session-report.snapshotted", "session_report", "reportId"],
  mcp_idempotent_save_session_report_ai_result: ["mcp.session-report.ai-result", "mcp.report.write", "mcp.session-report.ai-updated", "session_report", "reportId"],
  mcp_idempotent_update_field_check_result: ["mcp.field-check.update", "mcp.test.write", "mcp.field-check.updated", "field_check", "resultId"],
  mcp_idempotent_create_report_setting_group: ["mcp.report-setting-group.create", "mcp.report-setting.write", "mcp.report-setting-group.created", "report_setting_group", "groupId"],
  mcp_idempotent_update_report_setting_group: ["mcp.report-setting-group.update", "mcp.report-setting.write", "mcp.report-setting-group.updated", "report_setting_group", "groupId"],
  mcp_idempotent_create_report_setting_item: ["mcp.report-setting-item.create", "mcp.report-setting.write", "mcp.report-setting-item.created", "report_setting_item", "itemId"],
  mcp_idempotent_update_report_setting_item: ["mcp.report-setting-item.update", "mcp.report-setting.write", "mcp.report-setting-item.updated", "report_setting_item", "itemId"]
});

async function readRpc(name, args) {
  const persistence = providerPersistence();
  return persistence.withTransaction(async (client) => {
    if (name === "mcp_search_products") {
      const query = text(args.p_q) || "";
      const limit = Math.max(1, Math.min(Number(args.p_limit || 50), 100));
      const result = await client.query(
        `SELECT id, installation_id, name, product_code, category, brand, status, active, note, raw_payload
         FROM mcp.products
         WHERE ($1 = '' OR name ILIKE '%' || $1 || '%' OR product_code ILIKE '%' || $1 || '%')
           AND ($2 = '' OR category = $2)
           AND ($3 = '' OR brand = $3)
         ORDER BY name, id LIMIT $4`,
        [query, text(args.p_category) || "", text(args.p_brand) || "", limit]
      );
      return result.rows || [];
    }
    if (name === "mcp_get_product_variants") {
      const result = await client.query(
        `SELECT * FROM mcp.product_variants WHERE product_id = $1 ORDER BY name, id`,
        [text(args.p_product_id)]
      );
      return result.rows || [];
    }
    throw businessError("postgresql_rpc_not_implemented", 503, { name });
  });
}

export async function postgresqlRpc(config, name, args = {}) {
  try {
    if (name === "mcp_search_products" || name === "mcp_get_product_variants") {
      return await readRpc(name, args);
    }
    const contract = CONTRACTS[name];
    if (!contract) throw businessError("postgresql_rpc_not_implemented", 503, { name });
    const context = requestContext(config, args);
    const persistence = providerPersistence();
    const transaction = createPostgresqlWriteTransaction(persistence, {
      domainRepositoryFactory: compatibilityRepositoryFactory
    });
    const [commandName, permission, eventType, aggregateType, aggregateIdKey] = contract;
    return await executeWriteCommand({
      context,
      commandName,
      permission,
      payload: Object.fromEntries(Object.entries(args).filter(([key]) => key !== "p_context")),
      aggregate: (result) => ({
        type: aggregateType,
        id: text(result?.[aggregateIdKey] ?? result?.id) || "unknown",
        version: 1
      }),
      eventType,
      transaction,
      mutate: (tx) => tx.repositories.compatibility.execute(name, args, context)
    });
  } catch (error) {
    if (!error.providerMessage) error.providerMessage = text(error.code) || text(error.message) || "provider_request_failed";
    throw error;
  }
}

function quoteIdentifier(value) {
  if (!SAFE_IDENTIFIER.test(value)) throw businessError("invalid_read_identifier", 400);
  return `"${value}"`;
}

function postgrestFilter(key, value, params) {
  const column = quoteIdentifier(key);
  const raw = String(value || "");
  const prefixes = [
    ["eq.", "="], ["neq.", "<>"], ["gte.", ">="], ["lte.", "<="],
    ["gt.", ">"], ["lt.", "<"], ["ilike.", "ILIKE"], ["like.", "LIKE"]
  ];
  for (const [prefix, operator] of prefixes) {
    if (raw.startsWith(prefix)) {
      params.push(raw.slice(prefix.length));
      return `${column} ${operator} $${params.length}`;
    }
  }
  params.push(raw);
  return `${column} = $${params.length}`;
}

export async function postgresqlRest(resource, { method = "GET", body } = {}) {
  if (String(method).toUpperCase() !== "GET") {
    throw businessError("postgresql_rest_write_not_implemented", 503);
  }
  const url = new URL(resource, "http://mcp.local/");
  const table = url.pathname.replace(/^\/+/, "");
  if (!READ_TABLES.has(table)) throw businessError("invalid_read_table", 400);
  const params = [];
  const selectRaw = text(url.searchParams.get("select"));
  const columns = !selectRaw || selectRaw === "*"
    ? "*"
    : selectRaw.split(",").map((item) => quoteIdentifier(item.trim())).join(", ");
  const clauses = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    clauses.push(postgrestFilter(key, value, params));
  }
  const orderRaw = text(url.searchParams.get("order"));
  const order = orderRaw
    ? ` ORDER BY ${orderRaw.split(",").map((term) => {
        const [name, direction = "asc"] = term.split(".");
        return `${quoteIdentifier(name)} ${direction.toLowerCase() === "desc" ? "DESC" : "ASC"}`;
      }).join(", ")}`
    : "";
  const limit = Math.max(0, Math.min(Number(url.searchParams.get("limit") || 500), 50000));
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
  params.push(limit, offset);
  const sql = `SELECT ${columns} FROM ${quoteIdentifier(table)}${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""}${order} LIMIT $${params.length - 1} OFFSET $${params.length}`;
  const persistence = providerPersistence();
  return persistence.withTransaction(async (client) => {
    const result = await client.query(sql, params);
    return result.rows || [];
  });
}
