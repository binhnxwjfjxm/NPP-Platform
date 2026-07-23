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

export async function supabaseRequest(
  config,
  path,
  { method = "GET", body, prefer, fetchImpl = fetch } = {}
) {
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

export function supabaseRest(config, resource, options = {}) {
  return supabaseRequest(config, `/rest/v1/${resource}`, options);
}

export function supabaseRpc(config, name, args, options = {}) {
  return supabaseRequest(config, `/rest/v1/rpc/${name}`, {
    method: "POST",
    body: args,
    ...options
  });
}
