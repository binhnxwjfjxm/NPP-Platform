function parsePayload(text) { if (!text) return null; try { return JSON.parse(text); } catch { return { raw: text }; } }
function providerError(response, payload) { const error = new Error("provider_request_failed"); error.statusCode = 502; error.providerStatus = response.status; error.providerMessage = payload?.message || payload?.error || null; error.providerDetails = payload?.details || null; return error; }
function legacyConfig(config) { return { url: config.supabaseUrl || config.legacySupabase?.url, key: config.supabaseServiceRoleKey || config.legacySupabase?.serviceRoleKey }; }

export async function legacySupabaseRequest(config, path, { method = "GET", body, prefer, fetchImpl = fetch } = {}) {
  const legacy = legacyConfig(config);
  if (!legacy.url || !legacy.key) { const error = new Error("legacy_supabase_not_configured"); error.statusCode = 503; throw error; }
  const headers = { apikey: legacy.key, Authorization: `Bearer ${legacy.key}`, Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  const response = await fetchImpl(new URL(path, `${legacy.url}/`), { method, cache: "no-store", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = parsePayload(await response.text());
  if (!response.ok) throw providerError(response, payload);
  return payload;
}

export function legacySupabaseRest(config, resource, options = {}) { return legacySupabaseRequest(config, `/rest/v1/${resource}`, options); }
export function legacySupabaseRpc(config, name, args, options = {}) { return legacySupabaseRequest(config, `/rest/v1/rpc/${name}`, { method: "POST", body: args, ...options }); }

export function createLegacySupabasePersistence(config) {
  const configured = Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
  return Object.freeze({
    provider: "legacy-supabase",
    configured,
    async readiness() { return Object.freeze({ provider: "legacy-supabase", configured, ready: configured, ...(configured ? {} : { code: "legacy_supabase_not_configured" }) }); },
    async assertReady() { const state = await this.readiness(); if (!state.ready) { const error = new Error(state.code); error.code = state.code; error.statusCode = 503; throw error; } return state; },
    async close() {}
  });
}
