export type InventoryCostingRun = {
  id: string;
  methodVersion: 'MWA_V1';
  currencyCode: 'VND';
  warehouseIds: string[];
  ledgerLineCount: number;
  factCount: number;
  anomalyCount: number;
  startedAt: string;
  completedAt: string;
  createdBy: string;
  requestId: string;
};

export type InventoryCostBalance = {
  warehouseId: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  baseVariantId: string;
  baseSku: string | null;
  methodVersion: 'MWA_V1';
  currencyCode: 'VND';
  quantity: string;
  inventoryValue: string | null;
  averageUnitCost: string | null;
  status: 'COSTED' | 'ANOMALY';
  anomalyCount: number;
  projectedThroughEvent: string;
  rebuildRunId: string;
  updatedAt: string;
};

export type InventoryCostFact = {
  id: string;
  rebuildRunId: string;
  eventOrder: string;
  status: 'COSTED' | 'ANOMALY';
  eventType: string;
  inventoryMovementId: string;
  inventoryMovementLineId: string;
  reversalOfCostFactId: string | null;
  warehouseId: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  baseVariantId: string;
  baseSku: string | null;
  lotId: string | null;
  direction: 'IN' | 'OUT';
  quantityDelta: string;
  unitCost: string | null;
  valueDelta: string | null;
  currencyCode: 'VND';
  sourceCostType: string;
  sourceDocumentType: string | null;
  sourceDocumentId: string | null;
  sourceDocumentNumber: string | null;
  sourceLineReference: string | null;
  effectiveDate: string;
  movementPostedAt: string;
  movementLineNumber: number;
  metadata: Record<string, unknown>;
};

export type InventoryCostAnomaly = {
  id: string;
  rebuildRunId: string;
  inventoryMovementId: string;
  inventoryMovementLineId: string;
  warehouseId: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  baseVariantId: string;
  baseSku: string | null;
  code: string;
  message: string;
  details: Record<string, unknown>;
  createdAt: string;
};

export type InventoryCostReconciliation = {
  rebuildRunId: string;
  warehouseId: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  baseVariantId: string;
  baseSku: string | null;
  ledgerQuantity: string;
  costingQuantity: string;
  quantityDifference: string;
  inventoryValue: string | null;
  averageUnitCost: string | null;
  costingStatus: 'COSTED' | 'ANOMALY';
  anomalyCount: number;
  reconciliationStatus: 'OK' | 'QUANTITY_MISMATCH' | 'COST_ANOMALY';
};

export type InventoryCostingPeriod = {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: 'OPEN' | 'CLOSED';
  closedRebuildRunId: string | null;
  openedAt: string;
  openedBy: string;
  closedAt: string | null;
  closedBy: string | null;
  snapshotPoolCount: number;
  snapshotAnomalyPoolCount: number;
};

export type InventoryCostAdjustmentEvent = {
  id: string;
  eventType: 'LANDED_COST' | 'PURCHASE_PRICE_VARIANCE' | 'FORWARD_CORRECTION';
  effectiveDate: string;
  postingDate: string;
  warehouseId: string;
  warehouseCode: string | null;
  baseVariantId: string;
  baseSku: string | null;
  quantityDelta: string;
  valueDelta: string;
  currencyCode: 'VND';
  allocationGroupId: string | null;
  allocationBasis: 'PURCHASE_VALUE' | 'BASE_QUANTITY' | null;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceLineReference: string | null;
  originalCostFactId: string | null;
  originalMovementLineId: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export type InventoryCostDiscrepancy = {
  id: string;
  code: string;
  status: 'OPEN' | 'RESOLVED';
  warehouseId: string;
  warehouseCode: string | null;
  baseVariantId: string;
  baseSku: string | null;
  inventoryMovementId: string | null;
  inventoryMovementLineId: string | null;
  costAdjustmentEventId: string | null;
  periodId: string | null;
  stableKey: string;
  message: string;
  details: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
};

export type InventoryCostRebuildResult = {
  run: InventoryCostingRun;
  balances?: InventoryCostBalance[];
  anomalyCount: number;
  reconciliationMismatchCount?: number;
  discrepancyCount?: number;
  replayed: boolean;
};
