import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createPostgresqlPersistence } from "./postgresql-adapter.js";
import { bindProviderPersistence } from "./provider-runtime.js";
import { supabaseRpc } from "./supabase-adapter.js";
import { runMcpMigrations } from "./migrations/index.js";

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL;
const installationId = "installation-cutover-flow";

function config() {
  return Object.freeze({
    persistence: Object.freeze({
      provider: "postgresql",
      databaseUrl,
      schema: "mcp",
      expectedRole: null,
      poolMax: 4,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 5000,
      statementTimeoutMs: 15000
    }),
    legacyRuntime: Object.freeze({ enabled: false }),
    installationId,
    nppCode: "NPP-CUTOVER-TEST",
    legacyActorId: "service:test:mcp-cutover",
    authMode: "backend-token",
    servicePrincipal: Object.freeze({
      id: "service:test:mcp-cutover",
      type: "service",
      authentication: "backend-token",
      employeeId: null,
      roles: Object.freeze([]),
      permissions: Object.freeze([
        "mcp.route.write",
        "mcp.route-customer.write",
        "mcp.session.write",
        "mcp.session-customer.write",
        "mcp.order.write",
        "mcp.report.write"
      ]),
      scopes: Object.freeze(["mcp:*"])
    })
  });
}

function context(key, requestId = `request-${key}`) {
  return {
    requestId,
    idempotencyKey: `cutover:${key}`,
    receivedAt: "2026-08-02T13:00:00.000Z",
    installationId,
    nppCode: "NPP-CUTOVER-TEST",
    actorId: "service:test:mcp-cutover",
    actorType: "service",
    actorAuthentication: "backend-token"
  };
}

function data(result) {
  return result?.data && typeof result.data === "object" ? result.data : result;
}

async function resetMcp(admin) {
  await admin.query("DROP SCHEMA IF EXISTS mcp CASCADE");
  await admin.query("CREATE SCHEMA IF NOT EXISTS shared");
  await admin.query(`CREATE TABLE IF NOT EXISTS shared.schema_migrations (
    id text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  await admin.query("DELETE FROM shared.schema_migrations WHERE split_part(id, '_', 1) = 'mcp'");
}

test(
  "PostgreSQL cutover preserves route, session, order, report, media and archive behavior",
  { skip: !databaseUrl },
  async (t) => {
    const admin = new Pool({ connectionString: databaseUrl });
    let persistence = null;
    t.after(async () => {
      if (persistence) await persistence.close();
      await resetMcp(admin);
      await admin.end();
    });

    await resetMcp(admin);
    await runMcpMigrations(admin);
    const runtimeConfig = config();
    persistence = createPostgresqlPersistence(runtimeConfig, { PoolImpl: Pool });
    await persistence.assertReady();
    bindProviderPersistence(persistence);

    const createRouteArgs = {
      p_route_name: "Tuyến PostgreSQL",
      p_area: "Quận 5",
      p_weekday: 1,
      p_note: "Giữ nguyên hợp đồng Supabase",
      p_context: context("route-create")
    };
    const routeResult = await supabaseRpc(runtimeConfig, "mcp_idempotent_create_route", createRouteArgs);
    const route = data(routeResult);
    assert.match(route.routeId, /^route_/);
    const routeReplay = await supabaseRpc(runtimeConfig, "mcp_idempotent_create_route", {
      ...createRouteArgs,
      p_context: context("route-create", "request-route-retry")
    });
    assert.equal(routeReplay.meta.idempotency.replayed, true);
    assert.equal(data(routeReplay).routeId, route.routeId);

    const routeCustomer = data(await supabaseRpc(runtimeConfig, "mcp_idempotent_add_route_customer", {
      p_route_id: route.routeId,
      p_customer_name: "Điểm bán thử nghiệm",
      p_phone: "0900000000",
      p_area: "Quận 5",
      p_address: "01 Đường thử nghiệm",
      p_note: "Điểm bán thị trường, chưa phải khách Core",
      p_include_active_session: false,
      p_context: context("route-customer-create")
    }));
    assert.match(routeCustomer.routeCustomerId, /^route_customer_/);
    assert.equal(routeCustomer.customerId, null);

    const session = data(await supabaseRpc(runtimeConfig, "mcp_idempotent_open_route_session", {
      p_route_id: route.routeId,
      p_session_date: "2026-08-02",
      p_owner: "NV Thị Trường",
      p_context: context("session-open")
    }));
    assert.match(session.sessionId, /^session_/);

    const sessionCustomerQuery = await admin.query(
      `SELECT id FROM mcp.mcp_session_customers
       WHERE installation_id = $1 AND session_id = $2 AND route_customer_id = $3`,
      [installationId, session.sessionId, routeCustomer.routeCustomerId]
    );
    const sessionCustomerId = sessionCustomerQuery.rows?.[0]?.id;
    assert.match(sessionCustomerId, /^session_customer_/);

    const checkedIn = data(await supabaseRpc(runtimeConfig, "mcp_idempotent_set_session_customer_checkin", {
      p_session_customer_id: sessionCustomerId,
      p_checked_in: true,
      p_geo_lat: 10.762622,
      p_geo_lng: 106.660172,
      p_geo_accuracy: 8,
      p_geo_source: "gps",
      p_context: context("session-checkin")
    }));
    assert.equal(checkedIn.checkedIn, true);

    const order = data(await supabaseRpc(runtimeConfig, "mcp_idempotent_create_order_from_session_customer", {
      p_session_customer_id: sessionCustomerId,
      p_items: [{
        productName: "Sản phẩm thử nghiệm",
        sku: "SKU-TEST",
        unit: "chai",
        quantity: 2,
        unitPrice: 15000,
        discount: 1000
      }],
      p_note: "Order intent cần lập đơn chính thức",
      p_status: "confirmed",
      p_context: context("order-create")
    }));
    assert.match(order.orderId, /^order_/);
    assert.equal(Number(order.grandTotal), 29000);

    const report = data(await supabaseRpc(runtimeConfig, "mcp_idempotent_create_report_from_session_customer", {
      p_session_customer_id: sessionCustomerId,
      p_report_type: "competitor",
      p_content: "Đối thủ đang trưng bày mạnh.",
      p_price_summary: "Giá thấp hơn 5%",
      p_competitor_summary: "Đối thủ A",
      p_display_summary: "Hai kệ mặt tiền",
      p_stock_summary: "Còn khoảng 20 thùng",
      p_demand_summary: "Nhu cầu tăng",
      p_opportunity_summary: "Có thể mở đơn",
      p_risk_summary: "Chiết khấu cạnh tranh",
      p_next_action: "Xác minh mở mã khách khi chốt đơn",
      p_note: "Báo cáo đầy đủ",
      p_raw_payload: { context: { source: "field" }, fields: { custom: true } },
      p_selected_competitor_ids: ["competitor-a"],
      p_selected_used_product_ids: ["used-product-a"],
      p_selected_setting_item_ids: ["setting-a", "setting-b"],
      p_context: context("report-create")
    }));
    assert.match(report.reportId, /^market_report_/);
    assert.equal(report.reportType, "competitor");
    assert.deepEqual(report.selectedCompetitorIds, ["competitor-a"]);
    assert.deepEqual(report.selectedUsedProductIds, ["used-product-a"]);
    assert.deepEqual(report.selectedSettingItemIds, ["setting-a", "setting-b"]);

    const storedReport = (await admin.query(
      `SELECT report_type, content, price_summary, competitor_summary,
              display_summary, stock_summary,
              selected_competitor_ids, selected_used_product_ids, selected_setting_item_ids
       FROM mcp.market_reports
       WHERE installation_id = $1 AND id = $2`,
      [installationId, report.reportId]
    )).rows[0];
    assert.equal(storedReport.content, "Đối thủ đang trưng bày mạnh.");
    assert.equal(storedReport.display_summary, "Hai kệ mặt tiền");
    assert.equal(storedReport.stock_summary, "Còn khoảng 20 thùng");
    assert.deepEqual(storedReport.selected_setting_item_ids, ["setting-a", "setting-b"]);

    const media = [];
    for (let index = 1; index <= 3; index += 1) {
      media.push(await supabaseRpc(runtimeConfig, "mcp_prepare_outlet_media_upload", {
        p_installation_id: installationId,
        p_route_customer_id: routeCustomer.routeCustomerId,
        p_session_id: null,
        p_client_upload_id: `profile-photo-${index}`,
        p_mime_type: "image/jpeg",
        p_expected_byte_size: 1024 * index,
        p_context: context(`media-${index}`)
      }));
    }
    assert.equal(media.length, 3);
    assert.equal(media.every((item) => item.session_id === null), true);
    await assert.rejects(
      () => supabaseRpc(runtimeConfig, "mcp_prepare_outlet_media_upload", {
        p_installation_id: installationId,
        p_route_customer_id: routeCustomer.routeCustomerId,
        p_session_id: null,
        p_client_upload_id: "profile-photo-4",
        p_mime_type: "image/jpeg",
        p_expected_byte_size: 4096,
        p_context: context("media-4")
      }),
      (error) => error.providerMessage === "outlet_media_limit_reached" && error.statusCode === 409
    );

    const archiveArgs = {
      p_installation_id: installationId,
      p_operation: "route-customer.archive",
      p_idempotency_key: "archive:route-customer:1",
      p_target_type: "route_customer",
      p_target_id: routeCustomer.routeCustomerId,
      p_request_payload: {
        targetId: routeCustomer.routeCustomerId,
        details: { reason: "duplicate", requestedBy: "field" }
      },
      p_context: context("archive-claim")
    };
    const claimedIntent = await supabaseRpc(runtimeConfig, "mcp_claim_archive_intent", archiveArgs);
    const intentId = claimedIntent.intent.id;
    assert.equal(claimedIntent.mode, "execute");
    await assert.rejects(
      () => supabaseRpc(runtimeConfig, "mcp_claim_archive_intent", {
        ...archiveArgs,
        p_request_payload: {
          targetId: routeCustomer.routeCustomerId,
          details: { reason: "changed", requestedBy: "field" }
        }
      }),
      (error) => error.providerMessage === "idempotency_key_conflict" && error.statusCode === 409
    );

    const deleteClaim = await supabaseRpc(runtimeConfig, "mcp_claim_route_customer_media_delete", {
      p_installation_id: installationId,
      p_route_customer_id: routeCustomer.routeCustomerId,
      p_context: context("delete-claim")
    });
    const deleteJobId = deleteClaim.deleteJob.id;
    assert.match(deleteJobId, /^msdj_/);
    const linkedIntent = (await admin.query(
      `SELECT delete_job_id FROM mcp.mcp_archive_intents
       WHERE installation_id = $1 AND id = $2`,
      [installationId, intentId]
    )).rows[0];
    assert.equal(linkedIntent.delete_job_id, deleteJobId);

    for (const item of media) {
      await supabaseRpc(runtimeConfig, "mcp_finish_outlet_media_delete", {
        p_installation_id: installationId,
        p_media_id: item.id,
        p_succeeded: true,
        p_context: context(`media-delete-${item.id}`)
      });
    }
    const readyJobs = await supabaseRpc(runtimeConfig, "mcp_claim_ready_storage_delete_jobs", {
      p_installation_id: installationId,
      p_limit: 10,
      p_retry_before: "2026-08-03T00:00:00.000Z",
      p_context: context("delete-job-ready")
    });
    assert.equal(readyJobs.some((job) => job.id === deleteJobId), true);

    const deletedCustomer = await supabaseRpc(runtimeConfig, "mcp_delete_route_customer_hard", {
      p_route_customer_id: routeCustomer.routeCustomerId,
      p_context: context("route-customer-hard-delete")
    });
    assert.equal(deletedCustomer.deleted, true);
    await supabaseRpc(runtimeConfig, "mcp_finish_storage_delete_job", {
      p_installation_id: installationId,
      p_job_id: deleteJobId,
      p_succeeded: true,
      p_context: context("delete-job-finish")
    });
    const completedIntent = await supabaseRpc(runtimeConfig, "mcp_finish_archive_intent", {
      p_installation_id: installationId,
      p_intent_id: intentId,
      p_succeeded: true,
      p_response_status: 200,
      p_response_payload: {
        targetType: "route_customer",
        targetId: routeCustomer.routeCustomerId,
        deleteJobId,
        deleted: true,
        deletedMediaCount: 3
      },
      p_context: context("archive-finish")
    });
    assert.equal(completedIntent.status, "completed");
    await supabaseRpc(runtimeConfig, "mcp_finish_archive_intent", {
      p_installation_id: installationId,
      p_intent_id: intentId,
      p_succeeded: true,
      p_response_status: 200,
      p_response_payload: { deleted: true },
      p_context: context("archive-finish-replay")
    });

    const archiveAuditCount = Number((await admin.query(
      `SELECT count(*) AS count
       FROM mcp.audit_events
       WHERE installation_id = $1
         AND aggregate_type = 'archive_intent'
         AND aggregate_id = $2
         AND event_type = 'mcp.archive.completed'`,
      [installationId, intentId]
    )).rows[0].count);
    assert.equal(archiveAuditCount, 1);
    const remainingCustomerCount = Number((await admin.query(
      `SELECT count(*) AS count FROM mcp.mcp_route_customers
       WHERE installation_id = $1 AND id = $2`,
      [installationId, routeCustomer.routeCustomerId]
    )).rows[0].count);
    assert.equal(remainingCustomerCount, 0);
    const sessionSnapshot = (await admin.query(
      `SELECT route_customer_id, customer_name, order_id, report_id
       FROM mcp.mcp_session_customers
       WHERE installation_id = $1 AND id = $2`,
      [installationId, sessionCustomerId]
    )).rows[0];
    assert.equal(sessionSnapshot.route_customer_id, null);
    assert.equal(sessionSnapshot.customer_name, "Điểm bán thử nghiệm");
    assert.equal(sessionSnapshot.order_id, order.orderId);
    assert.equal(sessionSnapshot.report_id, report.reportId);
  }
);
