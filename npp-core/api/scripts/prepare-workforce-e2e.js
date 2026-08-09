import pg from 'pg';
import { hashInternalPassword } from '../src/internal-workforce-auth.js';

const { Pool } = pg;
const E2E_ACTOR = 'e2e:workforce-auth';

function required(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(`WORKFORCE_E2E_MISSING_${name}`);
  return value;
}

function assertEphemeralDatabase(connectionString) {
  if (process.env.NODE_ENV !== 'test') throw new Error('WORKFORCE_E2E_TEST_ENV_REQUIRED');
  const hostname = new URL(connectionString).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    throw new Error('WORKFORCE_E2E_EPHEMERAL_DATABASE_REQUIRED');
  }
}

const connectionString = required('DATABASE_URL');
assertEphemeralDatabase(connectionString);
const installationId = required('INSTALLATION_ID');
const employeeId = required('E2E_WORKFORCE_EMPLOYEE_ID');
const userId = required('E2E_WORKFORCE_USER_ID');
const loginName = required('E2E_WORKFORCE_LOGIN');
const password = required('E2E_WORKFORCE_PASSWORD');
const passwordHash = await hashInternalPassword(password);
const sslMode = String(process.env.DATABASE_SSL_MODE ?? 'disable').trim().toLowerCase();
const pool = new Pool({
  connectionString,
  ssl: sslMode === 'require' ? { rejectUnauthorized: false } : false,
});

const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO shared.employees (
       id, installation_id, code, full_name, job_title, phone, email, branch_id,
       is_active, created_at, updated_at, created_by, updated_by
     ) VALUES ($1, $2, 'E2E_AUTH', 'E2E Workforce User', 'Automated Test', NULL,
       'e2e-workforce@example.test', NULL, true, now(), now(), $3, $3)
     ON CONFLICT (id) DO UPDATE
     SET full_name = EXCLUDED.full_name,
         job_title = EXCLUDED.job_title,
         email = EXCLUDED.email,
         branch_id = NULL,
         is_active = true,
         updated_at = now(),
         updated_by = EXCLUDED.updated_by`,
    [employeeId, installationId, E2E_ACTOR],
  );
  await client.query(
    `INSERT INTO shared.users (
       id, installation_id, employee_id, login_name, is_active,
       created_at, updated_at, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, true, now(), now(), $5, $5)
     ON CONFLICT (id) DO UPDATE
     SET is_active = true,
         updated_at = now(),
         updated_by = EXCLUDED.updated_by`,
    [userId, installationId, employeeId, loginName, E2E_ACTOR],
  );
  await client.query(
    `INSERT INTO shared.user_credentials (
       installation_id, user_id, password_hash, failed_attempts, locked_until,
       created_at, updated_at, created_by, updated_by
     ) VALUES ($1, $2, $3, 0, NULL, now(), now(), $4, $4)
     ON CONFLICT (installation_id, user_id) DO UPDATE
     SET password_hash = EXCLUDED.password_hash,
         failed_attempts = 0,
         locked_until = NULL,
         updated_at = now(),
         updated_by = EXCLUDED.updated_by`,
    [installationId, userId, passwordHash, E2E_ACTOR],
  );
  await client.query(
    `INSERT INTO shared.security_owner_bindings (
       installation_id, user_id, owner_kind, created_at, updated_at, created_by, updated_by
     ) VALUES ($1, $2, 'TEMPORARY', now(), now(), $3, $3)
     ON CONFLICT (installation_id, user_id) DO UPDATE
     SET owner_kind = 'TEMPORARY',
         updated_at = now(),
         updated_by = EXCLUDED.updated_by`,
    [installationId, userId, E2E_ACTOR],
  );
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
