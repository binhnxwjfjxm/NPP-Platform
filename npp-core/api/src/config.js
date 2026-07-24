import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toBoolean } from '@npp/shared-utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configDefaults = {
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  PORT: '3004',
  DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/npp_platform',
  DATABASE_SSL_MODE: 'disable',
  BACKEND_API_TOKEN: 'replace-with-local-token',
  CORS_ORIGINS: 'http://127.0.0.1:3003',
};

function loadEnvFile() {
  const envPath = path.resolve(__dirname, '..', '.env');
  try {
    const fileContents = readFileSync(envPath, 'utf8');
    return fileContents
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => !line.trim().startsWith('#'))
      .reduce((acc, line) => {
        const [key, ...rest] = line.split('=');
        acc[key] = rest.join('=').trim();
        return acc;
      }, {});
  } catch {
    return {};
  }
}

export function loadConfig() {
  const env = {
    ...configDefaults,
    ...loadEnvFile(),
    ...process.env,
  };

  return {
    nodeEnv: env.NODE_ENV,
    host: env.HOST,
    port: Number(env.PORT || configDefaults.PORT),
    databaseUrl: env.DATABASE_URL,
    databaseSslMode: env.DATABASE_SSL_MODE,
    backendApiToken: env.BACKEND_API_TOKEN,
    corsOrigins: (env.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean),
    ignoreDatabaseWhenReady: toBoolean(env.IGNORE_DB_READY, false),
  };
}

export function getSanitizedConfig(config) {
  return {
    nodeEnv: config.nodeEnv,
    host: config.host,
    port: config.port,
    databaseSslMode: config.databaseSslMode,
    corsOrigins: config.corsOrigins,
  };
}
