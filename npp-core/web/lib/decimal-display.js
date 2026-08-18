export function formatExactDecimal(value) {
  const normalized = String(value ?? '0').trim();
  const match = /^(-?\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return normalized;
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  return fraction ? `${match[1]}.${fraction}` : match[1];
}

function parseExactDecimal(value) {
  const normalized = String(value ?? '').trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return null;
  const fraction = match[3] ?? '';
  const absolute = BigInt(`${match[2]}${fraction}` || '0');
  return {
    scaled: match[1] ? -absolute : absolute,
    scale: fraction.length,
  };
}

function scaleUp(value, fromScale, toScale) {
  return value * (10n ** BigInt(toScale - fromScale));
}

function formatScaled(value, scale) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const digits = absolute.toString().padStart(scale + 1, '0');
  const whole = scale === 0 ? digits : digits.slice(0, -scale);
  const fraction = scale === 0 ? '' : digits.slice(-scale).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function exactOperation(left, right, operation) {
  const parsedLeft = parseExactDecimal(left);
  const parsedRight = parseExactDecimal(right);
  if (!parsedLeft || !parsedRight) return null;
  const scale = Math.max(parsedLeft.scale, parsedRight.scale);
  const leftScaled = scaleUp(parsedLeft.scaled, parsedLeft.scale, scale);
  const rightScaled = scaleUp(parsedRight.scaled, parsedRight.scale, scale);
  return formatScaled(operation(leftScaled, rightScaled), scale);
}

export function addExactDecimal(left, right) {
  return exactOperation(left, right, (a, b) => a + b);
}

export function subtractExactDecimal(left, right) {
  return exactOperation(left, right, (a, b) => a - b);
}

export function formatSignedExactDecimal(value) {
  const formatted = formatExactDecimal(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(formatted)) return formatted;
  if (formatted.startsWith('-') || formatted === '0') return formatted;
  return `+${formatted}`;
}
