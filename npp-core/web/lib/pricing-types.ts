export type SalesChannel = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type PriceListType = 'BASE' | 'CHANNEL' | 'CUSTOMER_GROUP' | 'CUSTOMER' | 'PROMOTION' | 'CUSTOM';
export type PriceStackingMode = 'EXCLUSIVE' | 'STACKABLE';
export type PriceAdjustmentType = 'FIXED_PRICE' | 'PERCENT_DISCOUNT' | 'AMOUNT_DISCOUNT' | 'PERCENT_MARKUP' | 'AMOUNT_MARKUP';

export type PriceList = {
  id: string;
  code: string;
  name: string;
  list_type: PriceListType;
  currency_code: string;
  channel_id: string | null;
  customer_group_id: string | null;
  customer_id: string | null;
  priority: number;
  stacking_mode: PriceStackingMode;
  stop_processing: boolean;
  effective_from: string | null;
  effective_to: string | null;
  description: string | null;
  is_active: boolean;
  channel_code: string | null;
  channel_name: string | null;
  customer_group_code: string | null;
  customer_group_name: string | null;
  customer_code: string | null;
  customer_name: string | null;
  created_at: string;
  updated_at: string;
};

export type PriceListItem = {
  id: string;
  price_list_id: string;
  variant_id: string;
  adjustment_type: PriceAdjustmentType;
  amount_minor: string | null;
  rate_bps: number | null;
  min_quantity: string;
  max_quantity: string | null;
  effective_from: string | null;
  effective_to: string | null;
  source_kind: 'ADMIN' | 'IMPORT' | 'CODE';
  source_key: string | null;
  external_rule_code: string | null;
  note: string | null;
  is_active: boolean;
  sku: string;
  variant_name: string;
  product_code: string;
  product_name: string;
  created_at: string;
  updated_at: string;
};

export type PricingVariant = {
  id: string;
  product_id: string;
  sku: string;
  name: string;
  is_active: boolean;
  is_sellable: boolean;
  unit_id: string | null;
  conversion_to_base: string | null;
};

export type PricingResolutionStep = {
  kind: 'BASE' | 'RULE' | 'SKIPPED' | 'MANUAL_OVERRIDE';
  reason?: string;
  priceListId?: string;
  priceListCode?: string;
  priceListType?: string;
  itemId?: string;
  adjustmentType?: PriceAdjustmentType;
  amountMinor?: string | null;
  rateBps?: number | null;
  beforeUnitPriceMinor?: string | null;
  afterUnitPriceMinor?: string | null;
  priority?: number;
  stackingMode?: PriceStackingMode;
  sourceKind?: string;
  sourceKey?: string | null;
  externalRuleCode?: string | null;
};

export type PricingResolution = {
  variant: PricingVariant & { product_code?: string; product_name?: string };
  currencyCode: string;
  quantity: string;
  priceAt: string;
  channelId: string | null;
  customerGroupId: string | null;
  customerId: string | null;
  baseUnitPriceMinor: string;
  finalUnitPriceMinor: string;
  lineTotalMinor: string;
  steps: PricingResolutionStep[];
};

export type PricingCustomerGroup = { id: string; code: string; name: string; is_active: boolean };
export type PricingCustomer = { id: string; code: string; name: string; group_id: string | null; is_active: boolean };
export type PricingProduct = { id: string; code: string; name: string; is_active: boolean };
