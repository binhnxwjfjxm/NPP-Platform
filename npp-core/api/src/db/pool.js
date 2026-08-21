import { Pool } from 'pg';

let sharedPool;

function sanitizePoolError(error) {
  const raw = typeof error?.message === 'string' ? error.message : 'database_pool_error';
  const message = raw
    .replace(/(?:postgres(?:ql)?|https?):\/\/\S+/gi, '[redacted-url]')
    .replace(/(?:password|token|secret|api[_-]?key)\s*[=:]\s*\S+/gi, '$1=[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 240);

  return Object.freeze({
    event: 'database_pool_idle_client_error',
    name: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
    code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
    message,
  });
}

export function buildSslConfig(mode) {
  if (mode === 'disable') return false;
  if (mode === 'require') return { rejectUnauthorized: false };
  if (mode === 'verify-full') return { rejectUnauthorized: true };
  throw new Error('invalid_database_ssl_mode');
}

export function createPgPool(config, PoolImplementation = Pool) {
  if (!config?.databaseUrl) throw new Error('missing_database_url');
  const pool = new PoolImplementation({
    connectionString: config.databaseUrl,
    ssl: buildSslConfig(config.databaseSslMode),
    max: 5,
    idleTimeoutMillis: 30000,
  });

  if (typeof pool.on === 'function') {
    pool.on('error', (error) => {
      console.error(JSON.stringify(sanitizePoolError(error)));
    });
  }

  return pool;
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