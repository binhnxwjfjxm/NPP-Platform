export type ReportingWarehouseFilter = Readonly<{ warehouseId: string | null }>;

export type ReportingWarehouseOption = Readonly<{
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
}>;

export type AgingBucketRow = Readonly<{
  currencyCode: string;
  ageBucket: string;
  documentCount: string;
  remainingAmount: string;
}>;

export type AgingPartyRow = Readonly<{
  customerId?: string;
  customerCode?: string;
  customerName?: string;
  supplierId?: string;
  supplierCode?: string;
  supplierName?: string;
  currencyCode: string;
  documentCount: string;
  remainingAmount: string;
  oldestDocumentDate?: string;
  oldestAgeDays?: string;
  earliestDueDate?: string;
  maxOverdueDays?: string;
}>;

export type AgingDocumentRow = Readonly<{
  receivableDocumentId?: string;
  payableDocumentId?: string;
  customerId?: string;
  customerCode?: string;
  customerName?: string;
  supplierId?: string;
  supplierCode?: string;
  supplierName?: string;
  warehouseId: string;
  warehouseCode: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentNumber: string;
  sourceDocumentDate: string;
  collectionPolicy?: string;
  paymentMethodSnapshot?: string;
  paymentTermDaysSnapshot?: string;
  dueDate?: string;
  currencyCode: string;
  originalAmount: string;
  allocatedAmount: string;
  remainingAmount: string;
  ageDays?: string;
  overdueDays?: string;
  ageBucket: string;
}>;

export type AgingDashboard = Readonly<{
  family: 'aging';
  generatedAt: string;
  timezone: 'Asia/Ho_Chi_Minh';
  currentDate: string;
  filters: ReportingWarehouseFilter;
  scopeWarehouses: readonly ReportingWarehouseOption[];
  basis: Readonly<{ receivable: string; payable: string; currency: string }>;
  receivable: Readonly<{
    summary: readonly AgingBucketRow[];
    customers: readonly AgingPartyRow[];
    documents: readonly AgingDocumentRow[];
  }>;
  payable: Readonly<{
    summary: readonly AgingBucketRow[];
    suppliers: readonly AgingPartyRow[];
    documents: readonly AgingDocumentRow[];
  }>;
}>;

export type GrossMarginSummary = Readonly<{
  eventLineCount?: string;
  comparableLineCount?: string;
  missingLineageCount?: string;
  missingCostCount?: string;
  costAnomalyCount?: string;
  nonVndCount?: string;
  netRevenueVnd?: string;
  cogsVnd?: string;
  grossMarginVnd?: string;
  grossMarginPercent?: string | null;
  costingCompletedAt?: string | null;
}>;

export type GrossMarginGroupRow = Readonly<{
  customerId?: string;
  customerCode?: string;
  customerName?: string;
  variantId?: string;
  sku?: string;
  lineCount: string;
  netRevenueVnd: string;
  cogsVnd: string;
  grossMarginVnd: string;
  grossMarginPercent: string | null;
}>;

export type GrossMarginLineRow = Readonly<{
  eventKind: 'SALE' | 'RETURN';
  accountingDocumentId: string;
  documentNumber: string;
  documentDate: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  warehouseId: string;
  warehouseCode: string;
  variantId: string;
  sku: string;
  currencyCode: string;
  netRevenue: string;
  cogs?: string;
  grossMargin?: string;
  exceptionCode?: string;
  rebuildRunId?: string;
  costingCompletedAt?: string;
  sourceLineId: string;
  costingMovementLineId?: string;
}>;

export type GrossMarginDashboard = Readonly<{
  family: 'gross-margin';
  generatedAt: string;
  timezone: 'Asia/Ho_Chi_Minh';
  filters: Readonly<{ from: string; to: string; warehouseId: string | null }>;
  basis: Readonly<{ revenue: string; cogs: string; comparableCurrency: string; lineage: string }>;
  summary: GrossMarginSummary;
  topCustomers: readonly GrossMarginGroupRow[];
  topSkus: readonly GrossMarginGroupRow[];
  lines: readonly GrossMarginLineRow[];
  exceptions: readonly GrossMarginLineRow[];
}>;
