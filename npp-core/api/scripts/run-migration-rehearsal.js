import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REHEARSAL_CONFIRM_ENV,
  REHEARSAL_CONFIRM_VALUE,
  runMigrationRehearsal,
} from './rehearse-migrations.js';

const __filename = fileURLToPath(import.meta.url);

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

export function buildRehearsalEnv(env = process.env) {
  const result = { ...env };
  if (!result[REHEARSAL_CONFIRM_ENV] && isSafeEphemeralCiTarget(result)) {
    result[REHEARSAL_CONFIRM_ENV] = REHEARSAL_CONFIRM_VALUE;
  }
  return result;
}

export async function runConfirmedMigrationRehearsal(env = process.env) {
  return runMigrationRehearsal({ env: buildRehearsalEnv(env) });
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
