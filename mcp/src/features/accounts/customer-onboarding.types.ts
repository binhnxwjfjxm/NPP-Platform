export type CustomerOnboardingStatus =
  | "submitted"
  | "under_review"
  | "need_more_info"
  | "approved"
  | "linked_existing"
  | "rejected"
  | "cancelled";

export type CustomerOnboardingQueueStatus = "not_submitted" | CustomerOnboardingStatus;

export type CustomerOnboardingQueueItem = {
  routeCustomerId: string;
  routeId: string;
  routeName: string | null;
  customerName: string;
  phone: string | null;
  area: string | null;
  address: string | null;
  status: CustomerOnboardingQueueStatus;
  coreRequestId: string | null;
  coreCustomerId: string | null;
  coreCustomerAddressId: string | null;
  coreCustomerCode: string | null;
  reviewReason: string | null;
  submittedAt: string | null;
  lastSyncedAt: string | null;
  updatedAt: string | null;
};
