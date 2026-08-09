import pg from 'pg';
import { buildSslConfig } from '../src/db/pool.js';
import { loadInternalWorkforceAuthConfig } from '../src/internal-workforce-config.js';
import {
  reconcileSecurityOwners,
  setInternalUserCredential,
} from '../src/internal-workforce-auth.js';
import * as repo from '../src/db/repositories/internal-workforce-auth.js';

const { Pool } = pg;
const BOOTSTRAP_ACTOR = 'bootstrap:workforce-owner-credentials';

function required(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(`WORKFORCE_OWNER_BOOTSTRAP_MISSING_${name}`);
  return value;
}

function parseCredentials(raw, expectedEmails) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('WORKFORCE_OWNER_BOOTSTRAP_CREDENTIALS_JSON_INVALID');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('WORKFORCE_OWNER_BOOTSTRAP_CREDENTIALS_JSON_INVALID');
  }
  const normalized = new Map(
    Object.entries(parsed).map(([email, password]) => [String(email).trim().toLowerCase(), password]),
  );
  if (normalized.size !== expectedEmails.length || expectedEmails.some((email) => !normalized.has(email))) {
    throw new Error('WORKFORCE_OWNER_BOOTSTRAP_CREDENTIALS_MUST_MATCH_OWNER_EMAILS');
  }
  for (const email of expectedEmails) {
    const password = normalized.get(email);
    if (typeof password !== 'string' || password.length < 10 || password.length > 256) {
      throw new Error('WORKFORCE_OWNER_BOOTSTRAP_PASSWORD_INVALID');
    }
  }
  return normalized;
}

const connectionString = required('DATABASE_URL');
const installationId = required('INSTALLATION_ID');
const credentialsRaw = required('OWNER_BOOTSTRAP_CREDENTIALS_JSON');
const config = loadInternalWorkforceAuthConfig(process.env);

if (config.securityOwnerEmails.length !== 2 || config.implementationOwnerEmails.length !== 1) {
  throw new Error('WORKFORCE_OWNER_BOOTSTRAP_REQUIRES_2_PERMANENT_AND_1_TEMPORARY_OWNER');
}
const expectedEmails = [...config.securityOwnerEmails, ...config.implementationOwnerEmails];
const credentials = parseCredentials(credentialsRaw, expectedEmails);
const sslMode = String(process.env.DATABASE_SSL_MODE ?? 'require').trim().toLowerCase();
const pool = new Pool({
  connectionString,
  ssl: buildSslConfig(sslMode),
});

const client = await pool.connect();
try {
  await client.query('BEGIN');
  const reconciliation = await reconcileSecurityOwners(client, {
    repo,
    config,
    installationId,
    actorId: BOOTSTRAP_ACTOR,
  });
  if (!reconciliation.ok) throw new Error(reconciliation.code);

  const candidates = await repo.findOwnerCandidatesByEmails(client, {
    installationId,
    emails: expectedEmails,
  });
  const byEmail = new Map();
  for (const row of candidates) {
    const email = String(row.email).toLowerCase();
    const rows = byEmail.get(email) ?? [];
    rows.push(row);
    byEmail.set(email, rows);
  }

  for (const email of expectedEmails) {
    const rows = byEmail.get(email) ?? [];
    if (rows.length !== 1 || !rows[0].user_is_active || !rows[0].employee_is_active) {
      throw new Error('WORKFORCE_OWNER_BOOTSTRAP_IDENTITY_NOT_UNIQUE_ACTIVE');
    }
    const result = await setInternalUserCredential(client, {
      repo,
      installationId,
      userId: rows[0].user_id,
      password: credentials.get(email),
      actorId: BOOTSTRAP_ACTOR,
      allowSecurityOwnerMutation: true,
    });
    if (!result.ok) throw new Error(result.code);
  }

  await client.query('COMMIT');
  console.log(JSON.stringify({
    event: 'workforce_owner_credentials_bootstrapped',
    ownerCount: expectedEmails.length,
    permanentOwnerCount: config.securityOwnerEmails.length,
    temporaryOwnerCount: config.implementationOwnerEmails.length,
  }));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
