const SSL_MODES = new Set(["disable", "require", "verify-full"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

export function resolvePostgresqlSslMode({ nodeEnv = "development", mode } = {}) {
  const environment = String(nodeEnv ?? "").trim().toLowerCase() || "development";
  const resolved = String(mode ?? "").trim().toLowerCase() || (environment === "production" ? "require" : "disable");
  if (!SSL_MODES.has(resolved)) fail("invalid_mcp_database_ssl_mode");
  if (environment === "production" && resolved === "disable") fail("production_mcp_database_ssl_required");
  return resolved;
}

export function buildPostgresqlSslConfig(mode) {
  if (mode === "disable") return false;
  if (mode === "require") return { rejectUnauthorized: false };
  if (mode === "verify-full") return { rejectUnauthorized: true };
  fail("invalid_mcp_database_ssl_mode");
}
