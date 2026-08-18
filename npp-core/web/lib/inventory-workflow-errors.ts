export type InventoryWorkflowApiError = {
  code?: string;
  message?: string;
  retryable?: boolean;
  details?: unknown;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function inventoryWorkflowErrorMessage(
  error: InventoryWorkflowApiError | null | undefined,
  fallback = 'Thao tác chưa hoàn tất. Hãy làm mới dữ liệu và thử lại.',
): string {
  const code = String(error?.code ?? '').trim().toUpperCase();

  if (code.includes('SELF_APPROVAL_DENIED')) {
    return 'Bạn không thể tự duyệt phiếu mình đã gửi.';
  }
  if (code.includes('SCOPE_CHANGED')) {
    return 'Tồn kho đã thay đổi sau khi phiếu được lập. Hãy làm mới dữ liệu và thực hiện lại bước cần thiết.';
  }
  if (code.includes('REVISION') || code.includes('VERSION_CONFLICT')) {
    return 'Phiếu đã được cập nhật ở nơi khác. Hãy làm mới dữ liệu trước khi tiếp tục.';
  }
  if (code.includes('WAREHOUSE_SCOPE_DENIED') || code.includes('PERMISSION') || code === 'FORBIDDEN') {
    return 'Bạn không có quyền thực hiện thao tác này trong kho đã chọn.';
  }
  if (code.includes('NOT_FOUND')) {
    return 'Không tìm thấy phiếu hoặc dữ liệu liên quan. Hãy làm mới danh sách.';
  }
  if (code.includes('INVALID_STATUS') || code.includes('INVALID_TRANSITION')) {
    return 'Phiếu không còn ở trạng thái phù hợp cho thao tác này. Hãy làm mới dữ liệu.';
  }
  if (code.includes('QUANTITY')) {
    return 'Số lượng chưa hợp lệ. Hãy kiểm tra lại số đã nhập.';
  }
  if (code.includes('DOWNSTREAM_CONFLICT')) {
    return 'Không thể hoàn tác vì đã có nghiệp vụ phát sinh sau đó. Hãy kiểm tra các chứng từ liên quan.';
  }

  return fallback;
}

export function officeActorLabel(value: string | null | undefined, roleLabel: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) return 'Chưa có';
  if (UUID_PATTERN.test(normalized)) return `${roleLabel} đã được ghi nhận`;
  return normalized;
}
