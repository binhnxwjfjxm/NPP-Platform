import { createHash } from 'node:crypto';
import { createIdempotencyKey, IDEMPOTENCY_KEY_PATTERN } from '@npp/contracts';

function deterministicUuid(seed) {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 32);
  const variant = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function deriveIdempotencyKey(operation, seed) {
  const normalizedSeed = String(seed ?? '').trim();
  if (!normalizedSeed) throw new Error('idempotency_seed_required');
  const key = createIdempotencyKey(
    operation,
    deterministicUuid(`${String(operation ?? '')}\u0000${normalizedSeed}`),
  );
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) throw new Error('idempotency_key_generation_failed');
  return key;
}
