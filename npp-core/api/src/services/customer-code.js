const GENERATED_CODE_PREFIX = 'KH';
const GENERATED_CODE_MIN_DIGITS = 6;
const GENERATED_CODE_MAX = 999999999999;

export async function createCustomerCodeAllocator(client, { installationId, reservedCodes = new Set() }) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`customer-code:${installationId}`]);
  const result = await client.query(
    `SELECT COALESCE(MAX((substring(code from 3))::bigint), 0)::bigint AS max_number
       FROM shared.customers
      WHERE installation_id = $1
        AND code ~ '^KH[0-9]{6,12}$'`,
    [installationId],
  );
  let next = Number(result.rows[0]?.max_number ?? 0) + 1;

  return async function allocateCustomerCode() {
    while (next <= GENERATED_CODE_MAX) {
      const candidate = `${GENERATED_CODE_PREFIX}${String(next).padStart(GENERATED_CODE_MIN_DIGITS, '0')}`;
      next += 1;
      if (reservedCodes.has(candidate)) continue;
      const existing = await client.query(
        `SELECT 1
           FROM shared.customers
          WHERE installation_id = $1 AND code = $2
          LIMIT 1`,
        [installationId, candidate],
      );
      if (!existing.rows[0]) return candidate;
    }
    throw Object.assign(new Error('CUSTOMER_CODE_EXHAUSTED'), { code: 'CUSTOMER_CODE_EXHAUSTED' });
  };
}
