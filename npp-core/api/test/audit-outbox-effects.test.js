import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditOutboxEffect,
  combineAuditOutboxEffects,
  transactionExpectations,
} from '../src/audit-outbox-effects.js';

test('nested business operations compose audit and outbox effects without hard-coded totals', () => {
  assert.deepEqual(
    combineAuditOutboxEffects(
      auditOutboxEffect(1, 1),
      auditOutboxEffect(1, 1),
      undefined,
    ),
    { auditRecords: 2, outboxEvents: 2 },
  );
  assert.deepEqual(
    transactionExpectations(auditOutboxEffect(1, 1), auditOutboxEffect(1, 1)),
    { expectedAuditCount: 2, expectedOutboxCount: 2 },
  );
});

test('invalid effect counts fail closed before a transaction can commit', () => {
  assert.throws(() => auditOutboxEffect(-1, 0), /invalid_audit_record_count/);
  assert.throws(() => auditOutboxEffect(0, 101), /invalid_outbox_event_count/);
  assert.throws(
    () => combineAuditOutboxEffects({ auditRecords: 0.5, outboxEvents: 0 }),
    /invalid_audit_record_count/,
  );
});
