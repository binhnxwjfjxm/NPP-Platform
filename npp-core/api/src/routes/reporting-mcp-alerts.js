import { createSuccessEnvelope } from '@npp/contracts';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import { employeeMcpReport } from './reporting-employee-mcp.js';
import { BUSINESS_TIMEZONE } from './reporting-common.js';
import {
  ALERT_STATUSES,
  MCP_ALERT_RULES,
  assessLocation,
  buildMcpAnomalies,
  canTransitionAlertStatus,
  hasLinkedActivity,
} from './reporting-mcp-alert-rules.js';

const ALERT_RESOURCE_TYPE = 'admin-alert';
const ALERT_ACTION = 'admin.alert.status_changed';

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

async function locationRows(adapter, requestContext, filters, fieldScope) {
  const result = await adapter.query(
    `SELECT sc.id AS session_customer_id,
            sc.session_id,
            session.session_date::text,
            session.route_name,
            NULLIF(btrim(session.sales), '') AS sales_label,
            employee.id AS employee_id,
            employee.code AS employee_code,
            employee.full_name AS employee_name,
            sc.route_customer_id,
            sc.customer_id,
            sc.customer_name,
            sc.address,
            sc.visit_status,
            sc.checked_in,
            sc.checkin_at,
            sc.checkin_lat::text,
            sc.checkin_lng::text,
            sc.checkin_accuracy::text,
            sc.checkin_source,
            route_customer.geo_lat::text AS outlet_lat,
            route_customer.geo_lng::text AS outlet_lng,
            route_customer.geo_accuracy::text AS outlet_accuracy,
            route_customer.geo_captured_at AS outlet_geo_captured_at,
            route_customer.geo_source AS outlet_geo_source,
            sc.order_id,
            sc.test_id,
            sc.report_id,
            sc.followup_count::text,
            EXISTS (
              SELECT 1 FROM mcp.mcp_visits visit
               WHERE visit.installation_id = sc.installation_id
                 AND visit.session_customer_id = sc.id
            ) AS has_visit
       FROM mcp.mcp_route_sessions session
       JOIN mcp.mcp_session_customers sc
         ON sc.installation_id = session.installation_id
        AND sc.session_id = session.id
       LEFT JOIN mcp.mcp_route_customers route_customer
         ON route_customer.installation_id = sc.installation_id
        AND route_customer.id = sc.route_customer_id
       LEFT JOIN shared.employees employee
         ON employee.installation_id = session.installation_id
        AND employee.code = NULLIF(btrim(session.sales), '')
      WHERE session.installation_id = $1
        AND session.session_date BETWEEN $2::date AND $3::date
        AND ($4::text IS NULL OR NULLIF(btrim(session.sales), '') = $4::text)
      ORDER BY session.session_date DESC, sc.sort_order, sc.id
      LIMIT 500`,
    [requestContext.installationId, filters.from, filters.to, fieldScope.employeeCode],
  );
  return result.rows ?? [];
}

function publicOutlet(row) {
  const location = assessLocation(row);
  return Object.freeze({
    sessionCustomerId: String(row.session_customer_id),
    sessionId: String(row.session_id),
    sessionDate: String(row.session_date),
    routeName: text(row.route_name, 'Chưa có tuyến'),
    employeeId: row.employee_id == null ? null : String(row.employee_id),
    employeeCode: text(row.employee_code, text(row.sales_label, '')),
    employeeName: text(row.employee_name, text(row.sales_label, 'Nhân viên chưa khớp hồ sơ')),
    customerId: row.customer_id == null ? null : String(row.customer_id),
    customerName: text(row.customer_name, 'Điểm bán chưa có tên'),
    address: text(row.address, 'Chưa có địa chỉ'),
    visitStatus: text(row.visit_status, 'pending'),
    checkedIn: row.checked_in === true,
    checkinAt: row.checkin_at ?? null,
    locationStatus: location.status,
    distanceMeters: location.distanceMeters == null ? null : String(location.distanceMeters),
    uncertaintyMeters: location.uncertaintyMeters == null ? null : String(location.uncertaintyMeters),
    hasLinkedActivity: hasLinkedActivity(row),
  });
}

async function lifecycleRows(adapter, requestContext, alertIds) {
  if (!alertIds.length) return [];
  const result = await adapter.query(
    `SELECT resource_id, after_data, actor_id, employee_id, occurred_at
       FROM shared.core_audit_records
      WHERE installation_id = $1
        AND action = $2
        AND resource_type = $3
        AND resource_id = ANY($4::text[])
      ORDER BY occurred_at ASC, audit_id ASC`,
    [requestContext.installationId, ALERT_ACTION, ALERT_RESOURCE_TYPE, alertIds],
  );
  return result.rows ?? [];
}

function lifecycleState(rows, alertIds) {
  const states = new Map(alertIds.map((id) => [id, 'new']));
  const history = new Map(alertIds.map((id) => [id, []]));
  for (const row of rows) {
    const id = String(row.resource_id);
    const status = text(row.after_data?.status);
    if (!ALERT_STATUSES.includes(status) || !states.has(id)) continue;
    states.set(id, status);
    history.get(id)?.push(Object.freeze({
      status,
      actorId: String(row.actor_id),
      employeeId: row.employee_id == null ? null : String(row.employee_id),
      occurredAt: row.occurred_at,
    }));
  }
  return { states, history };
}

export async function mcpSupervisionReport(adapter, requestContext, filters, fieldScope) {
  const [base, rows] = await Promise.all([
    employeeMcpReport(adapter, requestContext, filters, fieldScope),
    locationRows(adapter, requestContext, filters, fieldScope),
  ]);
  const anomalies = buildMcpAnomalies(rows);
  return Object.freeze({
    family: 'mcp-supervision',
    generatedAt: requestContext.receivedAt,
    timezone: BUSINESS_TIMEZONE,
    filters: Object.freeze({ from: filters.from, to: filters.to }),
    summary: Object.freeze({
      employeeCount: String(base.fieldActors.length),
      routeCount: String(base.routes.length),
      sessionCount: String(base.sessions.length),
      visitedOutletCount: String(rows.filter((row) => row.visit_status === 'visited').length),
      checkinCount: String(rows.filter((row) => row.checked_in === true).length),
      reviewLocationCount: String(rows.filter((row) => assessLocation(row).status === 'review').length),
      anomalyCount: String(anomalies.length),
    }),
    fieldActors: base.fieldActors,
    routes: base.routes,
    sessions: base.sessions,
    outlets: Object.freeze(rows.map(publicOutlet)),
    anomalies,
    dataQuality: base.dataQuality,
  });
}

export async function adminAlertsReport(adapter, requestContext, filters, fieldScope) {
  const rows = await locationRows(adapter, requestContext, filters, fieldScope);
  const anomalies = buildMcpAnomalies(rows);
  const lifecycle = lifecycleState(
    await lifecycleRows(adapter, requestContext, anomalies.map((alert) => alert.id)),
    anomalies.map((alert) => alert.id),
  );
  const alerts = anomalies.map((alert) => Object.freeze({
    ...alert,
    status: lifecycle.states.get(alert.id) ?? 'new',
    history: Object.freeze(lifecycle.history.get(alert.id) ?? []),
  }));
  return Object.freeze({
    generatedAt: requestContext.receivedAt,
    timezone: BUSINESS_TIMEZONE,
    filters: Object.freeze({ from: filters.from, to: filters.to }),
    rules: MCP_ALERT_RULES,
    alerts: Object.freeze(alerts),
  });
}

function transitionError(code, publicMessage, statusCode) {
  const error = new Error(code);
  error.code = code;
  error.publicMessage = publicMessage;
  error.statusCode = statusCode;
  error.retryable = false;
  return error;
}

export async function updateAdminAlertStatus({ adapter, requestContext, alertId: id, nextStatus, filters, fieldScope }) {
  if (!ALERT_STATUSES.includes(nextStatus) || nextStatus === 'new') {
    throw transitionError('INVALID_ALERT_STATUS', 'Trạng thái cảnh báo không hợp lệ', 400);
  }
  const currentAlerts = await adminAlertsReport(adapter, requestContext, filters, fieldScope);
  const alert = currentAlerts.alerts.find((candidate) => candidate.id === id);
  if (!alert) throw transitionError('ALERT_NOT_FOUND', 'Cảnh báo không còn tồn tại trong phạm vi hiện tại', 404);
  if (!canTransitionAlertStatus(alert.status, nextStatus)) {
    throw transitionError('ALERT_STATUS_CONFLICT', 'Cảnh báo đã thay đổi trạng thái. Vui lòng tải lại dữ liệu.', 409);
  }

  return withAuditOutboxTransaction({
    adapter,
    mutate: async (client, helpers) => {
      const audit = buildAuditRecord({
        requestContext,
        action: ALERT_ACTION,
        resourceType: ALERT_RESOURCE_TYPE,
        resourceId: id,
        beforeData: { status: alert.status },
        afterData: { status: nextStatus, ruleCode: alert.ruleCode, title: alert.title, entity: alert.entity },
        metadata: { source: 'MCP' },
      });
      const event = buildOutboxEvent({
        requestContext,
        aggregateType: 'admin-alert',
        aggregateId: id,
        eventType: 'admin.alert.status-changed',
        payload: { alertId: id, fromStatus: alert.status, toStatus: nextStatus },
      });
      await insertAuditRecord(client, audit);
      await insertOutboxEvent(client, event);
      return Object.freeze({ alertId: id, status: nextStatus, auditId: audit.auditId, eventId: event.eventId });
    },
  });
}

export function alertMutationResponse(data, requestId, receivedAt) {
  return Object.freeze({
    statusCode: 200,
    contentType: 'application/json',
    requestId,
    body: createSuccessEnvelope(data, requestId, receivedAt),
  });
}
