export type SalesReportingFilters = Readonly<{
  from: string;
  to: string;
  warehouseId: string | null;
  productGroupId: string | null;
  customerGroupId: string | null;
  includeZeroProducts: boolean;
}>;

export type SalesScopeWarehouse = Readonly<{
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
}>;

export type SalesReportingUnit = Readonly<{
  id: string | null;
  code: string;
  name: string;
}>;

export type SalesRevenueSummary = Readonly<{
  currencyCode: string;
  revenue: string;
  previousRevenue: string;
  changePercent: string | null;
  documentCount: string;
}>;

export type SalesQuantitySummary = Readonly<{
  currencyCode: string;
  unit: SalesReportingUnit;
  quantity: string;
  previousQuantity: string;
  changePercent: string | null;
}>;

export type SalesReportingSummary = Readonly<{
  allOrderCount: string;
  effectiveOrderCount: string;
  cancelledOrderCount: string;
  buyerCount: string;
  soldProductCount: string;
  revenues: readonly SalesRevenueSummary[];
  quantities: readonly SalesQuantitySummary[];
}>;

export type SalesBreakdownKey = 'customers' | 'customerGroups' | 'channels' | 'products' | 'productGroups' | 'employees';

export type SalesBreakdownRow = Readonly<{
  id: string | null;
  code: string | null;
  name: string;
  source: string;
  currencyCode: string;
  unit: SalesReportingUnit;
  revenue: string;
  quantity: string;
  documentCount: string;
  customerCount: string;
  productCount: string;
  sharePercent: string;
  previousRevenue: string;
  previousQuantity: string;
  changePercent: string | null;
  comparisonState: 'new' | 'inactive' | 'comparable';
}>;

export type SalesReportingTrendRow = Readonly<{
  businessDate: string;
  currencyCode: string;
  revenue: string;
  totalValue: string;
  previousRevenue: string;
  changePercent: string | null;
}>;

export type SalesClassificationOption = Readonly<{
  id: string;
  code: string | null;
  name: string;
}>;

export type SalesProductGroupOption = SalesClassificationOption & Readonly<{
  parentCategoryId: string | null;
}>;

export type SalesReportingClassification = Readonly<{
  options: Readonly<{
    productGroups: readonly SalesProductGroupOption[];
    customerGroups: readonly SalesClassificationOption[];
  }>;
}>;

export type SalesReportingDashboard = Readonly<{
  family: 'sales';
  contractVersion: string;
  generatedAt: string;
  timezone: 'Asia/Ho_Chi_Minh';
  filters: SalesReportingFilters;
  scopeWarehouses: readonly SalesScopeWarehouse[];
  basis: Readonly<{
    date: string;
    revenue: string;
    quantity: string;
    classification: string;
    employee: string;
    historicalDimensions: string;
    effectiveStates: readonly string[];
  }>;
  comparison: Readonly<{
    current: Readonly<{ from: string; to: string; dayCount: number }>;
    previous: Readonly<{ from: string; to: string; dayCount: number }>;
  }>;
  summary: SalesReportingSummary;
  breakdowns: Readonly<Record<SalesBreakdownKey, readonly SalesBreakdownRow[]>>;
  breakdownTotals: Readonly<Record<SalesBreakdownKey, readonly SalesBreakdownRow[]>>;
  reconciliation: Readonly<{
    ok: boolean;
    checkedOrderCount: string;
    mismatchCount: string;
    mismatches: readonly unknown[];
  }>;
  dataQuality: Readonly<{
    customerGroupLegacyFallbackCount: string;
    productGroupLegacyFallbackCount: string;
    unitNameLegacyFallbackCount: string;
    unattributedEmployeeCount: string;
    warnings: readonly string[];
  }>;
  classification: SalesReportingClassification;
  dailyTrend: readonly SalesReportingTrendRow[];
}>;
