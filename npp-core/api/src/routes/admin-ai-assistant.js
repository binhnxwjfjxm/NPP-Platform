import { BUSINESS_TIMEZONE, mapRow, mapRows, reportingInternals } from './reporting-common.js';

const SCALE = 1_000_000n;
const PERCENT_SCALE = 10_000n;

function shiftDate(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function previousPeriod(filters) {
  const dayCount = reportingInternals.reportingRangeDays(filters.from, filters.to);
  const from = shiftDate(filters.from, -dayCount);
  const to = shiftDate(filters.from, -1);
  return Object.freeze({ from, to, fromInstant: reportingInternals.toInstant(from), toExclusiveInstant: filters.fromInstant, dayCount });
}

function decimal6(value) {
  const normalized = String(value ?? '0').trim();
  const match = normalized.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw Object.assign(new Error('sales_report_invalid_decimal'), { code: 'SALES_REPORT_INVALID_DECIMAL' });
  const fraction = `${match[3] ?? ''}000000`.slice(0, 6);
  const scaled = BigInt(match[2]) * SCALE + BigInt(fraction || '0');
  return match[1] ? -scaled : scaled;
}

function decimalText(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE;
  const fraction = String(absolute % SCALE).padStart(6, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function roundedDivide(numerator, denominator) {
  if (denominator === 0n) return null;
  const negative = (numerator < 0n) !== (denominator < 0n);
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const rounded = (n + (d / 2n)) / d;
  return negative ? -rounded : rounded;
}

function percentText(numerator, denominator) {
  if (denominator === 0n) return null;
  const scaled = roundedDivide(numerator * 100n * PERCENT_SCALE, denominator);
  if (scaled === null) return null;
  const negative = scaled < 0n;
  const absolute = negative ? -scaled : scaled;
  const whole = absolute / PERCENT_SCALE;
  const fraction = String(absolute % PERCENT_SCALE).padStart(4, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function text(value, fallback = '') { const normalized = String(value ?? '').trim(); return normalized || fallback; }
function identity(value, fallback) { const normalized = text(value); return normalized || fallback; }
function unitOf(fact) { return Object.freeze({ id: text(fact.unitId) || null, code: text(fact.unitCode, 'Không xác định'), name: text(fact.unitName, text(fact.unitCode, 'Không xác định')) }); }
function currentFacts(facts) { return facts.filter((fact) => fact.period === 'current'); }

function dimensionDefinition(key) {
  const definitions = {
    customers: (fact) => ({ id: fact.customerId, code: fact.customerCode, name: fact.customerName, source: 'order-snapshot' }),
    customerGroups: (fact) => ({ id: fact.customerGroupId, code: fact.customerGroupCode, name: fact.customerGroupName, source: fact.customerGroupSource }),
    channels: (fact) => ({ id: fact.salesChannelId, code: fact.salesChannelCode, name: fact.salesChannelName, source: fact.salesChannelId ? 'order-snapshot' : 'unavailable' }),
    products: (fact) => ({ id: fact.variantId, code: fact.sku, name: fact.itemName, source: 'order-line-snapshot' }),
    productGroups: (fact) => ({ id: fact.productGroupId, code: fact.productGroupCode, name: fact.productGroupName, source: fact.productGroupSource }),
    employees: (fact) => ({ id: fact.employeeId, code: fact.employeeCode, name: fact.employeeName, source: fact.employeeSource }),
  };
  return definitions[key];
}

function breakdown(facts, key) {
  const select = dimensionDefinition(key);
  const grouped = new Map();
  const currentDenominators = new Map();
  for (const fact of facts) {
    const dimension = select(fact);
    const unit = unitOf(fact);
    const entityIdentity = identity(dimension.id, `${text(dimension.code)}|${text(dimension.name, 'Không xác định')}`);
    const unitIdentity = identity(unit.id, unit.code);
    const groupKey = `${entityIdentity}|${text(fact.currencyCode)}|${unitIdentity}`;
    const revenue = decimal6(fact.lineTotal);
    const quantity = decimal6(fact.orderedQuantity);
    const existing = grouped.get(groupKey) ?? { id: text(dimension.id) || null, code: text(dimension.code) || null, name: text(dimension.name, 'Không xác định'), source: text(dimension.source, 'unavailable'), currencyCode: text(fact.currencyCode, 'VND'), unit, currentRevenue: 0n, currentQuantity: 0n, previousRevenue: 0n, previousQuantity: 0n, hasCurrent: false };
    if (fact.period === 'current') {
      existing.currentRevenue += revenue;
      existing.currentQuantity += quantity;
      existing.hasCurrent = true;
      existing.id = text(dimension.id) || existing.id;
      existing.code = text(dimension.code) || existing.code;
      existing.name = text(dimension.name, existing.name);
      existing.source = text(dimension.source, existing.source);
      const denominatorKey = `${existing.currencyCode}|${unitIdentity}`;
      currentDenominators.set(denominatorKey, (currentDenominators.get(denominatorKey) ?? 0n) + revenue);
    } else {
      existing.previousRevenue += revenue;
      existing.previousQuantity += quantity;
    }
    grouped.set(groupKey, existing);
  }
  return Object.freeze([...grouped.values()].sort((left, right) => {
    if (left.hasCurrent !== right.hasCurrent) return left.hasCurrent ? -1 : 1;
    if (left.currentRevenue !== right.currentRevenue) return left.currentRevenue > right.currentRevenue ? -1 : 1;
    return left.name.localeCompare(right.name, 'vi');
  }).map((row) => {
    const unitIdentity = identity(row.unit.id, row.unit.code);
    const denominator = currentDenominators.get(`${row.currencyCode}|${unitIdentity}`) ?? 0n;
    return Object.freeze({
      id: row.id, code: row.code, name: row.name, source: row.source, currencyCode: row.currencyCode,
      revenue: decimalText(row.currentRevenue), quantity: decimalText(row.currentQuantity), unit: row.unit,
      sharePercent: percentText(row.currentRevenue, denominator) ?? '0',
      previousRevenue: decimalText(row.previousRevenue), previousQuantity: decimalText(row.previousQuantity),
      changePercent: row.previousRevenue === 0n ? null : percentText(row.currentRevenue - row.previousRevenue, row.previousRevenue),
      comparisonState: row.previousRevenue === 0n && row.currentRevenue > 0n ? 'new' : row.currentRevenue === 0n && row.previousRevenue > 0n ? 'inactive' : 'comparable',
    });
  }));
}

function revenueSummary(facts) {
  const totals = new Map(); const orderSets = new Map();
  for (const fact of facts) {
    const currency = text(fact.currencyCode, 'VND');
    const row = totals.get(currency) ?? { current: 0n, previous: 0n };
    row[fact.period] += decimal6(fact.lineTotal); totals.set(currency, row);
    if (fact.period === 'current') { const orders = orderSets.get(currency) ?? new Set(); orders.add(text(fact.salesOrderId)); orderSets.set(currency, orders); }
  }
  return Object.freeze([...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currencyCode, value]) => Object.freeze({ currencyCode, revenue: decimalText(value.current), previousRevenue: decimalText(value.previous), changePercent: value.previous === 0n ? null : percentText(value.current - value.previous, value.previous), documentCount: String(orderSets.get(currencyCode)?.size ?? 0) })));
}

function quantitySummary(facts) {
  const totals = new Map();
  for (const fact of facts) {
    const unit = unitOf(fact); const key = `${text(fact.currencyCode)}|${identity(unit.id, unit.code)}`;
    const row = totals.get(key) ?? { currencyCode: text(fact.currencyCode, 'VND'), unit, current: 0n, previous: 0n };
    row[fact.period] += decimal6(fact.orderedQuantity); totals.set(key, row);
  }
  return Object.freeze([...totals.values()].sort((a, b) => `${a.currencyCode}|${a.unit.code}`.localeCompare(`${b.currencyCode}|${b.unit.code}`)).map((row) => Object.freeze({ currencyCode: row.currencyCode, unit: row.unit, quantity: decimalText(row.current), previousQuantity: decimalText(row.previous), changePercent: row.previous === 0n ? null : percentText(row.current - row.previous, row.previous) })));
}

function dailyTrend(facts, dayCount) {
  const totals = new Map();
  for (const fact of facts) { const key = `${fact.businessDate}|${fact.currencyCode}`; totals.set(key, (totals.get(key) ?? 0n) + decimal6(fact.lineTotal)); }
  const currentDates = new Set(facts.filter((fact) => fact.period === 'current').map((fact) => `${fact.businessDate}|${fact.currencyCode}`));
  return Object.freeze([...currentDates].map((key) => {
    const separator = key.indexOf('|'); const businessDate = key.slice(0, separator); const currencyCode = key.slice(separator + 1); const previousDate = shiftDate(businessDate, -dayCount);
    const revenue = totals.get(key) ?? 0n; const previousRevenue = totals.get(`${previousDate}|${currencyCode}`) ?? 0n;
    return Object.freeze({ businessDate, currencyCode, revenue: decimalText(revenue), totalValue: decimalText(revenue), previousRevenue: decimalText(previousRevenue), changePercent: previousRevenue === 0n ? null : percentText(revenue - previousRevenue, previousRevenue) });
  }).sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.currencyCode.localeCompare(b.currencyCode)));
}

function reconciliation(facts) {
  const orders = new Map();
  for (const fact of currentFacts(facts)) {
    const id = text(fact.salesOrderId);
    const row = orders.get(id) ?? { orderNumber: text(fact.orderNumber, id), currencyCode: text(fact.currencyCode), versionTotal: decimal6(fact.versionTotal), lineTotal: 0n };
    row.lineTotal += decimal6(fact.lineTotal); orders.set(id, row);
  }
  const mismatches = [...orders.entries()].flatMap(([salesOrderId, row]) => row.versionTotal === row.lineTotal ? [] : [Object.freeze({ salesOrderId, orderNumber: row.orderNumber, currencyCode: row.currencyCode, versionTotal: decimalText(row.versionTotal), lineTotal: decimalText(row.lineTotal) })]);
  if (mismatches.length) throw Object.assign(new Error('sales_report_reconciliation_failed'), { code: 'SALES_REPORT_RECONCILIATION_FAILED', details: { mismatchCount: mismatches.length, mismatches: mismatches.slice(0, 20) } });
  return Object.freeze({ ok: true, checkedOrderCount: String(orders.size), mismatchCount: '0', mismatches: Object.freeze([]) });
}

function quality(facts) {
  const current = currentFacts(facts);
  const customerGroupLegacyFallbackCount = current.filter((row) => row.customerGroupSource !== 'snapshot').length;
  const productGroupLegacyFallbackCount = current.filter((row) => row.productGroupSource !== 'snapshot').length;
  const unitNameLegacyFallbackCount = current.filter((row) => row.unitNameSource !== 'snapshot').length;
  const unattributedEmployeeCount = current.filter((row) => row.employeeSource === 'unavailable').length;
  const warnings = [];
  if (customerGroupLegacyFallbackCount) warnings.push('Một phần đơn cũ chưa có ảnh chụp Loại khách; báo cáo đang ghi rõ phần dùng danh mục hiện tại để tham chiếu.');
  if (productGroupLegacyFallbackCount) warnings.push('Một phần dòng hàng cũ chưa có ảnh chụp Nhóm hàng; báo cáo đang ghi rõ phần dùng danh mục hiện tại để tham chiếu.');
  if (unitNameLegacyFallbackCount) warnings.push('Một phần dòng hàng cũ chưa có tên ĐVT lịch sử; báo cáo đang ghi rõ phần dùng tên ĐVT hiện tại để tham chiếu.');
  if (unattributedEmployeeCount) warnings.push('Có dòng doanh thu chưa xác định được Nhân viên bán hàng từ nguồn đơn/người tạo.');
  return Object.freeze({ customerGroupLegacyFallbackCount: String(customerGroupLegacyFallbackCount), productGroupLegacyFallbackCount: String(productGroupLegacyFallbackCount), unitNameLegacyFallbackCount: String(unitNameLegacyFallbackCount), unattributedEmployeeCount: String(unattributedEmployeeCount), warnings: Object.freeze(warnings) });
}

function compatibilityCustomers(rows) {
  const grouped = new Map();
  for (const row of rows) { const key = `${identity(row.id, `${row.code}|${row.name}`)}|${row.currencyCode}`; const current = grouped.get(key) ?? { ...row, revenueValue: 0n }; current.revenueValue += decimal6(row.revenue); grouped.set(key, current); }
  return Object.freeze([...grouped.values()].sort((a, b) => a.revenueValue > b.revenueValue ? -1 : a.revenueValue < b.revenueValue ? 1 : 0).slice(0, 100).map((row) => Object.freeze({ currencyCode: row.currencyCode, customerId: row.id, customerCode: row.code, customerName: row.name, totalValue: decimalText(row.revenueValue) })));
}

export async function salesReport(adapter, requestContext, filters, warehouseIds) {
  const previous = previousPeriod(filters);
  const factParams = [requestContext.installationId, warehouseIds, filters.fromInstant, filters.toExclusiveInstant, filters.warehouseId, previous.fromInstant];
  const currentParams = [requestContext.installationId, warehouseIds, filters.fromInstant, filters.toExclusiveInstant, filters.warehouseId];
  const [summaryResult, factResult, documentsResult] = await Promise.all([
    adapter.query(`SELECT count(*)::text AS all_order_count,
              count(*) FILTER (WHERE so.status IN ('confirmed','closed'))::text AS effective_order_count,
              count(*) FILTER (WHERE so.status = 'cancelled')::text AS cancelled_order_count,
              count(DISTINCT so.customer_id) FILTER (WHERE so.status IN ('confirmed','closed'))::text AS buyer_count
         FROM sales.sales_orders so
        WHERE so.installation_id = $1 AND so.warehouse_id = ANY($2::uuid[])
          AND so.confirmed_at >= $3::timestamptz AND so.confirmed_at < $4::timestamptz
          AND ($5::uuid IS NULL OR so.warehouse_id = $5::uuid)`, currentParams),
    adapter.query(`SELECT CASE WHEN so.confirmed_at >= $3::timestamptz THEN 'current' ELSE 'previous' END AS period,
              (so.confirmed_at AT TIME ZONE '${BUSINESS_TIMEZONE}')::date::text AS business_date,
              so.id AS sales_order_id, so.order_number, so.source_employee_id, so.created_by,
              sov.id AS sales_order_version_id, sov.currency_code, sov.total::text AS version_total,
              sov.customer_id, sov.customer_code_snapshot AS customer_code, sov.customer_name_snapshot AS customer_name,
              CASE WHEN sov.customer_group_snapshot_captured THEN sov.customer_group_id_snapshot ELSE customer.group_id END AS customer_group_id,
              CASE WHEN sov.customer_group_snapshot_captured THEN sov.customer_group_code_snapshot ELSE customer_group.code END AS customer_group_code,
              CASE WHEN sov.customer_group_snapshot_captured THEN sov.customer_group_name_snapshot ELSE customer_group.name END AS customer_group_name,
              CASE WHEN sov.customer_group_snapshot_captured THEN 'snapshot' WHEN customer_group.id IS NOT NULL THEN 'legacy-current-master' ELSE 'legacy-unavailable' END AS customer_group_source,
              sov.sales_channel_id, sov.sales_channel_code_snapshot AS sales_channel_code, sov.sales_channel_name_snapshot AS sales_channel_name,
              line.variant_id, line.sku_snapshot AS sku, line.item_name_snapshot AS item_name,
              CASE WHEN line.reporting_dimension_snapshot_captured THEN line.product_category_id_snapshot ELSE product.category_id END AS product_group_id,
              CASE WHEN line.reporting_dimension_snapshot_captured THEN line.product_category_code_snapshot ELSE product_category.code END AS product_group_code,
              CASE WHEN line.reporting_dimension_snapshot_captured THEN line.product_category_name_snapshot ELSE product_category.name END AS product_group_name,
              CASE WHEN line.reporting_dimension_snapshot_captured THEN 'snapshot' WHEN product_category.id IS NOT NULL THEN 'legacy-current-master' ELSE 'legacy-unavailable' END AS product_group_source,
              line.unit_id, line.unit_code_snapshot AS unit_code,
              CASE WHEN line.reporting_dimension_snapshot_captured THEN line.unit_name_snapshot ELSE unit.name END AS unit_name,
              CASE WHEN line.reporting_dimension_snapshot_captured THEN 'snapshot' WHEN unit.id IS NOT NULL THEN 'legacy-current-master' ELSE 'legacy-unavailable' END AS unit_name_source,
              line.ordered_quantity::text, line.line_total::text,
              COALESCE(source_employee.id, creator_employee.id) AS employee_id,
              COALESCE(source_employee.code, creator_employee.code) AS employee_code,
              COALESCE(source_employee.full_name, creator_employee.full_name) AS employee_name,
              CASE WHEN source_employee.id IS NOT NULL THEN 'order-source' WHEN creator_employee.id IS NOT NULL THEN 'creator-user' ELSE 'unavailable' END AS employee_source
         FROM sales.sales_orders so
         JOIN LATERAL (SELECT version.* FROM sales.sales_order_versions version WHERE version.installation_id = so.installation_id AND version.sales_order_id = so.id AND version.version_status IN ('confirmed','superseded') ORDER BY version.version_number DESC LIMIT 1) sov ON true
         JOIN sales.sales_order_version_lines line ON line.installation_id = sov.installation_id AND line.sales_order_version_id = sov.id
         LEFT JOIN shared.customers customer ON customer.installation_id = sov.installation_id AND customer.id = sov.customer_id
         LEFT JOIN shared.customer_groups customer_group ON customer_group.installation_id = customer.installation_id AND customer_group.id = customer.group_id
         LEFT JOIN shared.product_variants variant ON variant.installation_id = line.installation_id AND variant.id = line.variant_id
         LEFT JOIN shared.products product ON product.installation_id = variant.installation_id AND product.id = variant.product_id
         LEFT JOIN shared.product_categories product_category ON product_category.installation_id = product.installation_id AND product_category.id = product.category_id
         LEFT JOIN shared.units_of_measure unit ON unit.installation_id = line.installation_id AND unit.id = line.unit_id
         LEFT JOIN shared.employees source_employee ON source_employee.installation_id = so.installation_id AND source_employee.id = so.source_employee_id
         LEFT JOIN shared.users creator_user ON creator_user.installation_id = so.installation_id AND so.created_by = ('user:' || creator_user.id::text)
         LEFT JOIN shared.employees creator_employee ON creator_employee.installation_id = creator_user.installation_id AND creator_employee.id = creator_user.employee_id
        WHERE so.installation_id = $1 AND so.warehouse_id = ANY($2::uuid[])
          AND so.confirmed_at >= $6::timestamptz AND so.confirmed_at < $4::timestamptz
          AND ($5::uuid IS NULL OR so.warehouse_id = $5::uuid) AND so.status IN ('confirmed','closed')
        ORDER BY so.confirmed_at, so.id, line.line_number`, factParams),
    adapter.query(`SELECT so.id AS sales_order_id, so.order_number, so.status, so.fulfillment_status, so.delivery_status, so.settlement_status, so.confirmed_at, so.warehouse_id,
              sov.currency_code, sov.total::text AS total_value, sov.customer_id, sov.customer_code_snapshot AS customer_code, sov.customer_name_snapshot AS customer_name
         FROM sales.sales_orders so
         JOIN LATERAL (SELECT version.* FROM sales.sales_order_versions version WHERE version.installation_id = so.installation_id AND version.sales_order_id = so.id AND version.version_status IN ('confirmed','superseded') ORDER BY version.version_number DESC LIMIT 1) sov ON true
        WHERE so.installation_id = $1 AND so.warehouse_id = ANY($2::uuid[])
          AND so.confirmed_at >= $3::timestamptz AND so.confirmed_at < $4::timestamptz
          AND ($5::uuid IS NULL OR so.warehouse_id = $5::uuid) AND so.status IN ('confirmed','closed')
        ORDER BY so.confirmed_at DESC, so.id DESC LIMIT 200`, currentParams),
  ]);

  const facts = mapRows(factResult.rows);
  const summaryCounts = mapRow(summaryResult.rows?.[0] ?? {});
  const revenues = revenueSummary(facts);
  const quantities = quantitySummary(facts);
  const breakdowns = Object.freeze({
    customers: breakdown(facts, 'customers'),
    customerGroups: breakdown(facts, 'customerGroups'),
    channels: breakdown(facts, 'channels'),
    products: breakdown(facts, 'products'),
    productGroups: breakdown(facts, 'productGroups'),
    employees: breakdown(facts, 'employees'),
  });
  const reportReconciliation = reconciliation(facts);
  const dataQuality = quality(facts);
  const trend = dailyTrend(facts, previous.dayCount);
  const compatibilityCustomerRows = compatibilityCustomers(breakdowns.customers);

  return Object.freeze({
    family: 'sales', contractVersion: '2026-08-29', generatedAt: requestContext.receivedAt, timezone: BUSINESS_TIMEZONE,
    filters: Object.freeze({ from: filters.from, to: filters.to, warehouseId: filters.warehouseId }),
    basis: Object.freeze({ date: 'sales.sales_orders.confirmed_at', revenue: 'sum(sales.sales_order_version_lines.line_total), reconciled exactly to latest confirmed/superseded version total', quantity: 'ordered_quantity kept at original order unit; never summed across different units', employee: 'sales_orders.source_employee_id, otherwise creator user employee mapping; customer responsible employee is not used', historicalDimensions: 'confirmed snapshots when captured; legacy rows explicitly mark current-master fallback instead of silently rewriting history', effectiveStates: Object.freeze(['confirmed', 'closed']) }),
    comparison: Object.freeze({ current: Object.freeze({ from: filters.from, to: filters.to, dayCount: previous.dayCount }), previous: Object.freeze({ from: previous.from, to: previous.to, dayCount: previous.dayCount }) }),
    summary: Object.freeze({ ...summaryCounts, revenues, quantities }), breakdowns,
    reconciliation: reportReconciliation, dataQuality, dailyTrend: trend, documents: mapRows(documentsResult.rows),
    currencyTotals: Object.freeze(revenues.map((row) => Object.freeze({ currencyCode: row.currencyCode, documentCount: row.documentCount, totalValue: row.revenue }))),
    statusBreakdown: Object.freeze([]),
    topEntities: Object.freeze(compatibilityCustomerRows.slice(0, 10).map((row) => Object.freeze({ currencyCode: row.currencyCode, entityId: row.customerId, entityCode: row.customerCode, entityName: row.customerName, totalValue: row.totalValue }))),
    topSkus: Object.freeze(breakdowns.products.slice(0, 10).map((row) => Object.freeze({ currencyCode: row.currencyCode, variantId: row.id, sku: row.code, itemName: row.name, orderedQuantity: row.quantity, unit: row.unit, totalValue: row.revenue }))),
    customers: compatibilityCustomerRows,
  });
}

export const reportingSalesInternals = Object.freeze({ shiftDate, previousPeriod, decimal6, decimalText, percentText, breakdown, reconciliation });
