export type CustomerAddress = {
  id: string;
  label: string;
  address_line1: string;
  ward: string | null;
  district: string | null;
  province: string | null;
  is_active: boolean;
};

export type Customer = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

export type CustomerOnboardingAction =
  | 'review'
  | 'need-more-info'
  | 'approve'
  | 'link-existing'
  | 'reject';

export type CustomerOnboardingRequestSummary = {
  id: string;
  status: string;
  sourceOutletId: string;
  sourceDemandReference: string;
  proposedCustomer: {
    name: string;
    phone: string | null;
    address: {
      addressLine1: string;
      addressLine2: string | null;
      ward: string | null;
      district: string | null;
      province: string | null;
      postalCode: string | null;
      countryCode: string;
      label: string;
    };
  };
  reviewReason: string | null;
  approvedCustomerId: string | null;
  approvedCustomerAddressId: string | null;
  version: number;
  submittedAt: string;
  updatedAt: string;
};

export type OverviewData = {
  branches: number | null;
  warehouses: number | null;
  locations: number | null;
  draftOrders: unknown[];
  onboarding: CustomerOnboardingRequestSummary[];
  warnings: string[];
};
