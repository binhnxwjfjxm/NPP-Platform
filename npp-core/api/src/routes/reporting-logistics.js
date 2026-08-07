import { BUSINESS_TIMEZONE, mapRow, mapRows } from './reporting-common.js';

const TRIP_METRICS_CTE = `WITH scoped_trips AS (
  SELECT trip.id AS trip_id,
         trip.trip_number,
         trip.warehouse_id,
         warehouse.code AS warehouse_code,
         warehouse.name AS warehouse_name,
         trip.delivery_route_id,
         route.code AS route_code,
         route.name AS route_name,
         trip.vehicle_id,
         vehicle.code AS vehicle_code,
         vehicle.license_plate,
         vehicle.vehicle_type,
         trip.primary_driver_id AS driver_profile_id,
         driver.code AS driver_code,
         driver.name AS driver_name,
         driver.employee_id,
         trip.planned_start_at,
         trip.dispatched_at,
         trip.closed_at,
         trip.status
    FROM logistics.delivery_trips trip
    JOIN shared.warehouses warehouse
      ON warehouse.installation_id = trip.installation_id
     AND warehouse.id = trip.warehouse_id
    LEFT JOIN logistics.delivery_routes route
      ON route.installation_id = trip.installation_id
     AND route.id = trip.delivery_route_id
    LEFT JOIN logistics.vehicles vehicle
      ON vehicle.installation_id = trip.installation_id
     AND vehicle.id = trip.vehicle_id
    LEFT JOIN logistics.driver_profiles driver
      ON driver.installation_id = trip.installation_id
     AND driver.id = trip.primary_driver_id
   WHERE trip.installation_id = $1
     AND trip.warehouse_id = ANY($2::uuid[])
     AND ($5::uuid IS NULL OR trip.warehouse_id = $5::uuid)
     AND trip.planned_start_at >= $3::timestamptz
     AND trip.planned_start_at < $4::timestamptz
), trip_metrics AS (
  SELECT trip.*,
         count(DISTINCT stop.id)::bigint AS stop_count,
         count(DISTINCT dispatch.delivery_order_id)::bigint AS delivery_order_count,
         count(DISTINCT attempt.id)::bigint AS attempt_count,
         count(DISTINCT attempt.id) FILTER (WHERE attempt.result = 'delivered_full')::bigint AS delivered_full_count,
         count(DISTINCT attempt.id) FILTER (WHERE attempt.result = 'delivered_partial')::bigint AS delivered_partial_count,
         count(DISTINCT attempt.id) FILTER (WHERE attempt.result = 'failed')::bigint AS failed_count,
         count(DISTINCT attempt.id) FILTER (WHERE attempt.result = 'rescheduled')::bigint AS rescheduled_count,
         count(DISTINCT attempt.id) FILTER (
           WHERE attempt.result = 'delivered_full' AND stop.planned_arrival_at IS NOT NULL
         )::bigint AS on_time_eligible_full_count,
         count(DISTINCT attempt.id) FILTER (
           WHERE attempt.result = 'delivered_full'
             AND stop.planned_arrival_at IS NOT NULL
             AND attempt.attempted_at <= stop.planned_arrival_at
         )::bigint AS on_time_full_count,
         count(DISTINCT attempt.id) FILTER (
           WHERE attempt.result = 'delivered_full'
             AND stop.planned_arrival_at IS NOT NULL
             AND attempt.attempted_at > stop.planned_arrival_at
         )::bigint AS late_full_count,
         count(DISTINCT attempt.id) FILTER (
           WHERE attempt.result = 'delivered_full' AND stop.planned_arrival_at IS NULL
         )::bigint AS full_without_plan_count,
         GREATEST(
           count(DISTINCT dispatch.delivery_order_id) - count(DISTINCT attempt.delivery_order_id),
           0
         )::bigint AS pending_result_count,
         CASE
           WHEN trip.dispatched_at IS NOT NULL AND trip.closed_at IS NOT NULL
           THEN round(extract(epoch FROM (trip.closed_at - trip.dispatched_at)) / 60.0, 2)
           ELSE NULL
         END AS trip_duration_minutes
    FROM scoped_trips trip
    LEFT JOIN logistics.trip_stops stop
      ON stop.installation_id = $1
     AND stop.trip_id = trip.trip_id
    LEFT JOIN logistics.trip_dispatch_items dispatch
      ON dispatch.installation_id = $1
     AND dispatch.trip_id = trip.trip_id
    LEFT JOIN logistics.delivery_attempts attempt
      ON attempt.installation_id = $1
     AND attempt.trip_id = trip.trip_id
     AND attempt.delivery_order_id = dispatch.delivery_order_id
     AND attempt.trip_stop_id = stop.id
   GROUP BY trip.trip_id, trip.trip_number, trip.warehouse_id, trip.warehouse_code,
            trip.warehouse_name, trip.delivery_route_id, trip.route_code, trip.route_name,
            trip.vehicle_id, trip.vehicle_code, trip.license_plate, trip.vehicle_type,
            trip.driver_profile_id, trip.driver_code, trip.driver_name, trip.employee_id,
            trip.planned_start_at, trip.dispatched_at, trip.closed_at, trip.status
)`;

function percent(numerator, denominator) {
  return `CASE WHEN sum(${denominator}) = 0 THEN NULL
               ELSE round(100::numeric * sum(${numerator}) / sum(${denominator}), 2)::text END`;
}

export async function logisticsReport(adapter, requestContext, filters, warehouseIds) {
  const params = [
    requestContext.installationId,
    warehouseIds,
    filters.fromInstant,
    filters.toExclusiveInstant,
    filters.warehouseId,
  ];

  const [summary, statuses, warehouses, drivers, vehicles, reasons, trips, attempts, reconciliation, exceptions] = await Promise.all([
    adapter.query(
      `${TRIP_METRICS_CTE}
       SELECT count(*)::text AS trip_count,
              count(*) FILTER (WHERE status = 'dispatched')::text AS dispatched_trip_count,
              count(*) FILTER (WHERE status = 'closed')::text AS closed_trip_count,
              COALESCE(sum(stop_count), 0)::text AS stop_count,
              COALESCE(sum(delivery_order_count), 0)::text AS delivery_order_count,
              COALESCE(sum(attempt_count), 0)::text AS attempt_count,
              COALESCE(sum(delivered_full_count), 0)::text AS delivered_full_count,
              COALESCE(sum(delivered_partial_count), 0)::text AS delivered_partial_count,
              COALESCE(sum(failed_count), 0)::text AS failed_count,
              COALESCE(sum(rescheduled_count), 0)::text AS rescheduled_count,
              COALESCE(sum(on_time_eligible_full_count), 0)::text AS on_time_eligible_full_count,
              COALESCE(sum(on_time_full_count), 0)::text AS on_time_full_count,
              COALESCE(sum(late_full_count), 0)::text AS late_full_count,
              COALESCE(sum(full_without_plan_count), 0)::text AS full_without_plan_count,
              COALESCE(sum(pending_result_count), 0)::text AS pending_result_count,
              ${percent('on_time_full_count', 'on_time_eligible_full_count')} AS on_time_full_rate_percent,
              ${percent('on_time_eligible_full_count', 'delivered_full_count')} AS sla_coverage_percent,
              CASE WHEN count(*) FILTER (WHERE trip_duration_minutes IS NOT NULL) = 0 THEN NULL
                   ELSE round(avg(trip_duration_minutes) FILTER (WHERE trip_duration_minutes IS NOT NULL), 2)::text END AS average_closed_trip_duration_minutes
         FROM trip_metrics`,
      params,
    ),
    adapter.query(
      `${TRIP_METRICS_CTE}
       SELECT status,
              count(*)::text AS trip_count,
              COALESCE(sum(stop_count), 0)::text AS stop_count,
              COALESCE(sum(delivery_order_count), 0)::text AS delivery_order_count
         FROM trip_metrics
        GROUP BY status
        ORDER BY status`,
      params,
    ),
    adapter.query(
      `SELECT warehouse.id AS warehouse_id,
              warehouse.code AS warehouse_code,
              warehouse.name AS warehouse_name
         FROM shared.warehouses warehouse
        WHERE warehouse.installation_id = $1
          AND warehouse.id = ANY($2::uuid[])
        ORDER BY warehouse.code, warehouse.name, warehouse.id`,
      [requestContext.installationId, warehouseIds],
    ),
    adapter.query(
      `${TRIP_METRICS_CTE}
       SELECT driver_profile_id,
              driver_code,
              driver_name,
              employee_id,
              count(*)::text AS trip_count,
              count(*) FILTER (WHERE status IN ('dispatched', 'closed'))::text AS dispatched_trip_count,
              count(*) FILTER (WHERE status = 'closed')::text AS closed_trip_count,
              COALESCE(sum(stop_count), 0)::text AS stop_count,
              COALESCE(sum(delivery_order_count), 0)::text AS delivery_order_count,
              COALESCE(sum(delivered_full_count), 0)::text AS delivered_full_count,
              COALESCE(sum(delivered_partial_count), 0)::text AS delivered_partial_count,
              COALESCE(sum(failed_count), 0)::text AS failed_count,
              COALESCE(sum(rescheduled_count), 0)::text AS rescheduled_count,
              ${percent('on_time_full_count', 'on_time_eligible_full_count')} AS on_time_full_rate_percent,
              CASE WHEN count(*) FILTER (WHERE trip_duration_minutes IS NOT NULL) = 0 THEN NULL
                   ELSE round(avg(trip_duration_minutes) FILTER (WHERE trip_duration_minutes IS NOT NULL), 2)::text END AS average_closed_trip_duration_minutes
         FROM trip_metrics
        GROUP BY driver_profile_id, driver_code, driver_name, employee_id
        ORDER BY count(*) DESC, driver_code NULLS LAST, driver_profile_id NULLS LAST
        LIMIT 100`,
      params,
    ),
    adapter.query(
      `${TRIP_METRICS_CTE}
       SELECT vehicle_id,
              vehicle_code,
              license_plate,
              vehicle_type,
              count(*)::text AS trip_count,
              count(*) FILTER (WHERE status IN ('dispatched', 'closed'))::text AS dispatched_trip_count,
              count(*) FILTER (WHERE status = 'closed')::text AS closed_trip_count,
              COALESCE(sum(stop_count), 0)::text AS stop_count,
              COALESCE(sum(delivery_order_count), 0)::text AS delivery_order_count,
              COALESCE(sum(delivered_full_count), 0)::text AS delivered_full_count,
              COALESCE(sum(delivered_partial_count), 0)::text AS delivered_partial_count,
              COALESCE(sum(failed_count), 0)::text AS failed_count,
              COALESCE(sum(rescheduled_count), 0)::text AS rescheduled_count,
              ${percent('on_time_full_count', 'on_time_eligible_full_count')} AS on_time_full_rate_percent,
              CASE WHEN count(*) FILTER (WHERE trip_duration_minutes IS NOT NULL) = 0 THEN NULL
                   ELSE round(avg(trip_duration_minutes) FILTER (WHERE trip_duration_minutes IS NOT NULL), 2)::text END AS average_closed_trip_duration_minutes
         FROM trip_metrics
        GROUP BY vehicle_id, vehicle_code, license_plate, vehicle_type
        ORDER BY count(*) DESC, vehicle_code NULLS LAST, vehicle_id NULLS LAST
        LIMIT 100`,
      params,
    ),
    adapter.query(
      `WITH scoped_trips AS (
         SELECT id
           FROM logistics.delivery_trips
          WHERE installation_id = $1
            AND warehouse_id = ANY($2::uuid[])
            AND ($5::uuid IS NULL OR warehouse_id = $5::uuid)
            AND planned_start_at >= $3::timestamptz
            AND planned_start_at < $4::timestamptz
       )
       SELECT attempt.result,
              attempt.reason_code,
              count(*)::text AS attempt_count
         FROM logistics.delivery_attempts attempt
         JOIN scoped_trips trip ON trip.id = attempt.trip_id
        WHERE attempt.installation_id = $1
          AND attempt.result IN ('failed', 'rescheduled')
        GROUP BY attempt.result, attempt.reason_code
        ORDER BY count(*) DESC, attempt.result, attempt.reason_code`,
      params,
    ),
    adapter.query(
      `${TRIP_METRICS_CTE}
       SELECT trip_id,
              trip_number,
              warehouse_id,
              warehouse_code,
              warehouse_name,
              delivery_route_id,
              route_code,
              route_name,
              vehicle_id,
              vehicle_code,
              license_plate,
              driver_profile_id,
              driver_code,
              driver_name,
              planned_start_at,
              dispatched_at,
              closed_at,
              status,
              stop_count::text,
              delivery_order_count::text,
              attempt_count::text,
              delivered_full_count::text,
              delivered_partial_count::text,
              failed_count::text,
              rescheduled_count::text,
              on_time_eligible_full_count::text,
              on_time_full_count::text,
              late_full_count::text,
              full_without_plan_count::text,
              pending_result_count::text,
              CASE WHEN on_time_eligible_full_count = 0 THEN NULL
                   ELSE round(100::numeric * on_time_full_count / on_time_eligible_full_count, 2)::text END AS on_time_full_rate_percent,
              CASE WHEN trip_duration_minutes IS NULL THEN NULL ELSE trip_duration_minutes::text END AS trip_duration_minutes
         FROM trip_metrics
        ORDER BY planned_start_at DESC, trip_number DESC, trip_id DESC
        LIMIT 100`,
      params,
    ),
    adapter.query(
      `WITH scoped_trips AS (
         SELECT trip.id, trip.trip_number, trip.warehouse_id
           FROM logistics.delivery_trips trip
          WHERE trip.installation_id = $1
            AND trip.warehouse_id = ANY($2::uuid[])
            AND ($5::uuid IS NULL OR trip.warehouse_id = $5::uuid)
            AND trip.planned_start_at >= $3::timestamptz
            AND trip.planned_start_at < $4::timestamptz
       )
       SELECT attempt.id AS attempt_id,
              attempt.trip_id,
              trip.trip_number,
              attempt.trip_stop_id,
              stop.stop_sequence,
              stop.planned_arrival_at,
              attempt.delivery_order_id,
              delivery_order.delivery_order_number,
              delivery_order.customer_code_snapshot,
              delivery_order.customer_name_snapshot,
              attempt.driver_id AS driver_profile_id,
              driver.code AS driver_code,
              driver.name AS driver_name,
              attempt.result,
              attempt.reason_code,
              attempt.attempted_at,
              attempt.rescheduled_for,
              CASE WHEN attempt.result = 'delivered_full' AND stop.planned_arrival_at IS NOT NULL
                   THEN (attempt.attempted_at <= stop.planned_arrival_at)
                   ELSE NULL END AS on_time
         FROM logistics.delivery_attempts attempt
         JOIN scoped_trips trip ON trip.id = attempt.trip_id
         JOIN logistics.trip_stops stop
           ON stop.installation_id = attempt.installation_id
          AND stop.id = attempt.trip_stop_id
         JOIN sales.delivery_orders delivery_order
           ON delivery_order.installation_id = attempt.installation_id
          AND delivery_order.id = attempt.delivery_order_id
         JOIN logistics.driver_profiles driver
           ON driver.installation_id = attempt.installation_id
          AND driver.id = attempt.driver_id
        WHERE attempt.installation_id = $1
        ORDER BY attempt.attempted_at DESC, attempt.id DESC
        LIMIT 200`,
      params,
    ),
    adapter.query(
      `WITH scoped_trips AS (
         SELECT id
           FROM logistics.delivery_trips
          WHERE installation_id = $1
            AND warehouse_id = ANY($2::uuid[])
            AND ($5::uuid IS NULL OR warehouse_id = $5::uuid)
            AND planned_start_at >= $3::timestamptz
            AND planned_start_at < $4::timestamptz
       )
       SELECT count(DISTINCT receipt.id)::text AS posted_return_receipt_count,
              count(DISTINCT receipt.trip_id)::text AS trips_with_return_receipt_count
         FROM logistics.trip_return_receipts receipt
         JOIN scoped_trips trip ON trip.id = receipt.trip_id
        WHERE receipt.installation_id = $1
          AND receipt.status = 'POSTED'`,
      params,
    ),
    adapter.query(
      `WITH scoped_trips AS (
         SELECT id
           FROM logistics.delivery_trips
          WHERE installation_id = $1
            AND warehouse_id = ANY($2::uuid[])
            AND ($5::uuid IS NULL OR warehouse_id = $5::uuid)
            AND planned_start_at >= $3::timestamptz
            AND planned_start_at < $4::timestamptz
       ), missing_sla AS (
         SELECT count(*)::bigint AS exception_count
           FROM logistics.delivery_attempts attempt
           JOIN scoped_trips trip ON trip.id = attempt.trip_id
           JOIN logistics.trip_stops stop
             ON stop.installation_id = attempt.installation_id
            AND stop.id = attempt.trip_stop_id
          WHERE attempt.installation_id = $1
            AND attempt.result = 'delivered_full'
            AND stop.planned_arrival_at IS NULL
       ), pending_result AS (
         SELECT count(*)::bigint AS exception_count
           FROM logistics.trip_dispatch_items dispatch
           JOIN scoped_trips trip ON trip.id = dispatch.trip_id
           LEFT JOIN logistics.delivery_attempts attempt
             ON attempt.installation_id = dispatch.installation_id
            AND attempt.trip_id = dispatch.trip_id
            AND attempt.delivery_order_id = dispatch.delivery_order_id
          WHERE dispatch.installation_id = $1
            AND attempt.id IS NULL
       )
       SELECT 'MISSING_PLANNED_ARRIVAL'::text AS exception_code,
              (SELECT exception_count FROM missing_sla)::text AS exception_count
       UNION ALL
       SELECT 'PENDING_DELIVERY_RESULT'::text,
              (SELECT exception_count FROM pending_result)::text`,
      params,
    ),
  ]);

  return Object.freeze({
    family: 'logistics',
    generatedAt: requestContext.receivedAt,
    timezone: BUSINESS_TIMEZONE,
    filters: Object.freeze({ from: filters.from, to: filters.to, warehouseId: filters.warehouseId }),
    scope: Object.freeze({ warehouseIds: Object.freeze([...warehouseIds]) }),
    basis: Object.freeze({
      cohort: 'trip cohort uses canonical delivery_trips.planned_start_at within the Asia/Ho_Chi_Minh business-date range',
      sla: 'on-time counts only delivered_full attempts with canonical trip_stops.planned_arrival_at and attempted_at <= planned_arrival_at',
      slaCoverage: 'delivered_full attempts without planned_arrival_at are excluded from the on-time denominator and surfaced as missing-SLA coverage',
      outcomes: 'delivery outcomes use only delivered_full, delivered_partial, failed and rescheduled from immutable delivery_attempts',
      utilization: 'driver/vehicle utilization reports actual trip, stop, order, outcome counts and dispatch-to-close duration; no capacity percentage is invented',
      reconciliation: 'return receipt metrics count posted canonical reconciliation receipts only; quantities across unlike SKUs are never summed into a meaningless global total',
      drilldown: 'attempt rows expose canonical trip, stop, attempt and Delivery Order identifiers; source screens reauthorize their own resources',
      adminReuse: 'this report contract is the canonical Delivery/Logistics input for the owner-facing Admin Control Tower; Admin must not recalculate a second metric set',
    }),
    summary: mapRow(summary.rows?.[0] ?? {}),
    statuses: mapRows(statuses.rows),
    warehouses: mapRows(warehouses.rows),
    drivers: mapRows(drivers.rows),
    vehicles: mapRows(vehicles.rows),
    failureReasons: mapRows(reasons.rows),
    trips: mapRows(trips.rows),
    attempts: mapRows(attempts.rows),
    reconciliation: mapRow(reconciliation.rows?.[0] ?? {}),
    dataQuality: Object.freeze({ exceptions: mapRows(exceptions.rows) }),
  });
}