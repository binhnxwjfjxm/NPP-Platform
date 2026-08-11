import {
  inventoryReport as inventoryReportUnsafe,
  normalizeSlowDays,
} from './reporting-inventory.js';

const PLACEHOLDER_PATTERN = /\$(\d+)/g;

export function exactReportingQueryValues(sql, values = []) {
  let highest = 0;
  for (const match of String(sql).matchAll(PLACEHOLDER_PATTERN)) {
    highest = Math.max(highest, Number(match[1]));
  }
  if (values.length < highest) {
    const error = new Error(`reporting_query_binding_missing:${highest}:${values.length}`);
    error.code = 'REPORTING_QUERY_BINDING_MISSING';
    throw error;
  }
  return values.slice(0, highest);
}

function exactBindingAdapter(adapter) {
  if (!adapter || typeof adapter.query !== 'function') {
    throw new Error('invalid_reporting_adapter');
  }
  return Object.freeze({
    query(sql, values = []) {
      return adapter.query(sql, exactReportingQueryValues(sql, values));
    },
  });
}

export function inventoryReport(adapter, ...args) {
  return inventoryReportUnsafe(exactBindingAdapter(adapter), ...args);
}

export { normalizeSlowDays };

export const reportingInventoryBindingInternals = Object.freeze({
  exactReportingQueryValues,
  exactBindingAdapter,
});
