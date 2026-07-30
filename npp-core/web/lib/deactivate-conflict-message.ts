type ConflictDetails = {
  conflictCode?: string;
  conflictType?: string;
  action?: string | null;
  path?: string | null;
  managementPath?: string | null;
  dependency?: {
    type?: string;
    entityType?: string;
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

const ACTION_GUIDANCE: Record<string, string> = {
  deactivate_skus_first: 'Hãy ngừng các SKU liên quan trước rồi thử lại.',
  reassign_or_deactivate_skus_first: 'Hãy chuyển đơn vị hoặc ngừng các SKU liên quan trước rồi thử lại.',
  deactivate_or_reassign_warehouses_first: 'Hãy ngừng các kho liên quan hoặc chuyển chúng sang chi nhánh khác trước rồi thử lại.',
  deactivate_or_reassign_locations_first: 'Hãy ngừng các vị trí kho liên quan hoặc chuyển chúng sang kho khác trước rồi thử lại.',
  refresh_and_retry: 'Bấm Làm mới rồi thực hiện lại thao tác.',
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

function actionGuidance(action: string | null | undefined, destination: string | null, fallback: string): string {
  const normalized = String(action ?? '').trim();
  if (ACTION_GUIDANCE[normalized]) return ACTION_GUIDANCE[normalized];
  return destination ? `Hãy mở ${destination} để xử lý dữ liệu liên quan trước.` : fallback;
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
    const guidance = actionGuidance(
      conflict.action,
      destination,
      'Hãy xử lý dữ liệu liên quan trước.',
    );
    return `Không thể ngừng sử dụng vì vẫn còn dữ liệu đang hoạt động. ${dependencySummary(conflict.dependency)} ${guidance}`;
  }

  if (conflictCode === 'STALE_VERSION') {
    return 'Dữ liệu đã được thay đổi ở nơi khác. Bấm Làm mới rồi thực hiện lại thao tác.';
  }

  if (conflictCode === 'DOMAIN_CONFLICT') {
    const destination = managementLabel(conflict.path || conflict.managementPath);
    const guidance = actionGuidance(
      conflict.action,
      destination,
      'Hãy xử lý dữ liệu liên quan trước.',
    );
    return `${base} ${guidance}`;
  }

  return base;
}
