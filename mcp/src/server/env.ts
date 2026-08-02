export type ServerEnv = {
  backendApiBaseUrl: string;
  backendApiToken: string;
  legacyActorId: string;
};

function required(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function httpUrl(value: string, name: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid ${name}`);
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error(`Invalid ${name}`);
  }
  return parsed.toString().replace(/\/+$/, "");
}

export function getServerEnv(): ServerEnv {
  const backendApiBaseUrl = httpUrl(required("BACKEND_API_BASE_URL"), "BACKEND_API_BASE_URL");
  const backendApiToken = required("BACKEND_API_TOKEN");
  const legacyActorId = required("MCP_LEGACY_ACTOR_ID");
  return { backendApiBaseUrl, backendApiToken, legacyActorId };
}
