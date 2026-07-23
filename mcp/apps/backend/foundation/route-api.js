import { archiveRoute, archiveRouteCustomer } from "./archive-intents.js";
import { unwrapIdempotentMutationResult } from "./idempotency.js";
import { updateRouteCustomer } from "./route-customer-update-mutations.js";
import { createRoute, updateRoute } from "./route-mutations.js";
import { supabaseRest } from "./supabase-adapter.js";

const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;
const F05_SMOKE_PREFIX = "__NPP_F05_RUNTIME_SMOKE__";
const F05_FIXTURE_PAGE_SIZE = 500;
const F05_FIXTURE_MAX_PAGES = 200;

function badRequest(code) {
  const error = new Error(code);
  error.statusCode = 400;
  throw error;
}

function forbidden(code) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = 403;
  throw error;
}

function decodePathId(value, code) {
  try {
    const decoded = decodeURIComponent(value).trim();
    if (!decoded) badRequest(code);
    return decoded;
  } catch {
    badRequest(code);
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BODY_BYTES) {
      const error = new Error("request_body_too_large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    badRequest("invalid_json_body");
  }
}

function mutationResponse(result, statusCode = 200) {
  const { data, meta } = unwrapIdempotentMutationResult(result);
  return {
    statusCode,
    payload: {
      data,
      ...(meta ? { meta } : {}),
      receivedAt: new Date().toISOString()
    }
  };
}

function assertInternalServiceActor(context) {
  if (context.actor.type !== "service" || context.actor.authentication !== "backend-token") {
    forbidden("f05_fixture_inventory_forbidden");
  }
}

function isF05FixtureRoute(row) {
  return [row?.route_name, row?.note]
    .map((value) => String(value ?? "").trim())
    .some((value) => value.startsWith(F05_SMOKE_PREFIX));
}

async function loadAllF05FixtureRoutes(context, config, fetchImpl) {
  assertInternalServiceActor(context);
  const fixtures = [];

  for (let page = 0; page < F05_FIXTURE_MAX_PAGES; page += 1) {
    const offset = page * F05_FIXTURE_PAGE_SIZE;
    const rows = await supabaseRest(
      config,
      `mcp_routes?select=id,route_name,note&order=id.asc&limit=${F05_FIXTURE_PAGE_SIZE}&offset=${offset}`,
      { fetchImpl }
    );
    const pageRows = Array.isArray(rows) ? rows : [];
    fixtures.push(...pageRows.filter(isF05FixtureRoute));
    if (pageRows.length < F05_FIXTURE_PAGE_SIZE) {
      return fixtures.map((row) => ({
        id: String(row.id || "").trim(),
        name: String(row.route_name || "").trim(),
        note: String(row.note || "").trim()
      })).filter((row) => row.id);
    }
  }

  const error = new Error("f05_fixture_inventory_page_limit_exceeded");
  error.statusCode = 500;
  throw error;
}

export async function handleRouteApi(req, url, context, config, { fetchImpl = fetch } = {}) {
  const method = String(req.method || "GET").toUpperCase();
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/internal/f05-smoke-fixtures") {
    return {
      statusCode: 200,
      payload: {
        data: await loadAllF05FixtureRoutes(context, config, fetchImpl),
        receivedAt: new Date().toISOString()
      }
    };
  }

  if (method === "POST" && pathname === "/api/routes") {
    return mutationResponse(
      await createRoute(await readJsonBody(req), context, config, { fetchImpl }),
      200
    );
  }

  const routeArchiveMatch = pathname.match(/^\/api\/routes\/([^/]+)\/archive$/);
  if (method === "POST" && routeArchiveMatch) {
    return mutationResponse(
      await archiveRoute(
        decodePathId(routeArchiveMatch[1], "invalid_route_id"),
        context,
        config,
        { fetchImpl }
      ),
      200
    );
  }

  const routeMatch = pathname.match(/^\/api\/routes\/([^/]+)$/);
  if (method === "PATCH" && routeMatch) {
    return mutationResponse(
      await updateRoute(
        decodePathId(routeMatch[1], "invalid_route_id"),
        await readJsonBody(req),
        context,
        config,
        { fetchImpl }
      ),
      200
    );
  }

  const routeCustomerArchiveMatch = pathname.match(/^\/api\/route-customers\/([^/]+)\/archive$/);
  if (method === "POST" && routeCustomerArchiveMatch) {
    return mutationResponse(
      await archiveRouteCustomer(
        decodePathId(routeCustomerArchiveMatch[1], "invalid_route_customer_id"),
        context,
        config,
        { fetchImpl }
      ),
      200
    );
  }

  const routeCustomerMatch = pathname.match(/^\/api\/route-customers\/([^/]+)$/);
  if (method === "PATCH" && routeCustomerMatch) {
    return mutationResponse(
      await updateRouteCustomer(
        decodePathId(routeCustomerMatch[1], "invalid_route_customer_id"),
        await readJsonBody(req),
        context,
        config,
        { fetchImpl }
      ),
      200
    );
  }

  return null;
}
