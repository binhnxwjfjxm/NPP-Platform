import { Pool } from 'pg';
import { loadConfig } from '../config.js';

let pool;

function buildSslConfig(mode) {
  if (!mode || mode === 'disable') {
    return false;
  }

  if (mode === 'require') {
    return { rejectUnauthorized: false };
  }

  return { rejectUnauthorized: false };
}

export function createPgPool(config = loadConfig()) {
  const ssl = buildSslConfig(config.databaseSslMode);

  pool = new Pool({
    connectionString: config.databaseUrl,
    ssl,
    max: 5,
    idleTimeoutMillis: 30000,
  });

  return pool;
}

export function getPool(config = loadConfig()) {
  if (!pool) {
    pool = createPgPool(config);
  }

  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

export async function queryOne(config = loadConfig()) {
  const currentPool = getPool(config);
  return currentPool.query('SELECT 1 as ok');
}
