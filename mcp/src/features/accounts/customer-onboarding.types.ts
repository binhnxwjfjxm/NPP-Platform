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
  orderId: string;
  orderCode: string | null;
  sessionCustomerId: string;
  sessionId: string | null;
  routeId: string | null;
  routeName: string | null;
  sessionDate: string | null;
  customerName: string;
  phone: string | null;
  area: string | null;
  address: string | null;
  status: CustomerOnboardingQueueStatus;
  coreRequestId: string | null;
  coreCustomerId: string | null;
  coreCustomerAddressId: string | null;
  reviewReason: string | null;
  submittedAt: string | null;
  lastSyncedAt: string | null;
  updatedAt: string | null;
};
