import {
  backendToken,
  ensure,
  flattenErrors,
  gatewayBase,
  must,
  object,
  serviceRole,
  stamp,
  supabaseUrl
} from "./a5-5-2-smoke-http.mjs";
import { cleanupAll, createFixture, verifyFixtureRemoved } from "./a5-5-2-smoke-fixture.mjs";
import { runOperation } from "./a5-5-2-smoke-operation.mjs";

async function run() {
  let primaryError = null;
  let cleanupError = null;
  let output = null;
  let fixture = null;
  const aggregateRows = [];

  try {
    ensure(backendToken.length >= 32, "missing_BACKEND_API_TOKEN");
    ensure(supabaseUrl.startsWith("https://"), "missing_SUPABASE_URL");
    ensure(serviceRole.length > 20, "missing_SUPABASE_SERVICE_ROLE_KEY");

    const health = await must("/api/health", { requestId: `a552-health-${stamp}` });
    const healthData = object(health.payload.data);
    ensure(healthData.service === "mcp-plan-backend", "health_service_invalid");
    ensure(healthData.installationConfigured === true, "health_installation_not_configured");
    ensure(healthData.providerConfigured === true, "health_provider_not_configured");

    fixture = await createFixture();
    const sessionCustomerId = fixture.sessionCustomerId;

    const orderPayload = {
      sessionCustomerId,
      items: [{ productName: `A552 Order Product ${stamp}`, quantity: 1, unitPrice: 12000 }],
      note: `A552 runtime order ${stamp}`,
      status: "confirmed"
    };
    const testPayload = {
      sessionCustomerId,
      fileTitle: `A552 Test ${stamp}`,
      results: [{ productName: `A552 Test Product ${stamp}`, status: "ok", note: "Runtime PASS" }],
      note: `A552 runtime test ${stamp}`,
      customerStatus: "tested"
    };
    const reportPayload = {
      sessionCustomerId,
      reportType: "market_report",
      fields: {
        opportunitySummary: `A552 opportunity ${stamp}`,
        note: `A552 runtime report ${stamp}`
      },
      selected: { competitors: [], usedProducts: [], settingItems: [] },
      context: { customerName: `A552 Customer ${stamp}` }
    };
    const followupPayload = {
      sessionCustomerId,
      title: `A552 Follow-up ${stamp}`,
      dueDate: "2099-12-31",
      priority: "high",
      owner: "API Smoke",
      note: `A552 runtime follow-up ${stamp}`,
      followupType: "general"
    };

    const order = await runOperation({
      name: "order",
      path: "/api/mcp-day/session-customer/order",
      operation: "session-customer.order.create",
      payload: orderPayload,
      conflictPayload: {
        ...orderPayload,
        items: [{ ...orderPayload.items[0], quantity: 2 }]
      },
      aggregateTable: "orders",
      aggregateIdKey: "orderId",
      aggregateRows
    });

    const test = await runOperation({
      name: "test",
      path: "/api/mcp-day/session-customer/test",
      operation: "session-customer.test.create",
      payload: testPayload,
      conflictPayload: {
        ...testPayload,
        results: [{ ...testPayload.results[0], note: "Changed" }]
      },
      aggregateTable: "test_customer_results",
      aggregateIdKey: "testId",
      aggregateRows
    });

    const report = await runOperation({
      name: "report",
      path: "/api/mcp-day/session-customer/report",
      operation: "session-customer.report.create",
      payload: reportPayload,
      conflictPayload: {
        ...reportPayload,
        fields: { ...reportPayload.fields, opportunitySummary: "Changed" }
      },
      aggregateTable: "market_reports",
      aggregateIdKey: "reportId",
      aggregateRows
    });

    const followup = await runOperation({
      name: "followup",
      path: "/api/mcp-day/session-customer/followup",
      operation: "session-customer.followup.create",
      payload: followupPayload,
      conflictPayload: { ...followupPayload, priority: "medium" },
      aggregateTable: "mcp_followups",
      aggregateIdKey: "followupId",
      aggregateRows
    });

    output = {
      A5_5_2_SESSION_ACTION_RUNTIME_SMOKE: "PASS",
      gateway: gatewayBase,
      health: "PASS",
      canonicalEnvelope: "PASS",
      order,
      test,
      report,
      followup,
      fixtureCleanup: "PENDING"
    };
  } catch (error) {
    primaryError = error;
  }

  try {
    await cleanupAll();
    if (fixture) await verifyFixtureRemoved(fixture.routeId, aggregateRows);
    if (output) output.fixtureCleanup = "PASS";
  } catch (error) {
    cleanupError = error;
  }

  if (primaryError || cleanupError) {
    const errors = [primaryError, cleanupError].filter(Boolean);
    console.error(JSON.stringify({
      A5_5_2_SESSION_ACTION_RUNTIME_SMOKE: "FAIL",
      errors: errors.flatMap((error) => flattenErrors(error))
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(output, null, 2));
}

await run();
