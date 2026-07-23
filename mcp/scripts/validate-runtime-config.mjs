import { loadEnvFile } from "node:process";

for (const file of [".env.local", ".env.production", ".env"]) {
  try {
    loadEnvFile(file);
  } catch {}
}

function value(name) {
  return String(process.env[name] || "").trim();
}

function required(name) {
  const result = value(name);
  if (!result) throw new Error(`missing_${name.toLowerCase()}`);
  return result;
}

function httpUrl(name, { optional = false, httpsInProduction = false } = {}) {
  const raw = value(name);
  if (!raw && optional) return null;
  if (!raw) throw new Error(`missing_${name.toLowerCase()}`);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`invalid_${name.toLowerCase()}`);
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(`invalid_${name.toLowerCase()}`);
  if (httpsInProduction && process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new Error(`${name.toLowerCase()}_https_required`);
  }
  return parsed.toString();
}

httpUrl("BACKEND_API_BASE_URL");
const token = required("BACKEND_API_TOKEN");
if (token.length < 32 || /replace|change[-_ ]?me|example|dev[-_ ]?only/i.test(token)) {
  throw new Error("invalid_backend_api_token");
}
required("MCP_LEGACY_ACTOR_ID");
required("SUPABASE_URL");
required("SUPABASE_ANON_KEY");
httpUrl("MCP_REPORT_AGENT_URL", { optional: true, httpsInProduction: true });

console.log("runtime_config_valid");
