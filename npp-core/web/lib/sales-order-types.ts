export type SalesOrderStatus = 'draft' | 'confirmed' | 'cancelled' | 'closed';
export type SalesOrderVersionStatus = 'draft' | 'confirmed' | 'superseded' | 'cancelled';
export type SalesOrderCollectionPolicy = 'PREPAID' | 'COLLECT_ON_DELIVERY' | 'COLLECT_AFTER_DELIVERY' | 'CREDIT_TERMS';
export type SalesOrderDeliveryMode = 'DELIVERY' | 'PICKUP';
export type SalesOrderSourceType = 'MANUAL' | 'IMPORT' | 'API' | 'MCP';
export type SalesOrderCustomerMode = 'EXISTING' | 'WALK_IN';
export type SalesOrderTaxMode = 'EXCLUSIVE' | 'INCLUSIVE';

export type SalesOrderLine = {
  id: string;
  lineNumber: number;
  variantId: string;
  sku: string;
  itemName: string;
  unitId: string;
  unitCode: string;
  conversionToBase: string;
  quantity: string;
  baseQuantity: string;
  priceListId: string | null;
  priceRuleId: string | null;
  priceSource: 'PRICE_ENGINE' | 'MANUAL_OVERRIDE';
  unitPrice: string;
  discountMode: 'TOTAL_AMOUNT' | 'PER_UNIT' | 'PERCENT';
  discountValue: string;
  discountAmount: string;
  taxMode: SalesOrderTaxMode;
  taxRate: string;
  taxAmount: string;
  lineSubtotal: string;
  lineTotal: string;
  note: string | null;
};

export type SalesOrderVersion = {
  id: string;
  versionNumber: string;
  status: SalesOrderVersionStatus;
  customerId: string;
  customerCode: string;
  customerName: string;
  customerAddressId: string | null;
  customerAddress: Record<string, unknown> | null;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  deliveryMode: SalesOrderDeliveryMode;
  sourceType: SalesOrderSourceType;
  sourceId: string | null;
  sourceOutletId: string | null;
  collectionPolicy: SalesOrderCollectionPolicy;
  currency: 'VND';
  requestedDeliveryDate: string | null;
  note: string | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  amendmentReason: string | null;
  basedOnVersionNumber: string | null;
  priceOverrideReason: string | null;
  revision: string;
  createdAt: string;
  createdBy: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
  lines?: SalesOrderLine[];
};

export type SalesOrder = {
  id: string;
  number: string | null;
  status: SalesOrderStatus;
  currentVersionNumber: string;
  sourceType: SalesOrderSourceType;
  sourceId: string | null;
  sourceOutletId: string | null;
  customerId: string;
  customerCode: string;
  customerName: string;
  customerAddressId: string | null;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  deliveryMode: SalesOrderDeliveryMode;
  collectionPolicy: SalesOrderCollectionPolicy;
  fulfillmentStatus: string;
  deliveryStatus: string;
  settlementStatus: string;
  currency: 'VND';
  requestedDeliveryDate: string | null;
  note: string | null;
  revision: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  versions?: SalesOrderVersion[];
};

export type ListSalesOrdersParams = {
  limit?: number;
  offset?: number;
  status?: SalesOrderStatus | 'all';
  customerId?: string;
  warehouseId?: string;
  search?: string;
};

export type SalesOrderSkuEligibility = {
  selectable: boolean;
  code: string;
  message: string;
};

export type SalesOrderSkuSearchOption = {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  sku: string;
  variantName: string;
  barcode: string | null;
  unitId: string | null;
  unitCode: string | null;
  unitName: string | null;
  conversionToBase: string | null;
  allowsFractional: boolean | null;
  eligibility: SalesOrderSkuEligibility;
};

export type SalesPriceStep = {
  kind: 'BASE' | 'RULE' | 'SKIPPED' | 'MANUAL_OVERRIDE';
  reason?: string;
  priceListId?: string;
  priceListCode?: string;
  priceListType?: string;
  itemId?: string;
  adjustmentType?: string;
  amountMinor?: string | null;
  rateBps?: number | null;
  beforeUnitPriceMinor?: string | null;
  afterUnitPriceMinor?: string;
  priority?: number;
  stackingMode?: string;
  sourceKind?: string;
  sourceKey?: string | null;
  externalRuleCode?: string | null;
};

export type SalesPriceResolution = {
  variant: Record<string, unknown>;
  currencyCode: string;
  quantity: string;
  priceAt: string;
  customerId: string | null;
  customerGroupId: string | null;
  baseUnitPriceMinor: string;
  finalUnitPriceMinor: string;
  lineTotalMinor: string;
  steps: SalesPriceStep[];
};

export type SalesOrderLineDraft = {
  variantId: string;
  quantity: string;
  discountMode?: 'TOTAL_AMOUNT' | 'PER_UNIT' | 'PERCENT';
  discountValue?: string;
  taxMode?: SalesOrderTaxMode;
  taxRate?: string;
  manualUnitPriceMinor?: string;
  manualReason?: string;
  note?: string;
};

export type SalesOrderDraftPayload = {
  sourceType?: SalesOrderSourceType;
  sourceId?: string;
  sourceOutletId?: string;
  customerMode?: SalesOrderCustomerMode;
  customerId?: string;
  customerAddressId?: string;
  warehouseId: string;
  deliveryMode: SalesOrderDeliveryMode;
  collectionPolicy: SalesOrderCollectionPolicy;
  currency: 'VND';
  requestedDeliveryDate?: string;
  note?: string;
  expectedRevision?: string;
  creditOverrideReason?: string;
  lines: SalesOrderLineDraft[];
};
