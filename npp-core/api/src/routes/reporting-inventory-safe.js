import {
  inventoryReport as inventoryReportUnsafe,
  normalizeSlowDays,
} from './reporting-inventory.js';

const PLACEHOLDER_PATTERN = /\$(\d+)/g;

export function compactReportingQueryBindings(sql, values = []) {
  const referenced = [...new Set([...String(sql).matchAll(PLACEHOLDER_PATTERN)].map((match) => Number(match[1])))]
    .sort((left, right) => left - right);
  for (const number of referenced) {
    if (!Number.isInteger(number) || number < 1 || values.length < number) {
      const error = new Error(`reporting_query_binding_missing:${number}:${values.length}`);
      error.code = 'REPORTING_QUERY_BINDING_MISSING';
      throw error;
    }
  }
  const indexByOriginal = new Map(referenced.map((number, index) => [number, index + 1]));
  const rewrittenSql = String(sql).replace(PLACEHOLDER_PATTERN, (_match, rawNumber) => `$${indexByOriginal.get(Number(rawNumber))}`);
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
});
