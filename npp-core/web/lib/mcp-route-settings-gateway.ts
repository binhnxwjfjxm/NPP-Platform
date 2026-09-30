import 'server-only';

import { createIdempotencyKey, isValidIdempotencyKey, normalizeIdempotencyKey } from '@npp/contracts';
import { randomUUID } from 'node:crypto';
import { readNppWorkforceSessionToken, requestNppInternalAuth } from './internal-auth-client';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MCP_PERMISSION_PATTERN = /^mcp\.[a-z0-9][a-z0-9._:-]{1,126}$/;
const REQUEST_TIMEOUT_MS = 10_000;
const OWNER_ROLES = new Set(['system:security-owner', 'system:implementation-owner']);

type CoreMe = Readonly<{
  employeeId?: string | null;
  roles?: readonly string[];
  permissions?: readonly string[];
  scopes?: readonly string[] | Readonly<{
    branchIds?: readonly string[];
    warehouseIds?: readonly string[];
    territoryIds?: readonly string[];
  }>;
  session?: Readonly<{ loginName?: string | null; employeeFullName?: string | null }> | null;
}>;

type McpEnvelope<T> = Readonly<{
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
}>;

export class McpRouteSettingsGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'McpRouteSettingsGatewayError';
  }
}

export function resolveMcpRouteSettingsRequestId(value: string | null | undefined) {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `company_mcp_route_${randomUUID()}`;
}

export function normalizeMcpRouteSettingsGatewayError(error: unknown) {
  return error instanceof McpRouteSettingsGatewayError
    ? error
    : new McpRouteSettingsGatewayError(
      'MCP_ROUTE_SETTINGS_UNAVAILABLE',
      'Thiết lập tuyến MCP tạm thời chưa sẵn sàng',
      503,
      true,
    );
}

function requiredServerValue(name: 'MCP_API_INTERNAL_URL' | 'MCP_API_SERVER_TOKEN') {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new McpRouteSettingsGatewayError(
      'MCP_ROUTE_SETTINGS_NOT_CONFIGURED',
      'Kết nối thiết lập tuyến MCP chưa được cấu hình',
      503,
      false,
    );
  }
  return value;
}

function mcpApiBaseUrl() {
  let url: URL;
  try {
    url = new URL(requiredServerValue('MCP_API_INTERNAL_URL'));
  } catch {
    throw new McpRouteSettingsGatewayError(
      'MCP_ROUTE_SETTINGS_NOT_CONFIGURED',
      'Kết nối thiết lập tuyến MCP chưa được cấu hình',
      503,
      false,
    );
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new McpRouteSettingsGatewayError(
      'MCP_ROUTE_SETTINGS_NOT_CONFIGURED',
      'Kết nối thiết lập tuyến MCP chưa được cấu hình',
      503,
      false,
    );
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? '').trim()).filter(Boolean) : [];
}

function mcpScopes(value: CoreMe['scopes']): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value
      .map((item) => String(item ?? '').trim().toLowerCase())
      .filter((item) => /^mcp:[a-z0-9*][a-z0-9._:*-]{0,126}$/.test(item)))].sort();
  }
  if (!value || typeof value !== 'object') return [];
  const scoped = value as Readonly<{
    branchIds?: readonly string[];
    warehouseIds?: readonly string[];
    territoryIds?: readonly string[];
  }>;
  const output: string[] = [];
  for (const [key, prefix] of [
    ['branchIds', 'branch'],
    ['warehouseIds', 'warehouse'],
    ['territoryIds', 'territory'],
  ] as const) {
    const values = stringList(scoped[key]);
    for (const id of values) {
      if (UUID_PATTERN.test(id)) output.push(`mcp:${prefix}:${id.toLowerCase()}`);
    }
  }
  return [...new Set(output)].sort();
}

async function workforceAuthorization() {
  const token = readNppWorkforceSessionToken();
  if (!token?.startsWith('nppusr.')) {
    throw new McpRouteSettingsGatewayError('UNAUTHORIZED', 'Cần đăng nhập', 401, false);
  }

  const result = await requestNppInternalAuth<CoreMe>('/api/internal-auth/me', { method: 'GET', token });
  if (!result.ok || !result.data) {
    throw new McpRouteSettingsGatewayError(
      result.code || 'UNAUTHORIZED',
      result.message || 'Phiên đăng nhập không còn hiệu lực',
      result.status,
      result.retryable === true,
    );
  }

  const employeeId = String(result.data.employeeId || '').trim().toLowerCase();
  const username = String(result.data.session?.loginName || '').trim();
  const displayName = String(result.data.session?.employeeFullName || '').trim() || username;
  if (!UUID_PATTERN.test(employeeId) || !/^[A-Za-z0-9._-]{2,128}$/.test(username) || !displayName) {
    throw new McpRouteSettingsGatewayError('UNAUTHORIZED', 'Phiên đăng nhập không hợp lệ', 401, false);
  }

  const roles = stringList(result.data.roles).map((item) => item.toLowerCase());
  const owner = roles.some((role) => OWNER_ROLES.has(role));
  const permissions = [...new Set(
    stringList(result.data.permissions)
      .map((item) => item.toLowerCase())
      .filter((item) => MCP_PERMISSION_PATTERN.test(item)),
  )].sort();
  const scopes = mcpScopes(result.data.scopes);
  const identity = [
    'v4',
    username,
    employeeId,
    encodeURIComponent(displayName),
    owner ? '1' : '0',
    encodeURIComponent(JSON.stringify(permissions)),
    encodeURIComponent(JSON.stringify(scopes)),
  ].join('|');

  return `Basic ${Buffer.from(identity, 'utf8').toString('base64')}`;
}

function mutationKey(value: string | undefined, operation: string) {
  const normalized = normalizeIdempotencyKey(value);
  if (!normalized) return createIdempotencyKey(operation);
  if (!isValidIdempotencyKey(normalized)) {
    throw new McpRouteSettingsGatewayError(
      'INVALID_IDEMPOTENCY_KEY',
      'Khóa chống trùng yêu cầu không hợp lệ',
      400,
      false,
    );
  }
  return normalized;
}

async function requestMcp<T>({
  method,
  path,
  requestId,
  body,
  idempotencyKey,
}: {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  requestId: string;
  body?: unknown;
  idempotencyKey?: string;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${mcpApiBaseUrl()}${path}`, {
      method,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'X-Backend-Token': requiredServerValue('MCP_API_SERVER_TOKEN'),
        Authorization: await workforceAuthorization(),
        'X-Request-Id': requestId,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    let payload: McpEnvelope<T>;
    try {
      payload = await response.json() as McpEnvelope<T>;
    } catch {
      throw new McpRouteSettingsGatewayError(
        'MCP_ROUTE_SETTINGS_RESPONSE_INVALID',
        'Phản hồi thiết lập tuyến MCP không hợp lệ',
        502,
        false,
      );
    }

    if (!response.ok) {
      throw new McpRouteSettingsGatewayError(
        payload.error?.code || 'MCP_ROUTE_SETTINGS_REQUEST_FAILED',
        payload.error?.message || 'Yêu cầu thiết lập tuyến MCP không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new McpRouteSettingsGatewayError(
        'MCP_ROUTE_SETTINGS_RESPONSE_INVALID',
        'Phản hồi thiết lập tuyến MCP không hợp lệ',
        502,
        false,
      );
    }
    return payload.data as T;
  } catch (error) {
    if (error instanceof McpRouteSettingsGatewayError) throw error;
    throw new McpRouteSettingsGatewayError(
      'MCP_ROUTE_SETTINGS_UNAVAILABLE',
      'Kết nối MCP tạm thời không khả dụng',
      503,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function listMcpRoutes<T>(requestId: string): Promise<T> {
  return requestMcp<T>({ method: 'GET', path: '/api/routes/data', requestId });
}

export function createMcpRoute<T>(requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return requestMcp<T>({
    method: 'POST',
    path: '/api/routes',
    requestId,
    body,
    idempotencyKey: mutationKey(idempotencyKey, 'route.create'),
  });
}

export function patchMcpRoute<T>(routeId: string, requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  const id = routeId.trim();
  if (!id) throw new McpRouteSettingsGatewayError('INVALID_ROUTE_ID', 'Mã tuyến không hợp lệ', 400, false);
  return requestMcp<T>({
    method: 'PATCH',
    path: `/api/routes/${encodeURIComponent(id)}`,
    requestId,
    body,
    idempotencyKey: mutationKey(idempotencyKey, 'route.update'),
  });
}

export function archiveMcpRoute<T>(routeId: string, requestId: string, idempotencyKey?: string): Promise<T> {
  const id = routeId.trim();
  if (!id) throw new McpRouteSettingsGatewayError('INVALID_ROUTE_ID', 'Mã tuyến không hợp lệ', 400, false);
  return requestMcp<T>({
    method: 'POST',
    path: `/api/routes/${encodeURIComponent(id)}/archive`,
    requestId,
    idempotencyKey: mutationKey(idempotencyKey, 'route.archive'),
  });
}
