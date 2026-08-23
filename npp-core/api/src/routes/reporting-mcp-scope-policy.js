import { resolveEmployeeMcpScope } from './reporting-employee-mcp.js';

const INSTALLATION_WIDE_MCP_ROLES = new Set([
  'bootstrap',
  'system:security-owner',
  'system:implementation-owner',
]);

export function hasInstallationWideMcpAccess(requestContext = {}) {
  const roles = Array.isArray(requestContext.roles) ? requestContext.roles : [];
  return roles.some((role) => INSTALLATION_WIDE_MCP_ROLES.has(role));
}

export function requiresCanonicalEmployeeMcpScope(requestContext = {}) {
  if (hasInstallationWideMcpAccess(requestContext)) return false;
  return typeof requestContext.employeeId !== 'string' || requestContext.employeeId.trim().length === 0;
}

export async function resolveReportingMcpScope(adapter, requestContext) {
  if (hasInstallationWideMcpAccess(requestContext)) {
    return Object.freeze({
      ok: true,
      employeeCode: null,
      employeeId: null,
      basis: 'INSTALLATION',
    });
  }
  return resolveEmployeeMcpScope(adapter, requestContext);
}
