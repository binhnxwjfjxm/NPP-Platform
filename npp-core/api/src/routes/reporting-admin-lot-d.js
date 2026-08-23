import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson, sendSuccess } from '../http-utils.js';
import { readJsonBody } from '../idempotency.js';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import { ensureWarehouseScopes, normalizeFilters, validateScope } from './reporting-common.js';
import { grossMarginReport, agingReport } from './reporting-finance.js';
import { inventoryReport } from './reporting-inventory-safe.js';
import { logisticsReport } from './reporting-logistics.js';
import { codReport } from './reporting-cod.js';
import { adminAlertsReport as mcpAlertsReport } from './reporting-mcp-alerts.js';
import { ALERT_STATUSES, canTransitionAlertStatus } from './reporting-mcp-alert-rules.js';
import { requiresCanonicalEmployeeMcpScope, resolveReportingMcpScope } from './reporting-mcp-scope-policy.js';
import { createManagementReportExport } from '../services/reporting-management-export.js';

const ALERT_RESOURCE_TYPE = 'admin-alert';
const ALERT_ACTION = 'admin.alert.status_changed';
const EXPORT_ROOT = '/api/reporting/management-export';
const ALERT_ROOT = '/api/reporting/admin-alerts';
const SAFE_ALERT_ID = /^[A-Za-z0-9._-]{1,240}$/;

const DOMAIN_LABELS = Object.freeze({ sales: 'Kinh doanh', debt: 'Công nợ', inventory: 'Kho', delivery: 'Giao vận', mcp: 'MCP' });

const LOT_D_RULES = Object.freeze([
  Object.freeze({ code: 'SALES_GROSS_MARGIN_LINEAGE_MISSING', domain: 'sales', name: 'Thiếu liên kết xuất kho để đối chiếu lãi gộp', metric: 'Liên kết doanh thu - xuất kho', threshold: 'Dòng doanh thu đã ghi nhận nhưng chưa có liên kết xuất kho canonical để đối chiếu giá vốn', severity: 'high' }),
  Object.freeze({ code: 'SALES_GROSS_MARGIN_COST_MISSING', domain: 'sales', name: 'Thiếu dữ liệu giá vốn cho dòng doanh thu', metric: 'Dữ liệu giá vốn', threshold: 'Dòng doanh thu có liên kết xuất kho nhưng chưa có cost fact canonical', severity: 'high' }),
  Object.freeze({ code: 'SALES_GROSS_MARGIN_COST_ANOMALY', domain: 'sales', name: 'Giá vốn cần đối soát trước khi đọc lãi gộp', metric: 'Trạng thái giá vốn', threshold: 'Cost fact của dòng doanh thu chưa ở trạng thái COSTED hợp lệ', severity: 'high' }),
  Object.freeze({ code: 'DEBT_PAYABLE_OVERDUE', domain: 'debt', name: 'Khoản phải trả đã quá hạn', metric: 'Ngày đến hạn và số dư còn lại', threshold: 'Ngày đến hạn đã qua và chứng từ vẫn còn số dư phải trả', severity: 'attention' }),
  Object.freeze({ code: 'INVENTORY_COST_RECONCILIATION_EXCEPTION', domain: 'inventory', name: 'Tồn kho và giá vốn chưa đối soát khớp', metric: 'Đối soát lượng và giá vốn', threshold: 'Trạng thái đối soát giá vốn khác OK', severity: 'high' }),
  Object.freeze({ code: 'DELIVERY_ATTEMPT_FAILED', domain: 'delivery', name: 'Lần giao không thành công', metric: 'Kết quả giao hàng', threshold: 'Kết quả lần giao canonical là failed', severity: 'high' }),
  Object.freeze({ code: 'DELIVERY_COD_COLLECTION_OVERDUE', domain: 'delivery', name: 'Khoản COD hẹn thu đã quá hạn', metric: 'Hạn thu COD', threshold: 'Hạn thu đã qua và khoản COD vẫn ở trạng thái chưa thu', severity: 'high' }),
  Object.freeze({ code: 'DELIVERY_COD_HANDOVER_DISCREPANCY', domain: 'delivery', name: 'Bàn giao COD có chênh lệch', metric: 'Đối soát bàn giao COD', threshold: 'Trạng thái đối soát bàn giao canonical là discrepancy', severity: 'high' }),
]);

const REPORT_READ_PERMISSIONS = Object.freeze({
  executive: Object.freeze(['coreReportingControlTowerRead']),
  'sales-profit': Object.freeze(['coreReportingSalesRead', 'coreReportingGrossMarginRead']),
  debt: Object.freeze(['coreReportingAgingRead']),
  inventory: Object.freeze(['coreReportingInventoryRead']),
  'delivery-cod': Object.freeze(['coreReportingLogisticsRead', 'coreReportingCodRead']),
  mcp: Object.freeze(['coreReportingEmployeeMcpRead']),
  people: Object.freeze(['coreReportingEmployeeMcpRead']),
  decisions: Object.freeze([]),
});

function apiError(code, message, details = {}, retryable = false, statusCode = 500) { return { code, message, details, retryable, statusCode }; }
function text(value, fallback = '') { const normalized = String(value ?? '').trim(); return normalized || fallback; }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function nullableText(value) { const normalized = text(value); return normalized || null; }
function formatAmount(value, currency = '') { const parsed = number(value); const display = parsed === null ? text(value, '0') : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(parsed); return `${display}${currency ? ` ${currency}` : ''}`; }
function ruleByCode(code) { return LOT_D_RULES.find((rule) => rule.code === code); }
function rulesByCodes(codes) { return codes.flatMap((code) => ruleByCode(code) ?? []); }

function stableAlertId(domain, ruleCode, businessKey) {
  const digest = createHash('sha256').update(`${domain}|${ruleCode}|${businessKey}`).digest('hex').slice(0, 24);
  return `${domain}-${ruleCode.toLowerCase().replaceAll('_', '-')}-${digest}`;
}

function domainAlert(ruleCode, businessKey, payload = {}) {
  const rule = ruleByCode(ruleCode);
  if (!rule) throw new Error(`admin_alert_rule_missing:${ruleCode}`);
  return Object.freeze({
    id: stableAlertId(rule.domain, rule.code, businessKey),
    domain: rule.domain,
    domainLabel: DOMAIN_LABELS[rule.domain],
    ruleCode: rule.code,
    ruleName: rule.name,
    severity: rule.severity,
    status: 'new',
    title: rule.name,
    entity: text(payload.entity, 'Đối tượng cần rà soát'),
    source: 'Công Ty',
    context: text(payload.context),
    employeeName: '', employeeCode: '', routeName: '',
    detectedAt: payload.detectedAt ?? null,
    threshold: rule.threshold,
    actual: text(payload.actual, 'Có dữ liệu cần rà soát'),
    summary: text(payload.summary, 'Có tín hiệu từ dữ liệu canonical cần được quản lý rà soát.'),
    recommendation: text(payload.recommendation, 'Đối chiếu chứng từ và dữ liệu nguồn liên quan trước khi kết luận.'),
    evidence: Object.freeze(Array.isArray(payload.evidence) ? payload.evidence.map(String) : []),
    history: Object.freeze([]),
  });
}

function canManageAlerts(requestContext) {
  const roles = Array.isArray(requestContext.roles) ? requestContext.roles : [];
  return roles.includes('system:security-owner') || roles.includes('system:implementation-owner') || roles.includes('bootstrap');
}
function permissionAllowed(options, requestContext, key) { const permission = options.PERMISSIONS?.[key]; return Boolean(permission && options.authorize(requestContext, permission).ok); }

function initialDomainAccess(options, requestContext) {
  const permissions = {
    sales: permissionAllowed(options, requestContext, 'coreReportingGrossMarginRead'),
    debt: permissionAllowed(options, requestContext, 'coreReportingAgingRead'),
    inventory: permissionAllowed(options, requestContext, 'coreReportingInventoryRead'),
    logistics: permissionAllowed(options, requestContext, 'coreReportingLogisticsRead'),
    cod: permissionAllowed(options, requestContext, 'coreReportingCodRead'),
    mcp: permissionAllowed(options, requestContext, 'coreReportingEmployeeMcpRead'),
  };
  const forbidden = 'Tài khoản hiện tại không có quyền xem nhóm cảnh báo này.';
  return {
    permissions,
    domains: {
      sales: { available: permissions.sales, message: permissions.sales ? null : forbidden },
      debt: { available: permissions.debt, message: permissions.debt ? null : forbidden },
      inventory: { available: permissions.inventory, message: permissions.inventory ? null : forbidden },
      delivery: { available: permissions.logistics || permissions.cod, message: permissions.logistics || permissions.cod ? null : forbidden },
      mcp: { available: permissions.mcp, message: permissions.mcp ? null : forbidden },
    },
    fieldScope: null,
  };
}

async function authenticate(req, res, options) {
  const auth = options.authenticate(req, options.config);
  if (!auth.ok) { res.setHeader('WWW-Authenticate', 'Bearer'); sendError(res, apiError('UNAUTHORIZED', 'Cần đăng nhập', {}, false, 401), options.requestId, options.receivedAt); return null; }
  return options.createContext({ config: options.config, principal: auth.principal, requestId: options.requestId, receivedAt: options.receivedAt });
}

async function ensureScopes(options, requestContext) {
  try { return await ensureWarehouseScopes(options.getPool(), requestContext); }
  catch (error) {
    console.error(JSON.stringify({ event: 'admin_lot_d_scope_lookup_failed', requestId: options.requestId, errorName: error?.name ?? null, errorCode: typeof error?.code === 'string' ? error.code : null }));
    return null;
  }
}

function salesAlerts(report) {
  const mapping = { MISSING_INVENTORY_LINEAGE: 'SALES_GROSS_MARGIN_LINEAGE_MISSING', MISSING_COST_FACT: 'SALES_GROSS_MARGIN_COST_MISSING', COST_ANOMALY: 'SALES_GROSS_MARGIN_COST_ANOMALY' };
  return (report?.exceptions ?? []).flatMap((row) => {
    const ruleCode = mapping[text(row.exceptionCode)]; if (!ruleCode) return [];
    const document = text(row.documentNumber, 'Chứng từ chưa cấp số'); const sku = text(row.sku, 'SKU chưa xác định');
    const customer = `${text(row.customerCode)} · ${text(row.customerName)}`.replace(/^ · | · $/g, '') || 'Khách hàng chưa xác định';
    const key = `${text(row.sourceLineId, text(row.accountingDocumentId))}|${text(row.exceptionCode)}`;
    return [domainAlert(ruleCode, key, {
      entity: `${document} · ${sku}`, context: `${customer} · ${text(row.warehouseCode, 'Kho chưa xác định')}`, detectedAt: row.documentDate ?? null,
      actual: text(row.exceptionCode), summary: 'Dòng doanh thu chưa đủ điều kiện để đọc lãi gộp một cách đáng tin cậy từ giá vốn canonical.',
      recommendation: 'Mở chứng từ và đối chiếu liên kết xuất kho/cost fact trước khi dùng lãi gộp để ra quyết định.',
      evidence: [`Chứng từ: ${document}`, `Khách hàng: ${customer}`, `SKU: ${sku}`, `Kho: ${text(row.warehouseCode)}`, `Doanh thu thuần: ${formatAmount(row.netRevenue, text(row.currencyCode))}`],
    })];
  });
}

function debtAlerts(report) {
  return (report?.payable?.documents ?? []).flatMap((row) => {
    const overdueDays = number(row.overdueDays); if (overdueDays === null || overdueDays <= 0) return [];
    const supplier = `${text(row.supplierCode)} · ${text(row.supplierName)}`.replace(/^ · | · $/g, '') || 'Nhà cung cấp chưa xác định';
    const document = text(row.sourceDocumentNumber, 'Chứng từ chưa cấp số');
    return [domainAlert('DEBT_PAYABLE_OVERDUE', text(row.payableDocumentId, document), {
      entity: document, context: `${supplier} · ${text(row.warehouseCode, 'Kho chưa xác định')}`, detectedAt: row.dueDate ?? null,
      actual: `Quá hạn ${overdueDays} ngày · còn ${formatAmount(row.remainingAmount, text(row.currencyCode))}`,
      summary: 'Chứng từ phải trả đã qua ngày đến hạn canonical và vẫn còn số dư chưa phân bổ.',
      recommendation: 'Rà soát lịch thanh toán, chứng từ liên quan và kế hoạch dòng tiền trước khi xử lý.',
      evidence: [`Nhà cung cấp: ${supplier}`, `Ngày đến hạn: ${text(row.dueDate)}`, `Quá hạn: ${overdueDays} ngày`, `Số dư còn lại: ${formatAmount(row.remainingAmount, text(row.currencyCode))}`],
    })];
  });
}

function inventoryAlerts(report, detectedAt) {
  return (report?.exceptions ?? []).map((row) => domainAlert('INVENTORY_COST_RECONCILIATION_EXCEPTION', `${text(row.warehouseId)}|${text(row.variantId)}`, {
    entity: text(row.sku, 'SKU chưa xác định'), context: `Kho ${text(row.warehouseCode, 'chưa xác định')}`, detectedAt,
    actual: `${text(row.reconciliationStatus, 'Cần đối soát')} · chênh lệch ${text(row.quantityDifference, '0')}`,
    summary: 'Số lượng theo sổ kho và dữ liệu giá vốn chưa ở trạng thái đối soát khớp.',
    recommendation: 'Đối chiếu sổ kho, lần dựng lại giá vốn và nguồn phát sinh trước khi dùng giá trị tồn để ra quyết định.',
    evidence: [`Kho: ${text(row.warehouseCode)}`, `SKU: ${text(row.sku)}`, `Lượng theo sổ: ${text(row.ledgerQuantity, '0')}`, `Lượng theo giá vốn: ${text(row.costingQuantity, '0')}`, `Chênh lệch: ${text(row.quantityDifference, '0')}`, `Trạng thái giá vốn: ${text(row.costingStatus)}`],
  }));
}

function failedDeliveryAlerts(report) {
  return (report?.attempts ?? []).filter((row) => text(row.result) === 'failed').map((row) => {
    const customer = `${text(row.customerCodeSnapshot)} · ${text(row.customerNameSnapshot)}`.replace(/^ · | · $/g, '') || 'Khách hàng chưa xác định';
    return domainAlert('DELIVERY_ATTEMPT_FAILED', text(row.attemptId), {
      entity: text(row.deliveryOrderNumber, 'Phiếu giao chưa cấp số'), context: `${customer} · ${text(row.driverName, 'Chưa xác định tài xế')}`, detectedAt: row.attemptedAt ?? null,
      actual: text(row.reasonCode, 'Giao không thành công'), summary: 'Lần giao đã được ghi nhận kết quả không thành công trong dữ liệu giao vận canonical.',
      recommendation: 'Rà soát lý do giao, kế hoạch xử lý tiếp theo và trạng thái phiếu giao trước khi quyết định.',
      evidence: [`Chuyến: ${text(row.tripNumber)}`, `Phiếu giao: ${text(row.deliveryOrderNumber)}`, `Khách hàng: ${customer}`, `Tài xế: ${text(row.driverCode)} · ${text(row.driverName)}`, `Lý do ghi nhận: ${text(row.reasonCode, 'Chưa có mã lý do')}`],
    });
  });
}

function codAlerts(report) {
  const snapshot = report?.currentSnapshot ?? {};
  const overdue = (snapshot.overduePromises ?? []).map((row) => domainAlert('DELIVERY_COD_COLLECTION_OVERDUE', text(row.collectionId), {
    entity: text(row.deliveryOrderNumber, 'Phiếu giao chưa cấp số'), context: `${text(row.driverName, 'Chưa xác định tài xế')} · Kho ${text(row.warehouseCode, 'chưa xác định')}`, detectedAt: row.dueAt ?? null,
    actual: `Quá hạn ${text(row.overdueDays, '0')} ngày · ${formatAmount(row.expectedAmount, text(row.currencyCode))}`,
    summary: 'Khoản COD đã qua hạn thu canonical nhưng vẫn chưa có khoản thu hợp lệ.', recommendation: 'Đối chiếu tài xế, phiếu giao và cam kết thu tiền trước khi xử lý công nợ/COD.',
    evidence: [`Phiếu giao: ${text(row.deliveryOrderNumber)}`, `Tài xế: ${text(row.driverCode)} · ${text(row.driverName)}`, `Hạn thu: ${text(row.dueAt)}`, `Quá hạn: ${text(row.overdueDays, '0')} ngày`, `Số tiền dự kiến: ${formatAmount(row.expectedAmount, text(row.currencyCode))}`],
  }));
  const discrepancies = (snapshot.discrepancies ?? []).map((row) => domainAlert('DELIVERY_COD_HANDOVER_DISCREPANCY', text(row.handoverId), {
    entity: text(row.tripNumber, 'Chuyến chưa cấp số'), context: `${text(row.driverName, 'Chưa xác định tài xế')} · Kho ${text(row.warehouseCode, 'chưa xác định')}`, detectedAt: row.acceptedAt ?? row.handedOverAt ?? null,
    actual: `Chênh lệch bàn giao ${formatAmount(row.handoverDifferenceAmount, text(row.currencyCode))}`,
    summary: 'Bàn giao COD đã được tiếp nhận nhưng dữ liệu đối soát canonical ghi nhận có chênh lệch.', recommendation: 'Đối chiếu khoản thu, số tiền bàn giao và số tiền tiếp nhận trước khi chốt trách nhiệm.',
    evidence: [`Chuyến: ${text(row.tripNumber)}`, `Tài xế: ${text(row.driverCode)} · ${text(row.driverName)}`, `Bàn giao: ${formatAmount(row.claimedAmount, text(row.currencyCode))}`, `Tiếp nhận: ${formatAmount(row.acceptedAmount, text(row.currencyCode))}`, `Chênh lệch bàn giao: ${formatAmount(row.handoverDifferenceAmount, text(row.currencyCode))}`],
  }));
  return [...overdue, ...discrepancies];
}

async function lifecycleRows(adapter, requestContext, alertIds) {
  if (!alertIds.length) return [];
  const result = await adapter.query(`SELECT audit.resource_id, audit.after_data, audit.actor_id, audit.employee_id, employee.full_name AS actor_name, employee.code AS actor_employee_code, audit.occurred_at FROM shared.core_audit_records audit LEFT JOIN shared.employees employee ON employee.installation_id = audit.installation_id AND employee.id::text = audit.employee_id WHERE audit.installation_id = $1 AND audit.action = $2 AND audit.resource_type = $3 AND audit.resource_id = ANY($4::text[]) ORDER BY audit.occurred_at ASC, audit.audit_id ASC`, [requestContext.installationId, ALERT_ACTION, ALERT_RESOURCE_TYPE, alertIds]);
  return result.rows ?? [];
}

function applyLifecycle(alerts, rows) {
  const byId = new Map(alerts.map((alert) => [alert.id, { status: 'new', history: [] }]));
  for (const row of rows) {
    const state = byId.get(String(row.resource_id)); const status = text(row.after_data?.status); if (!state || !ALERT_STATUSES.includes(status)) continue;
    state.status = status; const actorName = nullableText(row.actor_name); const actorCode = nullableText(row.actor_employee_code);
    state.history.push(Object.freeze({ status, actorId: String(row.actor_id), employeeId: row.employee_id == null ? null : String(row.employee_id), actorLabel: actorName ? (actorCode ? `${actorCode} · ${actorName}` : actorName) : text(row.actor_id, 'Hệ thống'), occurredAt: row.occurred_at }));
  }
  return alerts.map((alert) => Object.freeze({ ...alert, status: byId.get(alert.id)?.status ?? 'new', history: Object.freeze(byId.get(alert.id)?.history ?? []) }));
}
function severityRank(value) { return value === 'critical' ? 0 : value === 'high' ? 1 : 2; }
function sortAlerts(alerts) { return [...alerts].sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || Date.parse(b.detectedAt ?? '') - Date.parse(a.detectedAt ?? '')); }

async function resolveMcpAccess(options, requestContext, access) {
  if (!access.permissions.mcp) return;
  if (requiresCanonicalEmployeeMcpScope(requestContext)) { access.permissions.mcp = false; access.domains.mcp = { available: false, message: 'Tài khoản hiện tại chưa có phạm vi nhân viên để xem cảnh báo MCP.' }; return; }
  const resolved = await resolveReportingMcpScope(options.getPool(), requestContext);
  if (resolved.ok) access.fieldScope = resolved;
  else { access.permissions.mcp = false; access.domains.mcp = { available: false, message: 'Phạm vi MCP hiện chưa sẵn sàng.' }; }
}

async function loadCombinedAlertCenter(options, requestContext, access, filters) {
  const warehouseIds = Array.isArray(requestContext.scopes?.warehouseIds) ? requestContext.scopes.warehouseIds : [];
  const tasks = [];
  const add = (key, domain, ruleCodes, load) => tasks.push({ key, domain, ruleCodes, load });
  if (access.permissions.sales) add('sales', 'sales', ['SALES_GROSS_MARGIN_LINEAGE_MISSING','SALES_GROSS_MARGIN_COST_MISSING','SALES_GROSS_MARGIN_COST_ANOMALY'], async () => salesAlerts(await grossMarginReport(options.getPool(), requestContext, filters, warehouseIds)));
  if (access.permissions.debt) add('debt', 'debt', ['DEBT_PAYABLE_OVERDUE'], async () => debtAlerts(await agingReport(options.getPool(), requestContext, filters, warehouseIds)));
  if (access.permissions.inventory) add('inventory', 'inventory', ['INVENTORY_COST_RECONCILIATION_EXCEPTION'], async () => inventoryAlerts(await inventoryReport(options.getPool(), requestContext, filters, warehouseIds), requestContext.receivedAt));
  if (access.permissions.logistics) add('delivery-logistics', 'delivery', ['DELIVERY_ATTEMPT_FAILED'], async () => failedDeliveryAlerts(await logisticsReport(options.getPool(), requestContext, filters, warehouseIds)));
  if (access.permissions.cod) add('delivery-cod', 'delivery', ['DELIVERY_COD_COLLECTION_OVERDUE','DELIVERY_COD_HANDOVER_DISCREPANCY'], async () => codAlerts(await codReport(options.getPool(), requestContext, filters, warehouseIds)));
  if (access.permissions.mcp && access.fieldScope) add('mcp', 'mcp', [], () => mcpAlertsReport(options.getPool(), requestContext, filters, access.fieldScope));

  const settled = await Promise.allSettled(tasks.map((task) => task.load()));
  const alerts = []; const rules = []; const attempted = new Map(); const succeeded = new Map(); let mcpPayload = null;
  tasks.forEach((task) => attempted.set(task.domain, (attempted.get(task.domain) ?? 0) + 1));
  settled.forEach((result, index) => {
    const task = tasks[index];
    if (result.status === 'rejected') { console.error(JSON.stringify({ event: 'admin_lot_d_alert_source_failed', requestId: options.requestId, source: task.key, errorName: result.reason?.name ?? null, errorCode: typeof result.reason?.code === 'string' ? result.reason.code : null })); return; }
    succeeded.set(task.domain, (succeeded.get(task.domain) ?? 0) + 1);
    if (task.key === 'mcp') { mcpPayload = result.value; return; }
    alerts.push(...result.value); rules.push(...rulesByCodes(task.ruleCodes));
  });
  for (const domain of ['sales','debt','inventory','delivery']) {
    if ((attempted.get(domain) ?? 0) > 0 && (succeeded.get(domain) ?? 0) === 0) access.domains[domain] = { available: false, message: 'Nguồn cảnh báo của nhóm này tạm thời chưa sẵn sàng.' };
  }
  if (mcpPayload) {
    rules.push(...(mcpPayload.rules ?? []).map((rule) => Object.freeze({ ...rule, domain: 'mcp', domainLabel: DOMAIN_LABELS.mcp })));
    alerts.push(...(mcpPayload.alerts ?? []).map((alert) => Object.freeze({ ...alert, domain: 'mcp', domainLabel: DOMAIN_LABELS.mcp, source: 'MCP', context: `${text(alert.employeeName)}${alert.routeName ? ` · ${text(alert.routeName)}` : ''}`.trim() })));
  } else if (attempted.get('mcp')) access.domains.mcp = { available: false, message: 'Nguồn cảnh báo MCP tạm thời chưa sẵn sàng.' };

  const companyAlerts = alerts.filter((alert) => alert.domain !== 'mcp');
  const withLifecycle = applyLifecycle(companyAlerts, await lifecycleRows(options.getPool(), requestContext, companyAlerts.map((alert) => alert.id)));
  return Object.freeze({ generatedAt: requestContext.receivedAt, filters: Object.freeze({ from: filters.from, to: filters.to }), domainAccess: Object.freeze(Object.fromEntries(Object.entries(access.domains).map(([key,value]) => [key, Object.freeze({ ...value })]))), rules: Object.freeze(rules), alerts: Object.freeze(sortAlerts([...withLifecycle, ...alerts.filter((alert) => alert.domain === 'mcp')])) });
}

async function resolveAlertRuntime(req, res, options) {
  let requestContext = await authenticate(req, res, options); if (!requestContext) return null;
  const access = initialDomainAccess(options, requestContext);
  if (access.permissions.sales || access.permissions.debt || access.permissions.inventory || access.permissions.logistics || access.permissions.cod) {
    requestContext = await ensureScopes(options, requestContext); if (!requestContext) { sendError(res, apiError('REPORTING_SCOPE_LOOKUP_FAILED', 'Không tải được phạm vi kho', {}, true, 503), options.requestId, options.receivedAt); return null; }
  }
  await resolveMcpAccess(options, requestContext, access);
  if (!Object.values(access.domains).some((domain) => domain.available)) { sendError(res, apiError('FORBIDDEN', 'Tài khoản hiện tại không có quyền xem cảnh báo quản trị', {}, false, 403), options.requestId, options.receivedAt); return null; }
  return { requestContext, access };
}

function parseAlertId(pathname) {
  if (pathname === ALERT_ROOT) return null; if (!pathname.startsWith(`${ALERT_ROOT}/`)) return undefined;
  const raw = pathname.slice(ALERT_ROOT.length + 1); if (!raw || raw.includes('/')) return undefined;
  try { const decoded = decodeURIComponent(raw); return SAFE_ALERT_ID.test(decoded) ? decoded : undefined; } catch { return undefined; }
}

async function updateAlertStatus(options, requestContext, center, alertId, nextStatus) {
  if (!ALERT_STATUSES.includes(nextStatus) || nextStatus === 'new') throw Object.assign(new Error('INVALID_ALERT_STATUS'), { code:'INVALID_ALERT_STATUS', publicMessage:'Trạng thái cảnh báo không hợp lệ', statusCode:400 });
  const alert = center.alerts.find((candidate) => candidate.id === alertId); if (!alert) throw Object.assign(new Error('ALERT_NOT_FOUND'), { code:'ALERT_NOT_FOUND', publicMessage:'Cảnh báo không còn tồn tại trong phạm vi hiện tại', statusCode:404 });
  if (!canTransitionAlertStatus(alert.status, nextStatus)) throw Object.assign(new Error('ALERT_STATUS_CONFLICT'), { code:'ALERT_STATUS_CONFLICT', publicMessage:'Cảnh báo đã thay đổi trạng thái. Vui lòng tải lại dữ liệu.', statusCode:409 });
  return withAuditOutboxTransaction({ adapter: options.getPool(), mutate: async (client) => {
    const audit = buildAuditRecord({ requestContext, action: ALERT_ACTION, resourceType: ALERT_RESOURCE_TYPE, resourceId: alert.id, beforeData:{status:alert.status}, afterData:{status:nextStatus,domain:alert.domain,ruleCode:alert.ruleCode,title:alert.title,entity:alert.entity}, metadata:{source:alert.source,domain:alert.domain} });
    const event = buildOutboxEvent({ requestContext, aggregateType:'admin-alert', aggregateId:alert.id, eventType:'admin.alert.status-changed', payload:{alertId:alert.id,domain:alert.domain,fromStatus:alert.status,toStatus:nextStatus} });
    await insertAuditRecord(client,audit); await insertOutboxEvent(client,event); return Object.freeze({alertId:alert.id,status:nextStatus,auditId:audit.auditId,eventId:event.eventId});
  }});
}

async function handleAlertRequest(req, res, options, url) {
  const method = String(req.method ?? 'GET').toUpperCase(); const alertId = parseAlertId(url.pathname);
  if (alertId === undefined || !['GET','POST'].includes(method) || (method === 'POST' && alertId === null)) { sendError(res, apiError('METHOD_NOT_ALLOWED','Phương thức không được hỗ trợ',{},false,405), options.requestId, options.receivedAt); return; }
  const runtime = await resolveAlertRuntime(req,res,options); if (!runtime) return;
  const filters = normalizeFilters({from:url.searchParams.get('from'),to:url.searchParams.get('to'),warehouseId:null}, new Date(options.receivedAt));
  if (!filters.ok) { sendError(res,apiError(filters.code,filters.message,filters.details??{},false,filters.statusCode??400),options.requestId,options.receivedAt); return; }
  let center; try { center = await loadCombinedAlertCenter(options,runtime.requestContext,runtime.access,filters); } catch (error) { console.error(JSON.stringify({event:'admin_lot_d_alert_center_failed',requestId:options.requestId,errorName:error?.name??null,errorCode:error?.code??null})); sendError(res,apiError('REPORTING_QUERY_FAILED','Không tải được cảnh báo quản trị',{},true,503),options.requestId,options.receivedAt); return; }
  if (method === 'GET') { res.setHeader('Cache-Control','no-store'); sendSuccess(res,center,options.requestId,options.receivedAt); return; }
  if (!canManageAlerts(runtime.requestContext)) { sendError(res,apiError('FORBIDDEN','Tài khoản hiện tại không có quyền thay đổi trạng thái cảnh báo',{},false,403),options.requestId,options.receivedAt); return; }
  let payload; try { payload = await readJsonBody(req); } catch (error) { sendError(res,apiError(error.code,error.publicMessage,{},false,error.statusCode),options.requestId,options.receivedAt); return; }
  try {
    const execution = await options.executeRequestWithIdempotency({ idempotencyStore:options.idempotencyStore, req, requestContext:runtime.requestContext, requestId:options.requestId, receivedAt:options.receivedAt, route:`${ALERT_ROOT}/${alertId}`, payload, onProcess:async()=>({statusCode:200,contentType:'application/json',requestId:options.requestId,body:createSuccessEnvelope(await updateAlertStatus(options,runtime.requestContext,center,alertId,String(payload?.status??'')),options.requestId,options.receivedAt)}) });
    res.setHeader('Cache-Control','no-store'); sendJson(res,execution.response.statusCode,execution.response.body,execution.response.requestId??options.requestId,execution.response.contentType);
  } catch (error) { if (error?.publicMessage && error?.statusCode) sendError(res,apiError(error.code??'ALERT_UPDATE_FAILED',error.publicMessage,{},Boolean(error.retryable),error.statusCode),options.requestId,options.receivedAt); else sendError(res,apiError('ALERT_UPDATE_FAILED','Không thể cập nhật trạng thái cảnh báo',{},true,503),options.requestId,options.receivedAt); }
}

function reportKey(value) { const normalized = text(value); return Object.prototype.hasOwnProperty.call(REPORT_READ_PERMISSIONS, normalized) ? normalized : null; }
async function loadProposalExportRows(options, context) {
  const permissions = Array.isArray(context.permissions) ? context.permissions : []; const manager = canManageAlerts(context);
  const sources = manager ? ['company','mcp'] : [...(permissions.includes('core.management-proposal.submit')?['company']:[]), ...(permissions.includes('mcp.report.write')?['mcp']:[])];
  if (!sources.length) return [];
  const employeeId=context.employeeId?String(context.employeeId):''; const actorId=String(context.actorId??'');
  const result=await options.getPool().query(`SELECT source, domain, title, entity_label, priority, status, requester_name, impact, reason, created_at, updated_at FROM shared.management_proposals WHERE installation_id=$1 AND source=ANY($2::text[]) AND ($3::boolean=true OR (CASE WHEN $4::text<>'' THEN requester_employee_id::text=$4 ELSE requester_actor_id=$5 END)) ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'needs-info' THEN 1 ELSE 2 END, updated_at DESC LIMIT 500`,[context.installationId,sources,manager,employeeId,actorId]);
  return (result.rows??[]).map((row)=>({source:row.source==='mcp'?'MCP':'Công Ty',domain:text(row.domain),title:text(row.title),entityLabel:text(row.entity_label),priority:text(row.priority),status:text(row.status),requesterName:text(row.requester_name),impact:text(row.impact),reason:text(row.reason),createdAt:row.created_at,updatedAt:row.updated_at}));
}

async function handleExportRequest(req,res,options,url) {
  if (String(req.method??'GET').toUpperCase()!=='GET') { sendError(res,apiError('METHOD_NOT_ALLOWED','Phương thức không được hỗ trợ',{},false,405),options.requestId,options.receivedAt); return; }
  let context=await authenticate(req,res,options); if(!context)return;
  if(!permissionAllowed(options,context,'coreReportingExport')) { sendError(res,apiError('FORBIDDEN','Tài khoản hiện tại không có quyền xuất báo cáo',{},false,403),options.requestId,options.receivedAt); return; }
  const key=reportKey(url.searchParams.get('report')); if(!key){sendError(res,apiError('INVALID_REPORT','Nhóm báo cáo không hợp lệ',{},false,400),options.requestId,options.receivedAt);return;}
  for(const permissionKey of REPORT_READ_PERMISSIONS[key]) if(!permissionAllowed(options,context,permissionKey)){sendError(res,apiError('FORBIDDEN','Tài khoản hiện tại không có quyền xem đủ dữ liệu của báo cáo này',{},false,403),options.requestId,options.receivedAt);return;}
  const warehouseScoped=!['mcp','people','decisions'].includes(key);
  if(warehouseScoped||key==='decisions'){context=await ensureScopes(options,context);if(!context){sendError(res,apiError('REPORTING_SCOPE_LOOKUP_FAILED','Không tải được phạm vi kho',{},true,503),options.requestId,options.receivedAt);return;}}
  const filters=normalizeFilters({from:key==='debt'?null:url.searchParams.get('from'),to:key==='debt'?null:url.searchParams.get('to'),warehouseId:warehouseScoped?url.searchParams.get('warehouseId'):null},new Date(options.receivedAt));
  if(!filters.ok){sendError(res,apiError(filters.code,filters.message,filters.details??{},false,filters.statusCode??400),options.requestId,options.receivedAt);return;}
  let warehouseIds=Array.isArray(context.scopes?.warehouseIds)?context.scopes.warehouseIds:[];
  if(warehouseScoped){const scope=validateScope(context,filters);if(!scope.ok){sendError(res,apiError(scope.code,scope.message,scope.details??{},false,scope.statusCode??400),options.requestId,options.receivedAt);return;}warehouseIds=scope.warehouseIds;}
  let fieldScope=null;
  if(key==='mcp'||key==='people'){if(requiresCanonicalEmployeeMcpScope(context)){sendError(res,apiError('EMPLOYEE_MCP_SCOPE_DENIED','Cần phạm vi nhân viên để xuất báo cáo MCP',{},false,403),options.requestId,options.receivedAt);return;}const resolved=await resolveReportingMcpScope(options.getPool(),context);if(!resolved.ok){sendError(res,apiError(resolved.code,resolved.message,resolved.details??{},false,resolved.statusCode??403),options.requestId,options.receivedAt);return;}fieldScope=resolved;}
  let decisionData=null;
  if(key==='decisions'){const access=initialDomainAccess(options,context);await resolveMcpAccess(options,context,access);const center=await loadCombinedAlertCenter(options,context,access,filters);decisionData={proposals:await loadProposalExportRows(options,context),alerts:center.alerts};}
  let artifact=null;
  try{artifact=await createManagementReportExport(options.getPool(),{requestContext:context,reportKey:key,filters,warehouseIds,fieldScope,decisionData});res.statusCode=200;res.setHeader('Cache-Control','no-store, max-age=0');res.setHeader('Content-Type',artifact.contentType);res.setHeader('Content-Disposition',`attachment; filename="${artifact.filename}"`);res.setHeader('Content-Length',String(artifact.size));res.setHeader('X-Content-Type-Options','nosniff');await pipeline(createReadStream(artifact.filePath),res);}catch(error){console.error(JSON.stringify({event:'management_report_export_failed',requestId:options.requestId,report:key,errorName:error?.name??null,errorCode:typeof error?.code==='string'?error.code:null}));if(!res.headersSent)sendError(res,apiError('MANAGEMENT_REPORT_EXPORT_FAILED','Không xuất được báo cáo quản trị',{},true,503),options.requestId,options.receivedAt);else if(!res.destroyed)res.destroy(error instanceof Error?error:undefined);}finally{if(artifact?.cleanup){try{await artifact.cleanup();}catch{}}}
}

export async function handleAdminLotDRoutes(req,res,options){const url=new URL(req.url??'/','http://127.0.0.1');if(url.pathname===EXPORT_ROOT){await handleExportRequest(req,res,options,url);return true;}if(url.pathname===ALERT_ROOT||url.pathname.startsWith(`${ALERT_ROOT}/`)){await handleAlertRequest(req,res,options,url);return true;}return false;}

export const adminLotDInternals=Object.freeze({LOT_D_RULES,DOMAIN_LABELS,REPORT_READ_PERMISSIONS,stableAlertId,salesAlerts,debtAlerts,inventoryAlerts,failedDeliveryAlerts,codAlerts,applyLifecycle});
