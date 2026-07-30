type ConflictDetails = {
  conflictCode?: string;
  conflictType?: string;
  managementPath?: string | null;
  dependency?: {
    label?: string;
    count?: number;
    managementPath?: string | null;
  };
};

const MANAGEMENT_LABELS: Record<string, string> = {
  '/products': 'Danh mục sản phẩm',
  '/organization/branches': 'Chi nhánh',
  '/organization/warehouses': 'Kho',
  '/organization/locations': 'Vị trí kho',
};

function managementLabel(path: string | null | undefined): string | null {
  if (!path) return null;
  return MANAGEMENT_LABELS[path] ?? 'màn hình quản lý liên quan';
}

export function formatDeactivateConflictMessage(message: string, details: unknown): string {
  const base = message.trim() || 'Không thể hoàn tất thao tác';
  if (!details || typeof details !== 'object' || Array.isArray(details)) return base;
  const conflict = details as ConflictDetails;

  if (conflict.conflictType === 'active_dependents' && conflict.dependency) {
    const count = Number(conflict.dependency.count);
    const label = conflict.dependency.label?.trim() || 'Dữ liệu liên quan đang hoạt động';
    const summary = Number.isFinite(count) && count > 0 ? `${label}: ${Math.trunc(count)}.` : `${label}.`;
    const destination = managementLabel(conflict.dependency.managementPath || conflict.managementPath);
    return destination
      ? `${base} ${summary} Hãy mở ${destination} để xử lý dữ liệu liên quan.`
      : `${base} ${summary}`;
  }

  if (conflict.conflictType === 'stale_version') {
    return `${base} Bấm Làm mới rồi thực hiện lại thao tác.`;
  }

  if (conflict.conflictType === 'domain_conflict') {
    const destination = managementLabel(conflict.managementPath);
    return destination ? `${base} Hãy mở ${destination} để xử lý trước.` : base;
  }

  return base;
}
