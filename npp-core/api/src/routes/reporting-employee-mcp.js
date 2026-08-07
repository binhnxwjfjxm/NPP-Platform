import { BUSINESS_TIMEZONE, mapRow, mapRows } from './reporting-common.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(code, message, statusCode = 403, details = {}) {
  return Object.freeze({ ok: false, code, message, statusCode, details });
}

export async function resolveEmployeeMcpScope(adapter, requestContext) {
  const branchIds = Array.isArray(requestContext.scopes?.branchIds) ? requestContext.scopes.branchIds : [];
  const territoryIds = Array.isArray(requestContext.scopes?.territoryIds) ? requestContext.scopes.territoryIds : [];

  if (branchIds.length) {
    return failure(
      'EMPLOYEE_MCP_BRANCH_SCOPE_UNAVAILABLE',
      'Dữ liệu MCP hiện chưa có branch_id canonical để áp phạm vi chi nhánh',
    );
  }
  if (territoryIds.length) {
    return failure(
      'EMPLOYEE_MCP_TERRITORY_SCOPE_UNAVAILABLE',
      'Dữ liệu MCP hiện chưa có territory_id canonical để áp phạm vi địa bàn',
    );
  }

  const employeeId = String(requestContext.employeeId ?? '').trim().toLowerCase();
  if (!employeeId) {
    return Object.freeze({ ok: true, employeeCode: null, employeeId: null, basis: 'INSTALLATION' });
  }
  if (!UUID_PATTERN.test(employeeId)) {
    return failure('EMPLOYEE_MCP_EMPLOYEE_SCOPE_INVALID', 'Phạm vi nhân viên không hợp lệ');
  }

  const employee = await adapter.query(
    `SELECT id, code
       FROM shared.employees
      WHERE installation_id = $1
        AND id = $2::uuid
        AND is_active = true
      LIMIT 1`,
    [requestContext.installationId, employeeId],
  );
  const row = employee.rows?.[0];
  if (!row?.code) {
    return failure(
      'EMPLOYEE_MCP_EMPLOYEE_SCOPE_UNRESOLVED',
      'Không xác định được mã nhân viên canonical cho phạm vi hiện tại',
    );
  }

  return Object.freeze({ ok: true, employeeCode: String(row.code), employeeId: String(row.id), basis: 'EMPLOYEE_CODE' });
}

const SESSION_METRICS_CTE = `WITH scoped_sessions AS (
  SELECT session.id AS session_id,
         session.route_id,
         route.route_code,
         session.route_name,
         session.session_date,
         NULLIF(btrim(session.sales), '') AS sales_label,
         session.area,
         session.status,
         session.planned_customers AS stored_planned_customers,
         session.visited_customers AS stored_visited_customers,
         session.order_count AS stored_order_count,
         session.opened_at,
         session.closed_at,
         employee.id AS employee_id,
         employee.code AS employee_code,
         employee.full_name AS employee_name
    FROM mcp.mcp_route_sessions session
    LEFT JOIN mcp.mcp_routes route
      ON route.installation_id = session.installation_id
     AND route.id = session.route_id
    LEFT JOIN shared.employees employee
      ON employee.installation_id = session.installation_id
     AND employee.code = NULLIF(btrim(session.sales), '')
   WHERE session.installation_id = $1
     AND session.session_date BETWEEN $2::date AND $3::date
     AND ($4::text IS NULL OR NULLIF(btrim(session.sales), '') = $4::text)
), customer_facts AS (
  SELECT session.session_id,
         count(customer.id) FILTER (WHERE customer.source = 'planned')::bigint AS planned_outlet_count,
         count(customer.id) FILTER (WHERE customer.source = 'planned' AND customer.visit_status = 'visited')::bigint AS planned_visited_outlet_count,
         count(customer.id) FILTER (WHERE customer.visit_status = 'visited')::bigint AS visited_outlet_count,
         count(customer.id) FILTER (WHERE customer.checked_in = true)::bigint AS checked_in_outlet_count
    FROM scoped_sessions session
    LEFT JOIN mcp.mcp_session_customers customer
      ON customer.installation_id = $1
     AND customer.session_id = session.session_id
   GROUP BY session.session_id
), visit_facts AS (
  SELECT session.session_id,
         count(visit.id)::bigint AS visit_count
    FROM scoped_sessions session
    LEFT JOIN mcp.mcp_visits visit
      ON visit.installation_id = $1
     AND visit.session_id = session.session_id
   GROUP BY session.session_id
), order_facts AS (
  SELECT session.session_id,
         count(DISTINCT order_row.id)::bigint AS order_intent_count,
         count(DISTINCT order_row.id) FILTER (
           WHERE order_row.customer_onboarding_submitted_at IS NOT NULL
         )::bigint AS onboarding_submitted_count,
         count(DISTINCT order_row.id) FILTER (
           WHERE order_row.customer_onboarding_status IN ('approved', 'linked_existing')
         )::bigint AS onboarding_converted_count,
         count(DISTINCT order_row.id) FILTER (
           WHERE order_row.core_sales_order_id IS NOT NULL
         )::bigint AS core_sales_order_count
    FROM scoped_sessions session
    LEFT JOIN mcp.mcp_session_customers customer
      ON customer.installation_id = $1
     AND customer.session_id = session.session_id
    LEFT JOIN mcp.orders order_row
      ON order_row.installation_id = $1
     AND order_row.id = customer.order_id
   GROUP BY session.session_id
), session_metrics AS (
  SELECT session.*,
         COALESCE(customer.planned_outlet_count, 0)::bigint AS planned_outlet_count,
         COALESCE(customer.planned_visited_outlet_count, 0)::bigint AS planned_visited_outlet_count,
         COALESCE(customer.visited_outlet_count, 0)::bigint AS visited_outlet_count,
         COALESCE(customer.checked_in_outlet_count, 0)::bigint AS checked_in_outlet_count,
         COALESCE(visit.visit_count, 0)::bigint AS visit_count,
         COALESCE(order_fact.order_intent_count, 0)::bigint AS order_intent_count,
         COALESCE(order_fact.onboarding_submitted_count, 0)::bigint AS onboarding_submitted_count,
         COALESCE(order_fact.onboarding_converted_count, 0)::bigint AS onboarding_converted_count,
         COALESCE(order_fact.core_sales_order_count, 0)::bigint AS core_sales_order_count,
         (session.stored_planned_customers <> COALESCE(customer.planned_outlet_count, 0)
           OR session.stored_visited_customers <> COALESCE(customer.visited_outlet_count, 0)
           OR session.stored_order_count <> COALESCE(order_fact.order_intent_count, 0)) AS stored_counter_mismatch
    FROM scoped_sessions session
    LEFT JOIN customer_facts customer ON customer.session_id = session.session_id
    LEFT JOIN visit_facts visit ON visit.session_id = session.session_id
    LEFT JOIN order_facts order_fact ON order_fact.session_id = session.session_id
)`;

function percent(numerator, denominator) {
  return `CASE WHEN sum(${denominator}) = 0 THEN NULL
               ELSE round(100::numeric * sum(${numerator}) / sum(${denominator}), 2)::text END`;
}

export async function employeeMcpReport(adapter, requestContext, filters, fieldScope) {
  const params = [requestContext.installationId, filters.from, filters.to, fieldScope.employeeCode];
  const [summary, actors, routes, sessions, unmappedActors, counterMismatches] = await Promise.all([
    adapter.query(
      `${SESSION_METRICS_CTE}
       SELECT count(*)::text AS session_count,
              count(DISTINCT route_id)::text AS route_count,
              COALESCE(sum(planned_outlet_count), 0)::text AS planned_outlet_count,
              COALESCE(sum(planned_visited_outlet_count), 0)::text AS planned_visited_outlet_count,
              COALESCE(sum(visited_outlet_count), 0)::text AS visited_outlet_count,
              COALESCE(sum(checked_in_outlet_count), 0)::text AS checked_in_outlet_count,
              COALESCE(sum(visit_count), 0)::text AS visit_count,
              COALESCE(sum(order_intent_count), 0)::text AS order_intent_count,
              COALESCE(sum(onboarding_submitted_count), 0)::text AS onboarding_submitted_count,
              COALESCE(sum(onboarding_converted_count), 0)::text AS onboarding_converted_count,
              COALESCE(sum(core_sales_order_count), 0)::text AS core_sales_order_count,
              count(*) FILTER (WHERE employee_id IS NOT NULL)::text AS mapped_employee_session_count,
              count(*) FILTER (WHERE employee_id IS NULL)::text AS unmapped_employee_session_count,
              count(*) FILTER (WHERE stored_counter_mismatch)::text AS counter_mismatch_session_count,
              ${percent('planned_visited_outlet_count', 'planned_outlet_count')} AS planned_visit_rate_percent,
              ${percent('order_intent_count', 'visited_outlet_count')} AS order_intent_conversion_percent,
              ${percent('onboarding_converted_count', 'onboarding_submitted_count')} AS onboarding_conversion_percent,
              ${percent('core_sales_order_count', 'order_intent_count')} AS core_order_conversion_percent
         FROM session_metrics`,
      params,
    ),
    adapter.query(
      `${SESSION_METRICS_CTE}
       SELECT sales_label,
              employee_id,
              employee_code,
              employee_name,
              count(*)::text AS session_count,
              count(DISTINCT route_id)::text AS route_count,
              sum(planned_outlet_count)::text AS planned_outlet_count,
              sum(planned_visited_outlet_count)::text AS planned_visited_outlet_count,
              sum(visited_outlet_count)::text AS visited_outlet_count,
              sum(checked_in_outlet_count)::text AS checked_in_outlet_count,
              sum(visit_count)::text AS visit_count,
              sum(order_intent_count)::text AS order_intent_count,
              sum(onboarding_submitted_count)::text AS onboarding_submitted_count,
              sum(onboarding_converted_count)::text AS onboarding_converted_count,
              sum(core_sales_order_count)::text AS core_sales_order_count,
              ${percent('planned_visited_outlet_count', 'planned_outlet_count')} AS planned_visit_rate_percent,
              ${percent('order_intent_count', 'visited_outlet_count')} AS order_intent_conversion_percent,
              ${percent('core_sales_order_count', 'order_intent_count')} AS core_order_conversion_percent
         FROM session_metrics
        GROUP BY sales_label, employee_id, employee_code, employee_name
        ORDER BY sum(visited_outlet_count) DESC, sales_label NULLS LAST
        LIMIT 100`,
      params,
    ),
    adapter.query(
      `${SESSION_METRICS_CTE}
       SELECT route_id,
              max(route_code) AS route_code,
              max(route_name) AS route_name,
              max(area) AS area,
              sales_label,
              employee_id,
              employee_code,
              employee_name,
              count(*)::text AS session_count,
              sum(planned_outlet_count)::text AS planned_outlet_count,
              sum(planned_visited_outlet_count)::text AS planned_visited_outlet_count,
              sum(visited_outlet_count)::text AS visited_outlet_count,
              sum(checked_in_outlet_count)::text AS checked_in_outlet_count,
              sum(order_intent_count)::text AS order_intent_count,
              sum(core_sales_order_count)::text AS core_sales_order_count,
              ${percent('planned_visited_outlet_count', 'planned_outlet_count')} AS planned_visit_rate_percent
         FROM session_metrics
        GROUP BY route_id, sales_label, employee_id, employee_code, employee_name
        ORDER BY sum(visited_outlet_count) DESC, max(route_code), route_id
        LIMIT 100`,
      params,
    ),
    adapter.query(
      `${SESSION_METRICS_CTE}
       SELECT session_id,
              session_date::text,
              route_id,
              route_code,
              route_name,
              area,
              sales_label,
              employee_id,
              employee_code,
              employee_name,
              status,
              planned_outlet_count::text,
              planned_visited_outlet_count::text,
              visited_outlet_count::text,
              checked_in_outlet_count::text,
              visit_count::text,
              order_intent_count::text,
              onboarding_submitted_count::text,
              onboarding_converted_count::text,
              core_sales_order_count::text,
              stored_counter_mismatch,
              opened_at,
              closed_at
         FROM session_metrics
        ORDER BY session_date DESC, opened_at DESC NULLS LAST, session_id DESC
        LIMIT 100`,
      params,
    ),
    adapter.query(
      `${SESSION_METRICS_CTE}
       SELECT CASE WHEN sales_label IS NULL THEN 'MISSING_FIELD_ACTOR_CODE' ELSE 'UNMAPPED_EMPLOYEE_CODE' END AS exception_code,
              sales_label,
              count(*)::text AS session_count,
              min(session_date)::text AS first_session_date,
              max(session_date)::text AS last_session_date
         FROM session_metrics
        WHERE employee_id IS NULL
        GROUP BY sales_label
        ORDER BY count(*) DESC, sales_label NULLS FIRST`,
      params,
    ),
    adapter.query(
      `${SESSION_METRICS_CTE}
       SELECT 'SESSION_COUNTER_MISMATCH'::text AS exception_code,
              session_id,
              session_date::text,
              route_id,
              route_code,
              route_name,
              sales_label,
              stored_planned_customers::text,
              planned_outlet_count::text AS derived_planned_outlet_count,
              stored_visited_customers::text,
              visited_outlet_count::text AS derived_visited_outlet_count,
              stored_order_count::text,
              order_intent_count::text AS derived_order_intent_count
         FROM session_metrics
        WHERE stored_counter_mismatch
        ORDER BY session_date DESC, session_id DESC
        LIMIT 100`,
      params,
    ),
  ]);

  return Object.freeze({
    family: 'employee-mcp',
    generatedAt: requestContext.receivedAt,
    timezone: BUSINESS_TIMEZONE,
    filters: Object.freeze({ from: filters.from, to: filters.to }),
    scope: Object.freeze({ basis: fieldScope.basis, employeeId: fieldScope.employeeId, employeeCode: fieldScope.employeeCode }),
    basis: Object.freeze({
      identity: 'MCP field actor remains sales text; canonical employee mapping requires exact shared.employees.code equality only',
      territory: 'MCP area is descriptive and is never inferred into a canonical territory scope',
      visits: 'planned/visited/check-in metrics are derived from mcp_session_customers and mcp_visits child facts',
      conversion: 'order intent is session_customer.order_id; onboarding uses canonical sync fields; official conversion requires core_sales_order_id',
      customerBoundary: 'a field outlet is not a Core customer unless canonical onboarding/Core references prove the conversion',
      adminReuse: 'this report contract is the canonical input for the owner-facing Admin Control Tower; Admin must not recalculate a second metric set',
    }),
    summary: mapRow(summary.rows?.[0] ?? {}),
    fieldActors: mapRows(actors.rows),
    routes: mapRows(routes.rows),
    sessions: mapRows(sessions.rows),
    dataQuality: Object.freeze({
      unmappedActors: mapRows(unmappedActors.rows),
      counterMismatches: mapRows(counterMismatches.rows),
    }),
  });
}
