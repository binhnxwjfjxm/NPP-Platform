import type { AdjustmentLine, InventoryAdjustment } from './inventory-adjustment-types';

export function adjustmentLineDisplay(
  adjustment: InventoryAdjustment,
  line: AdjustmentLine,
  loadedOnHand?: string | null,
): Readonly<{
  delta: string;
  before: string | null;
  after: string | null;
  beforeLabel: string;
  afterLabel: string;
}>;
