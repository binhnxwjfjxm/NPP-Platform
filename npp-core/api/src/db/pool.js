import { Pool } from 'pg';

let sharedPool;
const DEFAULT_POOL_MAX = 10;
const MIN_POOL_MAX = 2;
const MAX_POOL_MAX = 30;

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

export function resolvePgPoolMax(config = {}) {
  const raw = config.databasePoolMax ?? process.env.DATABASE_POOL_MAX ?? DEFAULT_POOL_MAX;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < MIN_POOL_MAX || parsed > MAX_POOL_MAX) {
    throw new Error('invalid_database_pool_max');
  }
  return parsed;
}

export function snapshotPgPool(pool, max = DEFAULT_POOL_MAX) {
  const count = (value) => Number.isInteger(value) && value >= 0 ? value : 0;
  return Object.freeze({
    max,
    total: count(pool?.totalCount),
    idle: count(pool?.idleCount),
    waiting: count(pool?.waitingCount),
  });
}

function logPoolPressure(pool, max) {
  const state = snapshotPgPool(pool, max);
  if (state.waiting < 1) return;
  console.warn(JSON.stringify({
    event: 'database_pool_pressure',
    ...state,
  }));
}

export function createPgPool(config, PoolImplementation = Pool) {
  if (!config?.databaseUrl) throw new Error('missing_database_url');
  const max = resolvePgPoolMax(config);
  const pool = new PoolImplementation({
    connectionString: config.databaseUrl,
    ssl: buildSslConfig(config.databaseSslMode),
    max,
    idleTimeoutMillis: 30000,
  });

  if (typeof pool.on === 'function') {
    pool.on('error', (error) => {
      console.error(JSON.stringify(sanitizePoolError(error)));
    });
    pool.on('acquire', () => {
      logPoolPressure(pool, max);
    });
  }

  return pool;
}

export function getPool(config) {
  if (!sharedPool) sharedPool = createPgPool(config);
  return sharedPool;
}

export function getPoolState(config) {
  const pool = getPool(config);
  return snapshotPgPool(pool, resolvePgPoolMax(config));
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