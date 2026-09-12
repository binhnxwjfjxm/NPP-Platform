import { executeWriteCommand } from "./write-command.js";
import { createPostgresqlWriteTransaction } from "./postgresql-write-repository.js";
import { providerPersistence } from "./provider-runtime.js";

export const POSTGRESQL_TEST_RPC_NAMES = Object.freeze(new Set([
  "mcp_idempotent_create_test_from_session_customer"
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
  const source = object(args?.p_context);
  const sourceInstallationId = text(source.installationId);
  const configuredInstallationId = text(config.installationId);
  const installationId = sourceInstallationId || configuredInstallationId;
  if (!installationId) fail("installation_id_required");
  if (sourceInstallationId && configuredInstallationId && sourceInstallationId !== configuredInstallationId) {
    fail("installation_scope_mismatch", 403);
  }
  return Object.freeze({
    requestId: text(source.requestId) || `req_test_${Date.now()}`,
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

async function requireSessionCustomer(client, context, sessionCustomerId) {
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
  return customer;
}

async function resolveTestFile(client, args, context, customer) {
  const requestedFileId = text(args.p_file_id);
  if (requestedFileId) {
    const existing = await client.query(
      `SELECT * FROM mcp.test_files
       WHERE installation_id = $1 AND id = $2
       FOR UPDATE`,
      [context.installation.id, requestedFileId]
    );
    if (!existing.rows?.[0]) fail("test_file_not_found", 404);
    return existing.rows[0];
  }

  const inserted = await client.query(
    `INSERT INTO mcp.test_files (
       installation_id, title, test_date, sales, status, note, raw_payload
     ) VALUES (
       $1, $2, $3::date, $4, 'active', $5,
       jsonb_build_object(
         'session_customer_id', $6,
         'route_id', $7,
         'foundation_context', $8::jsonb
       )
     )
     RETURNING *`,
    [
      context.installation.id,
      text(args.p_file_title) || `Test nhanh - ${customer.customer_name}`,
      customer.session_date,
      customer.sales,
      text(args.p_note),
      customer.id,
      customer.route_id,
      json(args.p_context || {})
    ]
  );
  return inserted.rows[0];
}

async function resolveTestCustomer(client, args, context, customer, file) {
  const existing = await client.query(
    `SELECT * FROM mcp.test_customers
     WHERE installation_id = $1
       AND file_id = $2
       AND raw_payload ->> 'session_customer_id' = $3
     ORDER BY created_at ASC, id ASC
     LIMIT 1
     FOR UPDATE`,
    [context.installation.id, file.id, customer.id]
  );
  if (existing.rows?.[0]) {
    const updated = await client.query(
      `UPDATE mcp.test_customers
       SET customer_id = COALESCE($4, customer_id),
           customer_name = $5,
           phone = COALESCE($6, phone),
           area = COALESCE($7, area),
           status = $8,
           note = COALESCE($9, note),
           raw_payload = COALESCE(raw_payload, '{}'::jsonb) || jsonb_build_object(
             'session_customer_id', $3,
             'foundation_context', $10::jsonb
           ),
           updated_at = now()
       WHERE installation_id = $1 AND id = $2
       RETURNING *`,
      [
        context.installation.id,
        existing.rows[0].id,
        customer.id,
        customer.customer_id,
        customer.customer_name,
        customer.phone,
        customer.area,
        text(args.p_status) || "tested",
        text(args.p_note),
        json(args.p_context || {})
      ]
    );
    return updated.rows[0];
  }

  const inserted = await client.query(
    `INSERT INTO mcp.test_customers (
       installation_id, file_id, customer_id, customer_name, phone, area,
       status, note, raw_payload
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       jsonb_build_object(
         'session_customer_id', $9,
         'route_customer_id', $10,
         'foundation_context', $11::jsonb
       )
     )
     RETURNING *`,
    [
      context.installation.id,
      file.id,
      customer.customer_id,
      customer.customer_name,
      customer.phone,
      customer.area,
      text(args.p_status) || "tested",
      text(args.p_note),
      customer.id,
      customer.route_customer_id,
      json(args.p_context || {})
    ]
  );
  return inserted.rows[0];
}

async function resolveTestProduct(client, item, context, file) {
  const requestedProductId = text(item?.productId ?? item?.product_id);
  let productName = text(item?.productName ?? item?.product_name);

  if (requestedProductId) {
    const existingById = await client.query(
      `SELECT * FROM mcp.test_file_products
       WHERE installation_id = $1 AND file_id = $2
         AND (id = $3 OR product_id = $3)
       ORDER BY CASE WHEN id = $3 THEN 0 ELSE 1 END, created_at ASC, id ASC
       LIMIT 1
       FOR UPDATE`,
      [context.installation.id, file.id, requestedProductId]
    );
    if (existingById.rows?.[0]) return existingById.rows[0];
    if (!productName) fail("test_product_not_found", 404);
  } else {
    if (!productName) fail("product_name_required");
    const existingByName = await client.query(
      `SELECT * FROM mcp.test_file_products
       WHERE installation_id = $1 AND file_id = $2
         AND lower(product_name) = lower($3)
       ORDER BY sort_order ASC, created_at ASC, id ASC
       LIMIT 1
       FOR UPDATE`,
      [context.installation.id, file.id, productName]
    );
    if (existingByName.rows?.[0]) return existingByName.rows[0];
  }

  const sort = await client.query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
     FROM mcp.test_file_products
     WHERE installation_id = $1 AND file_id = $2`,
    [context.installation.id, file.id]
  );
  const inserted = await client.query(
    `INSERT INTO mcp.test_file_products (
       installation_id, file_id, product_id, product_name, sort_order, note, raw_payload
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       jsonb_build_object('foundation_context', $7::jsonb)
     )
     RETURNING *`,
    [
      context.installation.id,
      file.id,
      requestedProductId,
      productName,
      Number(sort.rows?.[0]?.next_order || 0),
      text(item?.note),
      json(context)
    ]
  );
  return inserted.rows[0];
}

async function ensureVisit(client, args, context, customer) {
  const existing = await client.query(
    `SELECT * FROM mcp.mcp_visits
     WHERE installation_id = $1 AND session_customer_id = $2
     ORDER BY created_at ASC, id ASC
     LIMIT 1
     FOR UPDATE`,
    [context.installation.id, customer.id]
  );
  if (existing.rows?.[0]) {
    const updated = await client.query(
      `UPDATE mcp.mcp_visits
       SET status = 'visited',
           checkin_at = COALESCE(checkin_at, $3::timestamptz, now()),
           geo_lat = COALESCE(geo_lat, $4::numeric),
           geo_lng = COALESCE(geo_lng, $5::numeric),
           geo_accuracy = COALESCE(geo_accuracy, $6::numeric),
           geo_source = COALESCE(geo_source, $7),
           note = COALESCE($8, note),
           raw_payload = COALESCE(raw_payload, '{}'::jsonb) ||
             jsonb_build_object('foundation_context', $9::jsonb),
           updated_at = now()
       WHERE installation_id = $1 AND id = $2
       RETURNING *`,
      [
        context.installation.id,
        existing.rows[0].id,
        customer.checkin_at,
        customer.checkin_lat,
        customer.checkin_lng,
        customer.checkin_accuracy,
        customer.checkin_source,
        text(args.p_note),
        json(args.p_context || {})
      ]
    );
    return updated.rows[0];
  }

  const inserted = await client.query(
    `INSERT INTO mcp.mcp_visits (
       installation_id, session_id, session_customer_id, route_id, route_customer_id,
       customer_id, customer_name, visit_date, status, checkin_at,
       geo_lat, geo_lng, geo_accuracy, geo_source, note, raw_payload
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8::date, 'visited', COALESCE($9::timestamptz, now()),
       $10::numeric, $11::numeric, $12::numeric, $13, $14,
       jsonb_build_object(
         'source', 'mcp_test_from_session_customer',
         'session_customer_id', $3,
         'foundation_context', $15::jsonb
       )
     )
     RETURNING *`,
    [
      context.installation.id,
      customer.session_id,
      customer.id,
      customer.route_id,
      customer.route_customer_id,
      customer.customer_id,
      customer.customer_name,
      customer.session_date,
      customer.checkin_at,
      customer.checkin_lat,
      customer.checkin_lng,
      customer.checkin_accuracy,
      customer.checkin_source,
      text(args.p_note) || "Tạo kết quả kiểm tra",
      json(args.p_context || {})
    ]
  );
  return inserted.rows[0];
}

async function refreshSessionCounters(client, context, sessionId) {
  const refreshed = await client.query(
    `UPDATE mcp.mcp_route_sessions s
     SET planned_customers = (
           SELECT COUNT(*)::integer
           FROM mcp.mcp_session_customers sc
           WHERE sc.installation_id = $1 AND sc.session_id = $2
         ),
         visited_customers = (
           SELECT COUNT(*)::integer
           FROM mcp.mcp_session_customers sc
           WHERE sc.installation_id = $1 AND sc.session_id = $2
             AND sc.visit_status = 'visited'
         ),
         order_count = (
           SELECT COUNT(*)::integer
           FROM mcp.mcp_session_customers sc
           WHERE sc.installation_id = $1 AND sc.session_id = $2
             AND sc.order_id IS NOT NULL
         ),
         test_count = (
           SELECT COUNT(*)::integer
           FROM mcp.mcp_session_customers sc
           WHERE sc.installation_id = $1 AND sc.session_id = $2
             AND sc.test_id IS NOT NULL
         ),
         report_count = (
           SELECT COUNT(*)::integer
           FROM mcp.mcp_session_customers sc
           WHERE sc.installation_id = $1 AND sc.session_id = $2
             AND sc.report_id IS NOT NULL
         ),
         followup_count = (
           SELECT COUNT(*)::integer
           FROM mcp.mcp_followups f
           WHERE f.installation_id = $1 AND f.session_id = $2
             AND f.status IN ('pending', 'open')
         ),
         updated_at = now()
     WHERE s.installation_id = $1 AND s.id = $2
     RETURNING id`,
    [context.installation.id, sessionId]
  );
  if (!refreshed.rows?.[0]) fail("session_not_found", 404);
}

async function createTest(client, args, context) {
  const sessionCustomerId = text(args.p_session_customer_id);
  if (!sessionCustomerId) fail("session_customer_id_required");
  const results = array(args.p_results);
  if (!results.length) fail("test_results_required");

  const customer = await requireSessionCustomer(client, context, sessionCustomerId);
  const file = await resolveTestFile(client, args, context, customer);
  const testCustomer = await resolveTestCustomer(client, args, context, customer, file);

  let lastResult = null;
  for (const item of results) {
    const product = await resolveTestProduct(client, item, context, file);
    const inserted = await client.query(
      `INSERT INTO mcp.test_customer_results (
         installation_id, file_id, customer_id, product_id, product_name,
         status, note, raw_payload
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7,
         jsonb_build_object(
           'session_customer_id', $8,
           'test_file_product_id', $4,
           'foundation_context', $9::jsonb
         )
       )
       RETURNING *`,
      [
        context.installation.id,
        file.id,
        testCustomer.id,
        product.id,
        product.product_name,
        text(item?.status) || text(args.p_status) || "tested",
        text(item?.note),
        customer.id,
        json(args.p_context || {})
      ]
    );
    lastResult = inserted.rows[0];
  }
  if (!lastResult) fail("test_results_required");

  const visit = await ensureVisit(client, args, context, customer);
  await client.query(
    `UPDATE mcp.mcp_session_customers
     SET test_id = $3,
         visit_status = 'visited',
         status = 'done',
         status_reason = NULL,
         note = COALESCE($4, note),
         raw_payload = COALESCE(raw_payload, '{}'::jsonb) || jsonb_build_object(
           'latest_test_id', $3,
           'latest_test_file_id', $5,
           'foundation_context', $6::jsonb
         ),
         updated_at = now()
     WHERE installation_id = $1 AND id = $2`,
    [
      context.installation.id,
      customer.id,
      lastResult.id,
      text(args.p_note),
      file.id,
      json(args.p_context || {})
    ]
  );
  await refreshSessionCounters(client, context, customer.session_id);

  return {
    id: lastResult.id,
    fileId: file.id,
    fileTitle: file.title,
    testId: lastResult.id,
    testCustomerId: testCustomer.id,
    sessionCustomerId: customer.id,
    visitId: visit.id,
    resultCount: results.length,
    results: results.map((item) => ({
      productId: text(item?.productId ?? item?.product_id),
      productName: text(item?.productName ?? item?.product_name),
      status: text(item?.status) || text(args.p_status) || "tested",
      note: text(item?.note)
    }))
  };
}

function repositoryFactory(client) {
  return Object.freeze({
    test: Object.freeze({
      create(args, context) {
        return createTest(client, args, context);
      }
    })
  });
}

export async function postgresqlTestRpc(config, name, args = {}) {
  if (!POSTGRESQL_TEST_RPC_NAMES.has(name)) fail("postgresql_rpc_not_implemented", 503);
  try {
    const context = requestContext(config, args);
    const transaction = createPostgresqlWriteTransaction(providerPersistence(), {
      domainRepositoryFactory: repositoryFactory
    });
    return await executeWriteCommand({
      context,
      commandName: "mcp.test.create-from-session",
      permission: "mcp.test.write",
      payload: Object.fromEntries(Object.entries(args).filter(([key]) => key !== "p_context")),
      aggregate: (result) => ({ type: "field_test", id: result.testId, version: 1 }),
      eventType: "mcp.test.created",
      transaction,
      mutate: (tx) => tx.repositories.test.create(args, context)
    });
  } catch (error) {
    if (!error.providerMessage) {
      error.providerMessage = text(error.code) || text(error.message) || "provider_request_failed";
    }
    throw error;
  }
}
