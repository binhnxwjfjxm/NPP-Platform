function activeProviderPort(config) {
  const port = config?.foundationProviderPort;
  return port && typeof port === "object" ? port : null;
}

async function legacyClient() {
  return import("./legacy-supabase-http.js");
}

export async function supabaseRequest(config, path, options = {}) {
  const client = await legacyClient();
  return client.legacySupabaseRequest(config, path, options);
}

export async function supabaseRest(config, resource, options = {}) {
  const port = activeProviderPort(config);
  if (port && typeof port.rest === "function") {
    return port.rest(resource, options, config.foundationRequestContext || null);
  }
  const client = await legacyClient();
  return client.legacySupabaseRest(config, resource, options);
}

export async function supabaseRpc(config, name, args, options = {}) {
  const port = activeProviderPort(config);
  if (port && typeof port.rpc === "function") {
    return port.rpc(name, args, config.foundationRequestContext || null);
  }
  const client = await legacyClient();
  return client.legacySupabaseRpc(config, name, args, options);
}
