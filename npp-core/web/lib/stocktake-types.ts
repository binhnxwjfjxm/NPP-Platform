export const STOCKTAKE_PERMISSION_KEYS = Object.freeze({
  read: 'core.stocktake.read',
  create: 'core.stocktake.create',
  count: 'core.stocktake.count',
  submit: 'core.stocktake.submit',
  approve: 'core.stocktake.approve',
  post: 'core.stocktake.post',
  cancel: 'core.stocktake.cancel',
  reverse: 'core.stocktake.reverse',
});

export type StocktakeStatus =
  | 'draft'
  | 'counted'
  | 'submitted'
  | 'recount_required'
  | 'approved'
  | 'posted'
  | 'cancelled'
  | 'reversed';

export type StocktakeRound = {
  id: string;
  roundNumber: number;
  status: string;
  reason: string | null;
  createdAt: string;
  createdBy: string;
  countedAt: string | null;
  countedBy: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
};

export type StocktakeLine = {
  id: string;
  roundNumber: number;
  lineNumber: number;
  warehouseId: string;
  locationId: string | null;
  locationCode: string | null;
  locationName: string | null;
  sourceVariantId: string;
  sourceSku: string;
  sourceUnitId: string;
  sourceUnitCode: string;
  conversionToBase: string;
  baseVariantId: string;
  baseSku: string;
  lotId: string | null;
  lotCode: string | null;
  expiryDate: string | null;
  expectedBaseQuantity?: string;
  countedBaseQuantity: string | null;
  finalDelta: string | null;
  snapshotScopeVersion?: string;
  postedScopeVersion: string | null;
  countedAt: string | null;
  countedBy: string | null;
};

export type Stocktake = {
  id: string;
  stocktakeNumber: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  status: StocktakeStatus;
  currentRound: number;
  revision: string;
  note: string | null;
  inventoryMovementId: string | null;
  reversalMovementId: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  postedAt: string | null;
  postedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  reversedAt: string | null;
  reversedBy: string | null;
  reversalReason: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  lineCount: number;
  rounds?: StocktakeRound[];
  lines?: StocktakeLine[];
};

export const STOCKTAKE_STATUS_LABELS: Record<StocktakeStatus, string> = {
  draft: 'Đang đếm',
  counted: 'Chờ gửi duyệt',
  submitted: 'Chờ duyệt',
  recount_required: 'Yêu cầu đếm lại',
  approved: 'Chờ cập nhật tồn',
  posted: 'Hoàn tất',
  cancelled: 'Đã hủy',
  reversed: 'Đã hoàn tác',
};
