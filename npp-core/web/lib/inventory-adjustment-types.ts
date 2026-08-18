export type AdjustmentKind = 'MANUAL_ADJUSTMENT' | 'QUARANTINE_TRANSFER' | 'DAMAGED_TRANSFER' | 'SCRAP';
export type AdjustmentStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'POSTED' | 'CANCELLED' | 'REVERSED';

export type AdjustmentReason = {
  code: string;
  documentKind: AdjustmentKind;
  adjustmentDirection: 'IN' | 'OUT' | null;
  label: string;
  description: string;
};

export type AdjustmentLine = {
  id: string;
  lineNumber: number;
  warehouseId: string;
  sourceLocationId: string;
  sourceLocationCode: string | null;
  sourceLocationName: string | null;
  sourceLocationType: string | null;
  destinationLocationId: string | null;
  destinationLocationCode: string | null;
  destinationLocationName: string | null;
  destinationLocationType: string | null;
  sourceVariantId: string;
  sourceSku: string;
  sourceUnitId: string;
  sourceUnitCode: string;
  quantity: string;
  conversionToBase: string;
  baseVariantId: string;
  baseSku: string;
  baseQuantity: string;
  lotId: string | null;
  lotCode: string | null;
  expiryDate: string | null;
  sourceSnapshotScopeVersion: string;
  destinationSnapshotScopeVersion: string | null;
};

export type InventoryAdjustment = {
  id: string;
  adjustmentNumber: string;
  warehouseId: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  documentKind: AdjustmentKind;
  adjustmentDirection: 'IN' | 'OUT' | null;
  reasonCode: string;
  reasonLabel: string | null;
  reasonNote: string;
  status: AdjustmentStatus;
  revision: string;
  correctionOfAdjustmentId: string | null;
  inventoryMovementId: string | null;
  reversalMovementId: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string | null;
  submittedAt: string | null;
  submittedBy?: string | null;
  approvedAt: string | null;
  approvedBy?: string | null;
  postedAt: string | null;
  postedBy?: string | null;
  cancelledAt: string | null;
  cancelledBy?: string | null;
  cancelReason?: string | null;
  reversedAt: string | null;
  reversedBy?: string | null;
  reversalReason?: string | null;
  lineCount: number;
  lines?: AdjustmentLine[];
};

export const adjustmentKindLabels: Record<AdjustmentKind, string> = {
  MANUAL_ADJUSTMENT: 'Điều chỉnh thủ công',
  QUARANTINE_TRANSFER: 'Chuyển cách ly',
  DAMAGED_TRANSFER: 'Chuyển hư hỏng',
  SCRAP: 'Tiêu hủy',
};

export const adjustmentStatusLabels: Record<AdjustmentStatus, string> = {
  DRAFT: 'Lập phiếu',
  SUBMITTED: 'Chờ duyệt',
  APPROVED: 'Chờ cập nhật tồn',
  POSTED: 'Hoàn tất',
  CANCELLED: 'Đã hủy',
  REVERSED: 'Đã hoàn tác',
};
