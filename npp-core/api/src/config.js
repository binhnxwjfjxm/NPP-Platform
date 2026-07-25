import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

function validateBackendToken(token, nodeEnv) {
  const minimumLength = nodeEnv === 'production' ? 32 : 16;
  if (token.length < minimumLength) {
    fail('backend_api_token_too_short', `BACKEND_API_TOKEN must contain at least ${minimumLength} characters`);
  }
  if (nodeEnv === 'production' && /replace|change[-_ ]?me|example|local[-_ ]?token/i.test(token)) {
    fail('backend_api_token_placeholder', 'BACKEND_API_TOKEN contains a placeholder value');
  }
}

function validateCoreBootstrapActorId(value, nodeEnv) {
  const actorId = text(value);
  if (!actorId) fail('missing_core_bootstrap_actor_id', 'CORE_BOOTSTRAP_ACTOR_ID is required');
  if (nodeEnv === 'production' && /replace|change[-_ ]?me|example|local[-_ ]?token/i.test(actorId)) {
    fail('core_bootstrap_actor_id_placeholder', 'CORE_BOOTSTRAP_ACTOR_ID contains a placeholder value');
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
