const DECIMAL_SCALE = 1_000_000n;

function parseScaledDecimal(value: string | null | undefined): bigint | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const [, sign, integer, fraction = ''] = match;
  const scaled = BigInt(integer) * DECIMAL_SCALE + BigInt(fraction.padEnd(6, '0').slice(0, 6) || '0');
  return sign === '-' ? -scaled : scaled;
}

export function sumDecimals(values: readonly string[]) {
  let total = 0n;
  for (const value of values) {
    const parsed = parseScaledDecimal(value);
    if (parsed !== null) total += parsed;
  }
  const negative = total < 0n;
  const absolute = negative ? -total : total;
  const integer = absolute / DECIMAL_SCALE;
  const fraction = String(absolute % DECIMAL_SCALE).padStart(6, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
}

export function numeric(value: string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function count(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '—';
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed)
    ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(parsed)
    : '—';
}

export function money(value: string | null | undefined, compact = false) {
  if (value === null || value === undefined || value === '') return '—';
  const parsed = numeric(value);
  if (compact && !parsed) return '0 ₫';
  return `${new Intl.NumberFormat('vi-VN', {
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 0,
  }).format(parsed)} ₫`;
}

export function percent(value: string | null | undefined) {
  return value ? `${value.replace('.', ',')}%` : '—';
}

export function dateLabel(value: string | null | undefined) {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}` : value;
}

export function generatedLabel(value: string | undefined) {
  if (!value) return 'Chưa có thời điểm cập nhật';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return `Cập nhật ${value}`;
  return `Cập nhật ${new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed)}`;
}
