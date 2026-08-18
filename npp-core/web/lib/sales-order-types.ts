export type SalesOrderStatus = 'draft' | 'confirmed' | 'cancelled' | 'closed';
export type SalesOrderVersionStatus = 'draft' | 'confirmed' | 'superseded' | 'cancelled';
export type SalesOrderCollectionPolicy = 'PREPAID' | 'COLLECT_ON_DELIVERY' | 'COLLECT_AFTER_DELIVERY' | 'CREDIT_TERMS';
export type SalesOrderDeliveryMode = 'DELIVERY' | 'PICKUP';
export type SalesOrderDeliveryExecutionMode = 'TRIP' | 'MANUAL';
export type SalesOrderSourceType = 'MANUAL' | 'IMPORT' | 'API' | 'MCP';
export type SalesOrderCustomerMode = 'EXISTING' | 'WALK_IN';
export type SalesOrderTaxMode = 'EXCLUSIVE' | 'INCLUSIVE';
export type SalesOrderDocumentDiscountMode = 'NONE' | 'PERCENT' | 'TOTAL_AMOUNT';
export type SalesOrderFulfillmentStatus =
  | 'unallocated'
  | 'backordered'
  | 'partially_reserved'
  | 'reserved'
  | 'partially_allocated'
  | 'allocated'
  | 'partially_fulfilled'
  | 'fulfilled'
  | 'cancelled';

export type SalesOrderChannel = {
  id: string;
  code: string;
  name: string;
};

export type SalesPriceStep = {
  kind: 'RESOLUTION' | 'BASE' | 'RULE' | 'SKIPPED' | 'MANUAL_OVERRIDE';
  reason?: string;
  resolutionFingerprint?: string;
  channelId?: string | null;
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
  baseUnitPrice: string;
  systemUnitPrice: string;
  unitPrice: string;
  manualOverrideReason: string | null;
  pricingTrace: SalesPriceStep[];
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
  customerMode: SalesOrderCustomerMode;
  customerId: string;
  customerCode: string;
  customerName: string;
  walkInDisplayName: string | null;
  walkInPhone: string | null;
  customerAddressId: string | null;
  customerAddress: Record<string, unknown> | null;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  salesChannelId: string | null;
  salesChannelCode: string | null;
  salesChannelName: string | null;
  deliveryMode: SalesOrderDeliveryMode;
  deliveryExecutionMode?: SalesOrderDeliveryExecutionMode | null;
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
  documentDiscountMode: SalesOrderDocumentDiscountMode;
  documentDiscountValue: string;
  documentDiscountReason: string | null;
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

export type SalesOrderFulfillmentLine = {
  id: string;
  salesOrderVersionId: string;
  salesOrderLineId: string;
  lineNumber: number;
  warehouseId: string;
  salesVariantId: string;
  baseVariantId: string;
  sku: string;
  baseUnitCode: string;
  orderedBaseQuantity: string;
  reservedBaseQuantity: string;
  backorderedBaseQuantity: string;
  allocatedBaseQuantity: string;
  pickedBaseQuantity: string;
  packedBaseQuantity: string;
  issuedBaseQuantity: string;
  cancelledBaseQuantity: string;
  warehouseOnHandBaseQuantity: string | null;
  warehouseHeldByOthersBaseQuantity: string | null;
  warehouseAvailableBaseQuantity: string | null;
  state: 'ACTIVE' | 'SUPERSEDED' | 'CANCELLED' | 'COMPLETED';
  createdAt: string;
  updatedAt: string;
};

export type SalesOrderFulfillmentProjection = {
  status: SalesOrderFulfillmentStatus;
  allowBackorder: boolean;
  totals: {
    orderedBaseQuantity: string;
    reservedBaseQuantity: string;
    backorderedBaseQuantity: string;
    allocatedBaseQuantity: string;
    pickedBaseQuantity: string;
    packedBaseQuantity: string;
    issuedBaseQuantity: string;
    cancelledBaseQuantity: string;
  };
  lines: SalesOrderFulfillmentLine[];
};

export type SalesOrder = {
  id: string;
  number: string | null;
  status: SalesOrderStatus;
  currentVersionNumber: string;
  sourceType: SalesOrderSourceType;
  sourceId: string | null;
  sourceOutletId: string | null;
  customerMode: SalesOrderCustomerMode;
  customerId: string;
  customerCode: string;
  customerName: string;
  walkInDisplayName: string | null;
  walkInPhone: string | null;
  customerAddressId: string | null;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  salesChannelId: string | null;
  salesChannelCode: string | null;
  salesChannelName: string | null;
  deliveryMode: SalesOrderDeliveryMode;
  deliveryExecutionMode?: SalesOrderDeliveryExecutionMode | null;
  collectionPolicy: SalesOrderCollectionPolicy;
  fulfillmentStatus: SalesOrderFulfillmentStatus;
  fulfillment?: SalesOrderFulfillmentProjection | null;
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
  defaultTaxMode: SalesOrderTaxMode;
  defaultTaxRate: string;
  eligibility: SalesOrderSkuEligibility;
};

export type SalesPriceResolution = {
  variant: Record<string, unknown>;
  currencyCode: string;
  quantity: string;
  priceAt: string;
  channelId: string | null;
  customerId: string | null;
  customerGroupId: string | null;
  baseUnitPriceMinor: string;
  systemUnitPriceMinor: string;
  finalUnitPriceMinor: string;
  lineTotalMinor: string;
  resolutionFingerprint: string;
  steps: SalesPriceStep[];
};

export type SalesOrderLineDraft = {
  variantId: string;
  quantity: string;
  taxMode?: SalesOrderTaxMode;
  taxRate?: string;
  manualUnitPriceMinor?: string;
  manualReason?: string;
  expectedSystemUnitPriceMinor?: string;
  expectedPricingFingerprint?: string;
  note?: string;
};

export type SalesOrderDraftPayload = {
  sourceType?: SalesOrderSourceType;
  sourceId?: string;
  sourceOutletId?: string;
  customerMode?: SalesOrderCustomerMode;
  customerId?: string;
  walkInDisplayName?: string;
  walkInPhone?: string;
  customerAddressId?: string;
  warehouseId: string;
  salesChannelId: string;
  pricingAt?: string;
  deliveryMode: SalesOrderDeliveryMode;
  deliveryExecutionMode?: SalesOrderDeliveryExecutionMode;
  collectionPolicy: SalesOrderCollectionPolicy;
  currency: 'VND';
  requestedDeliveryDate?: string;
  note?: string;
  expectedRevision?: string;
  creditOverrideReason?: string;
  documentDiscountMode?: SalesOrderDocumentDiscountMode;
  documentDiscountValue?: string;
  documentDiscountReason?: string;
  lines: SalesOrderLineDraft[];
};

export type SalesOrderEntrySettings = {
  walkInConfigured: boolean;
  walkInBootstrapSupported: boolean;
  defaultTaxMode: SalesOrderTaxMode;
  defaultTaxRate: string;
  salesChannels: SalesOrderChannel[];
  defaultSalesChannelId: string | null;
  permissions: {
    canPriceOverride: boolean;
    canDiscountOverride: boolean;
    canConfirm: boolean;
  };
};