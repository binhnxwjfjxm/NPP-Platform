import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SAFE_DEFAULTS = Object.freeze({
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  PORT: '3004',
  DATABASE_SSL_MODE: 'disable',
  R2_ENABLED: 'false',
  R2_REGION: 'auto',
  R2_PRESIGNED_URL_MAX_SECONDS: '900',
  R2_MAX_OBJECT_BYTES: '5242880',
  R2_CONTRACT_ROUTE_ENABLED: 'false',
});

function text(value) {
  return String(value ?? '').trim();
}

function fail(code, message) {
  const error = new Error(code);
  error.code = code;
  error.publicMessage = message;
  throw error;
}

function required(env, name) {
  const value = text(env[name]);
  if (!value) fail(`missing_${name.toLowerCase()}`, `${name} is required`);
  return value;
}

function parsePort(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    fail('invalid_port', 'PORT must be an integer from 1 to 65535');
  }
  return parsed;
}

function parsePositiveInteger(value, name, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    fail(`invalid_${name.toLowerCase()}`, `${name} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

function parseDatabaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('invalid_database_url', 'DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    fail('invalid_database_url', 'DATABASE_URL must use postgres or postgresql');
  }
  return parsed.toString();
}

function parseSslMode(value) {
  const mode = text(value) || 'disable';
  if (!['disable', 'require', 'verify-full'].includes(mode)) {
    fail('invalid_database_ssl_mode', 'DATABASE_SSL_MODE must be disable, require, or verify-full');
  }
  return mode;
}

function parseBoolean(value, { defaultValue = false } = {}) {
  const normalized = text(value).toLowerCase();
  if (!normalized) return defaultValue;
  if (['1', 'true', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'no'].includes(normalized)) return false;
  fail('invalid_boolean', 'Boolean environment value must be true, false, 1, or 0');
}

function parseHttpUrl(value, name, { optional = false } = {}) {
  const raw = text(value);
  if (!raw && optional) return '';
  if (!raw) fail(`missing_${name.toLowerCase()}`, `${name} is required`);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail(`invalid_${name.toLowerCase()}`, `${name} must be a valid URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    fail(`invalid_${name.toLowerCase()}`, `${name} must use http or https`);
  }
  return parsed.toString();
}

function parseUuidList(value, name) {
  const values = [...new Set(text(value).split(',').map((item) => item.trim()).filter(Boolean))];
  if (!values.length) fail(`missing_${name.toLowerCase()}`, `${name} must contain at least one warehouse UUID`);
  if (values.some((item) => !UUID_PATTERN.test(item))) {
    fail(`invalid_${name.toLowerCase()}`, `${name} must contain comma-separated warehouse UUIDs`);
  }
  return Object.freeze(values);
}

export function parseCorsOrigins(value, { nodeEnv = 'development' } = {}) {
  const raw = text(value);
  if (!raw) {
    if (nodeEnv === 'production') fail('missing_cors_origins', 'CORS_ORIGINS is required in production');
    return Object.freeze(['http://127.0.0.1:3003']);
  }

  const origins = [...new Set(raw.split(',').map((item) => item.trim()).filter(Boolean))];
  if (origins.includes('*')) fail('cors_wildcard_forbidden', 'CORS_ORIGINS cannot contain *');

  for (const origin of origins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      fail('invalid_cors_origin', `Invalid CORS origin: ${origin}`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
      fail('invalid_cors_origin', `CORS origin must be an exact http(s) origin: ${origin}`);
    }
  }

  return Object.freeze(origins);
}

function validateNamedToken(token, name, nodeEnv) {
  const minimumLength = nodeEnv === 'production' ? 32 : 16;
  const codeName = name.toLowerCase();
  if (token.length < minimumLength) {
    fail(`${codeName}_too_short`, `${name} must contain at least ${minimumLength} characters`);
  }
  if (nodeEnv === 'production' && /replace|change[-_ ]?me|example|local[-_ ]?token/i.test(token)) {
    fail(`${codeName}_placeholder`, `${name} contains a placeholder value`);
  }
}

function validateBackendToken(token, nodeEnv) {
  validateNamedToken(token, 'BACKEND_API_TOKEN', nodeEnv);
}

function validateCoreBootstrapActorId(value, nodeEnv) {
  const actorId = text(value);
  if (!actorId) fail('missing_core_bootstrap_actor_id', 'CORE_BOOTSTRAP_ACTOR_ID is required');
  if (nodeEnv === 'production' && /replace|change[-_ ]?me|example|local[-_ ]?token/i.test(actorId)) {
    fail('core_bootstrap_actor_id_placeholder', 'CORE_BOOTSTRAP_ACTOR_ID contains a placeholder value');
  }
  return actorId;
}

function validateServiceActorId(value, name, nodeEnv, fallback) {
  const actorId = text(value) || fallback;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,127}$/.test(actorId)) {
    fail(`invalid_${name.toLowerCase()}`, `${name} is invalid`);
  }
  if (nodeEnv === 'production' && /replace|change[-_ ]?me|example/i.test(actorId)) {
    fail(`${name.toLowerCase()}_placeholder`, `${name} contains a placeholder value`);
  }
  return actorId;
}

function loadEnvFile() {
  const envPath = path.resolve(__dirname, '..', '.env');
  try {
    return readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .reduce((acc, line) => {
        const separator = line.indexOf('=');
        if (separator < 1) return acc;
        acc[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
        return acc;
      }, {});
  } catch {
    return {};
  }
}

export function loadConfig(envInput) {
  const env = {
    ...SAFE_DEFAULTS,
    ...(envInput === undefined ? loadEnvFile() : {}),
    ...(envInput ?? process.env),
  };
  const nodeEnv = text(env.NODE_ENV) || SAFE_DEFAULTS.NODE_ENV;
  const backendApiToken = required(env, 'BACKEND_API_TOKEN');
  validateBackendToken(backendApiToken, nodeEnv);
  const coreBootstrapActorId = validateCoreBootstrapActorId(env.CORE_BOOTSTRAP_ACTOR_ID, nodeEnv);

  const mcpOnboardingApiToken = text(env.MCP_ONBOARDING_API_TOKEN);
  const configuredMcpOnboardingActorId = text(env.MCP_ONBOARDING_ACTOR_ID);
  if (!mcpOnboardingApiToken && configuredMcpOnboardingActorId) {
    fail('incomplete_mcp_onboarding_config', 'MCP_ONBOARDING_API_TOKEN is required when MCP_ONBOARDING_ACTOR_ID is configured');
  }
  if (mcpOnboardingApiToken) {
    validateNamedToken(mcpOnboardingApiToken, 'MCP_ONBOARDING_API_TOKEN', nodeEnv);
    if (mcpOnboardingApiToken === backendApiToken) fail('mcp_onboarding_token_reuse_forbidden', 'MCP_ONBOARDING_API_TOKEN must differ from BACKEND_API_TOKEN');
  }
  const mcpOnboardingActorId = mcpOnboardingApiToken
    ? validateServiceActorId(configuredMcpOnboardingActorId, 'MCP_ONBOARDING_ACTOR_ID', nodeEnv, 'service:mcp-customer-onboarding')
    : '';

  const mcpSalesApiToken = text(env.MCP_SALES_API_TOKEN);
  const configuredMcpSalesActorId = text(env.MCP_SALES_ACTOR_ID);
  const configuredMcpSalesWarehouseIds = text(env.MCP_SALES_WAREHOUSE_IDS);
  const mcpSalesParts = [mcpSalesApiToken, configuredMcpSalesActorId, configuredMcpSalesWarehouseIds].filter(Boolean).length;
  if (mcpSalesParts > 0 && (!mcpSalesApiToken || !configuredMcpSalesWarehouseIds)) {
    fail('incomplete_mcp_sales_config', 'MCP_SALES_API_TOKEN and MCP_SALES_WAREHOUSE_IDS must be configured together');
  }
  if (mcpSalesApiToken) {
    validateNamedToken(mcpSalesApiToken, 'MCP_SALES_API_TOKEN', nodeEnv);
    if (mcpSalesApiToken === backendApiToken || mcpSalesApiToken === mcpOnboardingApiToken) {
      fail('mcp_sales_token_reuse_forbidden', 'MCP_SALES_API_TOKEN must differ from other backend tokens');
    }
  }
  const mcpSalesActorId = mcpSalesApiToken
    ? validateServiceActorId(configuredMcpSalesActorId, 'MCP_SALES_ACTOR_ID', nodeEnv, 'service:mcp-sales-order')
    : '';
  const mcpSalesWarehouseIds = mcpSalesApiToken
    ? parseUuidList(configuredMcpSalesWarehouseIds, 'MCP_SALES_WAREHOUSE_IDS')
    : Object.freeze([]);

  const websiteAiApiToken = text(env.WEBSITE_AI_API_TOKEN);
  const configuredWebsiteAiActorId = text(env.WEBSITE_AI_ACTOR_ID);
  if (!websiteAiApiToken && configuredWebsiteAiActorId) {
    fail('incomplete_website_ai_config', 'WEBSITE_AI_API_TOKEN is required when WEBSITE_AI_ACTOR_ID is configured');
  }
  if (websiteAiApiToken) {
    validateNamedToken(websiteAiApiToken, 'WEBSITE_AI_API_TOKEN', nodeEnv);
    if ([backendApiToken, mcpOnboardingApiToken, mcpSalesApiToken].includes(websiteAiApiToken)) {
      fail('website_ai_token_reuse_forbidden', 'WEBSITE_AI_API_TOKEN must differ from other backend tokens');
    }
  }
  const websiteAiActorId = websiteAiApiToken
    ? validateServiceActorId(configuredWebsiteAiActorId, 'WEBSITE_AI_ACTOR_ID', nodeEnv, 'service:website-ai')
    : '';

  const orderingAiApiToken = text(env.ORDERING_AI_API_TOKEN);
  const configuredOrderingAiActorId = text(env.ORDERING_AI_ACTOR_ID);
  if (!orderingAiApiToken && configuredOrderingAiActorId) {
    fail('incomplete_ordering_ai_config', 'ORDERING_AI_API_TOKEN is required when ORDERING_AI_ACTOR_ID is configured');
  }
  if (orderingAiApiToken) {
    validateNamedToken(orderingAiApiToken, 'ORDERING_AI_API_TOKEN', nodeEnv);
    if ([backendApiToken, mcpOnboardingApiToken, mcpSalesApiToken, websiteAiApiToken].includes(orderingAiApiToken)) {
      fail('ordering_ai_token_reuse_forbidden', 'ORDERING_AI_API_TOKEN must differ from other backend tokens');
    }
  }
  const orderingAiActorId = orderingAiApiToken
    ? validateServiceActorId(configuredOrderingAiActorId, 'ORDERING_AI_ACTOR_ID', nodeEnv, 'service:ordering-ai')
    : '';

  const deliveryFrontendApiToken = text(env.DELIVERY_FRONTEND_API_TOKEN);
  const configuredDeliveryFrontendActorId = text(env.DELIVERY_FRONTEND_ACTOR_ID);
  const configuredDeliveryFrontendWarehouseIds = text(env.DELIVERY_FRONTEND_WAREHOUSE_IDS);
  const deliveryFrontendParts = [
    deliveryFrontendApiToken,
    configuredDeliveryFrontendActorId,
    configuredDeliveryFrontendWarehouseIds,
  ].filter(Boolean).length;
  if (deliveryFrontendParts > 0 && (!deliveryFrontendApiToken || !configuredDeliveryFrontendWarehouseIds)) {
    fail(
      'incomplete_delivery_frontend_config',
      'DELIVERY_FRONTEND_API_TOKEN and DELIVERY_FRONTEND_WAREHOUSE_IDS must be configured together',
    );
  }
  if (deliveryFrontendApiToken) {
    validateNamedToken(deliveryFrontendApiToken, 'DELIVERY_FRONTEND_API_TOKEN', nodeEnv);
    if ([backendApiToken, mcpOnboardingApiToken, mcpSalesApiToken, websiteAiApiToken, orderingAiApiToken].includes(deliveryFrontendApiToken)) {
      fail('delivery_frontend_token_reuse_forbidden', 'DELIVERY_FRONTEND_API_TOKEN must differ from other backend tokens');
    }
  }
  const deliveryFrontendActorId = deliveryFrontendApiToken
    ? validateServiceActorId(
        configuredDeliveryFrontendActorId,
        'DELIVERY_FRONTEND_ACTOR_ID',
        nodeEnv,
        'service:delivery-frontend',
      )
    : '';
  const deliveryFrontendWarehouseIds = deliveryFrontendApiToken
    ? parseUuidList(configuredDeliveryFrontendWarehouseIds, 'DELIVERY_FRONTEND_WAREHOUSE_IDS')
    : Object.freeze([]);

  const r2Enabled = parseBoolean(env.R2_ENABLED, { defaultValue: false });
  const r2ContractRouteEnabled = parseBoolean(env.R2_CONTRACT_ROUTE_ENABLED, { defaultValue: false });
  const r2Region = text(env.R2_REGION) || SAFE_DEFAULTS.R2_REGION;
  const r2Endpoint = text(env.R2_ENDPOINT) ? parseHttpUrl(env.R2_ENDPOINT, 'R2_ENDPOINT') : '';
  const r2Bucket = text(env.R2_BUCKET);
  const r2AccessKeyId = text(env.R2_ACCESS_KEY_ID);
  const r2SecretAccessKey = text(env.R2_SECRET_ACCESS_KEY);
  const r2PublicBaseUrl = text(env.R2_PUBLIC_BASE_URL)
    ? parseHttpUrl(env.R2_PUBLIC_BASE_URL, 'R2_PUBLIC_BASE_URL', { optional: true })
    : '';
  const r2PresignedUrlMaxSeconds = parsePositiveInteger(
    env.R2_PRESIGNED_URL_MAX_SECONDS,
    'R2_PRESIGNED_URL_MAX_SECONDS',
    { min: 1, max: 604800 },
  );
  const r2MaxObjectBytes = parsePositiveInteger(
    env.R2_MAX_OBJECT_BYTES,
    'R2_MAX_OBJECT_BYTES',
    { min: 1, max: 1073741824 },
  );

  if (r2Enabled) {
    if (!r2Endpoint) fail('missing_r2_endpoint', 'R2_ENDPOINT is required when R2_ENABLED=true');
    if (!r2Bucket) fail('missing_r2_bucket', 'R2_BUCKET is required when R2_ENABLED=true');
    if (!r2AccessKeyId) fail('missing_r2_access_key_id', 'R2_ACCESS_KEY_ID is required when R2_ENABLED=true');
    if (!r2SecretAccessKey) fail('missing_r2_secret_access_key', 'R2_SECRET_ACCESS_KEY is required when R2_ENABLED=true');
  }

  return Object.freeze({
    nodeEnv,
    host: text(env.HOST) || SAFE_DEFAULTS.HOST,
    port: parsePort(text(env.PORT) || SAFE_DEFAULTS.PORT),
    installationId: required(env, 'INSTALLATION_ID'),
    databaseUrl: parseDatabaseUrl(required(env, 'DATABASE_URL')),
    databaseSslMode: parseSslMode(env.DATABASE_SSL_MODE),
    backendApiToken,
    coreBootstrapActorId,
    mcpOnboardingApiToken,
    mcpOnboardingActorId,
    mcpSalesApiToken,
    mcpSalesActorId,
    mcpSalesWarehouseIds,
    websiteAiApiToken,
    websiteAiActorId,
    orderingAiApiToken,
    orderingAiActorId,
    deliveryFrontendApiToken,
    deliveryFrontendActorId,
    deliveryFrontendWarehouseIds,
    corsOrigins: parseCorsOrigins(env.CORS_ORIGINS, { nodeEnv }),
    r2Enabled,
    r2Endpoint,
    r2Region,
    r2Bucket,
    r2AccessKeyId,
    r2SecretAccessKey,
    r2PublicBaseUrl,
    r2PresignedUrlMaxSeconds,
    r2MaxObjectBytes,
    r2ContractRouteEnabled,
  });
}

export function getSanitizedConfig(config) {
  return Object.freeze({
    nodeEnv: config.nodeEnv,
    host: config.host,
    port: config.port,
    installationId: config.installationId,
    mcpOnboardingConfigured: Boolean(config.mcpOnboardingApiToken),
    mcpSalesConfigured: Boolean(config.mcpSalesApiToken),
    mcpSalesWarehouseScopeCount: config.mcpSalesWarehouseIds.length,
    websiteAiConfigured: Boolean(config.websiteAiApiToken),
    orderingAiConfigured: Boolean(config.orderingAiApiToken),
    deliveryFrontendConfigured: Boolean(config.deliveryFrontendApiToken),
    deliveryFrontendWarehouseScopeCount: config.deliveryFrontendWarehouseIds.length,
    databaseSslMode: config.databaseSslMode,
    corsOrigins: [...config.corsOrigins],
    storage: Object.freeze({
      enabled: config.r2Enabled,
      contractRouteEnabled: config.r2ContractRouteEnabled,
      bucketConfigured: Boolean(config.r2Bucket),
      region: config.r2Region,
      publicBaseUrlConfigured: Boolean(config.r2PublicBaseUrl),
      presignedUrlMaxSeconds: config.r2PresignedUrlMaxSeconds,
      maxObjectBytes: config.r2MaxObjectBytes,
    }),
  });
}
