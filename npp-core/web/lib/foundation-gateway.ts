import 'server-only';

import { randomUUID } from 'node:crypto';

const CORE_ENDPOINTS = new Set([
  '/health/live',
  '/health/ready',
  '/health/authenticated',
  '/api/config',
  '/api/storage/r2-test',
]);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const REQUEST_TIMEOUT_MS = 5_000;

interface CoreSuccessEnvelope<T> {
  data: T;
  requestId?: string;
  receivedAt?: string;
}

interface CoreResponse {
  status: number;
  payload: unknown;
}

interface CoreHealthData {
  status?: string;
}

interface CoreAuthenticatedData {
  status?: string;
  actorId?: string;
  installationId?: string;
  requestId?: string;
}

interface CoreStorageConfig {
  enabled?: boolean;
  contractRouteEnabled?: boolean;
  bucketConfigured?: boolean;
  region?: string;
  publicBaseUrlConfigured?: boolean;
  presignedUrlMaxSeconds?: number;
  maxObjectBytes?: number;
}

interface CoreSanitizedConfig {
  nodeEnv?: string;
  installationId?: string;
  databaseSslMode?: string;
  corsOrigins?: string[];
  storage?: CoreStorageConfig;
}

interface CoreConfigData {
  config?: CoreSanitizedConfig;
  requestContext?: {
    actorId?: string;
    installationId?: string;
    requestId?: string;
    sourceApp?: string;
  };
}

export interface FoundationStatus {
  apiLive: boolean;
  apiReady: boolean;
  authenticatedContext: {
    actorId: string | null;
    installationId: string | null;
    requestId: string | null;
    sourceApp: string | null;
  };
  sanitizedConfig: {
    nodeEnv: string | null;
    installationId: string | null;
    databaseSslMode: string | null;
    corsOrigins: readonly string[];
  };
  r2State: {
    enabled: boolean;
    contractRouteEnabled: boolean;
    bucketConfigured: boolean;
    publicBaseUrlConfigured: boolean;
    maxObjectBytes: number | null;
    presignedUrlMaxSeconds: number | null;
  };
  r2TestAllowed: boolean;
  checkedAt: string;
}

export class FoundationGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
  ) {
    super(publicMessage);
    this.name = 'FoundationGatewayError';
  }
}

export function isFoundationUiEnabled(): boolean {
  return process.env.FOUNDATION_TEST_UI_ENABLED === 'true';
}

export function isFoundationR2TestEnabled(): boolean {
  return process.env.FOUNDATION_R2_TEST_ENABLED === 'true';
}

export function resolveFoundationRequestId(value: string | null | undefined): string {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export function normalizeFoundationGatewayError(error: unknown): FoundationGatewayError {
  if (error instanceof FoundationGatewayError) return error;
  return new FoundationGatewayError(
    'FOUNDATION_GATEWAY_UNAVAILABLE',
    'Foundation status is temporarily unavailable',
    503,
    true,
  );
}

function requiredServerValue(name: 'CORE_API_INTERNAL_URL' | 'CORE_API_SERVER_TOKEN'): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new FoundationGatewayError(
      'FOUNDATION_GATEWAY_NOT_CONFIGURED',
      'Foundation gateway is not configured',
      503,
      false,
    );
  }
  return value;
}

function coreApiBaseUrl(): string {
  const raw = requiredServerValue('CORE_API_INTERNAL_URL');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new FoundationGatewayError(
      'FOUNDATION_GATEWAY_NOT_CONFIGURED',
      'Foundation gateway is not configured',
      503,
      false,
    );
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new FoundationGatewayError(
      'FOUNDATION_GATEWAY_NOT_CONFIGURED',
      'Foundation gateway is not configured',
      503,
      false,
    );
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new FoundationGatewayError(
      'FOUNDATION_GATEWAY_NOT_CONFIGURED',
      'Foundation gateway is not configured',
      503,
      false,
    );
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function successData<T>(response: CoreResponse, code: string): T {
  if (response.status < 200 || response.status >= 300 || !isRecord(response.payload)) {
    throw new FoundationGatewayError(code, 'Core API verification failed', 503, true);
  }
  const envelope = response.payload as unknown as CoreSuccessEnvelope<T>;
  if (!isRecord(envelope.data)) {
    throw new FoundationGatewayError(
      'FOUNDATION_GATEWAY_RESPONSE_INVALID',
      'Core API returned an invalid response',
      502,
      false,
    );
  }
  return envelope.data;
}

async function requestCore(
  path: string,
  requestId: string,
  options: { method?: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string } = {},
): Promise<CoreResponse> {
  if (!CORE_ENDPOINTS.has(path)) {
    throw new FoundationGatewayError(
      'FOUNDATION_GATEWAY_ROUTE_FORBIDDEN',
      'Foundation gateway route is not allowed',
      500,
      false,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${coreApiBaseUrl()}${path}`, {
      method: options.method ?? 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requiredServerValue('CORE_API_SERVER_TOKEN')}`,
        Accept: 'application/json',
        'x-request-id': requestId,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new FoundationGatewayError(
        'FOUNDATION_GATEWAY_RESPONSE_INVALID',
        'Core API returned an invalid response',
        502,
        false,
      );
    }
    return { status: response.status, payload };
  } catch (error) {
    if (error instanceof FoundationGatewayError) throw error;
    throw new FoundationGatewayError(
      'FOUNDATION_GATEWAY_UNAVAILABLE',
      'Core API is temporarily unavailable',
      503,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function healthIs(response: CoreResponse, expected: string): boolean {
  if (response.status < 200 || response.status >= 300 || !isRecord(response.payload)) return false;
  const envelope = response.payload as unknown as CoreSuccessEnvelope<CoreHealthData>;
  return isRecord(envelope.data) && envelope.data.status === expected;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').slice(0, 20);
}

function integerOrNull(value: unknown): number | null {
  return Number.isInteger(value) ? Number(value) : null;
}

export async function getFoundationStatus(requestId: string): Promise<FoundationStatus> {
  const [liveResponse, readyResponse, authResponse, configResponse] = await Promise.all([
    requestCore('/health/live', requestId),
    requestCore('/health/ready', requestId),
    requestCore('/health/authenticated', requestId),
    requestCore('/api/config', requestId),
  ]);

  const auth = successData<CoreAuthenticatedData>(authResponse, 'FOUNDATION_AUTH_CHECK_FAILED');
  const configData = successData<CoreConfigData>(configResponse, 'FOUNDATION_CONFIG_CHECK_FAILED');
  const config = configData.config ?? {};
  const requestContext = configData.requestContext ?? {};
  const storage = config.storage ?? {};

  return Object.freeze({
    apiLive: healthIs(liveResponse, 'ok'),
    apiReady: healthIs(readyResponse, 'ready'),
    authenticatedContext: Object.freeze({
      actorId: auth.actorId ?? requestContext.actorId ?? null,
      installationId: auth.installationId ?? requestContext.installationId ?? null,
      requestId: auth.requestId ?? requestContext.requestId ?? null,
      sourceApp: requestContext.sourceApp ?? null,
    }),
    sanitizedConfig: Object.freeze({
      nodeEnv: config.nodeEnv ?? null,
      installationId: config.installationId ?? null,
      databaseSslMode: config.databaseSslMode ?? null,
      corsOrigins: Object.freeze(strings(config.corsOrigins)),
    }),
    r2State: Object.freeze({
      enabled: storage.enabled === true,
      contractRouteEnabled: storage.contractRouteEnabled === true,
      bucketConfigured: storage.bucketConfigured === true,
      publicBaseUrlConfigured: storage.publicBaseUrlConfigured === true,
      maxObjectBytes: integerOrNull(storage.maxObjectBytes),
      presignedUrlMaxSeconds: integerOrNull(storage.presignedUrlMaxSeconds),
    }),
    r2TestAllowed: isFoundationR2TestEnabled(),
    checkedAt: new Date().toISOString(),
  });
}

export async function runFoundationR2Test(requestId: string): Promise<{ ran: true; success: true; checkedAt: string }> {
  if (!isFoundationR2TestEnabled()) {
    throw new FoundationGatewayError('FOUNDATION_R2_TEST_DISABLED', 'R2 contract test is disabled', 404, false);
  }

  const configResponse = await requestCore('/api/config', requestId);
  const configData = successData<CoreConfigData>(configResponse, 'FOUNDATION_CONFIG_CHECK_FAILED');
  const storage = configData.config?.storage;
  if (storage?.enabled !== true || storage.contractRouteEnabled !== true) {
    throw new FoundationGatewayError(
      'FOUNDATION_R2_CONTRACT_UNAVAILABLE',
      'R2 contract test is not available',
      409,
      false,
    );
  }

  const response = await requestCore('/api/storage/r2-test', requestId, {
    method: 'POST',
    idempotencyKey: `foundation-${randomUUID()}`,
    body: { message: 'NPP Core foundation browser verification' },
  });
  successData<Record<string, unknown>>(response, 'FOUNDATION_R2_TEST_FAILED');
  return { ran: true, success: true, checkedAt: new Date().toISOString() };
}
