export type ReportingFamily = 'sales' | 'purchasing';

export type ReportingFilters = Readonly<{
  from: string;
  to: string;
  warehouseId: string | null;
}>;

export type ReportingBasis = Readonly<{
  date: string;
  value: string;
  effectiveStates: readonly string[];
}>;

export type ReportingSummary = Readonly<{
  allOrderCount?: string;
  effectiveOrderCount?: string;
  cancelledOrderCount?: string;
  pendingApprovalCount?: string;
  postedReceiptCount?: string;
  reversedReceiptCount?: string;
}>;

export type ReportingCurrencyTotal = Readonly<{
  currencyCode: string;
  documentCount: string;
  totalValue: string;
}>;

export type ReportingStatusRow = Readonly<{
  dimension: string;
  state: string;
  documentCount: string;
}>;

export type ReportingTrendRow = Readonly<{
  businessDate: string;
  currencyCode: string;
  documentCount: string;
  totalValue: string;
}>;

export type ReportingEntityRow = Readonly<{
  currencyCode: string;
  entityId: string;
  entityCode: string;
  entityName: string;
  documentCount: string;
  totalValue: string;
}>;

export type ReportingSkuRow = Readonly<{
  currencyCode: string;
  variantId: string;
  sku: string;
  itemName: string;
  baseQuantity: string;
  totalValue: string;
  sampleDocumentNumber: string;
}>;

export type ReportingDashboard = Readonly<{
  family: ReportingFamily;
  generatedAt: string;
  timezone: 'Asia/Ho_Chi_Minh';
  filters: ReportingFilters;
  basis: ReportingBasis;
  summary: ReportingSummary;
  currencyTotals: readonly ReportingCurrencyTotal[];
  statusBreakdown: readonly ReportingStatusRow[];
  dailyTrend: readonly ReportingTrendRow[];
  topEntities: readonly ReportingEntityRow[];
  topSkus: readonly ReportingSkuRow[];
}>;
