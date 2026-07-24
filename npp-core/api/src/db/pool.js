import { Pool } from 'pg';

let sharedPool;

export function buildSslConfig(mode) {
  if (mode === 'disable') return false;
  if (mode === 'require') return { rejectUnauthorized: false };
  if (mode === 'verify-full') return { rejectUnauthorized: true };
  throw new Error('invalid_database_ssl_mode');
}

export function createPgPool(config, PoolImplementation = Pool) {
  if (!config?.databaseUrl) throw new Error('missing_database_url');
  return new PoolImplementation({
    connectionString: config.databaseUrl,
    ssl: buildSslConfig(config.databaseSslMode),
    max: 5,
    idleTimeoutMillis: 30000,
  });
}

export function getPool(config) {
  if (!sharedPool) sharedPool = createPgPool(config);
  return sharedPool;
}

export async function queryReady(config, executor) {
  const queryExecutor = executor ?? getPool(config);
  return queryExecutor.query('SELECT 1 AS ok');
}

export async function closePool() {
  if (!sharedPool) return;
  const pool = sharedPool;
  sharedPool = undefined;
  await pool.end();
}

export function setPoolForTest(pool) {
  sharedPool = pool;
}
