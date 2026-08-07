import { createHash } from 'node:crypto';

export const SCALE_12 = 1_000_000_000_000n;
export const METHOD_VERSION = 'MWA_V1';
export const CURRENCY_CODE = 'VND';
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export const failure = (code, message, details = {}, retryable = false) =>
  Object.freeze({ ok: false, code, message, details, retryable });

export function actorId(context) {
  return String(context?.actorId ?? context?.principalId ?? context?.subject ?? 'system').slice(0, 128);
}

export function warehouseIds(context) {
  return [...new Set((context?.scopes?.warehouseIds ?? [])
    .filter((value) => typeof value === 'string' && UUID_PATTERN.test(value.trim()))
    .map((value) => value.trim()))].sort();
}

export function parse12(value) {
  const match = /^(-?)(\d+)(?:\.(\d{1,12}))?$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const absolute = BigInt(match[2]) * SCALE_12
    + BigInt((match[3] ?? '').padEnd(12, '0'));
  return match[1] ? -absolute : absolute;
}

export function format12(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / SCALE_12}.${String(absolute % SCALE_12).padStart(12, '0')}`;
}

export function multiply12(left, right) {
  const negative = (left < 0n) !== (right < 0n);
  const a = left < 0n ? -left : left;
  const b = right < 0n ? -right : right;
  const result = (a * b + SCALE_12 / 2n) / SCALE_12;
  return negative ? -result : result;
}

export function divide12(numerator, denominator) {
  if (denominator === 0n) return null;
  const negative = (numerator < 0n) !== (denominator < 0n);
  const a = numerator < 0n ? -numerator : numerator;
  const b = denominator < 0n ? -denominator : denominator;
  const result = (a * SCALE_12 + b / 2n) / b;
  return negative ? -result : result;
}

function canonicalize(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

export function hashPayload(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

export function monthBounds(periodStart) {
  const match = /^(\d{4})-(\d{2})-01$/.exec(String(periodStart ?? ''));
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return null;
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]), 1));
  const end = new Date(next.getTime() - 86_400_000);
  return {
    start: `${match[1]}-${match[2]}-01`,
    end: end.toISOString().slice(0, 10),
  };
}

export function allocateLargestRemainder(totalValue, basis, targets) {
  const total = parse12(totalValue);
  if (total === null || total === 0n) {
    return failure('INVALID_TOTAL_VALUE', 'totalValue must be non-zero with at most 12 decimals');
  }
  if (!['PURCHASE_VALUE', 'BASE_QUANTITY'].includes(basis)) {
    return failure(
      'INVALID_ALLOCATION_BASIS',
      'allocationBasis must be PURCHASE_VALUE or BASE_QUANTITY',
    );
  }
  if (!Array.isArray(targets) || targets.length === 0) {
    return failure('INVALID_ALLOCATION_TARGETS', 'targets must be non-empty');
  }
  const rows = [];
  let weightTotal = 0n;
  for (const target of targets) {
    const receiptLineId = String(target.receiptLineId ?? '').trim();
    const weight = parse12(
      basis === 'PURCHASE_VALUE' ? target.purchaseValue : target.baseQuantity,
    );
    if (!UUID_PATTERN.test(receiptLineId) || weight === null || weight <= 0n) {
      return failure(
        'INVALID_ALLOCATION_TARGET',
        'Each target needs receiptLineId and positive selected basis',
      );
    }
    rows.push({ ...target, receiptLineId, weight });
    weightTotal += weight;
  }
  const sign = total < 0n ? -1n : 1n;
  const absolute = total < 0n ? -total : total;
  let allocated = 0n;
  for (const row of rows) {
    const numerator = absolute * row.weight;
    row.amount = numerator / weightTotal;
    row.remainder = numerator % weightTotal;
    allocated += row.amount;
  }
  let residual = absolute - allocated;
  rows.sort((a, b) => a.remainder === b.remainder
    ? a.receiptLineId.localeCompare(b.receiptLineId)
    : (a.remainder > b.remainder ? -1 : 1));
  for (let i = 0; residual > 0n; i = (i + 1) % rows.length) {
    rows[i].amount += 1n;
    residual -= 1n;
  }
  return {
    ok: true,
    allocations: rows
      .sort((a, b) => a.receiptLineId.localeCompare(b.receiptLineId))
      .map(({ weight, amount, remainder, ...row }) => ({
        ...row,
        valueDelta: format12(amount * sign),
      })),
  };
}
