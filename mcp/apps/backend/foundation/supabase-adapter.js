const POSTGRESQL_SPECIAL_ROUTED_RPC_NAMES = Object.freeze(new Set([
  "mcp_search_products",
  "mcp_get_product_variants",
  "mcp_claim_outlet_media_delete",
  "mcp_finish_outlet_media_delete",
  "mcp_claim_stale_outlet_media_delete",
  "mcp_finish_storage_delete_job",
  "mcp_claim_ready_storage_delete_jobs"
]));

function parsePayload(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function providerError(response, payload) {
  const error = new Error("provider_request_failed");
  error.statusCode = 502;
  error.providerStatus = response.status;
  error.providerMessage = payload?.message || payload?.error || null;
  error.providerDetails = payload?.details || null;
  return error;
}

function usesPostgresql(config) {
  return config?.persistence?.provider === "postgresql" && config?.legacyRuntime?.enabled !== true;
}

export async function supabaseRequest(
  config,
  path,
  { method = "GET", body, prefer, fetchImpl = fetch } = {}
) {
  if (usesPostgresql(config)) {
    const error = new Error("legacy_provider_request_forbidden");
    error.code = "legacy_provider_request_forbidden";
    error.statusCode = 503;
    throw error;
  }

  const headers = {
    apikey: config.supabaseServiceRoleKey,
    Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
    Accept: "application/json"
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;

  const response = await fetchImpl(new URL(path, `${config.supabaseUrl}/`), {
    method,
    cache: "no-store",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = parsePayload(await response.text());
  if (!response.ok) throw providerError(response, payload);
  return payload;
}

export async function supabaseRest(config, resource, options = {}) {
  if (usesPostgresql(config)) {
    const { postgresqlRead } = await import("./postgresql-read-adapter.js");
    return postgresqlRead(config, resource, options);
  }
  return supabaseRequest(config, `/rest/v1/${resource}`, options);
}

export async function supabaseRpc(config, name, args, options = {}) {
  if (usesPostgresql(config)) {
    const { POSTGRESQL_MEDIA_UPLOAD_RPC_NAMES, postgresqlMediaUploadRpc } = await import("./postgresql-media-upload-adapter.js");
    if (POSTGRESQL_MEDIA_UPLOAD_RPC_NAMES.has(name)) {
      return postgresqlMediaUploadRpc(config, name, args, options);
    }
    const { POSTGRESQL_ARCHIVE_RPC_NAMES, postgresqlArchiveRpc } = await import("./postgresql-archive-adapter.js");
    if (POSTGRESQL_ARCHIVE_RPC_NAMES.has(name)) {
      return postgresqlArchiveRpc(config, name, args, options);
    }
    const { POSTGRESQL_CHECKIN_RPC_NAMES, postgresqlCheckinRpc } = await import("./postgresql-checkin-adapter.js");
    if (POSTGRESQL_CHECKIN_RPC_NAMES.has(name)) {
      return postgresqlCheckinRpc(config, name, args, options);
    }
    const { POSTGRESQL_REPORT_RPC_NAMES, postgresqlReportRpc } = await import("./postgresql-report-adapter.js");
    if (POSTGRESQL_REPORT_RPC_NAMES.has(name)) {
      return postgresqlReportRpc(config, name, args, options);
    }
    const { POSTGRESQL_SESSION_RPC_NAMES, postgresqlSessionRpc } = await import("./postgresql-session-adapter.js");
    if (POSTGRESQL_SESSION_RPC_NAMES.has(name)) {
      return postgresqlSessionRpc(config, name, args, options);
    }
    const { POSTGRESQL_DELETE_RPC_NAMES, postgresqlDeleteRpc } = await import("./postgresql-delete-adapter.js");
    if (POSTGRESQL_DELETE_RPC_NAMES.has(name)) {
      return postgresqlDeleteRpc(config, name, args, options);
    }
    if (POSTGRESQL_SPECIAL_ROUTED_RPC_NAMES.has(name)) {
      const { postgresqlSpecialRpc } = await import("./postgresql-media-adapter.js");
      return postgresqlSpecialRpc(config, name, args, options);
    }
    const { postgresqlRpc } = await import("./postgresql-compat-adapter.js");
    return postgresqlRpc(config, name, args, options);
  }
  return supabaseRequest(config, `/rest/v1/rpc/${name}`, {
    method: "POST",
    body: args,
    ...options
  });
}

export function createLegacySupabasePersistence(config) {
  const configured = Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
  return Object.freeze({
    provider: "legacy-supabase",
    configured,
    async readiness() {
      return Object.freeze({
        provider: "legacy-supabase",
        configured,
        ready: configured,
        ...(configured ? {} : { code: "legacy_supabase_not_configured" })
      });
    },
    async assertReady() {
      const state = await this.readiness();
      if (!state.ready) {
        const error = new Error(state.code);
        error.code = state.code;
        error.statusCode = 503;
        throw error;
      }
      return state;
    },
    async close() {}
  });
}
