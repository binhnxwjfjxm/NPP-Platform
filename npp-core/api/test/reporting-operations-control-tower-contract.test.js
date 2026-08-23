import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';
import { PERMISSIONS, PERMISSION_REGISTRY } from '../src/access/permissions.js';
import {
  auditHistoryReport,
  importExportHistoryReport,
  normalizeAuditHistoryFilters,
  normalizeImportExportHistoryFilters,
  operationsReportingInternals,
} from '../src/routes/reporting-operations.js';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const period = Object.freeze({
  from: '2026-08-01',
  to: '2026-08-08',
  fromInstant: '2026-07-31T17:00:00.000Z',
  toExclusiveInstant: '2026-08-08T17:00:00.000Z',
});

test('Phase 8.7 registers deny-by-default history/control-tower/export permissions and migration 070', () => {
  assert.equal(PERMISSIONS.coreReportingAuditHistoryRead, 'core.reporting.audit-history.read');
  assert.equal(PERMISSIONS.coreReportingControlTowerRead, 'core.reporting.control-tower.read');
  assert.equal(PERMISSIONS.coreReportingExport, 'core.reporting.export');
  assert.ok(PERMISSION_REGISTRY.has(PERMISSIONS.coreReportingAuditHistoryRead));
  assert.ok(PERMISSION_REGISTRY.has(PERMISSIONS.coreReportingControlTowerRead));
  assert.ok(PERMISSION_REGISTRY.has(PERMISSIONS.coreReportingExport));

  const previous = CORE_API_MIGRATIONS.findIndex((entry) => entry.id === '069_reporting_cod_permission_catalog');
  const current = CORE_API_MIGRATIONS.findIndex((entry) => entry.id === '070_reporting_operations_history_control_tower');
  assert.ok(previous >= 0 && current === previous + 1);
  const sql = CORE_API_MIGRATIONS[current].sql;
  assert.match(sql, /CREATE TABLE IF NOT EXISTS reporting\.import_export_jobs/);
  assert.match(sql, /core\.reporting\.audit-history\.read/);
  assert.match(sql, /core\.reporting\.control-tower\.read/);
  assert.match(sql, /core\.reporting\.export/);
  assert.doesNotMatch(sql, /role_permission/i);
});

test('Phase 8.7 history filters are bounded and cursors are fail-closed without losing microseconds', () => {
  const audit = normalizeAuditHistoryFilters(new URLSearchParams({ limit: '200', action: 'sales.order.confirmed' }), period);
  assert.equal(audit.ok, true);
  assert.equal(audit.limit, 200);
  assert.equal(audit.action, 'sales.order.confirmed');
  assert.equal(normalizeAuditHistoryFilters(new URLSearchParams({ limit: '201' }), period).ok, false);
  assert.equal(normalizeAuditHistoryFilters(new URLSearchParams({ cursor: 'not-a-cursor' }), period).ok, false);

  const preciseAt = '2026-08-08T00:00:00.123456Z';
  const cursor = operationsReportingInternals.encodeCursor(preciseAt, randomUUID());
  const withCursor = normalizeAuditHistoryFilters(new URLSearchParams({ cursor }), period);
  assert.equal(withCursor.ok, true);
  assert.equal(withCursor.cursor.at, preciseAt);
  assert.equal(operationsReportingInternals.isValidCursorTimestamp('2026-02-31T00:00:00.123456Z'), false);

  const transfer = normalizeImportExportHistoryFilters(new URLSearchParams({ direction: 'export', status: 'completed' }), period);
  assert.equal(transfer.ok, true);
  assert.equal(transfer.direction, 'EXPORT');
  assert.equal(transfer.status, 'completed');
  assert.equal(normalizeImportExportHistoryFilters(new URLSearchParams({ direction: 'download' }), period).ok, false);
});

test('Phase 8.7 audit history is installation-owned, deterministic and does not expose payload metadata', async () => {
  const firstId = randomUUID();
  const secondId = randomUUID();
  const captured = [];
  const adapter = {
    async query(sql, params) {
      captured.push({ sql, params });
      return { rows: [
        {
          audit_id: firstId,
          actor_id: 'actor:a',
          employee_id: null,
          source_app: 'npp',
          request_id: 'req-a',
          action: 'a',
          resource_type: 'sales-order',
          resource_id: '1',
          occurred_at: '2026-08-08T00:00:00.123Z',
          cursor_at: '2026-08-08T00:00:00.123456Z',
          has_before_data: false,
          has_after_data: true,
          has_metadata: true,
          metadata: { email: 'user@example.test', nested: { accessToken: 'must-not-leak' } },
        },
        {
          audit_id: secondId,
          actor_id: 'actor:b',
          employee_id: null,
          source_app: 'npp',
          request_id: 'req-b',
          action: 'b',
          resource_type: 'sales-order',
          resource_id: '2',
          occurred_at: '2026-08-07T00:00:00.000Z',
          cursor_at: '2026-08-07T00:00:00.000000Z',
          has_before_data: true,
          has_after_data: true,
          has_metadata: false,
          metadata: {},
        },
      ] };
    },
  };
  const report = await auditHistoryReport(
    adapter,
    Object.freeze({ installationId: 'installation-a', receivedAt: '2026-08-08T01:00:00.000Z' }),
    Object.freeze({ ...period, limit: 1, cursor: null, action: null, resourceType: null, sourceApp: null }),
  );
  assert.match(captured[0].sql, /WHERE installation_id = \$1/);
  assert.match(captured[0].sql, /ORDER BY occurred_at DESC, audit_id DESC/);
  assert.match(captured[0].sql, /to_char\(occurred_at AT TIME ZONE 'UTC'/);
  assert.doesNotMatch(captured[0].sql, /\n\s*metadata\s*(?:,|\n)/);
  assert.equal(captured[0].params[0], 'installation-a');
  assert.equal(report.rows.length, 1);
  assert.equal(report.page.hasMore, true);
  assert.ok(report.page.nextCursor);
  assert.equal(report.rows[0].hasMetadata, true);
  assert.equal(Object.prototype.hasOwnProperty.call(report.rows[0], 'beforeData'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(report.rows[0], 'afterData'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(report.rows[0], 'metadata'), false);
  const decoded = operationsReportingInternals.decodeCursor(report.page.nextCursor);
  assert.equal(decoded.at, '2026-08-08T00:00:00.123456Z');
});

test('Phase 8.7 import/export history never exposes canonical storage object keys', async () => {
  const jobId = randomUUID();
  const adapter = {
    async query(sql) {
      assert.match(sql, /to_char\(requested_at AT TIME ZONE 'UTC'/);
      return { rows: [{
        job_id: jobId,
        direction: 'EXPORT',
        definition_key: 'sales.summary',
        definition_version: '1',
        format: 'csv',
        status: 'completed',
        actor_id: 'actor:a',
        employee_id: null,
        source_app: 'npp',
        request_id: 'req-a',
        normalized_filters: {},
        effective_scopes: {},
        business_timezone: 'Asia/Ho_Chi_Minh',
        source_as_of: '2026-08-08T00:00:00.000Z',
        row_count: '12',
        has_result: true,
        result_object_key: 'private/object/key.csv',
        result_checksum_sha256: 'a'.repeat(64),
        failure_code: null,
        requested_at: '2026-08-08T00:00:00.123Z',
        cursor_at: '2026-08-08T00:00:00.123456Z',
        started_at: '2026-08-08T00:00:01.000Z',
        completed_at: '2026-08-08T00:00:02.000Z',
      }] };
    },
  };
  const report = await importExportHistoryReport(
    adapter,
    Object.freeze({ installationId: 'installation-a', receivedAt: '2026-08-08T01:00:00.000Z' }),
    Object.freeze({ ...period, limit: 100, cursor: null, direction: null, status: null, definitionKey: null }),
  );
  assert.equal(report.rows[0].hasResult, true);
  assert.equal(Object.prototype.hasOwnProperty.call(report.rows[0], 'resultObjectKey'), false);
});

test('Phase 8.7 control tower reuses Phase 8.1-8.6 report contracts and fails closed for MCP scope', () => {
  const operations = source('../src/routes/reporting-operations.js');
  assert.match(operations, /salesReport\(adapter, requestContext, filters, warehouseIds\)/);
  assert.match(operations, /purchasingReport\(adapter, requestContext, filters, warehouseIds\)/);
  assert.match(operations, /inventoryReport\(adapter, requestContext, filters, warehouseIds\)/);
  assert.match(operations, /agingReport\(adapter, requestContext, filters, warehouseIds\)/);
  assert.match(operations, /grossMarginReport\(adapter, requestContext, filters, warehouseIds\)/);
  assert.match(operations, /employeeMcpReport\(adapter, requestContext, filters, fieldScope\)/);
  assert.match(operations, /logisticsReport\(adapter, requestContext, filters, warehouseIds\)/);
  assert.match(operations, /codReport\(adapter, requestContext, filters, warehouseIds\)/);
  assert.match(operations, /Promise\.allSettled/);
  assert.match(operations, /EMPLOYEE_MCP_SCOPE_DENIED/);
  assert.match(operations, /requiresCanonicalEmployeeMcpScope\(requestContext\)/);
  assert.match(operations, /resolveReportingMcpScope\(adapter, requestContext\)/);
  assert.doesNotMatch(operations, /FROM\s+(sales|purchasing|inventory|accounting|logistics)\./i);
});
