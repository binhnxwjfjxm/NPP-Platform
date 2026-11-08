import { addExactDecimal, subtractExactDecimal } from './decimal-display.js';

// Reconciliation values are immutable snapshots captured when the import was confirmed.
// After posting, current balances can change; never present them as the document's historical state.
export function adjustmentLineDisplay(adjustment, line, loadedOnHand = null) {
  const delta = adjustment.documentKind === 'MANUAL_ADJUSTMENT' && adjustment.adjustmentDirection === 'IN'
    ? line.baseQuantity
    : subtractExactDecimal('0', line.baseQuantity) ?? `-${line.baseQuantity}`;

  const hasImportSnapshot = Boolean(adjustment.reconciliationBatchCode)
    && line.systemBaseQuantity !== null
    && line.systemBaseQuantity !== undefined
    && line.countedBaseQuantity !== null
    && line.countedBaseQuantity !== undefined;
  if (hasImportSnapshot) {
    return Object.freeze({
      delta,
      before: line.systemBaseQuantity,
      after: line.countedBaseQuantity,
      beforeLabel: 'Tồn hệ thống khi lập phiếu',
      afterLabel: 'Tồn kiểm kê theo file',
    });
  }

  const canPreview = ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(adjustment.status);
  const before = canPreview ? loadedOnHand : null;
  const after = before === null || before === undefined
    ? null
    : addExactDecimal(before, delta);
  return Object.freeze({
    delta,
    before: before ?? null,
    after,
    beforeLabel: 'Tồn hiện tại',
    afterLabel: 'Tồn sau điều chỉnh dự kiến',
  });
}
