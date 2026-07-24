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

  return Object.freeze({
    nodeEnv,
    host: text(env.HOST) || SAFE_DEFAULTS.HOST,
    port: parsePort(text(env.PORT) || SAFE_DEFAULTS.PORT),
    installationId: required(env, 'INSTALLATION_ID'),
    databaseUrl: parseDatabaseUrl(required(env, 'DATABASE_URL')),
    databaseSslMode: parseSslMode(env.DATABASE_SSL_MODE),
    backendApiToken,
    corsOrigins: parseCorsOrigins(env.CORS_ORIGINS, { nodeEnv }),
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
  });
}
