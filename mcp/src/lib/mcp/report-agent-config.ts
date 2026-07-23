function configuredAgentUrl() {
  const value = String(process.env.MCP_REPORT_AGENT_URL || "").trim();
  if (!value) throw new Error("mcp_report_agent_not_configured");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid_mcp_report_agent_url");
  }

  if (!/^https?:$/.test(url.protocol)) {
    throw new Error("invalid_mcp_report_agent_url");
  }

  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("mcp_report_agent_https_required");
  }

  return url.toString().replace(/\/+$/, "");
}

export function mcpReportAgentUrl() {
  return configuredAgentUrl();
}

export function mcpReportAgentHealthUrl() {
  return configuredAgentUrl().replace(/\/analyze\/?$/, "/health");
}
