import 'server-only';

import { CoreApiError, requestCore } from '../../lib/core-api';
import { normalizeReportPeriod, resolveReportRange, type ReportPeriod } from '../reports/report-data';

export type AlertStatus = 'new' | 'seen' | 'handling' | 'resolved';
export type AlertSeverity = 'critical' | 'high' | 'attention';
export type AlertDomain = 'sales' | 'debt' | 'inventory' | 'delivery' | 'mcp';
export type AdminAlert = {
  id: string;
  domain: AlertDomain;
  domainLabel: string;
  ruleCode: string;
  ruleName: string;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  entity: string;
  source: 'Công Ty' | 'MCP';
  context: string;
  employeeName: string;
  employeeCode: string;
  routeName: string;
  detectedAt: string | null;
  threshold: string;
  actual: string;
  summary: string;
  recommendation: string;
  evidence: string[];
  history: Array<{ status: AlertStatus; actorId: string; actorLabel: string; employeeId: string | null; occurredAt: string }>;
};
export type AlertRule = { code: string; domain: AlertDomain; domainLabel: string; name: string; metric: string; threshold: string; severity: AlertSeverity };
export type AlertDomainAccess = Record<AlertDomain, { available: boolean; message: string | null }>;
export type AlertCenterData = { period: ReportPeriod; from: string; to: string; alerts: AdminAlert[]; rules: AlertRule[]; domainAccess: AlertDomainAccess; message: string | null };

const DOMAIN_LABELS: Record<AlertDomain, string> = { sales: 'Kinh doanh', debt: 'Công nợ', inventory: 'Kho', delivery: 'Giao vận', mcp: 'MCP' };
const EMPTY_ACCESS: AlertDomainAccess = {
  sales: { available: false, message: 'Nguồn cảnh báo Kinh doanh chưa sẵn sàng.' },
  debt: { available: false, message: 'Nguồn cảnh báo Công nợ chưa sẵn sàng.' },
  inventory: { available: false, message: 'Nguồn cảnh báo Kho chưa sẵn sàng.' },
  delivery: { available: false, message: 'Nguồn cảnh báo Giao vận chưa sẵn sàng.' },
  mcp: { available: false, message: 'Nguồn cảnh báo MCP chưa sẵn sàng.' },
};

function validStatus(value: unknown): value is AlertStatus { return value === 'new' || value === 'seen' || value === 'handling' || value === 'resolved'; }
function validSeverity(value: unknown): value is AlertSeverity { return value === 'critical' || value === 'high' || value === 'attention'; }
function validDomain(value: unknown): value is AlertDomain { return value === 'sales' || value === 'debt' || value === 'inventory' || value === 'delivery' || value === 'mcp'; }
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function string(value: unknown, fallback = ''): string { return typeof value === 'string' && value.trim() ? value.trim() : fallback; }

function normalizeAlert(value: unknown): AdminAlert | null {
  const row = record(value); if (!row || !validStatus(row.status) || !validSeverity(row.severity) || !validDomain(row.domain)) return null;
  const history = Array.isArray(row.history) ? row.history.flatMap((value) => {
    const event = record(value); if (!event || !validStatus(event.status) || typeof event.occurredAt !== 'string') return [];
    const actorId = string(event.actorId, 'Hệ thống');
    return [{ status: event.status, actorId, actorLabel: string(event.actorLabel, actorId), employeeId: typeof event.employeeId === 'string' ? event.employeeId : null, occurredAt: event.occurredAt }];
  }) : [];
  const evidence = Array.isArray(row.evidence) ? row.evidence.filter((item): item is string => typeof item === 'string') : [];
  const id = string(row.id); const ruleCode = string(row.ruleCode); if (!id || !ruleCode) return null;
  const source = row.source === 'MCP' ? 'MCP' : 'Công Ty';
  return {
    id, domain: row.domain, domainLabel: string(row.domainLabel, DOMAIN_LABELS[row.domain]), ruleCode,
    ruleName: string(row.ruleName, 'Quy tắc cảnh báo'), severity: row.severity, status: row.status,
    title: string(row.title, 'Cảnh báo quản trị'), entity: string(row.entity, 'Đối tượng cần rà soát'), source,
    context: string(row.context), employeeName: string(row.employeeName), employeeCode: string(row.employeeCode), routeName: string(row.routeName),
    detectedAt: typeof row.detectedAt === 'string' ? row.detectedAt : null,
    threshold: string(row.threshold, 'Theo bằng chứng hiện có'), actual: string(row.actual, 'Chưa có dữ liệu'),
    summary: string(row.summary, 'Cần rà soát thêm dữ liệu liên quan.'), recommendation: string(row.recommendation, 'Rà soát dữ liệu trước khi kết luận.'), evidence, history,
  };
}
function normalizeRule(value: unknown): AlertRule | null {
  const row = record(value); if (!row || !validSeverity(row.severity) || !validDomain(row.domain)) return null; const code = string(row.code); if (!code) return null;
  return { code, domain: row.domain, domainLabel: string(row.domainLabel, DOMAIN_LABELS[row.domain]), name: string(row.name, 'Quy tắc cảnh báo'), metric: string(row.metric, 'Tín hiệu quản trị'), threshold: string(row.threshold, 'Theo dữ liệu hiện có'), severity: row.severity };
}
function normalizeAccess(value: unknown): AlertDomainAccess {
  const source = record(value);
  return Object.fromEntries((Object.keys(DOMAIN_LABELS) as AlertDomain[]).map((domain) => {
    const item = record(source?.[domain]);
    return [domain, { available: item?.available === true, message: typeof item?.message === 'string' ? item.message : null }];
  })) as AlertDomainAccess;
}

export async function loadAlertCenter(periodInput?: string): Promise<AlertCenterData> {
  const period = normalizeReportPeriod(periodInput); const range = resolveReportRange(period); const query = new URLSearchParams({ from: range.from, to: range.to });
  try {
    const payload = await requestCore<unknown>(`/api/reporting/admin-alerts?${query.toString()}`); const data = record(payload);
    const alerts = Array.isArray(data?.alerts) ? data.alerts.flatMap((item) => normalizeAlert(item) ?? []) : [];
    const rules = Array.isArray(data?.rules) ? data.rules.flatMap((item) => normalizeRule(item) ?? []) : [];
    return { period, from: range.from, to: range.to, alerts, rules, domainAccess: normalizeAccess(data?.domainAccess), message: null };
  } catch (error) {
    const message = error instanceof CoreApiError && error.statusCode === 403
      ? 'Tài khoản hiện tại không có quyền xem cảnh báo quản trị.'
      : 'Không thể tải cảnh báo ở thời điểm hiện tại.';
    return { period, from: range.from, to: range.to, alerts: [], rules: [], domainAccess: EMPTY_ACCESS, message };
  }
}
export async function loadAlertById(alertId: string, periodInput?: string): Promise<{ data: AlertCenterData; alert: AdminAlert | null }> { const data = await loadAlertCenter(periodInput); return { data, alert: data.alerts.find((item) => item.id === alertId) ?? null }; }
