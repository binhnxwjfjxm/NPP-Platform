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

export function formatDeactivateConflictMessage(message: string, details: unknown): string {
  const base = message.trim() || 'Không thể hoàn tất thao tác';
  if (!details || typeof details !== 'object' || Array.isArray(details)) return base;
  const conflict = details as ConflictDetails;

  if (conflict.conflictType === 'active_dependents' && conflict.dependency) {
    const count = Number(conflict.dependency.count);
    const label = conflict.dependency.label?.trim() || 'Dữ liệu liên quan đang hoạt động';
    const summary = Number.isFinite(count) && count > 0 ? `${label}: ${Math.trunc(count)}.` : `${label}.`;
    const path = conflict.dependency.managementPath || conflict.managementPath;
    return path ? `${base} ${summary} Mở màn hình xử lý: ${path}` : `${base} ${summary}`;
  }

  if (conflict.conflictType === 'stale_version') {
    return `${base} Bấm Làm mới rồi thực hiện lại thao tác.`;
  }

  if (conflict.conflictType === 'domain_conflict' && conflict.managementPath) {
    return `${base} Mở màn hình xử lý: ${conflict.managementPath}`;
  }

  return base;
}
