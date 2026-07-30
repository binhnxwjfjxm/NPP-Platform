type ConflictDetails = {
  conflictCode?: string;
  conflictType?: string;
  action?: string | null;
  path?: string | null;
  managementPath?: string | null;
  dependency?: {
    type?: string;
    label?: string;
    count?: number;
    path?: string | null;
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

function normalizedConflictCode(details: ConflictDetails): string {
  const code = String(details.conflictCode ?? '').trim().toUpperCase();
  if (code) return code;
  if (details.conflictType === 'active_dependents') return 'ACTIVE_DEPENDENTS';
  if (details.conflictType === 'stale_version') return 'STALE_VERSION';
  if (details.conflictType === 'domain_conflict') return 'DOMAIN_CONFLICT';
  return '';
}

function dependencySummary(dependency: ConflictDetails['dependency']): string {
  const count = Number(dependency?.count);
  const label = dependency?.label?.trim() || 'Dữ liệu liên quan đang hoạt động';
  return Number.isFinite(count) && count > 0
    ? `${label}: ${Math.trunc(count)}.`
    : `${label}.`;
}

export function formatDeactivateConflictMessage(message: string, details: unknown): string {
  const base = message.trim() || 'Không thể hoàn tất thao tác';
  if (!details || typeof details !== 'object' || Array.isArray(details)) return base;

  const conflict = details as ConflictDetails;
  const conflictCode = normalizedConflictCode(conflict);

  if (conflictCode === 'ACTIVE_DEPENDENTS') {
    const destination = managementLabel(
      conflict.dependency?.path
        || conflict.dependency?.managementPath
        || conflict.path
        || conflict.managementPath,
    );
    const action = conflict.action?.trim();
    const guidance = action
      || (destination ? `Hãy mở ${destination} để xử lý dữ liệu liên quan trước.` : 'Hãy xử lý dữ liệu liên quan trước.');
    return `Không thể ngừng sử dụng vì vẫn còn dữ liệu đang hoạt động. ${dependencySummary(conflict.dependency)} ${guidance}`;
  }

  if (conflictCode === 'STALE_VERSION') {
    return 'Dữ liệu đã được thay đổi ở nơi khác. Bấm Làm mới rồi thực hiện lại thao tác.';
  }

  if (conflictCode === 'DOMAIN_CONFLICT') {
    const destination = managementLabel(conflict.path || conflict.managementPath);
    const guidance = conflict.action?.trim()
      || (destination ? `Hãy mở ${destination} để xử lý trước.` : 'Hãy xử lý dữ liệu liên quan trước.');
    return `${base} ${guidance}`;
  }

  return base;
}
