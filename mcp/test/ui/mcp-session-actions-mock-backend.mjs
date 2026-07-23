import http from "node:http";
import { mkdir, writeFile } from "node:fs/promises";

const port = Number(process.env.MCP_ACTION_UI_MOCK_PORT || 3110);
const resultsDir = process.env.MCP_ACTION_UI_RESULTS_DIR || "test-results/mcp-session-actions";
const product = { productId: "product-ui", variantId: "variant-ui", name: "Trà UI Smoke", brand: "NPP", category: "Trà", sku: "UI-001", variantName: "Chai", sizeLabel: "350ml", sellUnit: "chai", packUnit: "thùng", packQuantity: 24, price: 12000 };

function defaultBehavior() {
  return { productDelayMs: 0, productError: null };
}

function initialState() {
  return {
    requests: [],
    aggregates: { orders: [], tests: [], reports: [], followups: [] },
    behavior: defaultBehavior(),
    line: { id: "sc-existing", sessionCustomerId: "sc-existing", routeCustomerId: "rc-existing", sortOrder: 1, accountName: "UI Existing Customer", area: "API Smoke", source: "planned", status: "pending", note: "Browser smoke seed", hasOrder: false, hasTest: false, hasReport: false, followupCount: 0, checkedIn: false }
  };
}

let state = initialState();
const json = (res, status, payload) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(payload)); };
const canonical = (req, data) => ({ data, requestId: String(req.headers["x-request-id"] || "ui-request"), receivedAt: new Date().toISOString() });
async function body(req) { const chunks = []; for await (const chunk of req) chunks.push(chunk); const text = Buffer.concat(chunks).toString("utf8"); return text ? JSON.parse(text) : {}; }
function record(req, url, payload) { const item = { method: req.method, path: url.pathname, idempotencyKey: String(req.headers["idempotency-key"] || ""), requestId: String(req.headers["x-request-id"] || ""), payload }; state.requests.push(item); return item; }
async function persist() { await mkdir(resultsDir, { recursive: true }); await writeFile(`${resultsDir}/mock-state.json`, JSON.stringify(state, null, 2)); }
async function sleep(ms) { if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms)); }

const routes = [{ id: "route-active", name: "UI Smoke Active", area: "API Smoke", salesOwner: "Sales UI", plannedCustomers: 1, visitedCustomers: 0, orderCount: 0, lastVisitDate: "-", status: "active" }];
const routeCustomers = [{ id: "rc-existing", routeId: "route-active", routeName: "UI Smoke Active", accountId: "customer-existing", accountName: "UI Existing Customer", contactName: "0900000000", area: "API Smoke", sortOrder: 1, status: "active", note: "Browser smoke seed" }];
function dayData() { return { sessionOpened: true, run: { id: "session-active", routeId: "route-active", routeName: "UI Smoke Active", date: "2099-12-30", owner: "Sales UI", status: "active", openedAt: "08:00" }, kpis: [], lines: [state.line], results: [] }; }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || `127.0.0.1:${port}`}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });
    if (req.method === "POST" && url.pathname === "/__reset") { state = initialState(); await persist(); return json(res, 200, { ok: true }); }
    if (req.method === "POST" && url.pathname === "/__behavior") {
      const next = await body(req);
      state.behavior = { ...state.behavior, ...next };
      await persist();
      return json(res, 200, { ok: true, behavior: state.behavior });
    }
    if (req.method === "GET" && url.pathname === "/__state") return json(res, 200, state);
    if (req.method === "GET" && url.pathname === "/api/routes/data") return json(res, 200, canonical(req, { kpis: [], routes }));
    if (req.method === "GET" && url.pathname === "/api/routes/customers/data") return json(res, 200, canonical(req, { kpis: [], customers: routeCustomers }));
    if (req.method === "GET" && url.pathname === "/api/mcp-day/data") return json(res, 200, canonical(req, dayData()));
    if (req.method === "GET" && url.pathname === "/api/mcp-settings/session-status") return json(res, 200, canonical(req, { sessions: [{ id: "session-active", routeId: "route-active", routeName: "UI Smoke Active", sessionDate: "2099-12-30", status: "active" }] }));
    if (req.method === "GET" && url.pathname === "/api/products/search") {
      const behavior = state.behavior;
      state.behavior = defaultBehavior();
      await sleep(Number(behavior.productDelayMs || 0));
      if (behavior.productError) return json(res, 503, { error: String(behavior.productError) });
      return json(res, 200, { data: [product] });
    }
    if (req.method === "GET" && url.pathname === "/api/products/product-ui/variants") return json(res, 200, { data: [product] });
    if (req.method === "GET" && url.pathname === "/api/mcp-report-settings") return json(res, 200, { data: { groups: [] } });

    const action = req.method === "POST" && url.pathname.match(/^\/api\/mcp-day\/session-customer\/(order|test|report|followup)$/);
    if (action) {
      const payload = await body(req);
      const entry = record(req, url, payload);
      if (!entry.idempotencyKey) return json(res, 400, { error: { code: "idempotency_key_required", message: "idempotency_key_required" } });
      const kind = action[1];
      const id = `${kind}-ui-${state.aggregates[kind === "followup" ? "followups" : `${kind}s`].length + 1}`;
      const bucket = kind === "followup" ? "followups" : `${kind}s`;
      state.aggregates[bucket].push({ id, ...payload });
      if (kind === "order") state.line.hasOrder = true;
      if (kind === "test") state.line.hasTest = true;
      if (kind === "report") state.line.hasReport = true;
      if (kind === "followup") state.line.followupCount += 1;
      await persist();
      return json(res, 200, canonical(req, { id, sessionCustomerId: payload.sessionCustomerId }));
    }

    return json(res, 404, { error: { code: "not_found", message: `${req.method} ${url.pathname}` } });
  } catch (error) {
    return json(res, 500, { error: { code: "mock_error", message: error instanceof Error ? error.message : String(error) } });
  }
});

server.listen(port, "127.0.0.1", async () => { await persist(); console.log(`MCP action UI mock listening on 127.0.0.1:${port}`); });
