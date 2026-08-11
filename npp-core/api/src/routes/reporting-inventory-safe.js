import {
  inventoryReport as inventoryReportUnsafe,
  normalizeSlowDays,
} from './reporting-inventory.js';

const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/;
const DOLLAR_QUOTE_START = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

function reportingPlaceholderTokens(sql) {
  const source = String(sql);
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === "'") {
      index += 1;
      while (index < source.length) {
        if (source[index] === "'" && source[index + 1] === "'") { index += 2; continue; }
        if (source[index] === "'") { index += 1; break; }
        index += 1;
      }
      continue;
    }
    if (char === '"') {
      index += 1;
      while (index < source.length) {
        if (source[index] === '"' && source[index + 1] === '"') { index += 2; continue; }
        if (source[index] === '"') { index += 1; break; }
        index += 1;
      }
      continue;
    }
    if (char === '-' && source[index + 1] === '-') {
      const newline = source.indexOf('\n', index + 2);
      index = newline === -1 ? source.length : newline + 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      let depth = 1;
      index += 2;
      while (index < source.length && depth > 0) {
        if (source[index] === '/' && source[index + 1] === '*') { depth += 1; index += 2; continue; }
        if (source[index] === '*' && source[index + 1] === '/') { depth -= 1; index += 2; continue; }
        index += 1;
      }
      continue;
    }
    if (char !== '$') { index += 1; continue; }
    const previous = index > 0 ? source[index - 1] : '';
    if (previous && IDENTIFIER_CHAR.test(previous)) { index += 1; continue; }
    const dollarQuote = source.slice(index).match(DOLLAR_QUOTE_START);
    if (dollarQuote) {
      const delimiter = dollarQuote[0];
      const end = source.indexOf(delimiter, index + delimiter.length);
      index = end === -1 ? source.length : end + delimiter.length;
      continue;
    }
    const placeholder = source.slice(index).match(/^\$(\d+)/);
    if (!placeholder) { index += 1; continue; }
    const number = Number(placeholder[1]);
    tokens.push({ start: index, end: index + placeholder[0].length, number });
    index += placeholder[0].length;
  }
  return tokens;
}

export function compactReportingQueryBindings(sql, values = []) {
  const source = String(sql);
  const tokens = reportingPlaceholderTokens(source);
  const referenced = [...new Set(tokens.map((token) => token.number))].sort((left, right) => left - right);
  for (const number of referenced) {
    if (!Number.isInteger(number) || number < 1 || values.length < number) {
      const error = new Error(`reporting_query_binding_missing:${number}:${values.length}`);
      error.code = 'REPORTING_QUERY_BINDING_MISSING';
      throw error;
    }
  }
  const indexByOriginal = new Map(referenced.map((number, index) => [number, index + 1]));
  let cursor = 0;
  let rewrittenSql = '';
  for (const token of tokens) {
    rewrittenSql += source.slice(cursor, token.start);
    rewrittenSql += `$${indexByOriginal.get(token.number)}`;
    cursor = token.end;
  }
  rewrittenSql += source.slice(cursor);
  return Object.freeze({
    sql: rewrittenSql,
    values: Object.freeze(referenced.map((number) => values[number - 1])),
  });
}

export function exactReportingQueryValues(sql, values = []) {
  return [...compactReportingQueryBindings(sql, values).values];
}

function exactBindingAdapter(adapter) {
  if (!adapter || typeof adapter.query !== 'function') {
    throw new Error('invalid_reporting_adapter');
  }
  return Object.freeze({
    query(sql, values = []) {
      const compacted = compactReportingQueryBindings(sql, values);
      return adapter.query(compacted.sql, [...compacted.values]);
    },
  });
}

export function inventoryReport(adapter, ...args) {
  return inventoryReportUnsafe(exactBindingAdapter(adapter), ...args);
}

export { normalizeSlowDays };

export const reportingInventoryBindingInternals = Object.freeze({
  compactReportingQueryBindings,
  exactReportingQueryValues,
  exactBindingAdapter,
  reportingPlaceholderTokens,
});
