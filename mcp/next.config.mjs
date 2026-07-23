function requiredBuildEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function validateBuildConfig() {
  const shouldValidate =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL === "1" ||
    process.env.CI === "true" ||
    process.env.STRICT_RUNTIME_CONFIG === "1";

  if (!shouldValidate) return;

  const backendUrl = requiredBuildEnv("BACKEND_API_BASE_URL");
  let parsed;
  try {
    parsed = new URL(backendUrl);
  } catch {
    throw new Error("invalid_backend_api_base_url");
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error("invalid_backend_api_base_url");
  }

  const token = requiredBuildEnv("BACKEND_API_TOKEN");
  if (token.length < 32 || /replace|change[-_ ]?me|example|dev[-_ ]?only/i.test(token)) {
    throw new Error("invalid_backend_api_token");
  }

  requiredBuildEnv("MCP_LEGACY_ACTOR_ID");
  requiredBuildEnv("SUPABASE_URL");
  requiredBuildEnv("SUPABASE_ANON_KEY");

  const agentUrl = String(process.env.MCP_REPORT_AGENT_URL || "").trim();
  if (agentUrl) {
    let parsedAgent;
    try {
      parsedAgent = new URL(agentUrl);
    } catch {
      throw new Error("invalid_mcp_report_agent_url");
    }
    if (parsedAgent.protocol !== "https:") {
      throw new Error("mcp_report_agent_https_required");
    }
  }
}

validateBuildConfig();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    outputFileTracingIncludes: {
      "/api/exports/orders.csv": ["./logo-transparent.png"]
    }
  }
};

export default nextConfig;
