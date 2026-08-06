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

export type InventoryCostRebuildResult = {
  run: InventoryCostingRun;
  balances?: InventoryCostBalance[];
  anomalyCount: number;
  replayed: boolean;
};
