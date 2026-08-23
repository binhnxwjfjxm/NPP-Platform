import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  assessLocation,
  buildMcpAnomalies,
  canTransitionAlertStatus,
  haversineMeters,
} from '../src/routes/reporting-mcp-alert-rules.js';

const mcpSupervisionRoutePath = new URL('../src/routes/reporting-mcp-alerts.js', import.meta.url);

test('location assessment uses GPS distance plus recorded accuracy only', () => {
  const close = assessLocation({ checked_in: true, checkin_lat: 10, checkin_lng: 106, checkin_accuracy: 10, outlet_lat: 10.0001, outlet_lng: 106, outlet_accuracy: 5 });
  assert.equal(close.status, 'consistent');
  const far = assessLocation({ checked_in: true, checkin_lat: 10, checkin_lng: 106, checkin_accuracy: 5, outlet_lat: 10.001, outlet_lng: 106, outlet_accuracy: 5 });
  assert.equal(far.status, 'review');
  assert.ok(Number.isInteger(far.distanceMeters));
  assert.equal(far.uncertaintyMeters, 10);
  const missing = assessLocation({ checked_in: true, checkin_lat: 10, checkin_lng: 106, outlet_lat: 10, outlet_lng: 106 });
  assert.equal(missing.status, 'insufficient');
  assert.ok(haversineMeters(10, 106, 10.001, 106) > 100);
});

test('MCP anomalies are review signals, not misconduct conclusions', () => {
  const alerts = buildMcpAnomalies([{
    session_customer_id: 'session_customer_1', session_id: 'session_1', session_date: '2026-08-22', route_name: 'Tuyến 1', customer_name: 'Điểm A', visit_status: 'visited', checked_in: true,
    checkin_at: '2026-08-22T03:00:00Z', checkin_lat: 10, checkin_lng: 106, checkin_accuracy: 5, outlet_lat: 10.001, outlet_lng: 106, outlet_accuracy: 5,
    order_id: null, test_id: null, report_id: null, followup_count: '0', has_visit: false,
  }]);
  assert.ok(alerts.some((alert) => alert.ruleCode === 'MCP_LOCATION_OUTSIDE_ACCURACY'));
  assert.ok(alerts.some((alert) => alert.ruleCode === 'MCP_CHECKIN_WITHOUT_ACTIVITY'));
  assert.ok(alerts.every((alert) => !/gian lận|vi phạm|giả mạo/i.test(`${alert.summary} ${alert.recommendation}`)));
});

test('MCP supervision approved read contract exposes the full GPS evidence required by Admin', async () => {
  const source = await readFile(mcpSupervisionRoutePath, 'utf8');

  for (const field of [
    'routeCustomerId',
    'checkinLat',
    'checkinLng',
    'checkinAccuracy',
    'checkinSource',
    'outletLat',
    'outletLng',
    'outletAccuracy',
    'outletGeoCapturedAt',
    'outletGeoSource',
    'locationStatus',
    'distanceMeters',
    'uncertaintyMeters',
  ]) {
    assert.match(source, new RegExp(`${field}:`));
  }
  assert.match(source, /outlets: Object\.freeze\(rows\.map\(publicOutlet\)\)/);
});

test('alert lifecycle is sequential and deny-by-default for skips', () => {
  assert.equal(canTransitionAlertStatus('new', 'seen'), true);
  assert.equal(canTransitionAlertStatus('seen', 'handling'), true);
  assert.equal(canTransitionAlertStatus('handling', 'resolved'), true);
  assert.equal(canTransitionAlertStatus('new', 'resolved'), false);
  assert.equal(canTransitionAlertStatus('resolved', 'handling'), false);
});
