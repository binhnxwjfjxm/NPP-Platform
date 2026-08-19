import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REHEARSAL_CONFIRM_ENV,
  REHEARSAL_CONFIRM_VALUE,
  runMigrationRehearsal,
} from './rehearse-migrations.js';

const __filename = fileURLToPath(import.meta.url);
const CLIENT_INSTALLER = fileURLToPath(new URL('./install-postgresql-client-17.sh', import.meta.url));
const POSTGRESQL_17_BIN = '/usr/lib/postgresql/17/bin';
const POSTGRESQL_17_DUMP = `${POSTGRESQL_17_BIN}/pg_dump`;
export const POSTGRES_CLIENT_INSTALL_TIMEOUT_MS = 6 * 60 * 1000;

function isTruthy(value) {
  return ['1', 'true', 'yes'].includes(String(value ?? '').trim().toLowerCase());
}

export function isSafeEphemeralCiTarget(env = process.env) {
  if (!isTruthy(env.CI)) return false;
  if (String(env.NODE_ENV ?? '').trim().toLowerCase() !== 'test') return false;

  let url;
  try {
    url = new URL(String(env.DATABASE_URL ?? ''));
  } catch {
    return false;
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) return false;
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) return false;
  return decodeURIComponent(url.pathname.slice(1)) === 'rehearsal_npp_core';
}

export function postgresClientMajor(versionText) {
  const match = String(versionText ?? '').match(/\b(\d+)(?:\.\d+)?\b/);
  return match ? Number(match[1]) : null;
}

export function shouldInstallPostgres17Client(env, versionText) {
  return isSafeEphemeralCiTarget(env) && postgresClientMajor(versionText) !== 17;
}

export function buildRehearsalEnv(env = process.env) {
  const result = { ...env };
  if (isSafeEphemeralCiTarget(result)) {
    if (!result[REHEARSAL_CONFIRM_ENV]) result[REHEARSAL_CONFIRM_ENV] = REHEARSAL_CONFIRM_VALUE;
    const currentPath = String(result.PATH ?? '');
    result.PATH = currentPath.startsWith(`${POSTGRESQL_17_BIN}:`)
      ? currentPath
      : `${POSTGRESQL_17_BIN}:${currentPath}`;
  }
  return result;
}

export function ensureCompatiblePostgresClient(env = process.env, spawnCommand = spawnSync) {
  if (!isSafeEphemeralCiTarget(env)) return Object.freeze({ installed: false, reason: 'target_not_whitelisted' });

  const current = spawnCommand(POSTGRESQL_17_DUMP, ['--version'], { env, encoding: 'utf8' });
  const versionText = current.status === 0 ? current.stdout : '';
  if (!shouldInstallPostgres17Client(env, versionText)) {
    return Object.freeze({ installed: false, reason: 'client_17_available' });
  }

  const installation = spawnCommand('bash', [CLIENT_INSTALLER], {
    env,
    stdio: 'inherit',
    timeout: POSTGRES_CLIENT_INSTALL_TIMEOUT_MS,
    killSignal: 'SIGTERM',
  });
  if (installation.error?.code === 'ETIMEDOUT' || installation.signal === 'SIGTERM') {
    const error = new Error('PostgreSQL 17 client installation timed out for the whitelisted CI rehearsal target');
    error.code = 'postgresql_client_17_install_timeout';
    throw error;
  }
  if (installation.error || installation.status !== 0) {
    const error = new Error('PostgreSQL 17 client installation failed for the whitelisted CI rehearsal target');
    error.code = 'postgresql_client_17_install_failed';
    throw error;
  }

  const verified = spawnCommand(POSTGRESQL_17_DUMP, ['--version'], { env, encoding: 'utf8' });
  if (verified.status !== 0 || postgresClientMajor(verified.stdout) !== 17) {
    const error = new Error('PostgreSQL 17 client verification failed after installation');
    error.code = 'postgresql_client_17_verification_failed';
    throw error;
  }
  return Object.freeze({ installed: true, reason: 'client_17_installed' });
}

export async function runConfirmedMigrationRehearsal(env = process.env) {
  const rehearsalEnv = buildRehearsalEnv(env);
  ensureCompatiblePostgresClient(rehearsalEnv);
  return runMigrationRehearsal({ env: rehearsalEnv });
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMainModule) {
  try {
    const report = await runConfirmedMigrationRehearsal();
    process.stdout.write(`${JSON.stringify({ status: report.status, report: 'migration-rehearsal-report.json' })}\n`);
  } catch (error) {
    process.stderr.write(`${error.code || 'rehearsal_failed'}\n`);
    process.exitCode = 1;
  }
}
