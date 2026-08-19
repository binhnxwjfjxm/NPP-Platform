function count(value, name) {
  const normalized = Number(value ?? 0);
  if (!Number.isInteger(normalized) || normalized < 0 || normalized > 100) {
    throw new Error(`invalid_${name}_count`);
  }
  return normalized;
}

export function auditOutboxEffect(auditRecords = 0, outboxEvents = 0) {
  return Object.freeze({
    auditRecords: count(auditRecords, 'audit_record'),
    outboxEvents: count(outboxEvents, 'outbox_event'),
  });
}

export function combineAuditOutboxEffects(...effects) {
  return effects.reduce(
    (combined, effect) => auditOutboxEffect(
      combined.auditRecords + count(effect?.auditRecords, 'audit_record'),
      combined.outboxEvents + count(effect?.outboxEvents, 'outbox_event'),
    ),
    auditOutboxEffect(),
  );
}

export function transactionExpectations(...effects) {
  const combined = combineAuditOutboxEffects(...effects);
  return Object.freeze({
    expectedAuditCount: combined.auditRecords,
    expectedOutboxCount: combined.outboxEvents,
  });
}
