function text(value) {
  return String(value ?? '').trim();
}

function parseBoolean(value, defaultValue = false) {
  const normalized = text(value).toLowerCase();
  if (!normalized) return defaultValue;
  if (['1', 'true', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'no'].includes(normalized)) return false;
  throw new Error('INTERNAL_AUTH_BOOLEAN_CONFIG_INVALID');
}

function parsePositiveInteger(value, fallback, min, max, code) {
  const raw = text(value);
  const parsed = raw ? Number(raw) : fallback;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(code);
  return parsed;
}

function normalizeEmailList(value) {
  const emails = [...new Set(text(value).split(',').map((item) => item.trim().toLowerCase()).filter(Boolean))];
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (emails.some((email) => email.length > 256 || !pattern.test(email))) {
    throw new Error('INTERNAL_AUTH_OWNER_EMAIL_INVALID');
  }
  return Object.freeze(emails);
}

export function loadInternalWorkforceAuthConfig(env = process.env) {
  const nodeEnv = text(env.NODE_ENV) || 'development';
  const enabled = parseBoolean(env.INTERNAL_AUTH_ENABLED, false);
  const sessionTtlSeconds = parsePositiveInteger(
    env.INTERNAL_SESSION_TTL_SECONDS,
    28_800,
    300,
    86_400,
    'INTERNAL_SESSION_TTL_INVALID',
  );
  const configuredWebOwnerChallengeRequired = parseBoolean(env.INTERNAL_WEB_OWNER_CHALLENGE_REQUIRED, true);
  // Every production Owner is a privileged account and must pass the Web/PWA challenge.
  // Role-level challenge policy remains independent for non-Owner workforce users.
  const webOwnerChallengeRequired = nodeEnv === 'production' ? true : configuredWebOwnerChallengeRequired;
  const allowFixedOwnerCode = parseBoolean(env.ALLOW_FIXED_OWNER_CODE, false);
  const testCode = text(env.SECURITY_OWNER_TEST_CODE);
  const securityOwnerEmails = normalizeEmailList(env.SECURITY_OWNER_EMAILS);
  const implementationOwnerEmails = normalizeEmailList(env.IMPLEMENTATION_OWNER_EMAILS);

  if (nodeEnv === 'production' && allowFixedOwnerCode) {
    throw new Error('INTERNAL_AUTH_FIXED_OWNER_CODE_FORBIDDEN_IN_PRODUCTION');
  }
  if (allowFixedOwnerCode && (testCode.length < 6 || testCode.length > 64)) {
    throw new Error('INTERNAL_AUTH_FIXED_OWNER_CODE_INVALID');
  }
  const permanent = new Set(securityOwnerEmails);
  if (implementationOwnerEmails.some((email) => permanent.has(email))) {
    throw new Error('INTERNAL_AUTH_OWNER_EMAIL_OVERLAP');
  }

  return Object.freeze({
    enabled,
    nodeEnv,
    sessionTtlSeconds,
    webOwnerChallengeRequired,
    allowFixedOwnerCode,
    testCode,
    securityOwnerEmails,
    implementationOwnerEmails,
  });
}

export function safeInternalWorkforceAuthConfig(config) {
  return Object.freeze({
    enabled: Boolean(config.enabled),
    sessionTtlSeconds: Number(config.sessionTtlSeconds),
    webOwnerChallengeRequired: Boolean(config.webOwnerChallengeRequired),
    fixedOwnerCodeEnabled: Boolean(config.allowFixedOwnerCode),
    permanentOwnerCount: config.securityOwnerEmails?.length ?? 0,
    temporaryOwnerCount: config.implementationOwnerEmails?.length ?? 0,
  });
}
