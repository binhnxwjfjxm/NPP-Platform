export type InventoryReportingFilters = Readonly<{
  from: string;
  to: string;
  warehouseId: string | null;
  slowDays: number;
}>;

export type InventoryReportingSummary = Readonly<{
  stockPositionCount?: string;
  stockedSkuCount?: string;
  reservedPositionCount?: string;
  lotScopeCount?: string;
  inventoryValueVnd?: string;
  costingExceptionCount?: string;
}>;

export type InventoryPeriodFlowRow = Readonly<{
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  variantId: string;
  sku: string;
  openingQuantity: string;
  inboundQuantity: string;
  outboundQuantity: string;
  closingQuantity: string;
  movementLineCount: string;
  lastPostedAt: string | null;
}>;

export type InventoryMovementTypeRow = Readonly<{
  movementType: string;
  movementCount: string;
  movementLineCount: string;
  skuCount: string;
}>;

export type InventoryWarehouseSummaryRow = Readonly<{
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  stockedSkuCount: string;
  reservedSkuCount: string;
  inventoryValueVnd: string;
  costingExceptionCount: string;
  quantityProjectedThrough: string | null;
  costingUpdatedAt: string | null;
}>;

export type InventoryPositionRow = Readonly<{
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  variantId: string;
  sku: string;
  onHandQuantity: string;
  reservedQuantity: string;
  availableQuantity: string;
  costingQuantity: string | null;
  currencyCode: string | null;
  inventoryValue: string | null;
  averageUnitCost: string | null;
  costingStatus: string;
  anomalyCount: string;
  projectedThrough: string | null;
}>;

export type InventorySlowMovingRow = Readonly<{
  warehouseId: string;
  warehouseCode: string;
  variantId: string;
  sku: string;
  onHandQuantity: string;
  reservedQuantity: string;
  availableQuantity: string;
  lastOutDate: string | null;
  daysSinceOutbound: string | null;
  neverOutbound: boolean;
  inventoryValueVnd: string | null;
}>;

export type InventoryExpiryLotRow = Readonly<{
  warehouseId: string;
  warehouseCode: string;
  variantId: string;
  sku: string;
  lotId: string;
  lotCode: string;
  manufacturedDate: string | null;
  expiryDate: string | null;
  onHandQuantity: string;
  reservedQuantity: string;
  availableQuantity: string;
  manufacturedAgeDays: string | null;
  daysToExpiry: string | null;
  expiryBucket: 'NO_EXPIRY' | 'EXPIRED' | 'EXPIRING_30_DAYS' | 'EXPIRING_90_DAYS' | 'ACTIVE';
}>;

export type InventoryExceptionRow = Readonly<{
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  variantId: string;
  sku: string;
  ledgerQuantity: string;
  costingQuantity: string;
  quantityDifference: string;
  inventoryValueVnd: string | null;
  averageUnitCost: string | null;
  costingStatus: string;
  anomalyCount: string;
  reconciliationStatus: string;
}>;

export type InventoryProjectionState = Readonly<{
  ledgerThrough?: string | null;
  quantityProjectedThrough?: string | null;
  costingProjectedThrough?: string | null;
  quantityProjectionStale?: boolean;
}>;

export type InventoryReportingDashboard = Readonly<{
  family: 'inventory';
  generatedAt: string;
  timezone: 'Asia/Ho_Chi_Minh';
  currentDate: string;
  filters: InventoryReportingFilters;
  basis: Readonly<{
    quantityTruth: string;
    currentAvailability: string;
    currentValue: string;
    lotAge: string;
    slowMoving: string;
  }>;
  summary: InventoryReportingSummary;
  periodFlow: readonly InventoryPeriodFlowRow[];
  movementTypes: readonly InventoryMovementTypeRow[];
  warehouseSummary: readonly InventoryWarehouseSummaryRow[];
  currentPositions: readonly InventoryPositionRow[];
  slowMoving: readonly InventorySlowMovingRow[];
  expiryLots: readonly InventoryExpiryLotRow[];
  exceptions: readonly InventoryExceptionRow[];
  projectionState: InventoryProjectionState;
}>;
