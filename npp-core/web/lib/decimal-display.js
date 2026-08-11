export function formatExactDecimal(value) {
  const normalized = String(value ?? '0').trim();
  const match = /^(-?\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return normalized;
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  return fraction ? `${match[1]}.${fraction}` : match[1];
}
